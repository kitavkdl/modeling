import type { Geometry, Vec3 } from '../../engine/types'

// 키보드 고유 형상을 프리미티브 composite로 만든다. 입력 전부 mm. 원점은 부품 밑면 중심.

function walls(w: number, d: number, h: number, wall: number, y: number): Array<{ geometry: Geometry; position: Vec3 }> {
  return [
    { geometry: { type: 'box', size: [w, h, wall] }, position: [0, y, -(d / 2 - wall / 2)] },
    { geometry: { type: 'box', size: [w, h, wall] }, position: [0, y, d / 2 - wall / 2] },
    { geometry: { type: 'box', size: [wall, h, d - wall * 2] }, position: [-(w / 2 - wall / 2), y, 0] },
    { geometry: { type: 'box', size: [wall, h, d - wall * 2] }, position: [w / 2 - wall / 2, y, 0] },
  ]
}

/** 바닥판 + 벽 4개 (하부 케이스) */
export function tub(size: Vec3, wall: number, floor: number, radius: number): Geometry {
  const [w, h, d] = size
  return {
    type: 'composite',
    children: [
      { geometry: { type: 'roundedBox', size: [w, floor, d], radius } },
      ...walls(w, d, h - floor, wall, floor),
    ],
  }
}

/** 벽 4개 (상부 케이스) */
export function frame(size: Vec3, wall: number): Geometry {
  const [w, h, d] = size
  return { type: 'composite', children: walls(w, d, h, wall, 0) }
}

/** 하우징 2개 + 와이어 (와이어는 PCB 아래로 내려간다) */
export function stabilizer(span: number, housing: Vec3, wireR: number): Geometry {
  const [hw, , hd] = housing
  const half = span / 2
  return {
    type: 'composite',
    children: [
      { geometry: { type: 'box', size: housing }, position: [-half, 0, 0] },
      { geometry: { type: 'box', size: housing }, position: [half, 0, 0] },
      {
        geometry: { type: 'cylinder', radiusTop: wireR, radiusBottom: wireR, height: span + hw, segments: 8 },
        position: [-(span + hw) / 2, -2.5, hd / 2 - 1],
        rotation: [0, 0, -Math.PI / 2],
      },
    ],
  }
}

/** 몸통 + 스템 */
export function switchBody(body: Vec3, stemR: number, stemH: number): Geometry {
  return {
    type: 'composite',
    children: [
      { geometry: { type: 'box', size: body } },
      { geometry: { type: 'cylinder', radiusTop: stemR, radiusBottom: stemR, height: stemH, segments: 12 }, position: [0, body[1], 0] },
    ],
  }
}

/** 사다리꼴 키캡 */
export function keycap(bottom: [number, number], top: [number, number], h: number): Geometry {
  return { type: 'frustum', bottom, top, h }
}

/** 얇은 스트립들 */
export function gasketSet(strips: Array<{ pos: Vec3; size: Vec3 }>): Geometry {
  return {
    type: 'composite',
    children: strips.map((s) => ({ geometry: { type: 'box', size: s.size } as Geometry, position: s.pos })),
  }
}
