// 테스트용 bbox 계산기. PartGeometry.tsx가 그리는 규칙 그대로 mm 단위 월드 bbox를 쌓는다.
// 렌더러와 규칙이 어긋나면 여기부터 고친다.

import * as THREE from 'three'
import { curvedGeometry } from '../../engine/geometry/curved'
import { MM, type CurvedPrimitive, type Geometry, type PartDef, type PartInstance, type Vec3 } from '../../engine/types'

export interface Bounds {
  min: Vec3
  max: Vec3
}

const box3 = (min: Vec3, max: Vec3) => new THREE.Box3(new THREE.Vector3(...min), new THREE.Vector3(...max))

/** 프리미티브 하나의 로컬 bbox(mm). PartGeometry가 넣는 원점 보정까지 반영한다. */
function primitiveBox(g: Exclude<Geometry, { type: 'composite' }>): THREE.Box3 {
  switch (g.type) {
    case 'box':
    case 'roundedBox': {
      const [w, h, d] = g.size
      return box3([-w / 2, 0, -d / 2], [w / 2, h, d / 2])
    }
    case 'cylinder': {
      const r = Math.max(g.radiusTop, g.radiusBottom)
      return box3([-r, 0, -r], [r, g.height, r])
    }
    case 'sphere':
      return box3([-g.radius, 0, -g.radius], [g.radius, g.radius * 2, g.radius])
    case 'cone':
      return box3([-g.radius, 0, -g.radius], [g.radius, g.height, g.radius])
    case 'torus': {
      // 렌더러가 [π/2,0,0]으로 눕히고 y=tube만큼 올린다 → 밑면 y=0, 두께 2·tube
      const o = g.radius + g.tube
      return box3([-o, 0, -o], [o, g.tube * 2, o])
    }
    case 'frustum': {
      const w = Math.max(g.bottom[0], g.top[0]) / 2
      const d = Math.max(g.bottom[1], g.top[1]) / 2
      return box3([-w, 0, -d], [w, g.h, d])
    }
    default: {
      const geo = curvedGeometry(g as CurvedPrimitive)
      if (!geo.boundingBox) geo.computeBoundingBox()
      const bb = geo.boundingBox as THREE.Box3
      return new THREE.Box3(bb.min.clone().divideScalar(MM), bb.max.clone().divideScalar(MM))
    }
  }
}

const childMatrix = (position?: Vec3, rotation?: Vec3, scale?: Vec3) =>
  new THREE.Matrix4().compose(
    new THREE.Vector3(...(position ?? [0, 0, 0])),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...(rotation ?? [0, 0, 0]))),
    new THREE.Vector3(...(scale ?? [1, 1, 1])),
  )

function accumulate(g: Geometry, matrix: THREE.Matrix4, out: THREE.Box3): void {
  if (g.type === 'composite') {
    for (const c of g.children) {
      accumulate(c.geometry, matrix.clone().multiply(childMatrix(c.position, c.rotation, c.scale)), out)
    }
    return
  }
  out.union(primitiveBox(g).applyMatrix4(matrix))
}

/** 인스턴스 하나의 월드 bbox(mm) */
export function instanceBounds(inst: PartInstance): Bounds {
  const out = new THREE.Box3()
  accumulate(inst.geometry, childMatrix(inst.mountPosition, inst.mountRotation), out)
  return { min: out.min.toArray() as Vec3, max: out.max.toArray() as Vec3 }
}

/** 장착 완료 상태의 전체 bbox(mm). hidden 부품과 exclude에 든 부품 id는 뺀다. */
export function assemblyBounds(parts: PartDef[], exclude: string[] = ['mirror']): Bounds {
  const skip = new Set(exclude)
  const out = new THREE.Box3()
  for (const p of parts) {
    if (p.hidden || skip.has(p.id)) continue
    for (const inst of p.instances) {
      accumulate(inst.geometry, childMatrix(inst.mountPosition, inst.mountRotation), out)
    }
  }
  return { min: out.min.toArray() as Vec3, max: out.max.toArray() as Vec3 }
}

export interface TubeSample {
  /** 월드 좌표(mm) */
  point: Vec3
  /** 이 점이 속한 tube의 반지름(mm) */
  radius: number
}

/** 인스턴스 안의 모든 tube 중심선을 월드 좌표로 샘플링한다. composite 안쪽까지 훑는다.
 *  렌더러와 같은 CatmullRomCurve3('centripetal')를 쓰므로 실제 관 위치와 어긋나지 않는다. */
export function tubeSamples(inst: PartInstance, per = 120): TubeSample[] {
  const out: TubeSample[] = []
  const walk = (g: Geometry, matrix: THREE.Matrix4) => {
    if (g.type === 'composite') {
      for (const c of g.children) walk(c.geometry, matrix.clone().multiply(childMatrix(c.position, c.rotation, c.scale)))
      return
    }
    if (g.type !== 'tube') return
    const curve = new THREE.CatmullRomCurve3(g.path.map(([x, y, z]) => new THREE.Vector3(x, y, z)), g.closed ?? false, 'centripetal')
    for (const p of curve.getPoints(per)) {
      out.push({ point: p.applyMatrix4(matrix).toArray() as Vec3, radius: g.radius })
    }
  }
  walk(inst.geometry, childMatrix(inst.mountPosition, inst.mountRotation))
  return out
}

/** 여러 부품의 tube 샘플을 한 번에 */
export function partTubeSamples(parts: PartDef[], per = 120): TubeSample[] {
  return parts.flatMap((p) => p.instances.flatMap((i) => tubeSamples(i, per)))
}
