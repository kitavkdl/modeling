import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { MM } from '../../../engine/types'
import { LEAN_MAX } from './rideModel'
import { PITCH_FULL_ACCEL, PITCH_MAX, REAR_CONTACT_X_MM, applyRigPose, pitchFor } from './rideRig'

/** 리그에 물린 점 하나가 자세를 먹은 뒤 월드 어디에 있는가 */
function worldOf(lean: number, lurch: number, localMm: [number, number, number]): THREE.Vector3 {
  const g = new THREE.Group()
  applyRigPose(g, lean, lurch)
  g.updateMatrixWorld(true)
  return g.localToWorld(new THREE.Vector3(localMm[0] * MM, localMm[1] * MM, localMm[2] * MM))
}

describe('차체 자세 (리그)', () => {
  it('피치 부호: 가속이 +(노즈업) · 제동이 −(노즈다운)', () => {
    expect(pitchFor(0)).toBe(0)
    expect(pitchFor(PITCH_FULL_ACCEL / 2)).toBeCloseTo(PITCH_MAX / 2, 12)
    expect(pitchFor(-PITCH_FULL_ACCEL / 2)).toBeCloseTo(-PITCH_MAX / 2, 12)
  })

  it('피치는 ±1.5°를 넘지 않는다 — 어떤 가속도에도', () => {
    for (const a of [-1e6, -50, -8.6, 8.6, 50, 1e6]) {
      expect(Math.abs(pitchFor(a))).toBeLessThanOrEqual(PITCH_MAX + 1e-12)
    }
    expect(pitchFor(NaN)).toBe(0)
    expect(pitchFor(Infinity)).toBe(PITCH_MAX)
  })

  it('가속하면 앞(+x)이 올라가고 제동하면 내려간다', () => {
    // 앞바퀴 자리(+685 mm)를 본다
    const flat = worldOf(0, 0, [685, 0, 0])
    const accel = worldOf(0, PITCH_FULL_ACCEL, [685, 0, 0])
    const brake = worldOf(0, -PITCH_FULL_ACCEL, [685, 0, 0])
    expect(accel.y).toBeGreaterThan(flat.y)
    expect(brake.y).toBeLessThan(flat.y)
    // 1.5°에 축거 1,370 mm면 앞 끝이 ±36 mm쯤 오르내린다
    expect((accel.y - flat.y) / MM).toBeGreaterThan(20)
    expect((accel.y - flat.y) / MM).toBeLessThan(60)
  })

  it('피치 축은 뒷바퀴 접지점이다 — 그 점은 움직이지 않는다', () => {
    const pivot: [number, number, number] = [REAR_CONTACT_X_MM, 0, 0]
    for (const a of [-8, -2, 0, 2, 8]) {
      const p = worldOf(0, a, pivot)
      expect(p.x).toBeCloseTo(REAR_CONTACT_X_MM * MM, 10)
      expect(p.y).toBeCloseTo(0, 10)
      expect(p.z).toBeCloseTo(0, 10)
    }
  })

  it('기울기는 접지선(x축)을 축으로 돈다 — 오른쪽(+)으로 누우면 차 위쪽이 +z로 간다', () => {
    const up = worldOf(0.3, 0, [0, 600, 0])
    expect(up.z).toBeGreaterThan(0)
    expect(up.y).toBeLessThan(600 * MM)
    const left = worldOf(-0.3, 0, [0, 600, 0])
    expect(left.z).toBeCloseTo(-up.z, 10)
    // 접지선 위의 점은 기울여도 제자리다
    for (const x of [-685, 0, 685]) {
      const on = worldOf(LEAN_MAX, 0, [x, 0, 0])
      expect(on.y).toBeCloseTo(0, 10)
      expect(on.z).toBeCloseTo(0, 10)
    }
  })

  it('기울기와 피치를 같이 걸어도 뒷바퀴 접지점은 그대로다', () => {
    const p = worldOf(LEAN_MAX, -PITCH_FULL_ACCEL, [REAR_CONTACT_X_MM, 0, 0])
    expect(p.x).toBeCloseTo(REAR_CONTACT_X_MM * MM, 10)
    expect(p.y).toBeCloseTo(0, 10)
    expect(p.z).toBeCloseTo(0, 10)
  })

  it('자세가 0이면 항등이다 — 주행을 벗어난 리그가 어긋나 있지 않도록', () => {
    const g = new THREE.Group()
    applyRigPose(g, 0, 0)
    expect(g.rotation.x).toBe(0)
    expect(g.rotation.z).toBe(0)
    expect(g.position.lengthSq()).toBeCloseTo(0, 20)
  })

  it('NaN이 들어와도 자세가 깨지지 않는다', () => {
    const g = new THREE.Group()
    applyRigPose(g, NaN, NaN)
    for (const v of [g.rotation.x, g.rotation.z, g.position.x, g.position.y, g.position.z]) {
      expect(Number.isFinite(v)).toBe(true)
    }
    expect(() => applyRigPose(null, 0.3, 3)).not.toThrow()
  })
})
