// 닌자 400 형상 함수 — 제원(spec.ts)을 받아 엔진의 Geometry로 바꾼다. 치수는 전부 mm.
//
// 엔진 규약: 모든 프리미티브는 그룹 원점에서 y=0 위에 선다(원통·상자는 밑면, 토러스는
// 도넛 축이 y이고 밑면이 y=0). 그래서 축이 z인 부품(휠·디스크·스프라켓)은 여기서
// 중심 기준이 되도록 회전과 위치를 미리 보정해 둔다.

import type { CompositeChild, Geometry, Vec3 } from '../../engine/types'
import { BORE, CYL_PITCH, RAKE, forkPoint, tilt } from './spec'

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

// --- 엔진 외관 · 배기 · 냉각 ---------------------------------------------------
// 크랭크케이스가 차지하는 x -330..90, y 280..550, |z| <= 190 은 프레임 여유 테스트의
// 기준이라 여기 윤곽도 그 안에 들도록 잡았다(마운트 x = -120, 하부 y = 280).

/** 다각형을 반시계로 맞춘다. extrude.shape의 바깥 윤곽은 반시계여야 면이 바깥을 본다. */
function ccw(pts: [number, number][]): [number, number][] {
  let area = 0
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i]
    const [x2, y2] = pts[(i + 1) % pts.length]
    area += x1 * y2 - x2 * y1
  }
  return area < 0 ? [...pts].reverse() : pts
}

/**
 * 크랭크케이스: 옆에서 본 윤곽(xy)을 z로 380 밀어낸다.
 * 'lower'는 밑면이 원점이고 y 0..150, 'upper'는 합체면이 원점이고 y 0..120.
 * 주의 — ExtrudeGeometry의 bevelSize는 윤곽을 바깥으로 밀어낸다. 그래서 윤곽은
 * 봉투(|x| <= 210 / 200, y 0..150 / 0..120)에서 베벨 6만큼 안으로 그려 둔다.
 * 마운트 x=-120에서 월드 x -330..90, y 280..550 안에 정확히 들어간다.
 */
export function crankcaseGeometry(part: 'lower' | 'upper', bevel = 6): Geometry {
  if (part === 'lower') {
    // 앞(+x)은 배기 포트 아래라 살이 두껍고, 뒤(-x)는 변속기라 아래로 부푼다
    const shape = ccw([
      [-176, 6], [142, 6], [190, 32], [204, 78], [196, 120], [166, 144],
      [-152, 144], [-190, 112], [-204, 70],
    ])
    return { type: 'extrude', shape, depth: 380, bevel }
  }
  const shape = ccw([
    [-186, 6], [172, 6], [194, 34], [188, 84], [160, 114],
    [-146, 114], [-184, 82], [-194, 34],
  ])
  return { type: 'extrude', shape, depth: 380, bevel }
}

/**
 * 실린더 블록: 보어가 뚫린 배럴 두 개에 냉각핀을 두른 lathe 스택 + 위아래 데크(extrude).
 * 원점은 블록 밑면 중심이고 +y가 실린더 축이다(부품 rot이 TILT_ROT를 준다).
 */
export function cylinderBlockFinned(h = 130, fins = 6): Geometry {
  const bore = BORE / 2 + 1
  const body = 46
  const finR = 60
  const t = 6
  const profile: [number, number][] = [[bore, 0], [body, 0]]
  for (let i = 0; i < fins; i++) {
    const y = 16 + i * 16
    profile.push([body, y], [finR, y + 1], [finR, y + t - 1], [body, y + t])
  }
  profile.push([body, h], [bore, h], [bore, 0])
  // 두 배럴이 같은 geometry 객체를 공유한다 — curvedGeometry 캐시가 한 번만 만든다
  const barrel: Geometry = { type: 'lathe', profile, segments: 30 }
  const deck = (y0: number, y1: number): CompositeChild => ({
    geometry: { type: 'extrude', shape: ccw([[-102, y0], [102, y0], [102, y1], [-102, y1]]), depth: 230, bevel: 3 },
  })
  return {
    type: 'composite',
    children: [
      deck(0, 14),
      deck(h - 14, h),
      { geometry: barrel, position: [0, 0, -CYL_PITCH / 2] },
      { geometry: barrel, position: [0, 0, CYL_PITCH / 2] },
    ],
  }
}

