import * as THREE from 'three'
import { MM } from '../types'

const cache = new Map<string, THREE.BufferGeometry>()

/** 사다리꼴 기둥. 입력 mm, 출력 unit. 밑면이 y=0, 윗면 꼭짓점을 안쪽으로 당긴다. */
export function frustumGeometry(bottom: [number, number], top: [number, number], h: number): THREE.BufferGeometry {
  const key = `${bottom[0]},${bottom[1]},${top[0]},${top[1]},${h}`
  let g = cache.get(key)
  if (g) return g
  g = new THREE.BoxGeometry(bottom[0] * MM, h * MM, bottom[1] * MM)
  const pos = g.attributes.position as THREE.BufferAttribute
  const sx = top[0] / bottom[0]
  const sz = top[1] / bottom[1]
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) > 0) {
      pos.setX(i, pos.getX(i) * sx)
      pos.setZ(i, pos.getZ(i) * sz)
    }
  }
  pos.needsUpdate = true
  g.computeVertexNormals()
  g.translate(0, (h * MM) / 2, 0)
  cache.set(key, g)
  return g
}
