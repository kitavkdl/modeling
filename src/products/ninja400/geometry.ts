// 닌자 400 형상 함수 — 제원(spec.ts)을 받아 엔진의 Geometry로 바꾼다. 치수는 전부 mm.
//
// 엔진 규약: 모든 프리미티브는 그룹 원점에서 y=0 위에 선다(원통·상자는 밑면, 토러스는
// 도넛 축이 y이고 밑면이 y=0). 그래서 축이 z인 부품(휠·디스크·스프라켓)은 여기서
// 중심 기준이 되도록 회전과 위치를 미리 보정해 둔다.

import type { CompositeChild, Geometry, Vec3 } from '../../engine/types'
import { RAKE, forkPoint } from './spec'

/** spec의 RAKE는 이미 라디안이다. 이 파일에서는 이름을 분명히 해 둔다. */
const RAKE_RAD = RAKE

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

// --- 곡면 프리미티브로 만든 섀시 형상 -----------------------------------------
// 좌표는 전부 차체 절대 좌표(mm)로 적고, 부품 원점(mount)을 빼서 상대 좌표로 넘긴다.
// 엔진 크랭크케이스는 x -330..90, y 280..550, |z| <= 190 을 차지한다. 프레임 튜브는
// 여기를 관통하면 안 되고, parts.test.ts가 튜브 중심선을 샘플링해 지킨다.

const sub = (base: Vec3) => (p: Vec3): Vec3 => [p[0] - base[0], p[1] - base[1], p[2] - base[2]]

/**
 * 트렐리스 메인 프레임. 헤드튜브(lathe) + 좌우 메인 스파 + 다운튜브 + 대각 브레이스 +
 * 중앙 백본 + 가로대. 스파는 엔진 위로, 다운튜브는 엔진 앞으로 지나 크랭크케이스를 비껴간다.
 */
export function frameTrellis(base: Vec3 = [0, 0, 0]): Geometry {
  const to = sub(base)
  const path = (pts: Vec3[]) => pts.map(to)
  const tube = (radius: number, pts: Vec3[], radial = 10): CompositeChild => ({
    geometry: { type: 'tube', radius, radial, segments: Math.max(12, pts.length * 10), path: path(pts) },
  })
  const [hx, hy] = forkPoint(760)
  const side = (s: 1 | -1): CompositeChild[] => [
    // 메인 스파: 헤드 → 탱크 아래 → 엔진 위 → 스윙암 피벗
    tube(16, [[395, 925, 0], [330, 855, 120 * s], [120, 780, 175 * s], [-150, 705, 168 * s], [-390, 585, 122 * s], [-420, 400, 100 * s]], 12),
    // 다운튜브: 헤드 → 라디에이터 옆 → 엔진 앞 하단 마운트(지그가 받치는 y=300)
    tube(16, [[452, 800, 0], [390, 670, 95 * s], [330, 500, 128 * s], [275, 355, 138 * s], [200, 300, 138 * s]], 12),
    // 대각 브레이스 — 트렐리스의 삼각형
    tube(12, [[120, 780, 175 * s], [225, 640, 152 * s], [330, 500, 128 * s]]),
    tube(12, [[120, 780, 175 * s], [160, 540, 157 * s], [200, 300, 138 * s]]),
    // 백본 ↔ 스파 브레이스
    tube(11, [[180, 805, 0], [150, 793, 88 * s], [120, 780, 175 * s]]),
    tube(11, [[-100, 712, 0], [-125, 709, 84 * s], [-150, 705, 168 * s]]),
  ]
  return {
    type: 'composite',
    children: [
      // 헤드튜브: 스티어링 축 위에 서는 속 빈 원통
      {
        geometry: { type: 'lathe', segments: 24, profile: [[38, 0], [38, 240], [30, 240], [30, 0], [38, 0]] },
        position: to([hx, hy, 0]),
        rotation: [0, 0, RAKE_RAD],
      },
      // 중앙 백본
      tube(14, [[400, 908, 0], [180, 805, 0], [-100, 712, 0], [-255, 694, 0]], 12),
      ...side(1),
      ...side(-1),
      // 가로대
      tube(12, [[-150, 705, 168], [-150, 705, 0], [-150, 705, -168]]),
      tube(12, [[200, 300, 138], [200, 300, 0], [200, 300, -138]]),
      tube(14, [[-420, 400, 105], [-420, 400, 0], [-420, 400, -105]]),
    ],
  }
}

