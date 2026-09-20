import { describe, expect, it } from 'vitest'
import { displaySpeed } from './RideGauge'

describe('계기 속도 표시', () => {
  it('정수로 반올림한다', () => {
    expect(displaySpeed(0, 0)).toBe(0)
    expect(displaySpeed(41.2, 0)).toBe(41)
    expect(displaySpeed(41.7, 0)).toBe(42)
  })

  it('0/1 깜빡임을 불감대가 막는다 — 0.5 경계를 오가도 숫자는 그대로다', () => {
    let shown = 0
    // 0.45 ↔ 0.55를 오가는 실제 저속 구간
    for (const v of [0.45, 0.55, 0.49, 0.52, 0.5, 0.58, 0.44]) {
      shown = displaySpeed(v, shown)
      expect(shown).toBe(0)
    }
    // 0.65를 넘겨야 1로 올라간다
    expect(displaySpeed(0.66, 0)).toBe(1)
    // 1에서는 0.35 아래로 내려가야 0이 된다
    expect(displaySpeed(0.5, 1)).toBe(1)
    expect(displaySpeed(0.4, 1)).toBe(1)
    expect(displaySpeed(0.3, 1)).toBe(0)
  })

  it('크게 움직이면 바로 따라간다 — 불감대가 지연이 되지 않도록', () => {
    expect(displaySpeed(60, 59)).toBe(60)
    expect(displaySpeed(120.4, 0)).toBe(120)
  })

  it('NaN이 들어오면 직전 값을 지킨다', () => {
    expect(displaySpeed(NaN, 37)).toBe(37)
  })
})
