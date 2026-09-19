// 닌자 400 부품 정의 — 조립 순서는 배열 순서다. 치수와 좌표는 전부 mm.
// 좌표계: x 앞뒤(+x 앞), y 상하(+y 위), z 좌우(+z 오른쪽). 지면이 y=0.
// 부품을 추가할 때는 아래 구분 주석 자리에 add({...})를 순서대로 끼워 넣는다.

import type { CameraView, Geometry, PartDef, PartInstance, ProductDef, StationDef, Vec3 } from '../../engine/types'
import {
  EXHAUST_COLLECTOR_PATH,
  brakeDisc,
  camCoverGeometry,
  coolingFan,
  cowl,
  crankWebGeometry,
  crankcaseGeometry,
  cylZ,
  cylinderBlockFinned,
  cylinderHeadGeometry,
  exhaustCollector,
  exhaustHeader,
  exhaustHeaderPath,
  forkLeg,
  frameTrellis,
  keyGeometry,
  mufflerGeometry,
  pistonGeometry,
  radiatorCore,
  radiatorHose,
  roundCover,
  spokedWheel,
  subframeRails,
  swingarmGeometry,
  tank,
  toothedDisc,
} from './geometry'
import { PAINT_VARIANTS } from './materials'
import {
  CRANK,
  FORK_LEN,
  FORK_ROT,
  FORK_SPACING,
  FRONT_AXLE,
  FRONT_TIRE_R,
  FRONT_TIRE_W,
  REAR_AXLE,
  REAR_TIRE_R,
  REAR_TIRE_W,
  RIM_R,
  TILT_ROT,
  forkPoint,
  tilt,
} from './spec'

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

/** 프레임 지그: 프레임 최하단 노드 두 곳을 받치는 기둥 2개.
 *  앞 기둥은 엔진 앞 하단 마운트(200, 300, ±130), 뒤 기둥은 스윙암 피벗(-420, 420, ±150) 아래다.
 *  기둥 윗면 = position.y + size.y 가 그 노드 높이와 정확히 같다.
 *  x는 배기 경로를 피해 노드에서 비켜 세운다. 노드 z폭(±130 / ±150)을 덮어야 해서 z는 줄일 수 없고,
 *  기둥 x폭 80이 노드 x를 여전히 품는 범위 안에서 옮겼다.
 *  앞 기둥 x 190..270 — 배기 집합부(x ≤ 180)보다 앞. 뒤 기둥 x -440..-360 — 머플러(x ≤ -450)보다 앞. */
export const PROPS: NonNullable<ProductDef['props']> = [
  { geometry: { type: 'box', size: [80, 300, 300] }, position: [230, 0, 0], material: 'bench' },
  { geometry: { type: 'box', size: [80, 420, 340] }, position: [-400, 0, 0], material: 'bench' },
]

// 대기 위치 · 카메라 기본값 -------------------------------------------------------
// 대기 높이는 지면 위다. 부품 원점이 형상 한가운데인 경우가 많아 y=0이면 바닥에 파묻힌다.
const REST: Record<string, Vec3> = {
  main: [-300, 200, -1000], // 차체 뒤쪽 (큰 부품)
  small: [0, 200, 1500], // 카메라 쪽 (볼트·밸브·지시등)
  engine: [420, 300, 1100], // 엔진 스탠드 옆
  front_wheel: [1585, 320, 1000], // 휠 원점이 액슬 중심이라 타이어 반지름(293)보다 높다
  rear_wheel: [-1585, 320, 1000], // 뒤 타이어 반지름은 306
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
  /** 이 부품이 다 장착되면 넘어갈 phase (마지막 부품에만 의미 있음) */
  phaseOnMount?: string
}

const defs: PartInput[] = []
const add = (d: PartInput) => {
  defs.push(d)
  return d.id
}

// --- A. 프레임 ---------------------------------------------------------------
/** 프레임 원점 = 지그 상판 높이. 프레임이 지면이 아니라 지그 위에 선다. */
const FRAME_BASE: Vec3 = [0, 300, 0]
// TODO: 실물 확인 — 트렐리스 튜브 경로는 사진 기준 추정. 좌표는 geometry.ts 안에 차체 절대값으로
// 적혀 있고 FRAME_BASE를 빼서 상대 좌표가 된다. 지그가 받치는 두 지점은 그대로다:
// 엔진 앞 하단 마운트 (200, 300, ±138), 스윙암 피벗 (-420, 400, ±100).
add({
  id: 'main_frame',
  ko: '메인 프레임',
  en: 'Main Frame',
  geometry: frameTrellis(FRAME_BASE),
  mount: FRAME_BASE,
  material: 'frame_paint',
  preplaced: true,
  hint: '프레임 확인',
})

