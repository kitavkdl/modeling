// 닌자 400 재질표 — 이름은 parts.ts와 형상 함수가 참조하는 키다.

import * as THREE from 'three'
import type { MaterialSpec, Variant } from '../../engine/types'

export const NINJA_MATERIALS: Record<string, MaterialSpec> = {
  frame_paint: { color: '#141517', metalness: 0.4, roughness: 0.45 },
  // 스윙암은 뚜껑 없는 loft 껍데기라 안쪽 면도 그려야 구멍이 뚫려 보이지 않는다.
  cast_alu: { color: '#8b8f94', metalness: 0.7, roughness: 0.5, side: THREE.DoubleSide },
  polished_alu: { color: '#a8abb0', metalness: 0.9, roughness: 0.3 },
  steel: { color: '#a9adb3', metalness: 0.85, roughness: 0.4 },
  stainless: { color: '#c5c8cc', metalness: 0.9, roughness: 0.35 },
  rubber: { color: '#151617', metalness: 0, roughness: 0.95 },
  // 시트·펜더·카울은 뚜껑 없는 loft 껍데기라 안쪽 면도 그려야 구멍이 뚫려 보이지 않는다.
  plastic_black: { color: '#1e1f22', metalness: 0, roughness: 0.6, side: THREE.DoubleSide },
  primer: { color: '#7a7b7d', metalness: 0, roughness: 0.9, side: THREE.DoubleSide },
  glass: { color: '#1a1b1e', metalness: 0.6, roughness: 0.1, transparent: true, opacity: 0.35, side: THREE.DoubleSide },
  lamp_off: { color: '#3a3b3e', metalness: 0.1, roughness: 0.3 },
  lamp_on: { color: '#fff4dc', emissive: '#ffe9b8', emissiveIntensity: 2.5, metalness: 0, roughness: 0.4 },
  chain: { color: '#5c5e62', metalness: 0.8, roughness: 0.5 },
  bench: { color: '#2a2b2e', metalness: 0.2, roughness: 0.8 },
  // 라디에이터 코어 — 핀이 촘촘한 매트릭스라 거의 무광 검정으로 본다
  radiator_core: { color: '#26282b', metalness: 0.3, roughness: 0.85 },
  // 도색 3색도 primer와 같은 껍데기에 입혀지므로 양면이다.
  paint_krt: { physical: true, color: '#69be28', metalness: 0.6, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.1, side: THREE.DoubleSide },
  paint_blue: { physical: true, color: '#1d3f9e', metalness: 0.6, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.1, side: THREE.DoubleSide },
  paint_black: { physical: true, color: '#1a1b1e', metalness: 0.6, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.1, side: THREE.DoubleSide },
}

/** 외장 도색 선택지 */
export const PAINT_VARIANTS: Variant[] = [
  { id: 'krt', label: 'Lime Green / Ebony', swatch: '#69be28' },
  { id: 'blue', label: 'Candy Plasma Blue', swatch: '#1d3f9e' },
  { id: 'black', label: 'Metallic Spark Black', swatch: '#1a1b1e' },
]

/** 변형 id를 재질표 키로 바꾼다 */
export function paintMaterialName(id: string): string {
  return `paint_${id}`
}