/** 실린더 헤드: 윤곽 extrude + 배기·흡기 포트 스터브. 배기 포트는 tilt(120, 260) — 헤드 로컬 (120, 10). */
export function cylinderHeadGeometry(): Geometry {
  const shape = ccw([
    [-110, 0], [110, 0], [120, 32], [116, 72], [94, 90], [-94, 90], [-116, 72], [-120, 32],
  ])
  const stub = (x: number, y: number, z: number, r: number, dir: 1 | -1): CompositeChild => ({
    geometry: { type: 'cylinder', radiusTop: r, radiusBottom: r * 1.1, height: 34, segments: 16 },
    position: [x, y, z],
    rotation: [0, 0, (dir * -Math.PI) / 2],
  })
  const half = CYL_PITCH / 2
  return {
    type: 'composite',
    children: [
      { geometry: { type: 'extrude', shape, depth: 240, bevel: 6 } },
      stub(104, 10, -half, 23, 1),
      stub(104, 10, half, 23, 1),
      stub(-104, 54, -half, 26, -1),
      stub(-104, 54, half, 26, -1),
    ],
  }
}

/** 캠 커버: 아래가 넓고 위가 좁은 loft 4단면 + 윗면 덮개 + 플러그 홀 보스 2개 */
export function camCoverGeometry(h = 52): Geometry {
  const rect = (y: number, hx: number, hz: number): Vec3[] => [
    [hx, y, hz], [hx, y, -hz], [-hx, y, -hz], [-hx, y, hz],
  ]
  const boss: Geometry = {
    type: 'lathe',
    segments: 20,
    profile: [[10, 0], [24, 0], [24, 12], [19, 16], [10, 16], [10, 0]],
  }
  const half = CYL_PITCH / 2
  return {
    type: 'composite',
    children: [
      { geometry: { type: 'loft', sections: [rect(0, 116, 122), rect(18, 113, 119), rect(40, 102, 108), rect(h, 86, 90)], closed: true, smooth: false } },
      { geometry: { type: 'extrude', shape: ccw([[-86, h - 2], [86, h - 2], [86, h + 6], [-86, h + 6]]), depth: 180, bevel: 2 } },
      { geometry: boss, position: [0, h + 4, -half] },
      { geometry: boss, position: [0, h + 4, half] },
    ],
  }
}

/** 클러치·제너레이터 커버. lathe 축이 +y라 부품 rot [±π/2, 0, 0]으로 눕히면 z축 커버가 된다. */
export function roundCover(r: number, depth: number): Geometry {
  const profile: [number, number][] = [
    [0, 0], [r, 0], [r * 1.03, depth * 0.34], [r * 0.94, depth * 0.66],
    [r * 0.72, depth * 0.88], [r * 0.34, depth], [0, depth * 0.96],
  ]
  return {
    type: 'composite',
    children: [
      { geometry: { type: 'lathe', profile, segments: 36 } },
      // 가운데 점검 캡
      { geometry: { type: 'lathe', segments: 20, profile: [[0, 0], [r * 0.3, 0], [r * 0.27, 9], [0, 11]] }, position: [0, depth * 0.9, 0] },
    ],
  }
}

/** 피스톤: 스커트 → 링 홈 3줄 → 크라운. 원점은 스커트 밑면이고 +y가 실린더 축이다. */
export function pistonGeometry(r = BORE / 2, h = 62): Geometry {
  return {
    type: 'lathe',
    segments: 28,
    profile: [
      [0, 0], [r, 0], [r, 34], [r - 2, 34], [r - 2, 40], [r, 40],
      [r, 44], [r - 2, 44], [r - 2, 48], [r, 48],
      [r, h - 5], [r - 9, h], [0, h],
    ],
  }
}

/** 크랭크 웹(카운터웨이트). 눈물방울 윤곽을 z로 밀어낸다 — 좁은 쪽(+x)이 크랭크핀이다. */
export function crankWebGeometry(r = 60, pinR = 26): Geometry {
  const shape = ccw([
    [pinR + 16, 20], [26, 40], [-6, r * 0.86], [-34, r],
    [-r, 26], [-r, -26], [-34, -r], [-6, -r * 0.86], [26, -40], [pinR + 16, -20],
  ])
  return { type: 'extrude', shape, depth: 34, bevel: 3 }
}

// --- 배기 --------------------------------------------------------------------
// 경로는 차체 절대 좌표로 적고 첫 점(= 부품 마운트)을 빼서 상대 좌표로 넘긴다.
// 좌우 헤더가 서로 다른 경로를 타므로 인스턴스마다 geometry를 따로 준다.

