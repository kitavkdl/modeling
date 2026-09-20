import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PARTS, PART_BY_ID } from '../products/keyboard/parts'
import { keyboardProduct as product } from '../products/keyboard'
import type { Mounted, PartDef, ProductDef } from './types'
import {
  availableParts,
  canSkip,
  canUndo,
  createAssemblyStore,
  isAssemblyComplete,
  isAssemblyHidden,
  isFloorHidden,
  isStationSeated,
  stationOffset,
  validateProduct,
  visibleParts,
  type AssemblyStore,
} from './store'

let store: AssemblyStore

function mountWholePart(partId: string) {
  for (const inst of PART_BY_ID[partId].instances) store.getState().mount(inst.id)
}
function mountUpTo(partId: string) {
  for (const p of PARTS) {
    if (p.id === partId) return
    mountWholePart(p.id)
  }
}

describe('assembly store', () => {
  beforeEach(() => {
    store = createAssemblyStore(product)
    vi.useRealTimers()
  })

  it('starts with only the first part available and pre-selected', () => {
    const avail = availableParts(product, store.getState().mounted)
    expect(avail.map((p) => p.id)).toEqual([PARTS[0].id])
    expect(store.getState().selectedPartId).toBe(PARTS[0].id)
  })

  it('auto-selects the next part when one is completed', () => {
    store.getState().mount('bottom_case')
    expect(store.getState().selectedPartId).toBe('bottom_foam')
  })

  it('refuses to mount a part whose prerequisites are missing', () => {
    expect(store.getState().mount('pcb')).toBe(false)
    expect(store.getState().history).toEqual([])
  })

  it('refuses to select an unavailable part', () => {
    store.getState().selectPart('plate')
    expect(store.getState().selectedPartId).toBe('bottom_case')
  })

  it('mounts in order and unlocks the next part', () => {
    expect(store.getState().mount('bottom_case')).toBe(true)
    expect(availableParts(product, store.getState().mounted).map((p) => p.id)).toEqual(['bottom_foam'])
  })

  it('keeps a multi-instance part selected until all instances are mounted', () => {
    mountUpTo('stabilizer')
    store.getState().selectPart('stabilizer')
    const stab = PART_BY_ID.stabilizer
    store.getState().mount(stab.instances[0].id)
    expect(store.getState().selectedPartId).toBe('stabilizer')
    for (const inst of stab.instances.slice(1)) store.getState().mount(inst.id)
    expect(store.getState().selectedPartId).toBe('pcb')
    expect(availableParts(product, store.getState().mounted).map((p) => p.id)).toEqual(['pcb'])
  })

  it('records the drag drop position as the animation start', () => {
    store.getState().mount('bottom_case', [10, 30, 20])
    expect(store.getState().mounted.bottom_case.from).toEqual([10, 30, 20])
    store.getState().mount('bottom_foam')
    expect(store.getState().mounted.bottom_foam.from).toBeUndefined()
  })

  it('does not double-mount', () => {
    store.getState().mount('bottom_case')
    expect(store.getState().mount('bottom_case')).toBe(false)
    expect(store.getState().history).toHaveLength(1)
  })

  it('undo removes the last mounted instance and reselects its part', () => {
    mountUpTo('pcb')
    store.getState().mount('pcb')
    store.getState().undo()
    const s = store.getState()
    expect(s.mounted.pcb).toBeUndefined()
    expect(s.selectedPartId).toBe('pcb')
    expect(s.history[s.history.length - 1]).toBe(PART_BY_ID.stabilizer.instances.at(-1)!.id)
  })

  it('undo on empty history is a no-op', () => {
    store.getState().undo()
    expect(store.getState().history).toEqual([])
  })

  it('mountAll mounts every remaining instance in wave order', () => {
    vi.useFakeTimers()
    mountUpTo('switch')
    store.getState().mountAll('switch', 20)
    vi.runAllTimers()
    const s = store.getState()
    expect(s.sequencing).toBe(false)
    const sw = PART_BY_ID.switch
    expect(sw.instances.every((i) => s.mounted[i.id])).toBe(true)
    const orders = s.history.slice(-sw.count).map((id) => sw.instances.find((i) => i.id === id)!.order)
    for (let i = 1; i < orders.length; i++) expect(orders[i]).toBeGreaterThanOrEqual(orders[i - 1])
  })

  it('undo during mountAll stops the sequence', () => {
    vi.useFakeTimers()
    mountUpTo('switch')
    store.getState().mountAll('switch', 20)
    vi.advanceTimersByTime(100)
    const before = store.getState().history.length
    store.getState().undo()
    vi.runAllTimers()
    expect(store.getState().history.length).toBe(before - 1)
    expect(store.getState().sequencing).toBe(false)
  })

  it('enters complete phase when every part is mounted, then plugs the cable', () => {
    for (const p of PARTS) mountWholePart(p.id)
    expect(isAssemblyComplete(product, store.getState().mounted)).toBe(true)
    expect(store.getState().phase).toBe('complete')
    store.getState().advancePhase()
    expect(store.getState().phase).toBe('plugging')
    // 전원 시퀀스가 시작되면 되돌리기와 장착이 막힌다
    store.getState().undo()
    expect(store.getState().phase).toBe('plugging')
    expect(store.getState().history).toHaveLength(
      PARTS.reduce((n, p) => n + p.count, 0),
    )
  })

  it('undo from complete phase returns to assembly', () => {
    for (const p of PARTS) mountWholePart(p.id)
    store.getState().undo()
    expect(store.getState().phase).toBe('assembly')
    expect(store.getState().selectedPartId).toBe('keycap')
  })

  it('station is lifted until the marrying part is mounted, and lifted again after undo', () => {
    mountUpTo('gasket')
    expect(isStationSeated(product, store.getState().mounted, 'sandwich')).toBe(false)
    expect(stationOffset(product, PART_BY_ID.pcb, store.getState().mounted)).toEqual([0, 45, 0])
    store.getState().mount('gasket')
    expect(isStationSeated(product, store.getState().mounted, 'sandwich')).toBe(true)
    expect(stationOffset(product, PART_BY_ID.pcb, store.getState().mounted)).toEqual([0, 0, 0])
    expect(stationOffset(product, PART_BY_ID.bottom_case, store.getState().mounted)).toEqual([0, 0, 0])
    store.getState().undo()
    expect(isStationSeated(product, store.getState().mounted, 'sandwich')).toBe(false)
  })

  it('advancePhase walks phasesAfterComplete in order and stops at the end', () => {
    for (const p of PARTS) mountWholePart(p.id)
    expect(store.getState().phase).toBe('complete')
    store.getState().advancePhase()
    expect(store.getState().phase).toBe('plugging')
    store.getState().advancePhase(); store.getState().advancePhase(); store.getState().advancePhase()
    expect(store.getState().phase).toBe('on')
    store.getState().advancePhase()
    expect(store.getState().phase).toBe('on')
    // 후속 단계에서는 되돌리기와 장착이 막힌다
    store.getState().undo()
    expect(store.getState().phase).toBe('on')
  })

  it('advancePhase is ignored during assembly', () => {
    store.getState().advancePhase()
    expect(store.getState().phase).toBe('assembly')
  })

  it('requires a variant when the part defines variants, and undo clears it', () => {
    const painted = {
      ...product,
      parts: [
        { ...PARTS[0], variants: [{ id: 'a', label: 'A', swatch: '#fff' }, { id: 'b', label: 'B', swatch: '#000' }] },
        ...PARTS.slice(1),
      ],
    }
    const s = createAssemblyStore(painted)
    expect(s.getState().mount('bottom_case')).toBe(false)
    expect(s.getState().mount('bottom_case', undefined, 'zzz')).toBe(false)
    expect(s.getState().mount('bottom_case', undefined, 'b')).toBe(true)
    expect(s.getState().mounted.bottom_case.variant).toBe('b')
    s.getState().undo()
    expect(s.getState().mounted.bottom_case).toBeUndefined()
  })

  it('preplaced parts start mounted and survive reset', () => {
    const pre = { ...product, parts: [{ ...PARTS[0], preplaced: true }, ...PARTS.slice(1)] }
    const s = createAssemblyStore(pre)
    expect(s.getState().mounted.bottom_case).toBeDefined()
    expect(s.getState().history).toEqual([])
    expect(s.getState().selectedPartId).toBe('bottom_foam')
    s.getState().mount('bottom_foam')
    s.getState().reset()
    expect(s.getState().mounted.bottom_case).toBeDefined()
    expect(s.getState().mounted.bottom_foam).toBeUndefined()
  })
})

