import { describe, expect, it } from 'vitest'
import { LEAN_MAX, turnRate } from '../finale/rideModel'
import { HEADING_MAX, advanceHeading } from './RoadTiles'

/** dt초를 step초씩 나눠 계속 굴린다 */
function run(heading: number, lean: number, speed: number, secs: number, step = 1 / 60): number {
  let h = heading
  for (let t = 0; t < secs; t += step) h = advanceHeading(h, lean, speed, step)
  return h
}

describe('advanceHeading', () => {
  it('최대 기울기를 붙잡고 있으면 상한에 닿고 거기서 멈춘다', () => {
    // 20 m/s에서 38° 뱅크의 요 레이트는 0.38 rad/s — 한계 없이 적분하면 4초에 이미 87°다
    expect(turnRate(LEAN_MAX, 20) * 4).toBeGreaterThan(HEADING_MAX)
    const h = run(0, LEAN_MAX, 20, 10)
    expect(h).toBeCloseTo(HEADING_MAX, 12)
    // 더 굴려도 자라지 않는다
    expect(run(h, LEAN_MAX, 20, 10)).toBeCloseTo(HEADING_MAX, 12)
  })

  it('세우면 0으로 풀린다 — 0.8초에 1/e', () => {
    expect(advanceHeading(HEADING_MAX, 0, 20, 0.8)).toBeCloseTo(HEADING_MAX * Math.exp(-1), 12)
    expect(Math.abs(run(HEADING_MAX, 0, 20, 5))).toBeLessThan(HEADING_MAX * 0.01)
    // 반대쪽도 대칭이다
    expect(Math.abs(run(-HEADING_MAX, 0, 20, 5))).toBeLessThan(HEADING_MAX * 0.01)
  })

  it('서 있으면 기울기가 남아 있어도 푼다', () => {
    expect(Math.abs(run(HEADING_MAX, LEAN_MAX, 0.5, 5))).toBeLessThan(HEADING_MAX * 0.01)
  })

  it('어떤 입력에도 ±상한을 넘지 않고, 앞으로 흐르는 성분이 음수가 되지 않는다', () => {
    let h = 0
    for (let i = 0; i < 5000; i++) {
      const lean = (i % 7 < 4 ? 1 : -1) * LEAN_MAX * (1 + (i % 3))   // 캡을 넘긴 값까지 던진다
      const speed = i % 11 === 0 ? 0 : 1 + (i % 60)
      h = advanceHeading(h, lean, speed, i % 13 === 0 ? 0.1 : 1 / 60)
      expect(Math.abs(h)).toBeLessThanOrEqual(HEADING_MAX + 1e-12)
      expect(Math.cos(h)).toBeGreaterThan(0)
    }
  })

  it('망가진 입력은 조용히 받아 넘긴다', () => {
    expect(advanceHeading(Number.NaN, 0.1, 20, 1 / 60)).toBe(0)
    expect(advanceHeading(0.3, Number.NaN, 20, 1 / 60)).toBeLessThan(0.3)
    expect(advanceHeading(0.3, 0.5, 20, 0)).toBe(0.3)
    expect(advanceHeading(0.3, 0.5, 20, Number.NaN)).toBe(0.3)
  })
})