/** 서브프레임 원점 = 메인 프레임과 만나는 앞쪽 마운트 중앙 */
const SUB_BASE: Vec3 = [-150, 700, 0]
add({
  id: 'subframe',
  ko: '서브프레임',
  en: 'Subframe',
  geometry: subframeRails(SUB_BASE),
  mount: SUB_BASE,
  material: 'frame_paint',
  rest: REST.main,
})

// --- B. 엔진 작업대 (Task B3) --------------------------------------------------
const E = 'engine'
const cx = CRANK[0], cy = CRANK[1]
add({ id: 'crankcase_lower', ko: '크랭크케이스 하부', en: 'Lower Crankcase', geometry: crankcaseGeometry('lower'), mount: [cx, cy - 150, 0], material: 'cast_alu', station: E, requires: ['subframe'] })
add({ id: 'crankshaft', ko: '크랭크축', en: 'Crankshaft', geometry: { type: 'composite', children: [
  { geometry: cylZ(22, 360) }, { geometry: cylZ(60, 40), position: [0, 0, -60] }, { geometry: cylZ(60, 40), position: [0, 0, 60] },
  // 180도 위상 트윈 — 좌우 웹의 크랭크핀이 반대쪽을 본다
  { geometry: crankWebGeometry(), position: [0, 0, -42], rotation: [0, 0, Math.PI / 2] },
  { geometry: crankWebGeometry(), position: [0, 0, 42], rotation: [0, 0, -Math.PI / 2] } ] },
  mount: [cx, cy, 0], material: 'steel', station: E, small: true })
add({ id: 'balancer', ko: '밸런서 샤프트', en: 'Balancer Shaft', geometry: cylZ(16, 340), mount: [cx + 110, cy + 20, 0], material: 'steel', station: E, small: true })
add({ id: 'input_shaft', ko: '변속기 입력축', en: 'Transmission Input Shaft', geometry: { type: 'composite', children: [{ geometry: cylZ(14, 330) }, { geometry: cylZ(34, 24), position: [0, 0, -100] }, { geometry: cylZ(40, 24), position: [0, 0, -40] }, { geometry: cylZ(30, 24), position: [0, 0, 30] }, { geometry: cylZ(36, 24), position: [0, 0, 100] }] }, mount: [cx - 120, cy - 10, 0], material: 'steel', station: E, small: true })
add({ id: 'output_shaft', ko: '변속기 출력축', en: 'Transmission Output Shaft', geometry: { type: 'composite', children: [{ geometry: cylZ(14, 360) }, { geometry: cylZ(38, 24), position: [0, 0, -100] }, { geometry: cylZ(32, 24), position: [0, 0, -40] }, { geometry: cylZ(42, 24), position: [0, 0, 30] }, { geometry: cylZ(36, 24), position: [0, 0, 100] }] }, mount: [cx - 190, cy - 60, 0], material: 'steel', station: E, small: true })
add({ id: 'shift_drum', ko: '시프트 드럼', en: 'Shift Drum', geometry: cylZ(20, 200), mount: [cx - 160, cy + 40, 0], material: 'steel', station: E, small: true })
add({ id: 'crankcase_upper', ko: '크랭크케이스 상부', en: 'Upper Crankcase', geometry: crankcaseGeometry('upper'), mount: [cx, cy, 0], material: 'cast_alu', station: E })
add({ id: 'conrod', ko: '커넥팅로드', en: 'Connecting Rod', geometry: { type: 'box', size: [22, 110, 14] }, mount: tilt(0, 26, 0), rot: TILT_ROT, material: 'steel', station: E, small: true,
  instances: [{ suffix: 'l', mount: tilt(0, 26, -42) }, { suffix: 'r', mount: tilt(0, 26, 42) }] })
add({ id: 'piston', ko: '피스톤', en: 'Piston', geometry: pistonGeometry(), mount: tilt(0, 136, 0), rot: TILT_ROT, material: 'polished_alu', station: E, small: true,
  instances: [{ suffix: 'l', mount: tilt(0, 136, -42) }, { suffix: 'r', mount: tilt(0, 136, 42) }] })
add({ id: 'cylinder_block', ko: '실린더 블록', en: 'Cylinder Block', geometry: cylinderBlockFinned(), mount: tilt(0, 120, 0), rot: TILT_ROT, material: 'cast_alu', station: E })
add({ id: 'cylinder_head', ko: '실린더 헤드', en: 'Cylinder Head', geometry: cylinderHeadGeometry(), mount: tilt(0, 250, 0), rot: TILT_ROT, material: 'cast_alu', station: E })
add({ id: 'valve', ko: '밸브', en: 'Valve', geometry: { type: 'composite', children: [{ geometry: { type: 'cylinder', radiusTop: 3, radiusBottom: 3, height: 70, segments: 8 } }, { geometry: { type: 'cylinder', radiusTop: 13, radiusBottom: 13, height: 3, segments: 16 } }] },
  mount: tilt(0, 270, 0), rot: TILT_ROT, material: 'stainless', station: E, small: true,
  instances: [-56, -28, 28, 56].flatMap((z) => [{ suffix: `in${z}`, mount: tilt(-15, 270, z) }, { suffix: `ex${z}`, mount: tilt(15, 270, z) }]) })
