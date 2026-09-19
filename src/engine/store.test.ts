import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PARTS, PART_BY_ID } from '../products/keyboard/parts'
import { keyboardProduct as product } from '../products/keyboard'
import { availableParts, createAssemblyStore, isAssemblyComplete, isStationSeated, stationOffset, type AssemblyStore } from './store'

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
