// 닌자 400 부품 정의 — 조립 순서는 배열 순서다. 치수와 좌표는 전부 mm.
// 좌표계: x 앞뒤(+x 앞), y 상하(+y 위), z 좌우(+z 오른쪽). 지면이 y=0.
// 부품을 추가할 때는 아래 구분 주석 자리에 add({...})를 순서대로 끼워 넣는다.

import type { CameraView, Geometry, PartDef, PartInstance, ProductDef, StationDef, Vec3 } from '../../engine/types'
import { trellis } from './geometry'
import { HEAD } from './spec'

// 작업대 --------------------------------------------------------------------
// 엔진 스탠드 상판은 y=270..280 이고 크랭크케이스 하부 밑면이 y=280 이라 딱 얹힌다.
// 소품 원점은 (offset.x, 0, offset.z) 이므로 엔진 스탠드 children의 x는 크랭크 중심(-120) 기준이다.
export const STATIONS: StationDef[] = [
  {
    id: 'engine',
    nameKo: '엔진 스탠드',
    offset: [0, 0, 1100],
    propMaterial: 'bench',
    prop: {
      type: 'composite',
      children: [
        { geometry: { type: 'box', size: [60, 270, 60] }, position: [-300, 0, -160] },
        { geometry: { type: 'box', size: [60, 270, 60] }, position: [60, 0, -160] },
        { geometry: { type: 'box', size: [60, 270, 60] }, position: [-300, 0, 160] },
        { geometry: { type: 'box', size: [60, 270, 60] }, position: [60, 0, 160] },
        { geometry: { type: 'box', size: [460, 10, 420] }, position: [-120, 270, 0] },
      ],
    },
  },
  {
    id: 'front_wheel',
    nameKo: '앞바퀴 벤치',
    offset: [900, 20, 600],
    propMaterial: 'bench',
    prop: { type: 'box', size: [500, 20, 300] },
  },
  {
    id: 'rear_wheel',
    nameKo: '뒷바퀴 벤치',
    offset: [-900, 20, 600],
    propMaterial: 'bench',
    prop: { type: 'box', size: [500, 20, 300] },
  },
]

/** 프레임 지그: 프레임 아래 받침 2개 */
export const PROPS: NonNullable<ProductDef['props']> = [
  { geometry: { type: 'box', size: [80, 300, 240] }, position: [250, 0, 0], material: 'bench' },
  { geometry: { type: 'box', size: [80, 300, 240] }, position: [-350, 0, 0], material: 'bench' },
]

// 대기 위치 · 카메라 기본값 -------------------------------------------------------
const REST: Record<string, Vec3> = {
  main: [-300, 0, -1000], // 차체 뒤쪽 (큰 부품)
  small: [0, 0, 1500], // 카메라 쪽 (볼트·밸브·지시등)
  engine: [420, 300, 1100], // 엔진 스탠드 옆
  front_wheel: [1585, 20, 1000],
  rear_wheel: [-1585, 20, 1000],
}
const VIEW: Record<string, CameraView> = {
  main: { azimuth: 30, polar: 64, distance: 4200, target: [0, 500, 0] },
  engine: { azimuth: 20, polar: 60, distance: 2000, target: [-120, 480, 1100] },
  front_wheel: { azimuth: 40, polar: 65, distance: 1800, target: [1585, 320, 600] },
  rear_wheel: { azimuth: -40, polar: 65, distance: 1800, target: [-1585, 320, 600] },
}

interface InstanceInput {
  suffix: string
  mount: Vec3
  rot?: Vec3
  geometry?: Geometry
  tag?: string
}
interface PartInput {
  id: string
  ko: string
  en: string
  geometry: Geometry
  mount: Vec3
  rot?: Vec3
  rest?: Vec3
  material: string
  station?: string
  marries?: string
  instances?: InstanceInput[]
  requires?: string[]
  paintable?: boolean
  hidden?: boolean
  variants?: PartDef['variants']
  camera?: Partial<CameraView>
  hint?: string
  preplaced?: boolean
  /** 작은 부품이면 대기 위치를 카메라 쪽으로 */
  small?: boolean
}

const defs: PartInput[] = []
const add = (d: PartInput) => {
  defs.push(d)
  return d.id
}

/** 차체 절대 좌표 노드를 부품 원점(mount) 기준 상대 좌표로 옮긴다. */
function relative(nodes: Vec3[], base: Vec3): Vec3[] {
  return nodes.map((n) => [n[0] - base[0], n[1] - base[1], n[2] - base[2]])
}