add({ id: 'camshaft', ko: '캠샤프트', en: 'Camshaft', geometry: { type: 'composite', children: [{ geometry: cylZ(11, 260) }, ...[-70, -14, 14, 70].map((z) => ({ geometry: cylZ(18, 12), position: [0, 0, z] as Vec3 }))] },
  mount: tilt(0, 330, 0), rot: TILT_ROT, material: 'steel', station: E, small: true,
  instances: [{ suffix: 'intake', mount: tilt(-28, 330, 0) }, { suffix: 'exhaust', mount: tilt(28, 330, 0) }] })
add({ id: 'cam_chain', ko: '캠체인', en: 'Cam Chain', geometry: { type: 'box', size: [14, 330, 6] }, mount: tilt(0, 0, 128), rot: TILT_ROT, material: 'chain', station: E, small: true })
add({ id: 'cam_tensioner', ko: '캠체인 텐셔너', en: 'Cam Chain Tensioner', geometry: { type: 'box', size: [30, 60, 40] }, mount: tilt(-60, 200, 128), rot: TILT_ROT, material: 'cast_alu', station: E, small: true })
add({ id: 'cam_cover', ko: '캠 커버', en: 'Cam Cover', geometry: camCoverGeometry(), mount: tilt(0, 340, 0), rot: TILT_ROT, material: 'cast_alu', station: E })
add({ id: 'spark_plug', ko: '점화플러그', en: 'Spark Plug', geometry: { type: 'composite', children: [{ geometry: { type: 'cylinder', radiusTop: 8, radiusBottom: 8, height: 40, segments: 10 } }, { geometry: { type: 'cylinder', radiusTop: 6, radiusBottom: 6, height: 30, segments: 10 }, position: [0, 40, 0], material: 'plastic_black' }] },
  mount: tilt(0, 390, 0), rot: TILT_ROT, material: 'stainless', station: E, small: true,
  instances: [{ suffix: 'l', mount: tilt(0, 390, -42) }, { suffix: 'r', mount: tilt(0, 390, 42) }] })
add({ id: 'clutch_pack', ko: '클러치 팩', en: 'Clutch Pack', geometry: cylZ(75, 60), mount: [cx - 120, cy - 10, 200], material: 'steel', station: E, small: true })
add({ id: 'clutch_cover', ko: '클러치 커버', en: 'Clutch Cover', geometry: roundCover(118, 54), mount: [cx - 120, cy - 10, 188], rot: [Math.PI / 2, 0, 0], material: 'polished_alu', station: E })
add({ id: 'generator_rotor', ko: '제너레이터 로터', en: 'Generator Rotor', geometry: cylZ(60, 40), mount: [cx, cy, -200], material: 'steel', station: E, small: true })
add({ id: 'generator_cover', ko: '제너레이터 커버', en: 'Generator Cover', geometry: roundCover(104, 48), mount: [cx, cy, -188], rot: [-Math.PI / 2, 0, 0], material: 'polished_alu', station: E })
add({ id: 'oil_pump', ko: '오일펌프', en: 'Oil Pump', geometry: { type: 'box', size: [60, 50, 50] }, mount: [cx + 60, cy - 130, 120], material: 'cast_alu', station: E, small: true })
add({ id: 'oil_pan', ko: '오일팬', en: 'Oil Pan', geometry: { type: 'box', size: [360, 50, 320] }, mount: [cx, cy - 200, 0], material: 'cast_alu', station: E })
add({ id: 'oil_filter', ko: '오일필터', en: 'Oil Filter', geometry: { type: 'composite', children: [{ geometry: { type: 'cylinder', radiusTop: 34, radiusBottom: 34, height: 80, segments: 20 }, rotation: [0, 0, -Math.PI / 2] }] }, mount: [cx + 210, cy - 90, 60], material: 'plastic_black', station: E, small: true })
add({ id: 'starter_motor', ko: '스타터 모터', en: 'Starter Motor', geometry: cylZ(30, 120), mount: [cx - 40, cy + 100, -70], material: 'plastic_black', station: E, small: true })
add({ id: 'water_pump', ko: '워터펌프', en: 'Water Pump', geometry: { type: 'composite', children: [{ geometry: cylZ(40, 40) }, { geometry: { type: 'box', size: [30, 30, 40] }, position: [0, 40, 0] }] }, mount: [cx + 40, cy - 60, -215], material: 'cast_alu', station: E, small: true })
add({ id: 'drive_sprocket', ko: '드라이브 스프로킷', en: 'Drive Sprocket', geometry: toothedDisc(40, 14, 8, 13, 6), mount: [cx - 190, cy - 60, -200], material: 'steel', station: E, small: true })
add({ id: 'engine_mount_bolt', ko: '엔진 마운트 볼트', en: 'Engine Mount Bolt', geometry: { type: 'composite', children: [{ geometry: cylZ(6, 60) }, { geometry: cylZ(11, 8), position: [0, 0, 30] }] },
  mount: [0, 0, 0], material: 'steel', marries: E, requires: ['drive_sprocket', 'subframe'], small: true, hint: '엔진 마운트 볼트 체결',
  camera: { azimuth: 30, polar: 62, distance: 3200, target: [-120, 480, 0] },
  instances: [ { suffix: 'fl', mount: [80, 560, -170] }, { suffix: 'fr', mount: [80, 560, 170] }, { suffix: 'rl', mount: [-420, 420, -180] }, { suffix: 'rr', mount: [-420, 420, 180] } ] })

