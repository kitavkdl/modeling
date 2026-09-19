import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import type { Vec3 } from '../../engine/types'
import { strut, trellis } from './geometry'

/** strut이 만든 자식 회전을 실제로 적용해, +y 기둥 끝이 b에 닿는지 본다. */
function tipOf(a: Vec3, b: Vec3): THREE.Vector3 {
  const s = strut(a, b, 10)
  expect(s.geometry.type).toBe('cylinder')
  const height = s.geometry.type === 'cylinder' ? s.geometry.height : 0
  const e = new THREE.Euler(s.rotation[0], s.rotation[1], s.rotation[2])
  return new THREE.Vector3(0, height, 0).applyEuler(e).add(new THREE.Vector3(s.position[0], s.position[1], s.position[2]))
}

const CASES: Array<[string, Vec3, Vec3]> = [
  ['+x', [0, 0, 0], [500, 0, 0]],
  ['-x', [0, 0, 0], [-500, 0, 0]],
  ['+y', [0, 0, 0], [0, 500, 0]],
  ['-y', [0, 0, 0], [0, -500, 0]],
  ['+z', [0, 0, 0], [0, 0, 500]],
  ['-z', [0, 0, 0], [0, 0, -500]],
  ['대각선', [0, 0, 0], [300, 400, 0]],
  ['3축 대각선, 원점 이동', [120, -40, 60], [-180, 360, -240]],
]

describe('strut', () => {
  for (const [name, a, b] of CASES) {
    it(`${name} 방향 기둥의 끝이 b에 닿는다`, () => {
      const tip = tipOf(a, b)
      expect(tip.distanceTo(new THREE.Vector3(b[0], b[1], b[2]))).toBeLessThan(1)
    })
  }

  it('길이가 두 점 사이 거리와 같고 위치가 a다', () => {
    const s = strut([10, 20, 30], [10, 20, 30 + 250], 7)
    expect(s.position).toEqual([10, 20, 30])
    expect(s.geometry.type === 'cylinder' && s.geometry.height).toBeCloseTo(250, 9)
  })
})

describe('trellis', () => {
  it('edge마다 자식 하나를 만들고 각 자식이 노드 b에 닿는다', () => {
    const nodes: Vec3[] = [
      [0, 0, 0],
      [300, 400, 0],
      [-200, 150, 260],
    ]
    const edges: Array<[number, number]> = [
      [0, 1],
      [1, 2],
      [2, 0],
    ]
    const g = trellis(nodes, edges, 14)
    expect(g.type).toBe('composite')
    if (g.type !== 'composite') return
    expect(g.children).toHaveLength(edges.length)
    edges.forEach(([i, j], k) => {
      const c = g.children[k]
      const height = c.geometry.type === 'cylinder' ? c.geometry.height : 0
      const rot = c.rotation ?? [0, 0, 0]
      const pos = c.position ?? [0, 0, 0]
      const tip = new THREE.Vector3(0, height, 0)
        .applyEuler(new THREE.Euler(rot[0], rot[1], rot[2]))
        .add(new THREE.Vector3(pos[0], pos[1], pos[2]))
      expect(tip.distanceTo(new THREE.Vector3(...nodes[j])), `edge ${i}-${j}`).toBeLessThan(1)
    })
  })
})