/** 배기 헤더 중심선. 포트에서 나와 엔진 앞을 타고 내려가 집합부 첫 점에서 만난다.
 *  프레임 가로대(200, 300, |z|<=138, r12)를 피하려고 y≈300 구간은 x를 150 근처로 당겼다. */
export function exhaustHeaderPath(side: 1 | -1): Vec3[] {
  const port = tilt(120, 260, 42 * side)
  return side === 1
    ? [port, [120, 590, 52], [152, 505, 68], [170, 432, 84], [168, 346, 92], [145, 292, 94], [162, 238, 86], [180, 210, 76]]
    : [port, [120, 590, -52], [152, 505, -70], [170, 432, -86], [166, 350, -76], [148, 296, -30], [158, 240, 24], [180, 210, 72]]
}

/** 배기 헤더 한 본. 원점은 배기 포트(경로 첫 점). */
export function exhaustHeader(side: 1 | -1): Geometry {
  const pts = exhaustHeaderPath(side)
  const to = sub(pts[0])
  return { type: 'tube', radius: 19, radial: 14, segments: 140, path: pts.map(to) }
}

/** 집합부 중심선. 엔진 밑을 지나 오른쪽 머플러 입구까지. 오일팬(y 230..280)을 밑으로 비껴간다. */
export const EXHAUST_COLLECTOR_PATH: Vec3[] = [
  [180, 206, 75], [40, 188, 78], [-140, 190, 92], [-300, 196, 128], [-410, 220, 168], [-448, 238, 186],
]

/** 배기 집합부. 원점은 경로 첫 점 = 헤더 두 본이 만나는 자리. */
export function exhaustCollector(): Geometry {
  const to = sub(EXHAUST_COLLECTOR_PATH[0])
  return { type: 'tube', radius: 27, radial: 14, segments: 140, path: EXHAUST_COLLECTOR_PATH.map(to) }
}

/** 머플러 캔. lathe 축이 +y라 부품 rot [0, 0, π/2 - ε]로 뒤쪽·약간 위로 눕힌다. 원점은 입구. */
export function mufflerGeometry(len = 420): Geometry {
  const profile: [number, number][] = [
    [0, 0], [28, 0], [33, 8], [44, 28], [52, 70], [55, 150],
    [55, len * 0.78], [51, len - 38], [45, len - 12], [40, len - 4], [0, len],
  ]
  return { type: 'lathe', profile, segments: 32 }
}

// --- 냉각 --------------------------------------------------------------------

/** 라디에이터 호스. 차체 절대 좌표 경로를 받아 첫 점 기준 tube로 바꾼다. */
export function radiatorHose(path: Vec3[], radius = 15): Geometry {
  const to = sub(path[0])
  return { type: 'tube', radius, radial: 12, segments: Math.max(32, path.length * 16), path: path.map(to) }
}

/** 라디에이터: 코어(extrude) + 좌우 탱크(lathe) + 가로 핀 리브. 원점은 코어 밑면 중앙,
 *  x가 두께 t, y가 높이 h, z가 폭 w다. */
export function radiatorCore(h: number, w: number, t: number, ribs = 9): Geometry {
  const halfZ = w / 2
  const coreW = w - 40
  const tank: Geometry = {
    type: 'lathe',
    segments: 20,
    profile: [[0, 0], [t * 0.5, 0], [t * 0.62, h * 0.05], [t * 0.62, h * 0.95], [t * 0.5, h], [0, h]],
  }
  const children: CompositeChild[] = [
    { geometry: { type: 'extrude', shape: ccw([[-t / 2, 0], [t / 2, 0], [t / 2, h], [-t / 2, h]]), depth: coreW, bevel: 2 }, material: 'radiator_core' },
    { geometry: tank, position: [0, 0, halfZ - t * 0.6] },
    { geometry: tank, position: [0, 0, -(halfZ - t * 0.6)] },
  ]
  for (let i = 0; i < ribs; i++) {
    const y = h * ((i + 0.5) / ribs) - 3
    children.push({ geometry: { type: 'extrude', shape: ccw([[-t / 2 - 2, y], [t / 2 + 2, y], [t / 2 + 2, y + 6], [-t / 2 - 2, y + 6]]), depth: coreW, bevel: 1 } })
  }
  return { type: 'composite', children }
}

/** 낫 모양 팬 블레이드 윤곽 (xy 평면, 원점이 팬 중심) */
function fanBlade(r0: number, r1: number, w0: number, w1: number, sweep: number): [number, number][] {
  const n = 6
  const lead: [number, number][] = []
  const trail: [number, number][] = []
  for (let i = 0; i <= n; i++) {
    const s = i / n
    const r = r0 + (r1 - r0) * s
    const a = sweep * s
    const half = (w0 + (w1 - w0) * s) / r / 2
    lead.push([r * Math.cos(a + half), r * Math.sin(a + half)])
    trail.push([r * Math.cos(a - half), r * Math.sin(a - half)])
  }
  return ccw([...lead, ...trail.reverse()])
}