// --- C~F. 서스펜션·프런트엔드·바퀴 (Task B4) ---------------------------------
const FW = 'front_wheel', RW = 'rear_wheel'
// 스윙암 원점 = 피벗. 리어 액슬(-685, 306)은 상대 좌표로 (-265, -94, 0)이다.
add({ id: 'swingarm', ko: '스윙암', en: 'Swingarm', geometry: swingarmGeometry([REAR_AXLE[0] + 420, REAR_AXLE[1] - 400, 0]),
  mount: [-420, 400, 0], material: 'cast_alu', requires: ['engine_mount_bolt'] })
add({ id: 'rear_shock', ko: '리어 쇼크', en: 'Rear Shock', geometry: { type: 'composite', children: [{ geometry: { type: 'cylinder', radiusTop: 22, radiusBottom: 22, height: 180, segments: 16 } }, { geometry: { type: 'cylinder', radiusTop: 8, radiusBottom: 8, height: 110, segments: 10 }, position: [0, 180, 0] }, ...[0, 1, 2, 3, 4, 5].map((i) => ({ geometry: { type: 'torus', radius: 34, tube: 5 } as Geometry, position: [0, 20 + i * 28, 0] as Vec3 }))] },
  mount: [-470, 380, 0], rot: [0, 0, 0.35], material: 'steel', small: true })
add({ id: 'shock_linkage', ko: '쇼크 링크', en: 'Shock Linkage', geometry: { type: 'composite', children: [{ geometry: { type: 'box', size: [120, 24, 20] }, position: [0, 0, -30] }, { geometry: { type: 'box', size: [120, 24, 20] }, position: [0, 0, 30] }, { geometry: { type: 'box', size: [60, 20, 80] }, position: [-60, 0, 0] }] }, mount: [-500, 330, 0], material: 'cast_alu', small: true })
const [stemX, stemY] = forkPoint(760)
add({ id: 'steering_stem', ko: '스티어링 스템 · 하부 트리플 클램프', en: 'Steering Stem / Lower Triple Clamp', geometry: { type: 'composite', children: [{ geometry: { type: 'box', size: [80, 40, 240] } }, { geometry: { type: 'cylinder', radiusTop: 16, radiusBottom: 16, height: 150, segments: 12 }, position: [0, 40, 0] }] },
  mount: [stemX, stemY, 0], rot: FORK_ROT, material: 'cast_alu', small: true, camera: { azimuth: 40, polar: 60, distance: 2600, target: [500, 700, 0] } })
add({ id: 'fork', ko: '프런트 포크', en: 'Front Fork', geometry: forkLeg(FORK_LEN, 20.5, 27, 300), mount: FRONT_AXLE, rot: FORK_ROT, material: 'polished_alu',
  instances: [{ suffix: 'l', mount: [FRONT_AXLE[0], FRONT_AXLE[1], -FORK_SPACING / 2] }, { suffix: 'r', mount: [FRONT_AXLE[0], FRONT_AXLE[1], FORK_SPACING / 2] }],
  camera: { azimuth: 40, polar: 60, distance: 2600, target: [560, 600, 0] } })
const [topX, topY] = forkPoint(880)
add({ id: 'top_clamp', ko: '상부 트리플 클램프', en: 'Upper Triple Clamp', geometry: { type: 'box', size: [70, 30, 260] }, mount: [topX, topY, 0], rot: FORK_ROT, material: 'cast_alu', small: true, camera: { azimuth: 40, polar: 55, distance: 2200, target: [430, 850, 0] } })
add({ id: 'clip_on', ko: '클립온 핸들', en: 'Clip-on Handlebar', geometry: { type: 'composite', children: [{ geometry: { type: 'cylinder', radiusTop: 11, radiusBottom: 11, height: 230, segments: 12 }, rotation: [Math.PI / 2, 0, 0], position: [0, 0, 0] }, { geometry: { type: 'cylinder', radiusTop: 16, radiusBottom: 16, height: 120, segments: 12 }, rotation: [Math.PI / 2, 0, 0], position: [0, 0, 110], material: 'rubber' }] },
  mount: [topX - 20, topY + 20, 0], material: 'polished_alu', small: true, camera: { azimuth: 20, polar: 50, distance: 2200, target: [430, 900, 0] },
  instances: [{ suffix: 'l', mount: [topX - 20, topY + 20, -110], rot: [0, Math.PI, 0] }, { suffix: 'r', mount: [topX - 20, topY + 20, 110], rot: [0, 0, 0] }] })
