// 부품 정의 — 치수와 조립 순서는 이 파일 하나만 고친다.
// 모든 치수와 좌표는 mm. 씬에서는 MM(=0.1)을 곱해 1 unit = 10mm로 쓴다.
// 좌표계: x 좌우(+x 오른쪽), y 상하(+y 위), z 앞뒤(+z 사용자 쪽). 케이스 바닥이 y=0.

import { MM, type Geometry, type PartDef, type PartInstance, type StationDef, type Vec3 } from '../../engine/types'
import { frame, gasketSet, keycap as keycapGeom, stabilizer as stabilizerGeom, switchBody, tub } from './geometry'
export { MM }
export type { Vec3 }

// ---------------------------------------------------------------------------
// 키 배열
// ---------------------------------------------------------------------------

/** 키 피치 (1u) */
export const U = 19.05

/** 배열 폭·깊이 (u 단위) */
export const LAYOUT_COLS = 16
export const LAYOUT_ROWS = 6

export interface KeyDef {
  id: string
  /** 왼쪽 가장자리, u 단위 */
  col: number
  /** 위(뒤)에서부터 0 */
  row: number
  /** 폭, u 단위 */
  w: number
}

// 행 단위 정의: [id, 폭]. 폭 생략 시 1u. 숫자만 있으면 그 폭만큼 빈 공간.
type RowSpec = Array<[string, number?] | number>

const ROW_SPECS: RowSpec[] = [
  // F열: Esc / F1-4 / F5-8 / F9-12 / Del Home  (클러스터 사이 0.25u 간격)
  [['esc'], 0.25, ['f1'], ['f2'], ['f3'], ['f4'], 0.25, ['f5'], ['f6'], ['f7'], ['f8'], 0.25,
    ['f9'], ['f10'], ['f11'], ['f12'], 0.25, ['del'], ['home']],
  [['grave'], ['1'], ['2'], ['3'], ['4'], ['5'], ['6'], ['7'], ['8'], ['9'], ['0'],
    ['minus'], ['equal'], ['backspace', 2], ['pgup']],
  [['tab', 1.5], ['q'], ['w'], ['e'], ['r'], ['t'], ['y'], ['u'], ['i'], ['o'], ['p'],
    ['lbracket'], ['rbracket'], ['backslash', 1.5], ['pgdn']],
  [['caps', 1.75], ['a'], ['s'], ['d'], ['f'], ['g'], ['h'], ['j'], ['k'], ['l'],
    ['semicolon'], ['quote'], ['enter', 2.25], ['end']],
  [['lshift', 2.25], ['z'], ['x'], ['c'], ['v'], ['b'], ['n'], ['m'], ['comma'], ['period'],
    ['slash'], ['rshift', 1.75], ['up'], ['ins']],
  [['lctrl', 1.25], ['lwin', 1.25], ['lalt', 1.25], ['space', 6.25], ['ralt'], ['fn'], ['rctrl'],
    ['left'], ['down'], ['right']],
]

function buildLayout(): KeyDef[] {
  const keys: KeyDef[] = []
  ROW_SPECS.forEach((spec, row) => {
    let col = 0
    for (const item of spec) {
      if (typeof item === 'number') {
        col += item
        continue
      }
      const [id, w = 1] = item
      keys.push({ id, col, row, w })
      col += w
    }
    if (Math.abs(col - LAYOUT_COLS) > 1e-6) {
      throw new Error(`row ${row} width ${col}u != ${LAYOUT_COLS}u`)
    }
  })
  return keys
}

export const KEY_LAYOUT: KeyDef[] = buildLayout()

// TODO: 실물 분해 후 키 개수 확정. 현재는 표준 75% 배열(82키)로 가정.
export const KEY_COUNT = KEY_LAYOUT.length

/** 스태빌라이저가 들어가는 키. 실물 스펙: 5개. */
export const STABILIZED_KEYS = ['space', 'enter', 'backspace', 'lshift', 'rshift'] as const

export function isStabilizedKey(keyId: string): boolean {
  return (STABILIZED_KEYS as readonly string[]).includes(keyId)
}

/** 배열 전체 폭·깊이 (mm) */
export const LAYOUT_W = LAYOUT_COLS * U
export const LAYOUT_D = LAYOUT_ROWS * U

/** 키 중심의 x/z (mm). 배열은 원점 중심. */
export function keyCenter(k: KeyDef): [number, number] {
  const x = (k.col + k.w / 2) * U - LAYOUT_W / 2
  const z = (k.row + 0.5) * U - LAYOUT_D / 2
  return [x, z]
}

