// 닌자 400 제품 정의.
import type { ProductDef } from '../../engine/types'
import { NinjaFinale } from './finale/Finale'
import { RideGauge } from './finale/RideGauge'
import { NINJA_MATERIALS } from './materials'
import { onlyKeyLeft } from './onlyKeyLeft'
import { PARTS, PROPS, STATIONS } from './parts'
import { EngineShake } from './render/EngineShake'
import { Lamps } from './render/Lamps'
import { Paintable } from './render/Paintable'
import { refineDone, RefineNote } from './render/Refine'
import { rideModelFailed, rideModelReady } from './render/RideModel'
import { RIDE_MODEL } from './render/rideLayout.generated'
import { LeverPivot, ShiftLever, Spinner } from './render/RideParts'

/** 켜지는 부품 */
const LAMP_IDS = new Set(['headlight', 'taillight', 'instrument_cluster'])
/** 속도에 맞춰 도는 부품 (앞바퀴는 반지름이 달라 Spinner가 부품 id로 rpm을 고른다) */
const SPIN_IDS = new Set(['front_wheel', 'rear_wheel', 'rear_sprocket'])

/** HUD 우하단: 스윕 문구(마무리 중)와 계기. 둘 다 자기 조건이 아니면 null을 낸다 */
function NinjaHud() {
  return (
    <>
      <RefineNote />
      <RideGauge />
    </>
  )
}

export const ninja400Product: ProductDef = {
  id: 'ninja400',
  nameKo: '닌자 400',
  nameEn: 'Kawasaki Ninja 400',
  subtitle: '2018 · EX400G · 399cc 병렬 2기통',
  parts: PARTS,
  stations: STATIONS,
  props: PROPS,
  materials: NINJA_MATERIALS,
  camera: {
    initial: { azimuth: 30, polar: 64, distance: 4800 },
    target: [0, 500, 0],
    minDistanceMm: 900, // 키 삽입 뷰(1000)가 잘리지 않도록 — 계기판 키 구멍이 보여야 한다
    maxDistanceMm: 7000,
    minPolarDeg: 20,
    maxPolarDeg: 85,
  },
  drag: { snapMm: 150, paintMm: 25, grabMinMm: 200 },
  environment: { contactShadowSizeMm: [4200, 3200], shadowBoundsMm: 2400 },
  Finale: NinjaFinale,
  hudExtra: NinjaHud,
  renderInstance: (ctx) => {
    if (ctx.part.paintable) return <Paintable {...ctx} />
    if (LAMP_IDS.has(ctx.part.id)) return <Lamps {...ctx} />
    if (ctx.part.id === 'lever') return <LeverPivot {...ctx} />
    if (SPIN_IDS.has(ctx.part.id)) return <Spinner {...ctx} />
    if (ctx.part.id === 'shift_lever') return <ShiftLever {...ctx} />
    if (ctx.part.station === 'engine') return <EngineShake {...ctx} />
    return null
  },
  hints: { keyed: '시동', running: '스로틀 개방' },
  phasesAfterComplete: ['keyed', 'running'],
  // 키 하나만 남는 순간부터 절차 조립체를 감춘다 — 그 자리에 실물 모델(RideModel)이 서고
  // 키는 실물 모델의 키 구멍에 꽂는다. 고스트와 드래그는 엔진이 그대로 살려 둔다.
  // 실물 모델이 아직 디코드되지 않았거나(rideModelReady) 못 띄웠으면(rideModelFailed) 숨기지 않는다 —
  // 빈 무대 대신 절차 조립체를 그대로 쓴다.
  // 스윕(전문가의 손길)이 끝나야 감춘다 — 도는 동안에는 두 차가 칼날을 경계로 반씩 보여야 한다.
  assemblyHidden: (s) =>
    rideModelReady() &&
    !rideModelFailed() &&
    (s.phase !== 'assembly' || (onlyKeyLeft(s.mounted, PARTS) && refineDone())),
  // 조립체를 감춘 뒤에도 키는 그린다 — 실물 모델의 키 구멍(IGNITION)에 꽂히는 것이 보여야 한다
  alwaysVisibleParts: ['ignition_key'],
  // running에서는 주행 타일(RoadTiles, y = +0.0005)이 바닥을 맡는다. 엔진 바닥(y = −0.002)을
  // 같이 그리면 0.0025 units 차이라 20 m 밖에서 깊이가 갈리지 않아 '네모칸'이 생긴다.
  floorHidden: (s) => s.phase === 'running',
  credits: [
    { text: '모델 Kawasaki ninja ZX-6R · valvetin · CC BY 4.0', href: RIDE_MODEL.source.url },
    { text: '엔진음 AlexanderChe, brucehep · freesound · CC0' },
  ],
}