// (오른쪽 클립온의 원통은 +z로 뻗고 왼쪽은 y축 180도 회전으로 -z로 뻗는다. 그립은 원통 끝 110~230 구간.)
add({ id: 'front_wheel', ko: '앞 휠 · 타이어', en: 'Front Wheel', geometry: spokedWheel(FRONT_TIRE_R, FRONT_TIRE_W, RIM_R), mount: FRONT_AXLE, material: 'polished_alu', station: FW, requires: ['clip_on'] })
add({ id: 'front_disc', ko: '앞 브레이크 디스크', en: 'Front Brake Disc', geometry: brakeDisc(155, 5), mount: [FRONT_AXLE[0], FRONT_AXLE[1], -62], material: 'stainless', station: FW })
add({ id: 'front_axle', ko: '앞 액슬', en: 'Front Axle', geometry: { type: 'composite', children: [{ geometry: cylZ(9, 240) }, { geometry: cylZ(16, 10), position: [0, 0, 120] }] }, mount: FRONT_AXLE, material: 'steel', marries: FW, requires: ['front_disc', 'fork'], small: true, hint: '앞 액슬 체결', camera: { azimuth: 40, polar: 62, distance: 2400, target: [685, 400, 0] } })
add({ id: 'front_caliper', ko: '프런트 캘리퍼', en: 'Front Brake Caliper', geometry: { type: 'box', size: [90, 60, 40] }, mount: [FRONT_AXLE[0] + 40, FRONT_AXLE[1] + 120, -78], material: 'cast_alu', small: true })
add({ id: 'front_fender', ko: '프런트 펜더', en: 'Front Fender', geometry: { type: 'composite', children: [{ geometry: { type: 'frustum', bottom: [420, 130], top: [300, 120], h: 40 } }] }, mount: [FRONT_AXLE[0], FRONT_AXLE[1] + 300, 0], material: 'primer', paintable: true })
add({ id: 'rear_wheel', ko: '뒤 휠 · 타이어', en: 'Rear Wheel', geometry: spokedWheel(REAR_TIRE_R, REAR_TIRE_W, RIM_R), mount: REAR_AXLE, material: 'polished_alu', station: RW })
add({ id: 'rear_disc', ko: '리어 브레이크 디스크', en: 'Rear Brake Disc', geometry: brakeDisc(110, 5), mount: [REAR_AXLE[0], REAR_AXLE[1], 80], material: 'stainless', station: RW })
add({ id: 'rear_sprocket', ko: '리어 스프로킷', en: 'Rear Sprocket', geometry: toothedDisc(118, 41, 7, 24, 10), mount: [REAR_AXLE[0], REAR_AXLE[1], -200], material: 'steel', station: RW })
add({ id: 'rear_axle', ko: '뒤 액슬', en: 'Rear Axle', geometry: { type: 'composite', children: [{ geometry: cylZ(10, 420) }, { geometry: cylZ(17, 10), position: [0, 0, 210] }] }, mount: REAR_AXLE, material: 'steel', marries: RW, requires: ['rear_sprocket', 'swingarm'], small: true, hint: '뒤 액슬 체결', camera: { azimuth: -40, polar: 62, distance: 2400, target: [-685, 400, 0] } })
add({ id: 'rear_caliper', ko: '리어 캘리퍼', en: 'Rear Brake Caliper', geometry: { type: 'box', size: [70, 50, 36] }, mount: [REAR_AXLE[0] - 20, REAR_AXLE[1] + 80, 100], material: 'cast_alu', small: true })
add({ id: 'chain', ko: '체인', en: 'Drive Chain', geometry: { type: 'composite', children: [
  { geometry: { type: 'box', size: [372, 10, 8] }, position: [-184.6, 46.9, 0], rotation: [0, 0, -0.0373] }, { geometry: { type: 'box', size: [372, 10, 8] }, position: [-158.6, -105.5, 0], rotation: [0, 0, 0.3754] },
  { geometry: { type: 'torus', radius: 118, tube: 5 }, position: [-375, -64, -5], rotation: [Math.PI / 2, 0, 0] }, { geometry: { type: 'torus', radius: 40, tube: 5 }, position: [0, 0, -5], rotation: [Math.PI / 2, 0, 0] } ] },
  mount: [cx - 190, cy - 60, -200], material: 'chain', requires: ['rear_axle', 'drive_sprocket'], small: true, camera: { azimuth: -60, polar: 62, distance: 2600, target: [-400, 400, 0] } })