/** 좌하단(0) → 우상단(1). 부팅 웨이브와 순차 장착 순서에 쓴다. */
export function keyWaveOrder(k: KeyDef): number {
  const [x, z] = keyCenter(k)
  const nx = (x + LAYOUT_W / 2) / LAYOUT_W
  const nz = 1 - (z + LAYOUT_D / 2) / LAYOUT_D
  return (nx + nz) / 2
}

// ---------------------------------------------------------------------------
// 케이스·스택 치수 (mm)
// ---------------------------------------------------------------------------

export const CASE_W = 330
export const CASE_D = 140
export const CASE_WALL = 6
export const CASE_RADIUS = 3
export const BOTTOM_FLOOR_T = 4
export const BOTTOM_H = 22
export const TOP_H = 8

export const BOTTOM_FOAM_T = 3
export const PCB_T = 1.6
export const PCB_FOAM_T = 3.5
export const PLATE_T = 1.5

export const PCB_W = 305
export const PCB_D = 115
export const PLATE_W = 308
export const PLATE_D = 118

export const SWITCH_BODY = 14
export const SWITCH_H = 8
export const STEM_R = 2
export const STEM_H = 4

export const KEYCAP_H = 9
export const KEYCAP_GAP = 1 // 키캡 사이 여유(한쪽)
export const KEYCAP_TOP_INSET = 3 // 위쪽 면이 한쪽당 줄어드는 양

export const GASKET_T = 2
export const GASKET_W = 8

/** 샌드위치(3~7번)가 안착 전에 떠 있는 높이 */
export const ASSEMBLY_LIFT = 45

// 스택 y 좌표 (밑면 기준)
export const Y_FLOOR_TOP = BOTTOM_FLOOR_T
export const Y_BOTTOM_FOAM = Y_FLOOR_TOP
export const Y_PCB = 11
export const Y_PCB_FOAM = Y_PCB + PCB_T
export const Y_PLATE = Y_PCB_FOAM + PCB_FOAM_T
export const Y_PLATE_TOP = Y_PLATE + PLATE_T
export const Y_SWITCH = Y_PLATE_TOP
/** 키캡 밑면과 스위치 윗면 사이 1.5mm 틈으로 RGB가 새어 나온다 */
export const Y_KEYCAP = Y_SWITCH + SWITCH_H + 1.5
export const Y_TOP_CASE = BOTTOM_H
export const Y_GASKET = Y_PLATE - GASKET_T

// TODO: 마운트 방식 가스켓으로 추정. 실물 확인 후 정정.
export const MOUNT_STYLE = 'gasket' as const

/** USB-C 포트 위치 (뒷벽 바깥 면 기준) */
export const USB_PORT: Vec3 = [-90, BOTTOM_H / 2 + 2, -CASE_D / 2]

// 대기 위치. 큰 부품은 케이스 뒤쪽, 작은 부품은 케이스 오른쪽 옆.
// 뒤쪽은 공중에 뜬 샌드위치에 가려질 수 있어 작은 부품은 옆에 둔다.
const REST_Z = -130
const REST_Y = 6
const REST_SIDE: Vec3 = [215, REST_Y, 20]

function single(
  def: Omit<PartDef, 'instances' | 'count' | 'restPosition'> & { restPosition?: Vec3 },
): PartDef {
  const restPosition = def.restPosition ?? [0, REST_Y, REST_Z]
  return {
    ...def,
    restPosition,
    count: 1,
    instances: [
      {
        id: def.id,
        mountPosition: def.mountPosition,
        mountRotation: def.mountRotation,
        geometry: def.geometry,
        order: 0,
      },
    ],
  }
}

// --- 개별 부품 ---------------------------------------------------------------

const bottomCase = single({
  id: 'bottom_case',
  nameKo: '하부 케이스',
  nameEn: 'Bottom Case',
  geometry: tub([CASE_W, BOTTOM_H, CASE_D], CASE_WALL, BOTTOM_FLOOR_T, CASE_RADIUS),
  mountPosition: [0, 0, 0],
  mountRotation: [0, 0, 0],
  restPosition: [0, REST_Y, REST_Z - 30],
  requires: [],
  material: 'aluminum',
  cameraView: { azimuth: 20, polar: 58, distance: 620 },
  hint: '하부 케이스 장착',
})

const bottomFoam = single({
  id: 'bottom_foam',
  nameKo: '하판 흡음폼',
  nameEn: 'Case Foam',
  geometry: {
    type: 'box',
    size: [CASE_W - CASE_WALL * 2 - 2, BOTTOM_FOAM_T, CASE_D - CASE_WALL * 2 - 2],
  },
  mountPosition: [0, Y_BOTTOM_FOAM, 0],
  mountRotation: [0, 0, 0],
  requires: ['bottom_case'],
  material: 'foam',
  cameraView: { azimuth: 10, polar: 40, distance: 560 },
  hint: '하판 흡음폼 장착',
})

