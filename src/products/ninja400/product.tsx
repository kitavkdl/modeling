// 닌자 400 제품 정의 — 골격 (Task B2). Finale은 B7에서 채운다.
import type { ProductDef } from '../../engine/types'
import { NINJA_MATERIALS } from './materials'
import { PARTS, PROPS, STATIONS } from './parts'
import { Paintable } from './render/Paintable'

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
    initial: { azimuth: 30, polar: 64, distance: 4200 },
    target: [0, 500, 0],
    minDistanceMm: 1200,
    maxDistanceMm: 7000,
    minPolarDeg: 20,
    maxPolarDeg: 85,
  },
  drag: { snapMm: 150, paintMm: 60, hoverMm: 150, grabMinMm: 200 },
  environment: { contactShadowSizeMm: [4200, 3200], shadowBoundsMm: 2400 },
  Finale: () => null,
  renderInstance: (ctx) => (ctx.part.paintable ? <Paintable {...ctx} /> : null),
  hints: { complete: '키 삽입', keyed: '시동', running: '스로틀' },
  phasesAfterComplete: ['keyed', 'running'],
}