/** 서브프레임: 시트 레일 2본 + 피벗에서 올라오는 받침 스테이 2본 + 가로대 2본 */
export function subframeRails(base: Vec3 = [0, 0, 0]): Geometry {
  const to = sub(base)
  const path = (pts: Vec3[]) => pts.map(to)
  const tube = (radius: number, pts: Vec3[], radial = 10): CompositeChild => ({
    geometry: { type: 'tube', radius, radial, segments: Math.max(12, pts.length * 10), path: path(pts) },
  })
  const side = (s: 1 | -1): CompositeChild[] => [
    // 시트 레일 — 메인 스파 뒤끝(-360, 540)에서 테일까지
    tube(12, [[-390, 588, 122 * s], [-560, 655, 116 * s], [-750, 705, 104 * s], [-900, 738, 86 * s]]),
    // 받침 스테이 — 스윙암 피벗에서 레일 중간으로
    tube(11, [[-420, 400, 100 * s], [-520, 540, 106 * s], [-620, 671, 112 * s]]),
  ]
  return {
    type: 'composite',
    children: [
      ...side(1),
      ...side(-1),
      tube(10, [[-750, 705, 104], [-750, 705, 0], [-750, 705, -104]]),
      tube(10, [[-900, 738, 86], [-900, 738, 0], [-900, 738, -86]]),
    ],
  }
}

/** 스윙암: 피벗 60×92 → 액슬 40×52 로 가늘어지는 loft 암 2본 + 피벗 보스 + 가로 브릿지.
 *  원점은 스윙암 피벗, 리어 액슬은 (-265, -94, 0) 상대 위치다. */
export function swingarmGeometry(axle: Vec3 = [-265, -94, 0], armZ = 140): Geometry {
  const steps = [0, 0.3, 0.62, 1]
  const halfW = [34, 30, 24, 20]
  const halfH = [46, 42, 34, 26]
  const arm = (s: 1 | -1): Vec3[][] =>
    steps.map((t, i) => {
      const x = axle[0] * t
      const y = axle[1] * t
      const z = armZ * s
      const hw = halfW[i]
      const hh = halfH[i]
      return [
        [x, y + hh, z + hw],
        [x, y + hh, z - hw],
        [x, y - hh, z - hw],
        [x, y - hh, z + hw],
      ]
    })
  return {
    type: 'composite',
    children: [
      { geometry: { type: 'loft', sections: arm(1), closed: true, smooth: false } },
      { geometry: { type: 'loft', sections: arm(-1), closed: true, smooth: false } },
      // 피벗 보스 — loft 앞쪽 열린 단면을 덮는다
      { geometry: cylZ(52, (armZ + halfW[0]) * 2, 20) },
      // 액슬 보스 — loft 뒤쪽 열린 단면을 덮는다
      { geometry: cylZ(38, 88, 20), position: [axle[0], axle[1], armZ] },
      { geometry: cylZ(38, 88, 20), position: [axle[0], axle[1], -armZ] },
      // 가로 브릿지
      { geometry: { type: 'roundedBox', size: [130, 56, 250], radius: 10 }, position: [axle[0] * 0.3, axle[1] * 0.3 - 28, 0] },
    ],
  }
}

/** 림: 비드에서 안쪽 배럴까지 파인 단면을 z축 둘레로 돌린다. 원점은 휠 중심 */
export function rimGeometry(rimR: number, width: number): Geometry {
  const w = width
  const profile: [number, number][] = [
    [rimR - 6, -w / 2],
    [rimR, -w / 2 + 8],
    [rimR, w / 2 - 8],
    [rimR - 6, w / 2],
    [rimR - 30, w / 2 - 6],
    [rimR - 30, -w / 2 + 6],
    [rimR - 6, -w / 2],
  ]
  return { type: 'composite', children: [{ geometry: { type: 'lathe', profile, segments: 28 }, rotation: [Math.PI / 2, 0, 0] }] }
}

/** 휠: 타이어(torus) + 림(lathe) + 스포크(extrude) + 허브(lathe). 축이 z, 원점이 휠 중심 */
export function spokedWheel(tireR: number, tireW: number, rimR: number, spokes = 5): Geometry {
  const tube = (tireR - rimR) / 2
  const hubHalf = Math.max(26, tireW * 0.34)
  const hubProfile: [number, number][] = [
    [0, -hubHalf],
    [50, -hubHalf],
    [50, -hubHalf + 12],
    [38, -hubHalf + 18],
    [38, hubHalf - 18],
    [50, hubHalf - 12],
    [50, hubHalf],
    [0, hubHalf],
    [0, -hubHalf],
  ]
  const children: CompositeChild[] = [
    // 토러스는 엔진에서 y축 도넛이고 도넛 중심면이 y=tube라, z축으로 눕힌 뒤 tube만큼 당겨 중심에 맞춘다
    { geometry: { type: 'torus', radius: rimR + tube, tube }, position: [0, 0, -tube], rotation: [Math.PI / 2, 0, 0], material: 'rubber' },
    { geometry: rimGeometry(rimR, tireW * 0.72), material: 'polished_alu' },
    {
      geometry: { type: 'composite', children: [{ geometry: { type: 'lathe', profile: hubProfile, segments: 24 }, rotation: [Math.PI / 2, 0, 0] }] },
      material: 'cast_alu',
    },
  ]
  const shape: [number, number][] = [
    [42, -15],
    [rimR - 28, -9],
    [rimR - 28, 9],
    [42, 15],
  ]
  for (let i = 0; i < spokes; i++) {
    children.push({
      geometry: { type: 'extrude', shape, depth: 26, bevel: 3 },
      rotation: [0, 0, (i / spokes) * Math.PI * 2],
      material: 'polished_alu',
    })
  }
  return { type: 'composite', children }
}

