import * as THREE from 'three'
import type { Phase } from '../store/assembly'
import { RGB_COLOR, RGB_WAVE_COLOR } from './materials'

export const BOOT_WAVE_MS = 800
export const STILL_MS = 300
export const BREATH_PERIOD_MS = 3200

export interface Glow {
  /** 0~1 정상 점등 밝기 */
  level: number
  /** 0~1 웨이브 피크(흰색 섞임) */
  peak: number
}

/**
 * 키 하나의 발광량. order는 좌하단 0 → 우상단 1.
 * booting: 웨이브 전선이 order를 지나는 순간 피크, 지나간 뒤에는 정상 밝기.
 * on: 호흡. 부팅이 끝난 순간(밝기 1)에서 이어지도록 cos를 쓴다.
 */
export function keyGlow(order: number, phase: Phase, phaseAt: number, nowMs: number): Glow {
  if (phase === 'booting') {
    const t = (nowMs - phaseAt) / BOOT_WAVE_MS
    const front = t * 1.15 - 0.05
    const d = front - order
    const level = d <= 0 ? 0 : Math.min(1, d * 6)
    const peak = Math.exp(-(d * d) * 220)
    return { level, peak }
  }
  if (phase === 'on') {
    const t = (nowMs - phaseAt) / BREATH_PERIOD_MS
    return { level: 0.72 + 0.28 * Math.cos(t * Math.PI * 2), peak: 0 }
  }
  return { level: 0, peak: 0 }
}

const tmp = new THREE.Color()

export function applyGlow(mat: THREE.MeshStandardMaterial, g: Glow) {
  tmp.copy(RGB_COLOR).lerp(RGB_WAVE_COLOR, g.peak)
  mat.emissive.copy(tmp)
  mat.emissiveIntensity = g.level * 2.6 + g.peak * 4
}

export function makeGlowMaterial() {
  return new THREE.MeshStandardMaterial({
    color: '#0c0c0d',
    emissive: RGB_COLOR,
    emissiveIntensity: 0,
    metalness: 0,
    roughness: 0.9,
  })
}
