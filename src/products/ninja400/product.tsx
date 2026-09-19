// 닌자 400 제품 정의.
import type { ProductDef } from '../../engine/types'
import { NinjaFinale } from './finale/Finale'
import { NINJA_MATERIALS } from './materials'
import { PARTS, PROPS, STATIONS } from './parts'
import { EngineShake } from './render/EngineShake'
import { Lamps } from './render/Lamps'
import { Paintable } from './render/Paintable'

/** 켜지는 부품 */
const LAMP_IDS = new Set(['headlight', 'taillight', 'instrument_cluster'])

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
  renderInstance: (ctx) => {
    if (ctx.part.paintable) return <Paintable {...ctx} />
    if (LAMP_IDS.has(ctx.part.id)) return <Lamps {...ctx} />
    if (ctx.part.station === 'engine') return <EngineShake {...ctx} />
    return null
  },
  hints: { complete: '키 삽입', keyed: '시동', running: '스로틀 개방' },
  phasesAfterComplete: ['keyed', 'running'],
}
