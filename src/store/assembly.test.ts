import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PARTS, PART_BY_ID } from '../data/parts'
import { availableParts, isAssemblyComplete, useAssembly } from './assembly'

function mountWholePart(partId: string) {
  const part = PART_BY_ID[partId]
  for (const inst of part.instances) useAssembly.getState().mount(inst.id)
}

function mountUpTo(partId: string) {
  for (const p of PARTS) {
    if (p.id === partId) return
    mountWholePart(p.id)
  }
}

describe('assembly store', () => {
  beforeEach(() => {
    useAssembly.getState().reset()
    vi.useRealTimers()
  })

  it('starts with only the first part available and pre-selected', () => {
    const avail = availableParts(useAssembly.getState().mounted)
    expect(avail.map((p) => p.id)).toEqual([PARTS[0].id])
    expect(useAssembly.getState().selectedPartId).toBe(PARTS[0].id)
  })

  it('auto-selects the next part when one is completed', () => {
    useAssembly.getState().mount('bottom_case')
    expect(useAssembly.getState().selectedPartId).toBe('bottom_foam')
  })

  it('refuses to mount a part whose prerequisites are missing', () => {
    expect(useAssembly.getState().mount('pcb')).toBe(false)
    expect(useAssembly.getState().history).toEqual([])
  })

  it('refuses to select an unavailable part', () => {
    useAssembly.getState().selectPart('plate')
    expect(useAssembly.getState().selectedPartId).toBe('bottom_case')
  })

  it('mounts in order and unlocks the next part', () => {
    expect(useAssembly.getState().mount('bottom_case')).toBe(true)
    expect(availableParts(useAssembly.getState().mounted).map((p) => p.id)).toEqual(['bottom_foam'])
  })

  it('keeps a multi-instance part selected until all instances are mounted', () => {
    mountUpTo('stabilizer')
    useAssembly.getState().selectPart('stabilizer')
    const stab = PART_BY_ID.stabilizer
    useAssembly.getState().mount(stab.instances[0].id)
    expect(useAssembly.getState().selectedPartId).toBe('stabilizer')
    for (const inst of stab.instances.slice(1)) useAssembly.getState().mount(inst.id)
    expect(useAssembly.getState().selectedPartId).toBe('pcb')
    expect(availableParts(useAssembly.getState().mounted).map((p) => p.id)).toEqual(['pcb'])
  })

  it('does not double-mount', () => {
    useAssembly.getState().mount('bottom_case')
    expect(useAssembly.getState().mount('bottom_case')).toBe(false)
    expect(useAssembly.getState().history).toHaveLength(1)
  })

  it('undo removes the last mounted instance and reselects its part', () => {
    mountUpTo('pcb')
    useAssembly.getState().mount('pcb')
    useAssembly.getState().undo()
    const s = useAssembly.getState()
    expect(s.mounted.pcb).toBeUndefined()
    expect(s.selectedPartId).toBe('pcb')
    expect(s.history[s.history.length - 1]).toBe(PART_BY_ID.stabilizer.instances.at(-1)!.id)
  })

  it('undo on empty history is a no-op', () => {
    useAssembly.getState().undo()
    expect(useAssembly.getState().history).toEqual([])
  })

  it('mountAll mounts every remaining instance in wave order', () => {
    vi.useFakeTimers()
    mountUpTo('switch')
    useAssembly.getState().mountAll('switch', 20)
    vi.runAllTimers()
    const s = useAssembly.getState()
    expect(s.sequencing).toBe(false)
    const sw = PART_BY_ID.switch
    expect(sw.instances.every((i) => s.mounted[i.id])).toBe(true)
    const orders = s.history.slice(-sw.count).map((id) => sw.instances.find((i) => i.id === id)!.order)
    for (let i = 1; i < orders.length; i++) expect(orders[i]).toBeGreaterThanOrEqual(orders[i - 1])
  })

  it('undo during mountAll stops the sequence', () => {
    vi.useFakeTimers()
    mountUpTo('switch')
    useAssembly.getState().mountAll('switch', 20)
    vi.advanceTimersByTime(100)
    const before = useAssembly.getState().history.length
    useAssembly.getState().undo()
    vi.runAllTimers()
    expect(useAssembly.getState().history.length).toBe(before - 1)
    expect(useAssembly.getState().sequencing).toBe(false)
  })

  it('enters complete phase when every part is mounted, then plugs the cable', () => {
    for (const p of PARTS) mountWholePart(p.id)
    expect(isAssemblyComplete(useAssembly.getState().mounted)).toBe(true)
    expect(useAssembly.getState().phase).toBe('complete')
    useAssembly.getState().plugCable()
    expect(useAssembly.getState().phase).toBe('plugging')
    // 전원 시퀀스가 시작되면 되돌리기와 장착이 막힌다
    useAssembly.getState().undo()
    expect(useAssembly.getState().phase).toBe('plugging')
    expect(useAssembly.getState().history).toHaveLength(
      PARTS.reduce((n, p) => n + p.count, 0),
    )
  })

  it('undo from complete phase returns to assembly', () => {
    for (const p of PARTS) mountWholePart(p.id)
    useAssembly.getState().undo()
    expect(useAssembly.getState().phase).toBe('assembly')
    expect(useAssembly.getState().selectedPartId).toBe('keycap')
  })

  it('plugCable is ignored before completion', () => {
    useAssembly.getState().plugCable()
    expect(useAssembly.getState().phase).toBe('assembly')
  })
})