// 스태빌라이저: 실제로는 PCB에 먼저 끼운다. 스펙 순서(3→4)를 따르되,
// 순서를 바꾸려면 requires 두 줄만 교환하면 된다.
const stabilizerHousing: Vec3 = [7, 13, 7]
const stabilizerKeys = KEY_LAYOUT.filter((k) => isStabilizedKey(k.id))
const stabilizers: PartDef = {
  id: 'stabilizer',
  nameKo: '스태빌라이저',
  nameEn: 'Stabilizer',
  geometry: stabilizerGeom(24, stabilizerHousing, 0.8),
  restPosition: REST_SIDE,
  mountPosition: [0, Y_PCB + PCB_T, 0],
  mountRotation: [0, 0, 0],
  requires: ['bottom_foam'],
  count: stabilizerKeys.length,
  material: 'plastic',
  station: 'sandwich',
  cameraView: { azimuth: -15, polar: 42, distance: 520 },
  hint: '스태빌라이저 장착',
  instances: stabilizerKeys.map((k) => {
    const [x, z] = keyCenter(k)
    // 스태빌라이저 간격: 2u~2.75u는 24mm, 6.25u는 100mm
    const span = k.w >= 6 ? 100 : 24
    return {
      id: `stabilizer:${k.id}`,
      tag: k.id,
      mountPosition: [x, Y_PCB + PCB_T, z],
      mountRotation: [0, 0, 0],
      geometry: stabilizerGeom(span, stabilizerHousing, 0.8),
      order: keyWaveOrder(k),
    }
  }),
}

const pcb = single({
  id: 'pcb',
  nameKo: 'PCB (핫스왑)',
  nameEn: 'PCB',
  geometry: { type: 'box', size: [PCB_W, PCB_T, PCB_D] },
  mountPosition: [0, Y_PCB, 0],
  mountRotation: [0, 0, 0],
  requires: ['stabilizer'],
  material: 'pcb',
  station: 'sandwich',
  cameraView: { azimuth: 25, polar: 48, distance: 560 },
  hint: 'PCB 장착',
})

const pcbFoam = single({
  id: 'pcb_foam',
  nameKo: 'PCB 폼',
  nameEn: 'PCB Foam',
  geometry: { type: 'box', size: [PCB_W, PCB_FOAM_T, PCB_D] },
  mountPosition: [0, Y_PCB_FOAM, 0],
  mountRotation: [0, 0, 0],
  requires: ['pcb'],
  material: 'foam',
  station: 'sandwich',
  cameraView: { azimuth: 25, polar: 48, distance: 560 },
  hint: 'PCB 폼 장착',
})

const plate = single({
  id: 'plate',
  nameKo: '플레이트',
  nameEn: 'Plate',
  geometry: { type: 'box', size: [PLATE_W, PLATE_T, PLATE_D] },
  mountPosition: [0, Y_PLATE, 0],
  mountRotation: [0, 0, 0],
  requires: ['pcb_foam'],
  material: 'aluminum',
  station: 'sandwich',
  cameraView: { azimuth: 25, polar: 48, distance: 560 },
  hint: '플레이트 장착',
})

const switchGeometry: Geometry = switchBody([SWITCH_BODY, SWITCH_H, SWITCH_BODY], STEM_R, STEM_H)
const switches: PartDef = {
  id: 'switch',
  nameKo: '스위치 (리니어 45g)',
  nameEn: 'Switch',
  geometry: switchGeometry,
  restPosition: REST_SIDE,
  mountPosition: [0, Y_SWITCH, 0],
  mountRotation: [0, 0, 0],
  requires: ['plate'],
  count: KEY_COUNT,
  material: 'plastic',
  station: 'sandwich',
  cameraView: { azimuth: 0, polar: 35, distance: 500 },
  hint: '스위치 장착',
  instances: KEY_LAYOUT.map((k) => {
    const [x, z] = keyCenter(k)
    return {
      id: `switch:${k.id}`,
      tag: k.id,
      mountPosition: [x, Y_SWITCH, z],
      mountRotation: [0, 0, 0],
      geometry: switchGeometry,
      order: keyWaveOrder(k),
    }
  }),
}

