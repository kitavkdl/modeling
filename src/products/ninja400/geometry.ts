// 닌자 400 형상 함수 — 제원(spec.ts)을 받아 엔진의 Geometry로 바꾼다. 치수는 전부 mm.
//
// 엔진 규약: 모든 프리미티브는 그룹 원점에서 y=0 위에 선다(원통·상자는 밑면, 토러스는
// 도넛 축이 y이고 밑면이 y=0). 그래서 축이 z인 부품(휠·디스크·스프라켓)은 여기서
// 중심 기준이 되도록 회전과 위치를 미리 보정해 둔다.

import type { CompositeChild, Geometry, Vec3 } from '../../engine/types'

/** 위치와 회전이 반드시 있는 composite 자식 */
export interface Strut extends CompositeChild {
  position: Vec3
  rotation: Vec3
}

/**
 * 두 점을 잇는 원통. 엔진의 cylinder는 +y 기둥(밑면이 원점)이므로 a에 두고 a→b로 돌린다.
 * 오일러 XYZ에서 y=0이면 R·(0,len,0) = len·(-sin z, cos x·cos z, sin x·cos z) 이므로
 * x = atan2(dz, dy), z = -atan2(dx, hypot(dy, dz)) 로 뒤집으면 정확히 b를 가리킨다.
 */
export function strut(a: Vec3, b: Vec3, r: number): Strut {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const dz = b[2] - a[2]
  const len = Math.hypot(dx, dy, dz)
  const rx = Math.atan2(dz, dy)
  const rz = -Math.atan2(dx, Math.hypot(dy, dz))
  return {
    geometry: { type: 'cylinder', radiusTop: r, radiusBottom: r, height: len, segments: 10 },
    position: a,
    rotation: [rx, 0, rz],
  }
}

/** 노드와 edge 목록으로 만든 트렐리스 프레임 */
export function trellis(nodes: Vec3[], edges: Array<[number, number]>, r: number): Geometry {
  const children: CompositeChild[] = edges.map(([i, j]) => strut(nodes[i], nodes[j], r))
  return { type: 'composite', children }
}

/** z축 원통, 중심 기준 */
export function cylZ(r: number, len: number, segments = 32): Geometry {
  const children: CompositeChild[] = [
    {
      geometry: { type: 'cylinder', radiusTop: r, radiusBottom: r, height: len, segments },
      position: [0, 0, -len / 2],
      rotation: [Math.PI / 2, 0, 0],
    },
  ]
  return { type: 'composite', children }
}

/** 휠: 타이어 + 림 + 스포크 + 허브. 축이 z, 원점이 휠 중심 */
export function wheel(tireR: number, tireW: number, rimR: number, spokes = 5): Geometry {
  const tube = (tireR - rimR) / 2
  const children: CompositeChild[] = []
  // 토러스는 엔진에서 y축 도넛이고 도넛 중심면이 y=tube라, z축으로 눕힌 뒤 tube만큼 당겨 중심에 맞춘다
  children.push({
    geometry: { type: 'torus', radius: rimR + tube, tube },
    position: [0, 0, -tube],
    rotation: [Math.PI / 2, 0, 0],
    material: 'rubber',
  })
  children.push({ geometry: cylZ(rimR, tireW * 0.7), material: 'polished_alu' })
  // 림 안쪽 그늘
  children.push({ geometry: cylZ(rimR * 0.98, tireW * 0.74, 32), material: 'plastic_black' })
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2
    children.push({
      geometry: { type: 'box', size: [22, rimR * 0.9, 18] },
      position: [0, 0, 0],
      rotation: [0, 0, a],
      material: 'polished_alu',
    })
  }
  // 허브
  children.push({ geometry: cylZ(28, tireW * 0.8), material: 'cast_alu' })
  return { type: 'composite', children }
}

/** 브레이크 디스크. 축이 z, 중심 기준 */
export function disc(r: number, t: number): Geometry {
  return cylZ(r, t, 48)
}

/** 스프라켓. 축이 z, 중심 기준 */
export function sprocket(r: number, t: number, teeth: number): Geometry {
  const children: CompositeChild[] = [{ geometry: cylZ(r, t, 40) }]
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * Math.PI * 2
    children.push({
      geometry: { type: 'box', size: [8, 10, t] },
      position: [Math.cos(a) * r, Math.sin(a) * r, 0],
      rotation: [0, 0, a],
    })
  }
  return { type: 'composite', children }
}

/** 포크 다리: 아래 슬라이더(굵음) + 위 이너튜브. 밑면(액슬)이 원점, +y 방향 */
export function forkLeg(len: number, upperR: number, lowerR: number, lowerLen: number): Geometry {
  const children: CompositeChild[] = [
    {
      geometry: { type: 'cylinder', radiusTop: lowerR, radiusBottom: lowerR, height: lowerLen, segments: 20 },
      material: 'cast_alu',
    },
    {
      geometry: { type: 'cylinder', radiusTop: upperR, radiusBottom: upperR, height: len - lowerLen, segments: 20 },
      position: [0, lowerLen, 0],
      material: 'polished_alu',
    },
  ]
  return { type: 'composite', children }
}

/** 카울: 밑면 기준. 아래가 넓고 위가 좁은 사다리꼴 껍데기 */
export function cowl(size: Vec3, taper: number): Geometry {
  const [w, h, d] = size
  return { type: 'frustum', bottom: [w, d], top: [w * taper, d * taper], h }
}

/** 연료탱크: 2단 frustum. 밑면 기준 */
export function tank(): Geometry {
  const children: CompositeChild[] = [
    { geometry: { type: 'frustum', bottom: [380, 280], top: [340, 240], h: 90 } },
    { geometry: { type: 'frustum', bottom: [340, 240], top: [220, 150], h: 110 }, position: [0, 90, 0] },
  ]
  return { type: 'composite', children }
}

/** 모서리가 둥근 사각형 윤곽. extrude.shape로 쓴다 — 중심이 원점, w×h 크기, 모서리 반지름 r */
function roundedRect(w: number, h: number, r: number, seg = 4): [number, number][] {
  const hw = w / 2
  const hh = h / 2
  const corners: Array<[number, number, number]> = [
    [hw - r, hh - r, 0],
    [-(hw - r), hh - r, Math.PI / 2],
    [-(hw - r), -(hh - r), Math.PI],
    [hw - r, -(hh - r), Math.PI * 1.5],
  ]
  const pts: [number, number][] = []
  for (const [cx, cy, start] of corners) {
    for (let i = 0; i <= seg; i++) {
      const a = start + (i / seg) * (Math.PI / 2)
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)])
    }
  }
  return pts
}

/** 점화 키. 원점은 날 끝(꽂히는 쪽). 날은 사각 기둥으로 원점에서 +y 32mm 뻗고,
 *  손잡이(둥근 사각 압출)는 날 위 y=32에 얹혀 날이 손잡이에서 −y로 뻗는 모양이 된다. */
export function keyGeometry(): Geometry {
  const children: CompositeChild[] = [
    { geometry: { type: 'box', size: [4, 32, 8] } },
    { geometry: { type: 'extrude', shape: roundedRect(40, 28, 6), depth: 6, bevel: 2 }, position: [0, 32, 0], material: 'plastic_black' },
  ]
  return { type: 'composite', children }
}
