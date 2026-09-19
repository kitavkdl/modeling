import { describe, expect, it } from 'vitest'
import { resolveDragTargets, thresholdPx } from './dragMath'
import type { PartDef } from '../types'

const part = (count: number): PartDef => ({
  id: 'p', nameKo: 'p', nameEn: 'p', geometry: { type: 'box', size: [1, 1, 1] }, material: 'm', restPosition: [0, 0, 0],
  mountPosition: [0, 0, 0], mountRotation: [0, 0, 0], requires: [], count,
  instances: Array.from({ length: count }, (_, i) => ({ id: count === 1 ? 'p' : `p_${i}`, mountPosition: [0, 0, 0], mountRotation: [0, 0, 0], geometry: { type: 'box', size: [1, 1, 1] }, order: 0 })),
  cameraView: { azimuth: 0, polar: 60, distance: 1000 }, hint: 'p 장착',
})

describe('thresholdPx', () => {
  it('거리 100 units, 높이 1000px, fov 40에서 150mm는 약 20.6px', () => {
    // 15 units × (1000 / (2 × 100 × tan20°)) = 15 × 13.74 = 206 → 클램프 120
    expect(thresholdPx(150, 100, 1000, 40)).toBe(120)
    // 거리 1000 units → 20.6px
    expect(thresholdPx(150, 1000, 1000, 40)).toBeCloseTo(20.6, 0)
  })
  it('18px 아래로는 내려가지 않는다', () => {
    expect(thresholdPx(10, 5000, 600, 40)).toBe(18)
  })
})

describe('resolveDragTargets (screen space)', () => {
  it('단일 부품: 반경 안이면 snap, 밖이면 null', () => {
    const p = part(1)
    expect(resolveDragTargets(p, { x: 100, y: 100 }, [{ id: 'p', px: { x: 110, y: 105 }, radiusPx: 20 }], {}).snap).toBe('p')
    expect(resolveDragTargets(p, { x: 100, y: 100 }, [{ id: 'p', px: { x: 130, y: 100 }, radiusPx: 20 }], {}).snap).toBeNull()
  })
  it('단일 부품이 이미 장착돼 있으면 null', () => {
    const p = part(1)
    expect(resolveDragTargets(p, { x: 0, y: 0 }, [{ id: 'p', px: { x: 0, y: 0 }, radiusPx: 20 }], { p: { instanceId: 'p', at: 0 } }).snap).toBeNull()
  })
  it('다수 부품: 반경 안의 미장착 슬롯만 paint', () => {
    const p = part(3)
    const ghosts = [
      { id: 'p_0', px: { x: 0, y: 0 }, radiusPx: 10 },
      { id: 'p_1', px: { x: 5, y: 5 }, radiusPx: 10 },
      { id: 'p_2', px: { x: 50, y: 0 }, radiusPx: 10 },
    ]
    expect(resolveDragTargets(p, { x: 0, y: 0 }, ghosts, { p_0: { instanceId: 'p_0', at: 0 } }).paint).toEqual(['p_1'])
  })
})