// --- G~K. 냉각·전장·흡기·배기·조작계 (Task B5) --------------------------------
// 라디에이터는 프레임 대각 브레이스([120,780,175]→[225,640,152]→[330,500,128])가 스치던 자리라
// 앞·아래로 옮기고 폭을 260(±130)으로 줄여 브레이스 안쪽으로 넣었다. parts.test.ts가 지킨다.
add({ id: 'radiator', ko: '라디에이터', en: 'Radiator', geometry: radiatorCore(280, 250, 34), mount: [240, 385, 0], material: 'cast_alu', requires: ['chain'], camera: { azimuth: 60, polar: 62, distance: 2600, target: [250, 500, 0] } })
add({ id: 'cooling_fan', ko: '냉각 팬', en: 'Cooling Fan', geometry: coolingFan(), mount: [204, 520, 20], rot: [0, Math.PI / 2, 0], material: 'plastic_black', small: true })
// 위 호스는 라디에이터 윗탱크 → 헤드 오른쪽, 아래 호스는 아랫탱크 → 워터펌프(왼쪽) 방향.
// 둘 다 크랭크케이스(x -330..90, y 280..550, |z|<=190)를 파고들지 않는 경로다.
const HOSE_UPPER: Vec3[] = [[248, 640, 66], [190, 676, 92], [120, 648, 95]]
const HOSE_LOWER: Vec3[] = [[248, 404, -66], [176, 364, -152], [86, 350, -234]]
add({ id: 'radiator_hose', ko: '라디에이터 호스', en: 'Radiator Hose', geometry: radiatorHose(HOSE_UPPER), mount: HOSE_UPPER[0], material: 'rubber', small: true,
  instances: [{ suffix: 'upper', mount: HOSE_UPPER[0], geometry: radiatorHose(HOSE_UPPER) }, { suffix: 'lower', mount: HOSE_LOWER[0], geometry: radiatorHose(HOSE_LOWER) }] })
add({ id: 'coolant_reservoir', ko: '리저브 탱크', en: 'Coolant Reservoir', geometry: { type: 'box', size: [90, 140, 60] }, mount: [-200, 260, 190], material: 'plastic_black', small: true })
add({ id: 'battery', ko: '배터리', en: 'Battery', geometry: { type: 'box', size: [140, 100, 90] }, mount: [-560, 620, 0], material: 'plastic_black', small: true, camera: { azimuth: -30, polar: 55, distance: 2600, target: [-500, 700, 0] } })
add({ id: 'ecu', ko: 'ECU', en: 'ECU', geometry: { type: 'box', size: [120, 30, 100] }, mount: [-650, 720, 0], material: 'plastic_black', small: true })
add({ id: 'instrument_cluster', ko: '계기판', en: 'Instrument Cluster', geometry: { type: 'composite', children: [
  { geometry: { type: 'box', size: [40, 90, 200] } },
  // 키 실린더: 계기판이 rot [0,0,-0.5]로 서 있어, 키 부품의 월드 마운트(540, 980, 60)에 겹치도록
  // 역회전한 로컬 좌표에 둔다.
  { geometry: { type: 'cylinder', radiusTop: 12, radiusBottom: 12, height: 20, segments: 16 }, position: [27, -8, 60], rotation: [0, 0, 0.5] } ] },
  mount: [520, 1000, 0], rot: [0, 0, -0.5], material: 'plastic_black', small: true, camera: { azimuth: 10, polar: 50, distance: 2200, target: [500, 950, 0] } })
add({ id: 'headlight', ko: '헤드라이트 유닛', en: 'Headlight Unit', geometry: { type: 'composite', children: [{ geometry: { type: 'box', size: [60, 120, 110] }, position: [0, 0, -95] }, { geometry: { type: 'box', size: [60, 120, 110] }, position: [0, 0, 95] }] }, mount: [720, 900, 0], rot: [0, 0, 0.2], material: 'lamp_off', small: true, camera: { azimuth: 0, polar: 60, distance: 2400, target: [700, 850, 0] } })
add({ id: 'taillight', ko: '테일라이트', en: 'Tail Light', geometry: { type: 'box', size: [40, 60, 160] }, mount: [-900, 780, 0], material: 'lamp_off', small: true, camera: { azimuth: 180, polar: 60, distance: 2400, target: [-800, 750, 0] } })
add({ id: 'turn_signal', ko: '방향지시등', en: 'Turn Signal', geometry: { type: 'composite', children: [{ geometry: { type: 'cylinder', radiusTop: 6, radiusBottom: 6, height: 60, segments: 8 }, rotation: [Math.PI / 2, 0, 0] }, { geometry: { type: 'box', size: [50, 30, 30] }, position: [0, 0, 70] }] }, mount: [0, 0, 0], material: 'lamp_off', small: true,
  instances: [{ suffix: 'fl', mount: [700, 820, -150], rot: [0, Math.PI, 0] }, { suffix: 'fr', mount: [700, 820, 150] }, { suffix: 'rl', mount: [-880, 700, -110], rot: [0, Math.PI, 0] }, { suffix: 'rr', mount: [-880, 700, 110] }] })