/** 냉각 팬: lathe 허브 + extrude 블레이드 + 슈라우드 링. 로컬 축이 z이고 원점이 팬 중심이라
 *  부품 rot [0, π/2, 0]으로 축을 x(진행 방향)로 눕힌다. */
export function coolingFan(tip = 96, blades = 7): Geometry {
  const hub: [number, number][] = [[0, -11], [30, -11], [34, -5], [34, 6], [26, 11], [0, 11]]
  const children: CompositeChild[] = [
    { geometry: { type: 'lathe', profile: hub, segments: 24 }, rotation: [Math.PI / 2, 0, 0] },
    {
      geometry: { type: 'lathe', segments: 36, profile: [[tip + 2, -12], [tip + 9, -12], [tip + 9, 12], [tip + 2, 12], [tip + 2, -12]] },
      rotation: [Math.PI / 2, 0, 0],
    },
  ]
  const blade: Geometry = { type: 'extrude', shape: fanBlade(30, tip, 18, 36, 0.55), depth: 6, bevel: 1.2 }
  for (let i = 0; i < blades; i++) {
    children.push({ geometry: blade, rotation: [0, 0, (i / blades) * Math.PI * 2] })
  }
  return { type: 'composite', children }
}

// --- 외장 · 램프 · 조작계 -------------------------------------------------------
// 외장은 x(앞뒤) 스테이션마다 yz 평면 위 10점 단면을 놓고 loft로 잇는다. 좌표는 차체
// 절대값으로 적고 base(= 부품 마운트)를 빼서 상대 좌표로 넘긴다.
// loft는 뚜껑을 만들지 않는다. 끝을 막아야 하는 껍데기는 같은 x에 축소 단면을 하나 더 둬서
// 납작한 벽을 세운다. 좌우가 다른 패널은 오른쪽만 적고 mirrorZ로 왼쪽을 만든다.

/** 단면 윤곽 비율 */
type Profile = ReadonlyArray<readonly [number, number]>

/** 탱크·테일 링 단면 [z 비율, y 비율]. 밑변이 최대 폭의 0.7배라 위로 갈수록 둥글다 */
const RING10: Profile = [
  [0.7, 0], [1, 0.34], [0.92, 0.68], [0.62, 0.92], [0.22, 1],
  [-0.22, 1], [-0.62, 0.92], [-0.92, 0.68], [-1, 0.34], [-0.7, 0],
]

/** 시트 패드 — 윗면이 더 평평하다 */
const PAD10: Profile = [
  [0.86, 0], [1, 0.34], [0.99, 0.7], [0.82, 0.92], [0.45, 1],
  [-0.45, 1], [-0.82, 0.92], [-0.99, 0.7], [-1, 0.34], [-0.86, 0],
]

/** 아래가 열린 셸(어퍼 카울·윈드스크린) — 아래 양 끝이 최대 폭이다 */
const SHELL10: Profile = [
  [1, 0], [0.99, 0.34], [0.9, 0.64], [0.66, 0.88], [0.35, 0.99],
  [-0.35, 0.99], [-0.66, 0.88], [-0.9, 0.64], [-0.99, 0.34], [-1, 0],
]

/** 사이드 카울 [y 비율(1 위 ~ 0 아래), z 비율]. 허리가 가장 부풀고 아래로 가며 접힌다 */
const SIDE_PANEL: Profile = [
  [1, 0.6], [0.92, 0.85], [0.81, 0.97], [0.68, 1], [0.56, 0.99],
  [0.45, 0.95], [0.34, 0.89], [0.24, 0.81], [0.13, 0.7], [0, 0.55],
]

/** 로어 카울(벨리팬) — 위는 사이드 카울 밑단에 붙고 아래로 갈수록 안쪽으로 말린다 */
const LOWER_PANEL: Profile = [
  [1, 1], [0.88, 1.02], [0.76, 1.01], [0.63, 0.97], [0.51, 0.91],
  [0.4, 0.83], [0.29, 0.73], [0.19, 0.6], [0.09, 0.45], [0, 0.26],
]

