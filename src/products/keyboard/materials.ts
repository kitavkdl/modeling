import * as THREE from 'three'
import type { MaterialSpec } from '../../engine/types'

export const KEYBOARD_MATERIALS: Record<string, MaterialSpec> = {
  aluminum: { color: '#8a8d93', metalness: 0.9, roughness: 0.35 },
  foam: { color: '#5c5c5e', metalness: 0, roughness: 1 },
  pcb: { color: '#111214', metalness: 0.05, roughness: 0.85 },
  plastic: { color: '#2a2b2e', metalness: 0, roughness: 0.6 },
  keycap: { color: '#c9c6bf', metalness: 0, roughness: 0.75 },
  rubber: { color: '#3a3a3c', metalness: 0, roughness: 0.95 },
  glass: { color: '#1a1b1e', metalness: 0.6, roughness: 0.1 },
  cable: { color: '#1c1d20', metalness: 0.1, roughness: 0.7 },
  plug: { color: '#9a9da3', metalness: 0.9, roughness: 0.3 },
}

/** RGB 점등 색. 은은한 단색 */
export const RGB_COLOR = new THREE.Color('#ffd7a3')
/** 부팅 웨이브 피크 색 */
export const RGB_WAVE_COLOR = new THREE.Color('#ffffff')
