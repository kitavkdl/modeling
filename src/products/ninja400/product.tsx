// 닌자 400 제품 정의.
import type { ProductDef } from '../../engine/types'
import { NinjaFinale } from './finale/Finale'
import { RideGauge } from './finale/RideGauge'
import { NINJA_MATERIALS } from './materials'
import { PARTS, PROPS, STATIONS } from './parts'
import { EngineShake } from './render/EngineShake'
import { Lamps } from './render/Lamps'
import { Paintable } from './render/Paintable'
import { LeverPivot, ShiftLever, Spinner } from './render/RideParts'

/** 켜지는 부품 */
const LAMP_IDS = new Set(['headlight', 'taillight', 'instrument_cluster'])
/** 뒷바퀴와 함께 도는 부품 */
const SPIN_IDS = new Set(['rear_wheel', 'rear_sprocket'])

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
    minDistanceMm: 1200,
    maxDistanceMm: 7000,
    minPolarDeg: 20,
    maxPolarDeg: 85,
  },
  drag: { snapMm: 150, paintMm: 25, grabMinMm: 200 },
  environment: { contactShadowSizeMm: [4200, 3200], shadowBoundsMm: 2400 },
  Finale: NinjaFinale,
  hudExtra: RideGauge,
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
}
