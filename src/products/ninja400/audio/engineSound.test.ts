import { describe, expect, it } from 'vitest'
import { firingTimes, rpmFor } from './engineSound'

describe('engine firing schedule', () => {
  it('maps throttle to rpm', () => {
    expect(rpmFor(0)).toBe(1300)
    expect(rpmFor(1)).toBe(10000)
  })
  it('fires twice per 720-degree cycle at 0 and 180 degrees', () => {
    const P = 120 / 3000 // 3000rpm → 0.04s per cycle
    const t = firingTimes(3000, 0, P * 2)
    expect(t.length).toBe(4)
    expect(t[1] - t[0]).toBeCloseTo(P / 4, 6)
    expect(t[2] - t[1]).toBeCloseTo((3 * P) / 4, 6)
  })
})