// --- A. 프레임 ---------------------------------------------------------------
/** 프레임 원점 = 지그 상판 높이. 프레임이 지면이 아니라 지그 위에 선다. */
const FRAME_BASE: Vec3 = [0, 300, 0]
// TODO: 실물 확인 — 트렐리스 노드 좌표는 사진 기준 추정
const FRAME_NODES: Vec3[] = [
  HEAD, // 0 스티어링 헤드
  [300, 780, 120],
  [300, 780, -120], // 1,2 상부 메인 튜브 시작
  [-150, 700, 150],
  [-150, 700, -150], // 3,4 탱크 아래
  [-420, 560, 150],
  [-420, 560, -150], // 5,6 스윙암 피벗 위
  [-420, 420, 150],
  [-420, 420, -150], // 7,8 스윙암 피벗
  [80, 560, 140],
  [80, 560, -140], // 9,10 엔진 앞 마운트 다운튜브
  [200, 300, 130],
  [200, 300, -130], // 11,12 엔진 앞 하단 마운트
  [-250, 720, 0], // 13 백본 뒤끝
]
const FRAME_EDGES: Array<[number, number]> = [
  [0, 1], [0, 2], [1, 3], [2, 4], [3, 5], [4, 6], [5, 7], [6, 8], [7, 8],
  [0, 9], [0, 10], [9, 11], [10, 12], [9, 3], [10, 4], [1, 13], [2, 13],
  [13, 5], [13, 6], [11, 7], [12, 8], [1, 2], [3, 4], [5, 6],
]
add({
  id: 'main_frame',
  ko: '메인 프레임',
  en: 'Main Frame',
  geometry: trellis(relative(FRAME_NODES, FRAME_BASE), FRAME_EDGES, 14),
  mount: FRAME_BASE,
  material: 'frame_paint',
  preplaced: true,
  hint: '프레임',
})

/** 서브프레임 원점 = 메인 프레임과 만나는 앞쪽 마운트 중앙 */
const SUB_BASE: Vec3 = [-150, 700, 0]
// TODO: 실물 확인 — 서브프레임 노드 좌표는 사진 기준 추정
const SUB_NODES: Vec3[] = [
  [-150, 700, 150],
  [-150, 700, -150], // 0,1 앞쪽 마운트
  [-820, 760, 120],
  [-820, 760, -120], // 2,3 시트 레일 뒤끝
  [-420, 560, 150],
  [-420, 560, -150], // 4,5 아래쪽 마운트
  [-780, 640, 110],
  [-780, 640, -110], // 6,7 받침 스테이 뒤끝
]
const SUB_EDGES: Array<[number, number]> = [
  [0, 2], [1, 3], [4, 6], [5, 7], [2, 3], [6, 7], [2, 6], [3, 7],
]
add({
  id: 'subframe',
  ko: '서브프레임',
  en: 'Subframe',
  geometry: trellis(relative(SUB_NODES, SUB_BASE), SUB_EDGES, 11),
  mount: SUB_BASE,
  material: 'frame_paint',
  rest: REST.main,
})

// --- B. 엔진 작업대 (Task B3) --------------------------------------------------
// --- C~F. 서스펜션·프런트엔드·바퀴 (Task B4) ---------------------------------
// --- G~K. 냉각·전장·흡기·배기·조작계 (Task B5) --------------------------------
// --- L~M. 외장·도색 (Task B6) --------------------------------------------------

// 빌드 ---------------------------------------------------------------------
function build(): PartDef[] {
  return defs.map((d, i) => {
    const prev = i > 0 ? defs[i - 1].id : null
    const requires = d.requires ?? (prev && !d.preplaced ? [prev] : [])
    const group = d.station ?? 'main'
    const rest = d.rest ?? (d.small ? REST.small : REST[group])
    const cameraView: CameraView = { ...VIEW[group], ...d.camera }
    const rot: Vec3 = d.rot ?? [0, 0, 0]
    const instances: PartInstance[] = d.instances
      ? d.instances.map((inst, k, arr) => ({
          id: `${d.id}:${inst.suffix}`,
          mountPosition: inst.mount,
          mountRotation: inst.rot ?? rot,
          geometry: inst.geometry ?? d.geometry,
          tag: inst.tag ?? inst.suffix,
          order: arr.length > 1 ? k / (arr.length - 1) : 0,
        }))
      : [{ id: d.id, mountPosition: d.mount, mountRotation: rot, geometry: d.geometry, order: 0 }]
    return {
      id: d.id,
      nameKo: d.ko,
      nameEn: d.en,
      geometry: d.geometry,
      material: d.material,
      restPosition: rest,
      mountPosition: d.mount,
      mountRotation: rot,
      requires,
      count: instances.length,
      instances,
      station: d.station,
      marries: d.marries,
      preplaced: d.preplaced,
      paintable: d.paintable,
      variants: d.variants,
      hidden: d.hidden,
      cameraView,
      hint: d.hint ?? `${d.ko} 장착`,
    }
  })
}

/** 조립 순서 = 배열 순서 */
export const PARTS: PartDef[] = build()
export const PART_BY_ID: Record<string, PartDef> = Object.fromEntries(PARTS.map((p) => [p.id, p]))
