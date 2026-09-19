import { describe, expect, it } from 'vitest'
import { validateGeometry } from '../../engine/types'
import {
  KEY_COUNT,
  KEY_LAYOUT,
  LAYOUT_COLS,
  PARTS,
  PART_BY_ID,
  STABILIZED_KEYS,
  STATIONS,
  findInstance,
  keyCenter,
  partOfInstance,
} from './parts'

describe('parts data', () => {
  it('has unique part ids', () => {
    const ids = PARTS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('has unique instance ids across all parts', () => {
    const ids = PARTS.flatMap((p) => p.instances.map((i) => i.id))
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('count matches instances', () => {
    for (const p of PARTS) expect(p.instances).toHaveLength(p.count)
  })

  it('requires only reference earlier parts (acyclic, ordered)', () => {
    const seen = new Set<string>()
    for (const p of PARTS) {
      for (const r of p.requires) {
        expect(PART_BY_ID[r], `${p.id} requires unknown ${r}`).toBeDefined()
        expect(seen.has(r), `${p.id} requires ${r} which comes later`).toBe(true)
      }
      seen.add(p.id)
    }
  })

  it('only the first part has no prerequisites', () => {
    expect(PARTS[0].requires).toEqual([])
    for (const p of PARTS.slice(1)) expect(p.requires.length).toBeGreaterThan(0)
  })

  it('every geometry validates', () => {
    for (const p of PARTS) {
      expect(validateGeometry(p.geometry), p.id).toEqual([])
      for (const inst of p.instances) expect(validateGeometry(inst.geometry), inst.id).toEqual([])
    }
  })

  it('uses the sandwich station and gasket marries it after all station parts', () => {
    expect(STATIONS.map((s) => s.id)).toEqual(['sandwich'])
    const stationIdx = PARTS.map((p, i) => (p.station === 'sandwich' ? i : -1)).filter((i) => i >= 0)
    const marryIdx = PARTS.findIndex((p) => p.marries === 'sandwich')
    expect(stationIdx.length).toBe(5)
    expect(Math.max(...stationIdx)).toBeLessThan(marryIdx)
    expect(PARTS[marryIdx].id).toBe('gasket')
  })

  it('keycap instances use frustum geometry and switches are composites', () => {
    expect(PART_BY_ID.keycap.instances[0].geometry.type).toBe('frustum')
    expect(PART_BY_ID.switch.geometry.type).toBe('composite')
  })

  it('stabilizer keys exist in the layout and count matches', () => {
    for (const id of STABILIZED_KEYS) expect(KEY_LAYOUT.find((k) => k.id === id)).toBeDefined()
    expect(PART_BY_ID.stabilizer.count).toBe(STABILIZED_KEYS.length)
  })

  it('switch and keycap counts equal KEY_COUNT', () => {
    expect(PART_BY_ID.switch.count).toBe(KEY_COUNT)
    expect(PART_BY_ID.keycap.count).toBe(KEY_COUNT)
  })

  it('keys do not overlap within a row and stay inside the layout', () => {
    for (let row = 0; row < 6; row++) {
      const keys = KEY_LAYOUT.filter((k) => k.row === row).sort((a, b) => a.col - b.col)
      for (let i = 1; i < keys.length; i++) {
        expect(keys[i].col).toBeGreaterThanOrEqual(keys[i - 1].col + keys[i - 1].w - 1e-6)
      }
      const last = keys[keys.length - 1]
      expect(last.col + last.w).toBeLessThanOrEqual(LAYOUT_COLS + 1e-6)
    }
  })

  it('key centers are symmetric around the origin for the full-width bottom row', () => {
    const [xl] = keyCenter(KEY_LAYOUT.find((k) => k.id === 'lctrl')!)
    const [xr] = keyCenter(KEY_LAYOUT.find((k) => k.id === 'right')!)
    expect(xl).toBeLessThan(0)
    expect(xr).toBeGreaterThan(0)
  })

  it('resolves instances back to their part', () => {
    expect(partOfInstance('switch:space').id).toBe('switch')
    expect(findInstance('keycap:esc').tag).toBe('esc')
    expect(partOfInstance('pcb').id).toBe('pcb')
    expect(() => findInstance('switch:nope')).toThrow()
  })
})