function tinyProduct(withPhaseOnMount = false, withStation = false, bCount = 2): ProductDef {
  // 부품 3개: a(preplaced) → b(count bCount) → c(마지막, phaseOnMount)
  const mk = (id: string, count: number, requires: string[], extra: Partial<PartDef> = {}): PartDef => ({
    id,
    nameKo: id,
    nameEn: id,
    geometry: { type: 'box', size: [10, 10, 10] },
    material: 'm',
    restPosition: [0, 0, 500],
    mountPosition: [0, 0, 0],
    mountRotation: [0, 0, 0],
    requires,
    count,
    instances: Array.from({ length: count }, (_, i) => ({
      // 멀티 인스턴스 부품은 `partId:key` 규칙을 쓴다 (partOf가 ':' 앞을 partId로 본다)
      id: count === 1 ? id : `${id}:${i}`,
      mountPosition: [i * 20, 0, 0],
      mountRotation: [0, 0, 0],
      geometry: { type: 'box', size: [10, 10, 10] },
      order: i / Math.max(1, count - 1),
    })),
    cameraView: { azimuth: 0, polar: 60, distance: 1000 },
    hint: `${id} 장착`,
    ...extra,
  })
  return {
    ...product,
    phasesAfterComplete: ['keyed', 'running'],
    parts: [
      mk('a', 1, [], { preplaced: true }),
      // withStation이면 b는 키보드 제품의 'sandwich' 작업대(offset [0, 45, 0]) 소속이고 c가 그것을 결합한다.
      // 결합 전이라 b의 대기 위치(월드)에서 작업대 오프셋을 빼야 작업대 로컬 출발점이 된다.
      mk('b', bCount, ['a'], withStation ? { station: 'sandwich', restPosition: [0, 500, 500] } : {}),
      mk('c', 1, ['b'], {
        ...(withPhaseOnMount ? { phaseOnMount: 'keyed' as const } : {}),
        ...(withStation ? { marries: 'sandwich' } : {}),
      }),
    ],
  }
}