add({ id: 'airbox', ko: '에어박스', en: 'Airbox', geometry: { type: 'roundedBox', size: [260, 170, 300], radius: 20 }, mount: [-120, 730, 0], material: 'plastic_black', camera: { azimuth: 30, polar: 50, distance: 2800, target: [-100, 800, 0] } })
add({ id: 'throttle_body', ko: '스로틀 바디', en: 'Throttle Body', geometry: { type: 'composite', children: [{ geometry: cylZ(28, 200) }, { geometry: { type: 'box', size: [60, 40, 200] }, position: [0, 30, 0] }] }, mount: tilt(-70, 400, 0), rot: TILT_ROT, material: 'cast_alu', small: true })
add({ id: 'fuel_tank', ko: '연료탱크', en: 'Fuel Tank', geometry: tank(), mount: [40, 840, 0], material: 'primer', paintable: true, camera: { azimuth: 30, polar: 55, distance: 3000, target: [0, 900, 0] } })
// 좌우 헤더가 서로 다른 경로를 타서 인스턴스마다 geometry를 따로 준다. 경로는 월드 좌표라
// 회전은 필요 없다(rot [0,0,0]). 왼쪽 헤더가 엔진 밑에서 오른쪽으로 건너와 집합부에서 만난다.
add({ id: 'exhaust_header', ko: '배기 헤더', en: 'Exhaust Header', geometry: exhaustHeader(1),
  mount: exhaustHeaderPath(1)[0], material: 'stainless', small: true,
  instances: [
    { suffix: 'l', mount: exhaustHeaderPath(-1)[0], geometry: exhaustHeader(-1) },
    { suffix: 'r', mount: exhaustHeaderPath(1)[0], geometry: exhaustHeader(1) },
  ],
  camera: { azimuth: 70, polar: 65, distance: 2800, target: [100, 350, 0] } })
add({ id: 'exhaust_collector', ko: '배기 집합부', en: 'Exhaust Collector', geometry: exhaustCollector(), mount: EXHAUST_COLLECTOR_PATH[0], material: 'stainless' })
add({ id: 'muffler', ko: '머플러', en: 'Muffler', geometry: mufflerGeometry(), mount: [-450, 240, 190], rot: [0, 0, Math.PI / 2 - 0.18], material: 'stainless', camera: { azimuth: 90, polar: 62, distance: 2800, target: [-500, 350, 0] } })
add({ id: 'brake_pedal', ko: '브레이크 페달', en: 'Brake Pedal', geometry: { type: 'composite', children: [{ geometry: { type: 'box', size: [180, 14, 14] } }, { geometry: { type: 'box', size: [40, 14, 40] }, position: [90, 0, 20] }] }, mount: [-300, 330, 200], material: 'steel', small: true })
add({ id: 'shift_lever', ko: '시프트 레버', en: 'Shift Lever', geometry: { type: 'composite', children: [{ geometry: { type: 'box', size: [180, 14, 14] } }, { geometry: { type: 'box', size: [40, 14, 40] }, position: [90, 0, -20] }] }, mount: [-300, 330, -200], material: 'steel', small: true })
add({ id: 'rider_peg', ko: '라이더 스텝', en: 'Rider Footpeg', geometry: { type: 'composite', children: [{ geometry: { type: 'cylinder', radiusTop: 12, radiusBottom: 12, height: 90, segments: 10 }, rotation: [Math.PI / 2, 0, 0] }] }, mount: [0, 0, 0], material: 'steel', small: true,
  instances: [{ suffix: 'l', mount: [-330, 360, -180], rot: [0, Math.PI, 0] }, { suffix: 'r', mount: [-330, 360, 180] }] })
add({ id: 'passenger_peg', ko: '동승자 스텝', en: 'Passenger Footpeg', geometry: { type: 'composite', children: [{ geometry: { type: 'cylinder', radiusTop: 11, radiusBottom: 11, height: 80, segments: 10 }, rotation: [Math.PI / 2, 0, 0] }] }, mount: [0, 0, 0], material: 'steel', small: true,
  instances: [{ suffix: 'l', mount: [-620, 500, -170], rot: [0, Math.PI, 0] }, { suffix: 'r', mount: [-620, 500, 170] }] })
add({ id: 'sidestand', ko: '사이드스탠드', en: 'Sidestand', geometry: { type: 'composite', children: [{ geometry: { type: 'cylinder', radiusTop: 10, radiusBottom: 10, height: 300, segments: 10 }, rotation: [0.5, 0, 0.35] }] }, mount: [-380, 40, -200], material: 'steel', small: true })
add({ id: 'lever', ko: '브레이크 · 클러치 레버', en: 'Brake / Clutch Lever', geometry: { type: 'box', size: [150, 12, 16] }, mount: [0, 0, 0], material: 'polished_alu', small: true,
  instances: [{ suffix: 'clutch', mount: [topX + 40, topY + 30, -230] }, { suffix: 'brake', mount: [topX + 40, topY + 30, 230] }] })