/** 원 다각형. cw면 시계방향 — extrude의 holes는 바깥 윤곽과 반대로 감는다. */
function circlePts(cx: number, cy: number, r: number, seg = 12, cw = false): [number, number][] {
  const out: [number, number][] = []
  for (let i = 0; i < seg; i++) {
    const a = ((cw ? -i : i) / seg) * Math.PI * 2
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)])
  }
  return out
}

/** 톱니 디스크(스프로킷). 이 끝 반지름이 r이라 체인 토러스 반지름과 그대로 맞는다.
 *  축이 z, 중심 기준. 톱니마다 뿌리·이끝·이끝 3점을 찍는다. */
export function toothedDisc(r: number, teeth: number, thickness: number, holeR: number, toothDepth: number): Geometry {
  const root = r - toothDepth
  const step = (Math.PI * 2) / teeth
  const shape: [number, number][] = []
  for (let i = 0; i < teeth; i++) {
    const a = i * step
    shape.push([root * Math.cos(a), root * Math.sin(a)])
    shape.push([r * Math.cos(a + step * 0.26), r * Math.sin(a + step * 0.26)])
    shape.push([r * Math.cos(a + step * 0.74), r * Math.sin(a + step * 0.74)])
  }
  const holes: [number, number][][] = [circlePts(0, 0, holeR, 20, true)]
  const boltR = r * 0.35
  if (boltR - 6 > holeR + 8) {
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + step / 2
      holes.push(circlePts(boltR * Math.cos(a), boltR * Math.sin(a), 6, 10, true))
    }
  }
  return { type: 'extrude', shape, depth: thickness, bevel: Math.min(1.2, thickness / 4), holes }
}

/** 브레이크 디스크: 구멍 뚫린 바깥 링(stainless) + 안쪽 캐리어(cast_alu). 축이 z, 중심 기준 */
export function brakeDisc(r: number, thickness: number): Geometry {
  const inner = r - 42
  const drillR = (r + inner) / 2
  const ringHoles: [number, number][][] = [circlePts(0, 0, inner, 32, true)]
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2
    ringHoles.push(circlePts(drillR * Math.cos(a), drillR * Math.sin(a), 6, 10, true))
  }
  const carrierOuter = inner + 6
  const carrierHoles: [number, number][][] = [circlePts(0, 0, 38, 20, true)]
  const lightenR = (38 + carrierOuter) / 2
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.3
    carrierHoles.push(circlePts(lightenR * Math.cos(a), lightenR * Math.sin(a), Math.min(13, (carrierOuter - 38) / 2 - 2), 12, true))
  }
  return {
    type: 'composite',
    children: [
      { geometry: { type: 'extrude', shape: circlePts(0, 0, r, 48), depth: thickness, holes: ringHoles } },
      { geometry: { type: 'extrude', shape: circlePts(0, 0, carrierOuter, 36), depth: thickness * 1.6, holes: carrierHoles }, material: 'cast_alu' },
    ],
  }
}

/** 포크 상단 캡. 밑면이 원점, +y로 26mm */
export function forkCap(): Geometry {
  return { type: 'lathe', segments: 20, profile: [[0, 0], [26, 0], [26, 14], [22, 22], [16, 26], [0, 26], [0, 0]] }
}

/** 포크 다리: 아래 슬라이더(lathe, 액슬 보스 → 가는 몸통) + 위 이너튜브 + 상단 캡.
 *  밑면(액슬)이 원점, +y 방향 */
export function forkLeg(len: number, upperR: number, lowerR: number, lowerLen: number): Geometry {
  const children: CompositeChild[] = [
    {
      geometry: {
        type: 'lathe',
        segments: 20,
        profile: [
          [0, 0],
          [lowerR + 9, 0],
          [lowerR + 9, 74],
          [lowerR + 3, 96],
          [lowerR, 120],
          [lowerR, lowerLen],
          [0, lowerLen],
          [0, 0],
        ],
      },
      material: 'cast_alu',
    },
    {
      geometry: { type: 'cylinder', radiusTop: upperR, radiusBottom: upperR, height: len - lowerLen, segments: 20 },
      position: [0, lowerLen, 0],
      material: 'polished_alu',
    },
    { geometry: forkCap(), position: [0, len - 26, 0], material: 'cast_alu' },
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