/** 좌우 대칭 단면 하나. shrink는 단면 중심 기준 축소 — 끝을 막는 벽에 쓴다. */
function symSection(profile: Profile, x: number, halfW: number, yBot: number, yTop: number, shrink = 1): Vec3[] {
  const cy = (yBot + yTop) / 2
  return profile.map(([fz, fy]): Vec3 => [x, cy + (yBot + (yTop - yBot) * fy - cy) * shrink, halfW * fz * shrink])
}

/** 한쪽만 있는 패널 단면 */
function panelSection(profile: Profile, x: number, yBot: number, yTop: number, zMax: number): Vec3[] {
  return profile.map(([fy, fz]): Vec3 => [x, yBot + (yTop - yBot) * fy, zMax * fz])
}

/** 단면들을 z 대칭으로 뒤집는다. 점 순서도 뒤집어 면의 앞뒤가 유지된다. */
export function mirrorZ(sections: Vec3[][]): Vec3[][] {
  return sections.map((s) => s.map(([x, y, z]): Vec3 => [x, y, -z]).reverse())
}

const rebase = (sections: Vec3[][], base: Vec3): Vec3[][] => sections.map((s) => s.map(sub(base)))

// 연료탱크 --------------------------------------------------------------------
// 앞이 높고 뒤로 가며 좁아진다. 밑면 y=760은 프레임 메인 스파(|z| >= 152) 안쪽이라
// 스파는 탱크 옆을 비껴가고, 백본(z=0)만 껍데기 안을 지난다.
const TANK_X = [300, 240, 180, 120, 60, 0, -60, -120]
const TANK_HALF = [60, 95, 115, 120, 110, 95, 75, 55]
const TANK_TOP = [860, 900, 940, 960, 950, 920, 890, 860]
const TANK_BOTTOM = 760

/** 연료탱크 원점 — 밑면 중앙 */
export const TANK_BASE: Vec3 = [90, TANK_BOTTOM, 0]

export function tankGeometry(base: Vec3 = TANK_BASE): Geometry {
  const at = (i: number, shrink = 1) => symSection(RING10, TANK_X[i], TANK_HALF[i], TANK_BOTTOM, TANK_TOP[i], shrink)
  const last = TANK_X.length - 1
  const sections = [at(0, 0.12), ...TANK_X.map((_, i) => at(i)), at(last, 0.12)]
  return {
    type: 'composite',
    children: [
      { geometry: { type: 'loft', closed: true, sections: rebase(sections, base) } },
      // 주유구 캡 — 탱크 등선(x=80에서 y≈953)에 얹는다
      {
        geometry: { type: 'lathe', segments: 24, profile: [[0, 0], [45, 0], [45, 9], [40, 15], [0, 17]] },
        position: sub(base)([80, 945, 0]),
        material: 'polished_alu',
      },
    ],
  }
}

// 시트 ------------------------------------------------------------------------
const SEAT = {
  rider: { x: [-120, -220, -320, -420, -520], half: [100, 122, 130, 124, 110], top: [800, 797, 795, 792, 790], depth: 66 },
  pillion: { x: [-540, -610, -680, -750, -820], half: [110, 104, 96, 88, 80], top: [830, 842, 855, 868, 880], depth: 56 },
} as const

export const RIDER_SEAT_BASE: Vec3 = [-320, 730, 0]
export const PILLION_SEAT_BASE: Vec3 = [-680, 770, 0]

/** 시트: 위가 평평한 패드. 밑면은 서브프레임 레일보다 위에 있다. */
export function seatGeometry(kind: 'rider' | 'pillion', base: Vec3 = kind === 'rider' ? RIDER_SEAT_BASE : PILLION_SEAT_BASE): Geometry {
  const s = SEAT[kind]
  const at = (i: number, shrink = 1) => symSection(PAD10, s.x[i], s.half[i], s.top[i] - s.depth, s.top[i], shrink)
  const last = s.x.length - 1
  const sections = [at(0, 0.18), ...s.x.map((_, i) => at(i)), at(last, 0.18)]
  return { type: 'loft', closed: true, sections: rebase(sections, base) }
}

// 어퍼 카울 -------------------------------------------------------------------
// 앞 단면(x=640)이 곧 헤드라이트가 앉는 낯짝이다 — 폭 240에 높이 92로 좁고 납작하게 시작해
// 뒤로 가며 벌어진다. 윗마루가 x=596에서 가장 높고(y=1000) 거기서 윈드스크린이 올라간다.
// 마루는 뒤로 내려와 탱크 앞으로 이어지고, 밑단은 사이드 카울 윗단과 겹친다.
const UPPER_X = [640, 596, 552, 500, 440, 380]
const UPPER_HALF = [120, 162, 180, 188, 191, 192]
const UPPER_TOP = [930, 1000, 990, 966, 944, 925]
const UPPER_BOT = [838, 812, 792, 778, 774, 782]

