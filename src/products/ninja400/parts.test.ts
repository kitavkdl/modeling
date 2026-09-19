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
})
