import { describe, expect, it } from 'vitest'
import { resolveAlongSegment, resolveDragTargets, thresholdPx } from './dragMath'
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
  it('다수 부품: 반경 안에 여럿이면 가장 가까운 하나만 paint (뒷줄 겹침 방지)', () => {
    const p = part(3)
    const ghosts = [
      { id: 'p_0', px: { x: 2, y: 0 }, radiusPx: 20 },
      { id: 'p_1', px: { x: 6, y: 6 }, radiusPx: 20 },
      { id: 'p_2', px: { x: 50, y: 0 }, radiusPx: 20 },
    ]
    expect(resolveDragTargets(p, { x: 0, y: 0 }, ghosts, {}).paint).toEqual(['p_0'])
  })
})

describe('resolveAlongSegment (빠른 쓸기)', () => {
  const ghosts = [
    { id: 'p_0', px: { x: 0, y: 0 }, radiusPx: 20 },
    { id: 'p_1', px: { x: 60, y: 0 }, radiusPx: 20 },
  ]
  it('반경 20짜리 슬롯 두 개가 60px 떨어져 있어도 80px 한 방에 둘 다 박힌다', () => {
    // 한 번의 pointermove가 슬롯 하나만 박으면 p_1이 빠진다. 구간을 10px(반경의 절반)씩 밟으면 둘 다 걸린다.
    expect(resolveAlongSegment(part(2), { x: -5, y: 0 }, { x: 75, y: 0 }, ghosts, {}, 10)).toEqual(['p_0', 'p_1'])
  })
  it('이미 장착된 슬롯은 건너뛰고, 같은 슬롯을 두 번 담지 않는다', () => {
    const taken = resolveAlongSegment(part(2), { x: -5, y: 0 }, { x: 75, y: 0 }, ghosts, { p_0: { instanceId: 'p_0', at: 0 } }, 10)
    expect(taken).toEqual(['p_1'])
  })
  it('제자리(from === to)면 그 지점만 판정한다', () => {
    expect(resolveAlongSegment(part(2), { x: 60, y: 0 }, { x: 60, y: 0 }, ghosts, {}, 10)).toEqual(['p_1'])
  })
  it('단일 부품은 페인팅이 없으므로 빈 배열', () => {
    expect(resolveAlongSegment(part(1), { x: 0, y: 0 }, { x: 80, y: 0 }, [{ id: 'p', px: { x: 0, y: 0 }, radiusPx: 20 }], {}, 10)).toEqual([])
  })
})
