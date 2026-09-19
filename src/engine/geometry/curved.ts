import * as THREE from 'three'
import { MM, type CurvedPrimitive } from '../types'

// 곡면 프리미티브 → BufferGeometry. 입력 객체를 키로 캐시하므로 부품 정의를 새 객체로 만들지 않는 한 한 번만 만든다.
// 단위 변환(mm → units)은 여기서 끝낸다.

const cache = new WeakMap<CurvedPrimitive, THREE.BufferGeometry>()

export function curvedGeometry(g: CurvedPrimitive): THREE.BufferGeometry {
  const hit = cache.get(g)
  if (hit) return hit
  const geo = build(g)
  cache.set(g, geo)
  return geo
}

function build(g: CurvedPrimitive): THREE.BufferGeometry {
  switch (g.type) {
    case 'lathe': {
      const pts = g.profile.map(([r, y]) => new THREE.Vector2(r * MM, y * MM))
      return new THREE.LatheGeometry(pts, g.segments ?? 32, 0, g.angle ?? Math.PI * 2)
    }
    case 'tube': {
      const curve = new THREE.CatmullRomCurve3(g.path.map(([x, y, z]) => new THREE.Vector3(x * MM, y * MM, z * MM)), g.closed ?? false, 'centripetal')
      return new THREE.TubeGeometry(curve, g.segments ?? Math.max(8, g.path.length * 8), g.radius * MM, g.radial ?? 12, g.closed ?? false)
    }
    case 'extrude': {
      const shape = new THREE.Shape(g.shape.map(([x, y]) => new THREE.Vector2(x * MM, y * MM)))
      for (const h of g.holes ?? []) shape.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x * MM, y * MM))))
      const depth = g.depth * MM
      // bevel이 depth의 절반을 넘으면 z 범위가 비대칭이 된다. validateGeometry가 막지만 여기서도 잘라 둔다
      const bevel = Math.min((g.bevel ?? 0) * MM, depth * 0.49)
      const geo = new THREE.ExtrudeGeometry(shape, {
        depth: Math.max(0.001, depth - bevel * 2),
        bevelEnabled: bevel > 0,
        bevelThickness: bevel,
        bevelSize: bevel,
        bevelSegments: bevel > 0 ? 3 : 0,
        curveSegments: 12,
      })
      geo.translate(0, 0, -depth / 2 + (bevel > 0 ? bevel : 0))
      return geo
    }
    case 'loft':
      return loft(g.sections, g.closed ?? false, g.smooth ?? true)
  }
}

function loft(sections: [number, number, number][][], closed: boolean, smooth: boolean): THREE.BufferGeometry {
  const n = sections[0].length
  const m = sections.length
  const pos: number[] = []
  for (const s of sections) for (const [x, y, z] of s) pos.push(x * MM, y * MM, z * MM)
  const idx: number[] = []
  const cols = closed ? n : n - 1
  for (let i = 0; i < m - 1; i++) {
    for (let j = 0; j < cols; j++) {
      const a = i * n + j, b = i * n + ((j + 1) % n), c = (i + 1) * n + j, d = (i + 1) * n + ((j + 1) % n)
      idx.push(a, c, b, b, c, d)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setIndex(idx)
  if (smooth) geo.computeVertexNormals()
  else {
    const flat = geo.toNonIndexed()
    flat.computeVertexNormals()
    return flat
  }
  return geo
}