export const UPPER_COWL_BASE: Vec3 = [500, 820, 0]

export function upperCowl(base: Vec3 = UPPER_COWL_BASE): Geometry {
  const sections = UPPER_X.map((x, i) => symSection(SHELL10, x, UPPER_HALF[i], UPPER_BOT[i], UPPER_TOP[i]))
  return { type: 'loft', sections: rebase(sections, base) }
}

// 사이드 카울 -----------------------------------------------------------------
// 앞은 라디에이터(x 223..257, |z| <= 125)를 감싸고, 밑단은 뒤로 가며 치켜 올라가 엔진
// 아랫도리와 배기 헤더를 드러낸다. 앞쪽 밑단만 로어 카울 윗단과 만난다.
const SIDE_X = [420, 330, 240, 150, 60, -30, -120]
const SIDE_TOP = [820, 790, 758, 726, 700, 670, 640]
const SIDE_BOT = [300, 322, 355, 400, 450, 500, 545]
const SIDE_Z = [240, 238, 234, 228, 221, 215, 210]

export const SIDE_COWL_BASE = (side: 1 | -1): Vec3 => [150, 520, 170 * side]

export function sideCowl(side: 1 | -1, base: Vec3 = SIDE_COWL_BASE(side)): Geometry {
  const right = SIDE_X.map((x, i) => panelSection(SIDE_PANEL, x, SIDE_BOT[i], SIDE_TOP[i], SIDE_Z[i]))
  return { type: 'loft', sections: rebase(side === 1 ? right : mirrorZ(right), base) }
}

// 로어 카울(벨리팬) -----------------------------------------------------------
const LOWER_X = [250, 130, 10, -120, -250]
const LOWER_TOP_Y = [324, 340, 355, 368, 380]
const LOWER_TOP_Z = [129, 126, 122, 117, 110]
const LOWER_BOT_Y = [172, 178, 186, 194, 205]

export const LOWER_COWL_BASE = (side: 1 | -1): Vec3 => [0, 280, 100 * side]

export function lowerCowl(side: 1 | -1, base: Vec3 = LOWER_COWL_BASE(side)): Geometry {
  const right = LOWER_X.map((x, i) => panelSection(LOWER_PANEL, x, LOWER_BOT_Y[i], LOWER_TOP_Y[i], LOWER_TOP_Z[i]))
  return { type: 'loft', sections: rebase(side === 1 ? right : mirrorZ(right), base) }
}

// 테일 카울 -------------------------------------------------------------------
// 뒤로 가며 좁아지면서 치켜 올라간다. 뒷면은 축소 단면으로 막고 그 위에 후미등이 앉는다.
const TAIL_X = [-520, -596, -672, -748, -824, -900]
const TAIL_HALF = [130, 124, 114, 100, 78, 60]
const TAIL_TOP = [800, 820, 840, 862, 882, 900]
const TAIL_BOT = [700, 724, 748, 772, 796, 820]

export const TAIL_COWL_BASE: Vec3 = [-710, 800, 0]

export function tailCowl(base: Vec3 = TAIL_COWL_BASE): Geometry {
  const at = (i: number, shrink = 1) => symSection(RING10, TAIL_X[i], TAIL_HALF[i], TAIL_BOT[i], TAIL_TOP[i], shrink)
  const last = TAIL_X.length - 1
  const sections = [...TAIL_X.map((_, i) => at(i)), at(last, 0.15)]
  return { type: 'loft', closed: true, sections: rebase(sections, base) }
}

// 윈드스크린 -----------------------------------------------------------------
export const WINDSCREEN_BASE: Vec3 = [560, 1000, 0]

/**
 * 윈드스크린: 어퍼 카울 마루(x=572, y=1000)에서 올라오며 좁아지는 얇은 버블 3단면.
 * 밑단 양 끝은 카울 표면보다 아래로 넣어 틈이 보이지 않게 하고, 계기판 포드(x <= 554,
 * y <= 1023)보다 앞·위로만 지나간다.
 */
export function windscreenGeometry(base: Vec3 = WINDSCREEN_BASE): Geometry {
  const sections = [
    symSection(SHELL10, 576, 78, 900, 995),
    symSection(SHELL10, 560, 66, 985, 1045),
    symSection(SHELL10, 544, 48, 1040, 1085),
  ]
  return { type: 'loft', sections: rebase(sections, base) }
}

