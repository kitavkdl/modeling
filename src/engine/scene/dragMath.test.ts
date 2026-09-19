import { describe, expect, it } from 'vitest'
import { PART_BY_ID } from '../../products/keyboard/parts'
import { resolveDragTargets } from './dragMath'

const drag = { snapMm: 60, paintMm: 12, hoverMm: 30, grabMinMm: 50 }

describe('resolveDragTargets', () => {
  it('snaps a single part when within snapMm horizontally', () => {
    const pcb = PART_BY_ID.pcb
    expect(resolveDragTargets(pcb, [30, 999, 40], drag, {}).snap).toBe('pcb')
    expect(resolveDragTargets(pcb, [61, 0, 0], drag, {}).snap).toBeNull()
    expect(resolveDragTargets(pcb, [0, 0, 0], drag, { pcb: { instanceId: 'pcb', at: 0 } }).snap).toBeNull()
  })

  it('paints every unmounted multi instance within paintMm', () => {
    const sw = PART_BY_ID.switch
    const q = sw.instances.find((i) => i.tag === 'q')!
    const [x, , z] = q.mountPosition
    const r = resolveDragTargets(sw, [x + 5, 0, z - 5], drag, {})
    expect(r.snap).toBeNull()
    expect(r.paint).toEqual(['switch:q'])
    expect(resolveDragTargets(sw, [x + 5, 0, z - 5], drag, { 'switch:q': { instanceId: 'switch:q', at: 0 } }).paint).toEqual([])
  })
})
