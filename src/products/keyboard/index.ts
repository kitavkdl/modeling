// Task 4 시점의 최소본 — Finale은 Task 7에서 채운다.
import type { ProductDef } from '../../engine/types'
import { KEYBOARD_MATERIALS } from './materials'
import { PARTS, STATIONS } from './parts'

export const keyboardProduct: ProductDef = {
  id: 'keyboard',
  nameKo: '조약돌75',
  nameEn: 'SPM Pebble 75',
  subtitle: '75% 알루미늄 핫스왑',
  parts: PARTS,
  stations: STATIONS,
  materials: KEYBOARD_MATERIALS,
  camera: {
    initial: { azimuth: 20, polar: 58, distance: 600 },
    target: [0, 15, 0],
    minDistanceMm: 300,
    maxDistanceMm: 900,
    minPolarDeg: 20,
    maxPolarDeg: 80,
  },
  drag: { snapMm: 60, paintMm: 12, hoverMm: 30, grabMinMm: 50 },
  environment: { contactShadowSizeMm: [600, 450], shadowBoundsMm: 300 },
  Finale: () => null,
  hints: { complete: '케이블 연결', on: '키캡 타건' },
  phasesAfterComplete: ['plugging', 'still', 'booting', 'on'],
}