// 펜더 ------------------------------------------------------------------------

/**
 * 타이어를 감싸는 호. sweepDeg는 수직 위가 0이고 +가 앞이다. 단면은 폭 width에 10점이고
 * 가운데가 thickness만큼 볼록, 양 끝은 타이어 쪽으로 말려 들어간다.
 * 좌표는 휠 중심 기준이고 base만큼 빼서 부품 원점을 옮긴다.
 */
export function fenderArch(tireR: number, width: number, sweepDeg: [number, number], base: Vec3 = [0, 0, 0], thickness = 6, steps = 10): Geometry {
  const [a0, a1] = sweepDeg
  const half = width / 2
  const zf = [-1, -0.94, -0.78, -0.52, -0.18, 0.18, 0.52, 0.78, 0.94, 1]
  const sections: Vec3[][] = []
  for (let i = 0; i <= steps; i++) {
    const a = ((a0 + ((a1 - a0) * i) / steps) * Math.PI) / 180
    const s = Math.sin(a)
    const c = Math.cos(a)
    sections.push(
      zf.map((f): Vec3 => {
        const r = tireR + thickness * (1 - f * f) - (5 * Math.max(0, Math.abs(f) - 0.85)) / 0.15
        return [r * s - base[0], r * c - base[1], half * f - base[2]]
      }),
    )
  }
  return { type: 'loft', sections }
}

// 램프 ------------------------------------------------------------------------

/** 헤드라이트 렌즈: 얕은 돔. lathe 축이 +y라 부품 쪽에서 [0,0,-π/2]로 앞(+x)을 보게 눕힌다. */
export function headlightLens(r = 90, depth = 30): Geometry {
  return {
    type: 'lathe',
    segments: 28,
    profile: [[0, 0], [r, 0], [r * 0.99, depth * 0.25], [r * 0.92, depth * 0.55], [r * 0.72, depth * 0.8], [r * 0.4, depth * 0.95], [0, depth]],
  }
}

/** 헤드라이트 유닛: 어퍼 카울 안에 들어가는 트윈 렌즈 + 뒤쪽 하우징. 원점은 렌즈 밑동 중앙 */
export function headlightUnit(): Geometry {
  const housing: Geometry = { type: 'lathe', segments: 20, profile: [[0, 0], [84, 0], [70, -34], [40, -54], [0, -60]] }
  const lens = headlightLens()
  const side = (s: 1 | -1): CompositeChild[] => [
    { geometry: housing, position: [0, 0, 74 * s], rotation: [0, 0, -Math.PI / 2], scale: [0.62, 1, 0.69], material: 'plastic_black' },
    // 재질을 비워 두면 부품 재질(lamp_off / 점화 후 lamp_on)을 그대로 받는다
    { geometry: lens, position: [0, 0, 74 * s], rotation: [0, 0, -Math.PI / 2], scale: [0.62, 1, 0.69] },
  ]
  return { type: 'composite', children: [...side(1), ...side(-1)] }
}

/** 후미등 렌즈: lathe를 scale로 눌러 만든 타원 돔. 뒤(-x)를 본다. 원점은 렌즈 밑동 중앙 */
export function tailLightLens(r = 45, depth = 26): Geometry {
  const dome: Geometry = {
    type: 'lathe',
    segments: 24,
    profile: [[0, 0], [r, 0], [r * 0.97, depth * 0.3], [r * 0.85, depth * 0.62], [r * 0.55, depth * 0.88], [0, depth]],
  }
  return {
    type: 'composite',
    children: [
      { geometry: { type: 'lathe', segments: 20, profile: [[0, 0], [r * 1.06, 0], [r * 0.9, -20], [0, -26]] }, rotation: [0, 0, Math.PI / 2], scale: [0.72, 1, 1.35], material: 'plastic_black' },
      { geometry: dome, rotation: [0, 0, Math.PI / 2], scale: [0.72, 1, 1.35] },
    ],
  }
}

/** 방향지시등: 스템 + 타원 렌즈. 원점은 카울에 닿는 뿌리, +z로 뻗는다 */
export function turnSignal(): Geometry {
  return {
    type: 'composite',
    children: [
      { geometry: { type: 'cylinder', radiusTop: 7, radiusBottom: 9, height: 58, segments: 10 }, rotation: [Math.PI / 2, 0, 0], material: 'plastic_black' },
      {
        geometry: { type: 'lathe', segments: 18, profile: [[0, 0], [26, 0], [25, 10], [20, 18], [11, 23], [0, 25]] },
        position: [0, 0, 58],
        rotation: [Math.PI / 2, 0, 0],
        scale: [0.8, 1, 1],
      },
    ],
  }
}

