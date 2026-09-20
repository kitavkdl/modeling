import { describe, expect, it } from 'vitest'
import { bankMix, type Loop } from './bankMix'

/** 실제 뱅크(public/audio/ninja400/engine/bank.json)와 같은 rpm 사다리 */
const BANK: Loop[] = [1330, 2250, 2790, 3760, 4100, 4620, 5460, 6460].map((rpm) => ({
  rpm,
  file: `${rpm}.ogg`,
}))

describe('bankMix 경계', () => {
  it('빈 뱅크는 0/0/0', () => {
    expect(bankMix(3000, [])).toEqual({ lower: 0, upper: 0, t: 0 })
  })

  it('최저 루프 이하는 최저 하나만 (t=0)', () => {
    expect(bankMix(1330, BANK)).toEqual({ lower: 0, upper: 0, t: 0 })
    expect(bankMix(800, BANK)).toEqual({ lower: 0, upper: 0, t: 0 })
    expect(bankMix(0, BANK)).toEqual({ lower: 0, upper: 0, t: 0 })
    expect(bankMix(-500, BANK)).toEqual({ lower: 0, upper: 0, t: 0 })
  })

  it('최고 루프 이상은 최고 하나만 (t=0, 피치업은 런타임이 한다)', () => {
    const last = BANK.length - 1
    expect(bankMix(6460, BANK)).toEqual({ lower: last, upper: last, t: 0 })
    expect(bankMix(12000, BANK)).toEqual({ lower: last, upper: last, t: 0 })
  })

  it('rpm이 유한하지 않으면 최저 루프로 본다', () => {
    expect(bankMix(NaN, BANK)).toEqual({ lower: 0, upper: 0, t: 0 })
    expect(bankMix(Infinity, BANK)).toEqual({ lower: 0, upper: 0, t: 0 })
  })

  it('루프가 하나뿐이면 항상 그 하나', () => {
    const one: Loop[] = [{ rpm: 1330, file: '1320.ogg' }]
    expect(bankMix(500, one)).toEqual({ lower: 0, upper: 0, t: 0 })
    expect(bankMix(9000, one)).toEqual({ lower: 0, upper: 0, t: 0 })
  })
})

describe('bankMix 보간', () => {
  it('두 루프 사이 중간점은 t=0.5', () => {
    const mid = (1330 + 2250) / 2
    expect(bankMix(mid, BANK)).toEqual({ lower: 0, upper: 1, t: 0.5 })
  })

  it('이웃한 두 인덱스를 고르고 t는 그 구간의 선형 위치', () => {
    const m = bankMix(3000, BANK) // 2790 ~ 3760
    expect(m.lower).toBe(2)
    expect(m.upper).toBe(3)
    expect(m.t).toBeCloseTo((3000 - 2790) / (3760 - 2790), 10)
  })

  it('루프 rpm에 정확히 걸리면 그 루프에서 t=0', () => {
    expect(bankMix(4100, BANK)).toEqual({ lower: 4, upper: 5, t: 0 })
  })

  it('단조 증가 rpm 스윕에서 t가 끊기지 않는다 (10 rpm 걸음에 0.2 초과 점프 없음)', () => {
    let prev = bankMix(1000, BANK)
    for (let rpm = 1010; rpm <= 12000; rpm += 10) {
      const m = bankMix(rpm, BANK)
      // 같은 구간 안이면 t는 조금만 움직이고, 구간을 넘어가면 1에서 0으로 넘어간다
      const jump = m.lower === prev.lower ? Math.abs(m.t - prev.t) : Math.abs(1 - prev.t) + m.t
      expect(jump).toBeLessThanOrEqual(0.2)
      // 인덱스는 한 칸씩만 올라간다
      expect(m.lower - prev.lower).toBeLessThanOrEqual(1)
      expect(m.lower).toBeGreaterThanOrEqual(prev.lower)
      prev = m
    }
  })

  it('t는 항상 0~1 안에 있고 upper는 lower보다 작지 않다', () => {
    for (let rpm = -1000; rpm <= 13000; rpm += 37) {
      const m = bankMix(rpm, BANK)
      expect(m.t).toBeGreaterThanOrEqual(0)
      expect(m.t).toBeLessThanOrEqual(1)
      expect(m.upper).toBeGreaterThanOrEqual(m.lower)
    }
  })
})
