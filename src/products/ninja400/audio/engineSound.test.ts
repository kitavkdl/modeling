import { describe, expect, it } from 'vitest'
import { IDLE_RPM, MAX_RPM } from '../finale/rideModel'
import { firingTimes, pulseFor, resonanceFor } from './engineSound'

describe('engine firing schedule', () => {
  it('fires twice per 720-degree cycle at 0 and 180 degrees', () => {
    const P = 120 / 3000 // 3000rpm → 0.04s per cycle
    const t = firingTimes(3000, 0, P * 2)
    expect(t.length).toBe(4)
    expect(t[1] - t[0]).toBeCloseTo(P / 4, 6)
    expect(t[2] - t[1]).toBeCloseTo((3 * P) / 4, 6)
  })
})

describe('engine sound v2 parameters', () => {
  it('공명 주파수는 95/190/285Hz에서 스로틀 1일 때 15% 오르고 저역통과는 1.2k→2.6k', () => {
    expect(resonanceFor(0).freqs.map(Math.round)).toEqual([95, 190, 285])
    expect(resonanceFor(1).freqs.map(Math.round)).toEqual([109, 219, 328])
    expect(resonanceFor(0).lowpassHz).toBe(1200)
    expect(resonanceFor(1).lowpassHz).toBe(2600)
  })
  it('펄스 감쇠는 rpm이 오를수록 짧아지고(20ms→8ms) 부하가 걸리면 세진다', () => {
    expect(pulseFor(IDLE_RPM, 0).decayS).toBeCloseTo(0.02, 3)
    expect(pulseFor(MAX_RPM, 0).decayS).toBeCloseTo(0.008, 3)
    expect(pulseFor(3000, 1).gain).toBeCloseTo(pulseFor(3000, 0).gain * 1.3, 5)
  })
})