describe('skipCurrent / phaseOnMount', () => {
  beforeEach(() => {
    vi.useRealTimers()
  })

  it('skipCurrent는 선택 부품의 남은 인스턴스를 전부 장착하고 대기 위치를 from으로 남긴다', async () => {
    vi.useFakeTimers()
    const store = createAssemblyStore(tinyProduct())
    expect(store.getState().selectedPartId).toBe('b')
    expect(canSkip(store.getState())).toBe(true)
    store.getState().skipCurrent()
    expect(canSkip(store.getState())).toBe(false) // sequencing 중
    await vi.runAllTimersAsync()
    expect(store.getState().mounted['b:0'].from).toEqual([0, 0, 500])
    expect(store.getState().mounted['b:1']).toBeDefined()
    expect(store.getState().selectedPartId).toBe('c')
  })

  it('작업대 부품을 건너뛰면 대기 위치에서 작업대 오프셋을 뺀 자리에서 떨어진다', async () => {
    vi.useFakeTimers()
    const store = createAssemblyStore(tinyProduct(false, true))
    // 작업대 'sandwich'는 offset [0, 45, 0]이고 c가 결합하기 전이라 아직 떠 있다
    expect(stationOffset(store.getState().product, store.getState().product.parts[1], store.getState().mounted))
      .toEqual([0, 45, 0])
    store.getState().skipCurrent()
    await vi.runAllTimersAsync()
    // 대기 위치 [0, 500, 500] − 작업대 오프셋 [0, 45, 0]
    expect(store.getState().mounted['b:0'].from).toEqual([0, 455, 500])
    expect(store.getState().mounted['b:1'].from).toEqual([0, 455, 500])
  })

  it('dispose가 돌고 있는 시퀀스를 끊는다', () => {
    vi.useFakeTimers()
    const store = createAssemblyStore(tinyProduct(false, false, 3))
    store.getState().skipCurrent()
    // mountAll의 첫 걸음은 동기라 b:0은 이미 박혀 있고, 나머지는 타이머 위에 있다
    expect(store.getState().mounted['b:0']).toBeDefined()
    expect(store.getState().sequencing).toBe(true)

    store.getState().dispose()
    expect(store.getState().sequencing).toBe(false)

    vi.runAllTimers()
    expect(store.getState().mounted['b:0']).toBeDefined()
    expect(store.getState().mounted['b:1']).toBeUndefined()
    expect(store.getState().mounted['b:2']).toBeUndefined()
    expect(store.getState().sequencing).toBe(false)
  })

  it('canUndo는 phaseOnMount 단계에서는 참, 그 뒤 단계에서는 거짓', () => {
    const store = createAssemblyStore(tinyProduct(true))
    expect(canUndo(store.getState())).toBe(false) // 히스토리가 비었다
    store.getState().mount('b:0')
    expect(canUndo(store.getState())).toBe(true)
    store.getState().mount('b:1')
    store.getState().mount('c')
    expect(store.getState().phase).toBe('keyed')
    expect(canUndo(store.getState())).toBe(true)
    store.getState().advancePhase() // keyed → running
    expect(canUndo(store.getState())).toBe(false)
  })

  it('마지막 부품에 phaseOnMount가 있으면 complete 대신 그 phase로 간다', () => {
    const store = createAssemblyStore(tinyProduct(true))
    store.getState().mount('b:0')
    store.getState().mount('b:1')
    store.getState().mount('c')
    expect(store.getState().phase).toBe('keyed')
  })

  it('phaseOnMount로 간 phase에서는 되돌리기가 허용되고 assembly로 돌아온다', () => {
    const store = createAssemblyStore(tinyProduct(true))
    store.getState().mount('b:0')
    store.getState().mount('b:1')
    store.getState().mount('c')
    store.getState().undo()
    expect(store.getState().phase).toBe('assembly')
    expect(store.getState().mounted.c).toBeUndefined()
    expect(store.getState().selectedPartId).toBe('c')
  })

  it('phaseOnMount 뒤로 advancePhase하면 되돌리기가 막힌다', () => {
    const store = createAssemblyStore(tinyProduct(true))
    store.getState().mount('b:0')
    store.getState().mount('b:1')
    store.getState().mount('c')
    store.getState().advancePhase() // keyed → running
    expect(store.getState().phase).toBe('running')
    store.getState().undo()
    expect(store.getState().phase).toBe('running')
  })

  it('canSkip은 선택 부품이 없거나 sequencing 중이면 false', () => {
    const store = createAssemblyStore(tinyProduct())
    store.getState().selectPart(null)
    expect(canSkip(store.getState())).toBe(false)
  })
})