// --- L~M. 외장·도색 (Task B6) --------------------------------------------------
add({ id: 'upper_cowl', ko: '어퍼 카울', en: 'Upper Cowl', geometry: cowl([260, 260, 520], 0.7), mount: [640, 760, 0], rot: [0, 0, 0.25], material: 'primer', paintable: true, requires: ['lever'], camera: { azimuth: 25, polar: 60, distance: 3200, target: [600, 850, 0] } })
add({ id: 'side_cowl', ko: '사이드 카울', en: 'Side Cowl', geometry: { type: 'box', size: [620, 380, 30] }, mount: [0, 0, 0], material: 'primer', paintable: true,
  instances: [{ suffix: 'l', mount: [40, 560, -265], rot: [0, 0, 0.15] }, { suffix: 'r', mount: [40, 560, 265], rot: [0, 0, 0.15] }] })
add({ id: 'lower_cowl', ko: '로어 카울', en: 'Lower Cowl', geometry: { type: 'box', size: [520, 220, 30] }, mount: [0, 0, 0], material: 'primer', paintable: true,
  instances: [{ suffix: 'l', mount: [0, 250, -270] }, { suffix: 'r', mount: [0, 250, 270] }] })
add({ id: 'windscreen', ko: '윈드스크린', en: 'Windscreen', geometry: { type: 'box', size: [12, 220, 300] }, mount: [560, 1000, 0], rot: [0, 0, 0.55], material: 'glass', small: true })
add({ id: 'tail_cowl', ko: '테일 카울', en: 'Tail Cowl', geometry: cowl([520, 160, 280], 0.6), mount: [-620, 760, 0], material: 'primer', paintable: true, camera: { azimuth: -150, polar: 60, distance: 3200, target: [-600, 800, 0] } })
add({ id: 'rear_hugger', ko: '리어 허거', en: 'Rear Hugger', geometry: { type: 'frustum', bottom: [360, 170], top: [300, 160], h: 30 }, mount: [-685, 640, 0], material: 'plastic_black', small: true })
add({ id: 'rider_seat', ko: '라이더 시트', en: 'Rider Seat', geometry: { type: 'roundedBox', size: [360, 60, 260], radius: 20 }, mount: [-330, 740, 0], material: 'plastic_black' })
add({ id: 'passenger_seat', ko: '동승자 시트', en: 'Passenger Seat', geometry: { type: 'roundedBox', size: [260, 50, 220], radius: 18 }, mount: [-680, 820, 0], material: 'plastic_black' })
add({ id: 'mirror', ko: '미러', en: 'Mirror', geometry: { type: 'composite', children: [{ geometry: { type: 'cylinder', radiusTop: 7, radiusBottom: 7, height: 140, segments: 8 }, rotation: [0.6, 0, 0] }, { geometry: { type: 'box', size: [30, 80, 130] }, position: [0, 120, 80] }] }, mount: [0, 0, 0], material: 'plastic_black', small: true,
  instances: [{ suffix: 'l', mount: [600, 1000, -200], rot: [0, Math.PI, 0] }, { suffix: 'r', mount: [600, 1000, 200] }] })
add({ id: 'paint', ko: '도색', en: 'Paint', geometry: { type: 'box', size: [10, 10, 10] }, mount: [0, 0, 0], material: 'primer', hidden: true, variants: PAINT_VARIANTS, hint: '도색', camera: { azimuth: 30, polar: 62, distance: 4000, target: [0, 600, 0] } })
// 도색까지 끝나면 마지막으로 키를 꽂는다 — 정규 부품 81번째. 다 장착되면 phase가 assembly에서 바로 keyed로 넘어간다.
add({ id: 'ignition_key', ko: '키', en: 'Ignition Key', geometry: keyGeometry(), mount: [540, 980, 60], rot: [0, 0, 0], material: 'steel',
  requires: ['paint'], small: true, hint: '키 삽입', phaseOnMount: 'keyed',
  camera: { azimuth: 20, polar: 55, distance: 900, target: [520, 950, 40] } })

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
      phaseOnMount: d.phaseOnMount,
    }
  })
}

/** 조립 순서 = 배열 순서 */
export const PARTS: PartDef[] = build()
export const PART_BY_ID: Record<string, PartDef> = Object.fromEntries(PARTS.map((p) => [p.id, p]))

/** 도색 순서: paintable 인스턴스를 x 내림차순(앞→뒤)으로. 0부터 */
export function paintRank(instanceId: string): number {
  const list = PARTS.filter((p) => p.paintable).flatMap((p) => p.instances).sort((a, b) => b.mountPosition[0] - a.mountPosition[0])
  return Math.max(0, list.findIndex((i) => i.id === instanceId))
}
