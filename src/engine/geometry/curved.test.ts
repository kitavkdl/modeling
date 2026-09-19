import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { curvedGeometry } from './curved'
import { validateGeometry, type Geometry } from '../types'

const bbox = (g: THREE.BufferGeometry) => { g.computeBoundingBox(); const b = g.boundingBox!; return { min: b.min.toArray(), max: b.max.toArray() } }
const close = (a: number[], b: number[], tol = 0.02) => a.every((v, i) => Math.abs(v - b[i]) <= tol)

describe('curved primitives', () => {
  it('lathe: 반지름 100·높이 200 원통 프로필의 bbox는 ±10 x/z, 0..20 y (units)', () => {
    const g = curvedGeometry({ type: 'lathe', profile: [[100, 0], [100, 200], [0, 200]], segments: 32 })
    const b = bbox(g)
    expect(close(b.min, [-10, 0, -10])).toBe(true)
    expect(close(b.max, [10, 20, 10])).toBe(true)
  })
  it('tube: 직선 경로 x 0..1000, 반지름 20 → bbox x ≈ 0..100, y/z ±2', () => {
    const g = curvedGeometry({ type: 'tube', path: [[0, 0, 0], [500, 0, 0], [1000, 0, 0]], radius: 20, segments: 16 })
    const b = bbox(g)
    expect(close(b.min, [0, -2, -2], 0.3)).toBe(true)
    expect(close(b.max, [100, 2, 2], 0.3)).toBe(true)
  })
  it('extrude: 100x50 사각형, depth 30 → x ±5, y ±2.5, z ±1.5', () => {
    const g = curvedGeometry({ type: 'extrude', shape: [[-50, -25], [50, -25], [50, 25], [-50, 25]], depth: 30 })
    const b = bbox(g)
    expect(close(b.min, [-5, -2.5, -1.5])).toBe(true)
    expect(close(b.max, [5, 2.5, 1.5])).toBe(true)
  })
  it('extrude with hole: 구멍이 있으면 정점 수가 늘고 여전히 유효', () => {
    const solid = curvedGeometry({ type: 'extrude', shape: [[-50, -25], [50, -25], [50, 25], [-50, 25]], depth: 10 })
    const holed = curvedGeometry({ type: 'extrude', shape: [[-50, -25], [50, -25], [50, 25], [-50, 25]], depth: 10, holes: [[[-10, -5], [10, -5], [10, 5], [-10, 5]]] })
    expect(holed.attributes.position.count).toBeGreaterThan(solid.attributes.position.count)
  })
  it('loft: 두 사각 단면(y 0, y 100) → 옆면만, bbox 맞음, 법선 있음', () => {
    const sq = (y: number, s: number): [number, number, number][] => [[-s, y, -s], [s, y, -s], [s, y, s], [-s, y, s]]
    const g = curvedGeometry({ type: 'loft', sections: [sq(0, 50), sq(100, 30)], closed: true })
    const b = bbox(g)
    expect(close(b.min, [-5, 0, -5])).toBe(true)
    expect(close(b.max, [5, 10, 5])).toBe(true)
    expect(g.attributes.normal).toBeDefined()
    expect(g.index!.count).toBe(4 * 2 * 3) // 4변 × 삼각형 2 × 정점 3
  })
  it('같은 입력 객체는 같은 BufferGeometry를 돌려준다 (캐시)', () => {
    const def: Geometry = { type: 'lathe', profile: [[10, 0], [10, 10]] }
    expect(curvedGeometry(def as never)).toBe(curvedGeometry(def as never))
  })
  it('validateGeometry가 잘못된 곡면 입력을 잡는다', () => {
    expect(validateGeometry({ type: 'lathe', profile: [[0, 0]] })).not.toEqual([])
    expect(validateGeometry({ type: 'tube', path: [[0, 0, 0]], radius: 5 })).not.toEqual([])
    expect(validateGeometry({ type: 'extrude', shape: [[0, 0], [1, 0]], depth: 5 })).not.toEqual([])
    expect(validateGeometry({ type: 'loft', sections: [[[0, 0, 0], [1, 0, 0], [0, 0, 1]], [[0, 1, 0], [1, 1, 0]]] })).not.toEqual([])
    expect(validateGeometry({ type: 'loft', sections: [[[0, 0, 0], [1, 0, 0], [0, 0, 1]], [[0, 1, 0], [1, 1, 0], [0, 1, 1]]] })).toEqual([])
  })
})

describe('extrude bevel guard', () => {
  it('bevel*2 >= depth는 validateGeometry가 거부하고, 빌더는 잘라서 z 범위를 대칭으로 유지한다', () => {
    expect(validateGeometry({ type: 'extrude', shape: [[-50, -25], [50, -25], [50, 25], [-50, 25]], depth: 10, bevel: 5 })).not.toEqual([])
    const g = curvedGeometry({ type: 'extrude', shape: [[-50, -25], [50, -25], [50, 25], [-50, 25]], depth: 10, bevel: 8 })
    const b = bbox(g)
    expect(Math.abs(b.min[2] + b.max[2])).toBeLessThan(0.05)
  })
})