describe('validateProduct', () => {
  it('has no problems for the keyboard product', () => {
    expect(validateProduct(product)).toEqual([])
  })

  it('flags a station that has parts but nothing marries it', () => {
    const broken: ProductDef = {
      ...product,
      stations: [...product.stations, { id: 'orphan', nameKo: '고아', offset: [0, 0, 0] }],
      parts: [{ ...PARTS[0], station: 'orphan' }, ...PARTS.slice(1)],
    }
    const messages = validateProduct(broken)
    expect(messages).toHaveLength(1)
    expect(messages[0]).toContain('orphan')
  })
})

describe('isAssemblyHidden', () => {
  it('훅이 없으면 숨기지 않는다', () => {
    const store = createAssemblyStore(tinyProduct())
    expect(isAssemblyHidden(store.getState().product, store.getState())).toBe(false)
  })

  it('훅에 현재 phase와 장착표를 넘기고 그 결과를 그대로 쓴다', () => {
    const seen: Array<{ phase: string; mounted: Mounted }> = []
    const base = tinyProduct(true)
    const hidden: ProductDef = {
      ...base,
      assemblyHidden: (s) => {
        seen.push(s)
        return s.phase !== 'assembly'
      },
    }
    const store = createAssemblyStore(hidden)
    expect(isAssemblyHidden(hidden, store.getState())).toBe(false)
    store.getState().mount('b:0')
    store.getState().mount('b:1')
    store.getState().mount('c') // 마지막 부품 → phaseOnMount로 keyed
    expect(store.getState().phase).toBe('keyed')
    expect(isAssemblyHidden(hidden, store.getState())).toBe(true)
    expect(seen[seen.length - 1].mounted['c']).toBeDefined()
    expect(seen.map((s) => s.phase)).toContain('assembly')
  })
})

describe('isFloorHidden', () => {
  it('훅이 없으면 숨기지 않는다', () => {
    expect(isFloorHidden(product, { phase: 'running', mounted: {} })).toBe(false)
  })

  it('제품이 올리면 그 단계에서만 숨긴다', () => {
    const withHook: ProductDef = { ...product, floorHidden: (s) => s.phase === 'running' }
    expect(isFloorHidden(withHook, { phase: 'running', mounted: {} })).toBe(true)
    expect(isFloorHidden(withHook, { phase: 'assembly', mounted: {} })).toBe(false)
  })
})

describe('visibleParts', () => {
  const parts = product.parts.slice(0, 3)

  it('숨기지 않으면 받은 목록 그대로', () => {
    expect(visibleParts(product, parts, false)).toEqual(parts)
  })

  it('숨기면 alwaysVisibleParts에 든 것만 남는다', () => {
    const withAlways: ProductDef = { ...product, alwaysVisibleParts: [parts[1].id] }
    expect(visibleParts(withAlways, parts, true).map((p) => p.id)).toEqual([parts[1].id])
  })

  it('alwaysVisibleParts가 없으면 숨길 때 아무것도 안 남는다', () => {
    expect(visibleParts(product, parts, true)).toEqual([])
  })
})