const gasketStrips: Array<{ pos: Vec3; size: Vec3 }> = (() => {
  // 얇은 스트립 4개: 앞·뒤 긴 것, 좌·우 짧은 것
  const long = 140
  const short = 50
  const dz = PLATE_D / 2 - GASKET_W / 2
  const sx = PLATE_W / 2 - GASKET_W / 2
  return [
    { pos: [0, 0, -dz], size: [long, GASKET_T, GASKET_W] },
    { pos: [0, 0, dz], size: [long, GASKET_T, GASKET_W] },
    { pos: [-sx, 0, 0], size: [GASKET_W, GASKET_T, short] },
    { pos: [sx, 0, 0], size: [GASKET_W, GASKET_T, short] },
  ]
})()

const gasket = single({
  id: 'gasket',
  nameKo: '가스켓 안착',
  nameEn: 'Gasket Seat',
  geometry: gasketSet(gasketStrips),
  restPosition: [REST_SIDE[0] + 80, REST_Y, 0],
  mountPosition: [0, Y_GASKET, 0],
  mountRotation: [0, 0, 0],
  requires: ['switch'],
  material: 'rubber',
  marries: 'sandwich',
  cameraView: { azimuth: 35, polar: 62, distance: 600 },
  hint: '조립체 안착',
})

const topCase = single({
  id: 'top_case',
  nameKo: '상부 케이스',
  nameEn: 'Top Case',
  geometry: frame([CASE_W, TOP_H, CASE_D], (CASE_W - PLATE_W) / 2 - 2),
  mountPosition: [0, Y_TOP_CASE, 0],
  mountRotation: [0, 0, 0],
  requires: ['gasket'],
  material: 'aluminum',
  cameraView: { azimuth: 20, polar: 55, distance: 600 },
  hint: '상부 케이스 장착',
})

function keycapGeometry(k: KeyDef): Geometry {
  const w = k.w * U - KEYCAP_GAP * 2
  const d = U - KEYCAP_GAP * 2
  return keycapGeom([w, d], [w - KEYCAP_TOP_INSET * 2, d - KEYCAP_TOP_INSET * 2], KEYCAP_H)
}
const keycaps: PartDef = {
  id: 'keycap',
  nameKo: '키캡 (PBT 이중사출)',
  nameEn: 'Keycap',
  geometry: keycapGeometry(KEY_LAYOUT[0]),
  restPosition: REST_SIDE,
  mountPosition: [0, Y_KEYCAP, 0],
  mountRotation: [0, 0, 0],
  requires: ['top_case'],
  count: KEY_COUNT,
  material: 'keycap',
  cameraView: { azimuth: 0, polar: 40, distance: 520 },
  hint: '키캡 장착',
  instances: KEY_LAYOUT.map((k) => {
    const [x, z] = keyCenter(k)
    return {
      id: `keycap:${k.id}`,
      tag: k.id,
      mountPosition: [x, Y_KEYCAP, z],
      mountRotation: [0, 0, 0],
      geometry: keycapGeometry(k),
      order: keyWaveOrder(k),
    }
  }),
}

/** 샌드위치(스태빌라이저~스위치)는 케이스 위 ASSEMBLY_LIFT에서 조립되고 가스켓 안착 시 내려앉는다 */
export const STATIONS: StationDef[] = [{ id: 'sandwich', nameKo: '샌드위치', offset: [0, ASSEMBLY_LIFT, 0] }]

/** 조립 순서 = 배열 순서 */
export const PARTS: PartDef[] = [
  bottomCase,
  bottomFoam,
  stabilizers,
  pcb,
  pcbFoam,
  plate,
  switches,
  gasket,
  topCase,
  keycaps,
]

export const PART_BY_ID: Record<string, PartDef> = Object.fromEntries(PARTS.map((p) => [p.id, p]))

export function partOfInstance(instanceId: string): PartDef {
  const partId = instanceId.split(':')[0]
  const part = PART_BY_ID[partId]
  if (!part) throw new Error(`unknown instance ${instanceId}`)
  return part
}

export function findInstance(instanceId: string): PartInstance {
  const part = partOfInstance(instanceId)
  const inst = part.instances.find((i) => i.id === instanceId)
  if (!inst) throw new Error(`unknown instance ${instanceId}`)
  return inst
}

// ---------------------------------------------------------------------------
// USB-C 케이블 (부품 목록 밖, 전원 시퀀스용)
// ---------------------------------------------------------------------------

export const CABLE = {
  plug: [8.5, 3, 14] as Vec3,
  cordR: 1.8,
  cordLength: 90,
  /** 조립 완료 후 등장 위치 */
  restPosition: [USB_PORT[0], 45, USB_PORT[2] - 90] as Vec3,
  /** 연결된 상태의 플러그 중심 */
  pluggedPosition: [USB_PORT[0], USB_PORT[1], USB_PORT[2] - 7] as Vec3,
}