// 조작계 ----------------------------------------------------------------------

/** 그립: 고무 통에 끝 플랜지. lathe 축이 +y라 부품 쪽에서 [π/2,0,0]으로 눕혀 +z로 뻗는다 */
export function gripGeometry(r = 16, len = 120, flange = 20): Geometry {
  return {
    type: 'lathe',
    segments: 20,
    profile: [
      [0, 0], [r, 0], [r, 6], [r + 1, 10], [r, 14],
      [r, len - 16], [flange - 1, len - 12], [flange, len - 6], [flange - 2, len], [0, len],
    ],
  }
}

/**
 * 브레이크·클러치 레버. 원점이 레버 뿌리(퍼치)라 RideParts의 LeverPivot이 뿌리에서 돌린다
 * — halfLength가 첫 자식 box의 x 길이 절반을 축 위치로 쓰므로 첫 자식은 작은 퍼치 블록이다.
 */
export function leverGeometry(side: 1 | -1): Geometry {
  const path: Vec3[] = [[0, 0, 0], [38, -2, 14], [76, -6, 30], [112, -12, 44], [142, -20, 52]]
  const p = (i: number): Vec3 => [path[i][0], path[i][1], path[i][2] * side]
  return {
    type: 'composite',
    children: [
      { geometry: { type: 'box', size: [10, 26, 34] }, position: [0, -13, 0], material: 'plastic_black' },
      { geometry: { type: 'tube', radius: 6, radial: 10, segments: 40, path: [p(0), p(1), p(2)] } },
      { geometry: { type: 'tube', radius: 4.5, radial: 10, segments: 40, path: [p(2), p(3), p(4)] } },
    ],
  }
}

/** 미러: 스템 tube + 하우징 loft 4단면. 원점은 카울에 닿는 스템 뿌리 */
export function mirrorGeometry(side: 1 | -1): Geometry {
  const stem: Vec3[] = [[0, 0, 0], [-14, 30, 22], [-32, 56, 52], [-46, 72, 88], [-52, 80, 125]]
  const c: Vec3 = [-52, 92, 122]
  // 하우징 단면: 앞(작음) → 거울면(가장 큼). x가 깊이 방향이다
  const steps: Array<[number, number, number]> = [[30, 0.34, 0.3], [8, 0.74, 0.7], [-12, 0.96, 0.95], [-30, 1, 1]]
  const hy = 40
  const hz = 62
  const ring = (dx: number, fy: number, fz: number): Vec3[] =>
    Array.from({ length: 10 }, (_, i) => {
      const a = (i / 10) * Math.PI * 2
      return [c[0] + dx, c[1] + hy * fy * Math.sin(a), (c[2] + hz * fz * Math.cos(a)) * side] as Vec3
    })
  return {
    type: 'composite',
    children: [
      { geometry: { type: 'tube', radius: 9, radial: 10, segments: 48, path: stem.map((p): Vec3 => [p[0], p[1], p[2] * side]) } },
      { geometry: { type: 'loft', closed: true, sections: steps.map(([dx, fy, fz]) => ring(dx, fy, fz)) } },
      // 거울면
      {
        geometry: { type: 'extrude', shape: roundedRect(74, 46, 12, 5), depth: 4, bevel: 1 },
        position: [c[0] - 31, c[1], c[2] * side],
        rotation: [0, Math.PI / 2, 0],
        material: 'glass',
      },
    ],
  }
}

/** 계기판: 8각 압출 포드 + 화면 + 키 실린더. 화면만 재질을 비워 둬서 점화 때 켜진다. */
export function clusterGeometry(keyLocal: Vec3, keyRot: number): Geometry {
  const pod = ccw([[-18, 2], [-11, 0], [11, 0], [18, 2], [18, 70], [11, 72], [-11, 72], [-18, 70]])
  return {
    type: 'composite',
    children: [
      { geometry: { type: 'extrude', shape: pod, depth: 200, bevel: 2 }, material: 'plastic_black' },
      { geometry: { type: 'roundedBox', size: [6, 28, 140], radius: 4 }, position: [-23, 8, 0] },
      { geometry: { type: 'cylinder', radiusTop: 12, radiusBottom: 12, height: 20, segments: 16 }, position: keyLocal, rotation: [0, 0, keyRot], material: 'polished_alu' },
    ],
  }
}
