import { describe, expect, it } from 'vitest'
import { validateGeometry } from '../../engine/types'
import { PARTS, PART_BY_ID, PROPS, STATIONS } from './parts'
import { NINJA_MATERIALS } from './materials'

describe('ninja400 parts', () => {
  it('has unique part and instance ids', () => {
    const ids = PARTS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    const inst = PARTS.flatMap((p) => p.instances.map((i) => i.id))
    expect(new Set(inst).size).toBe(inst.length)
  })
  it('count matches instances and every geometry validates', () => {
    for (const p of PARTS) {
      expect(p.instances, p.id).toHaveLength(p.count)
      expect(validateGeometry(p.geometry), p.id).toEqual([])
      for (const i of p.instances) expect(validateGeometry(i.geometry), i.id).toEqual([])
    }
    for (const s of STATIONS) if (s.prop) expect(validateGeometry(s.prop), s.id).toEqual([])
    for (const pr of PROPS) expect(validateGeometry(pr.geometry)).toEqual([])
  })
  it('requires reference only earlier parts; first part is preplaced', () => {
    expect(PARTS[0].preplaced).toBe(true)
    const seen = new Set<string>()
    for (const p of PARTS) {
      for (const r of p.requires) expect(seen.has(r), `${p.id} requires ${r}`).toBe(true)
      seen.add(p.id)
    }
  })
  it('stations exist and marrying parts come after their station parts', () => {
    const stationIds = new Set(STATIONS.map((s) => s.id))
    for (const p of PARTS) if (p.station) expect(stationIds.has(p.station), p.id).toBe(true)
    for (const s of STATIONS) {
      const memberIdx = PARTS.map((p, i) => (p.station === s.id ? i : -1)).filter((i) => i >= 0)
      const marryIdx = PARTS.findIndex((p) => p.marries === s.id)
      if (memberIdx.length > 0) {
        expect(marryIdx, s.id).toBeGreaterThan(Math.max(...memberIdx))
      }
    }
  })
  it('materials referenced exist; paintable parts start in primer', () => {
    for (const p of PARTS) {
      expect(NINJA_MATERIALS[p.material], `${p.id} material ${p.material}`).toBeDefined()
      if (p.paintable) expect(p.material).toBe('primer')
    }
  })
  it('the frame sits on the ground plane and the axles match the wheelbase', async () => {
    const { FRONT_AXLE, REAR_AXLE, WHEELBASE } = await import('./spec')
    expect(FRONT_AXLE[0] - REAR_AXLE[0]).toBe(WHEELBASE)
    expect(PART_BY_ID.main_frame.mountPosition[1]).toBeGreaterThan(0)
  })
  it('engine station has 27 parts and the mount bolts marry it after all of them', () => {
    const engine = PARTS.filter((p) => p.station === 'engine')
    expect(engine).toHaveLength(27)
    expect(engine[0].id).toBe('crankcase_lower')
    const bolts = PART_BY_ID.engine_mount_bolt
    expect(bolts.marries).toBe('engine')
    expect(bolts.count).toBe(4)
    expect(bolts.requires).toEqual(['drive_sprocket', 'subframe'])
    expect(PART_BY_ID.valve.count).toBe(8)
    expect(PART_BY_ID.piston.count).toBe(2)
  })
  it('wheel stations marry with axles that also require the fork / swingarm', () => {
    expect(PART_BY_ID.front_axle.marries).toBe('front_wheel')
    expect(PART_BY_ID.front_axle.requires).toEqual(['front_disc', 'fork'])
    expect(PART_BY_ID.rear_axle.marries).toBe('rear_wheel')
    expect(PART_BY_ID.rear_axle.requires).toEqual(['rear_sprocket', 'swingarm'])
    expect(PART_BY_ID.chain.requires).toEqual(['rear_axle', 'drive_sprocket'])
    expect(PART_BY_ID.fork.count).toBe(2)
    expect(PART_BY_ID.front_wheel.mountPosition).toEqual([685, 293, 0])
  })
  it('lamps use lamp_off and the tank is paintable', () => {
    for (const id of ['headlight', 'taillight', 'turn_signal']) expect(PART_BY_ID[id].material).toBe('lamp_off')
    expect(PART_BY_ID.fuel_tank.paintable).toBe(true)
    expect(PART_BY_ID.turn_signal.count).toBe(4)
    expect(PART_BY_ID.radiator.requires).toEqual(['chain'])
  })
})
