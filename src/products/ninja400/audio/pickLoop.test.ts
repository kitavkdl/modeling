import { describe, expect, it } from 'vitest'
import { pickLoop, SWITCH_HYSTERESIS, type Loop } from './pickLoop'

/** 실제 뱅크(public/audio/ninja400/engine/bank.json)와 같은 rpm 사다리 — 실측값이라 소수가 붙는다 */
const BANK: Loop[] = [1325.5, 2248.4, 2745.8, 3730.2, 4096.8, 4594.8, 5514.5, 6510.3].map((rpm, i) => ({
  rpm,
  file: `${i}.ogg`,
}))

/** 칸 i와 i+1 사이 경계 — 기하 중점 */
const edge = (i: number) => Math.sqrt(BANK[i].rpm * BANK[i + 1].rpm)

describe('pickLoop 경계', () => {
  it('빈 뱅크는 언제나 0', () => {
    expect(pickLoop(3000, [], -1)).toBe(0)
    expect(pickLoop(3000, [], 2)).toBe(0)
  })

  it('루프가 하나뿐이면 항상 그 하나', () => {
    const one: Loop[] = [{ rpm: 1325.5, file: '0.ogg' }]
    expect(pickLoop(500, one, -1)).toBe(0)
    expect(pickLoop(9000, one, 0)).toBe(0)
  })

  it('물고 있는 것이 없으면 로그 거리로 가장 가까운 칸', () => {
    expect(pickLoop(1325.5, BANK, -1)).toBe(0)
    expect(pickLoop(500, BANK, -1)).toBe(0)
    expect(pickLoop(99999, BANK, -1)).toBe(BANK.length - 1)
    expect(pickLoop(edge(3) * 0.999, BANK, -1)).toBe(3)
    expect(pickLoop(edge(3) * 1.001, BANK, -1)).toBe(4)
  })

  it('rpm이 유한하지 않거나 0 이하면 물고 있던 칸 그대로, 없으면 0', () => {
    expect(pickLoop(NaN, BANK, 5)).toBe(5)
    expect(pickLoop(Infinity, BANK, 5)).toBe(5)
    expect(pickLoop(0, BANK, 5)).toBe(5)
    expect(pickLoop(-1, BANK, 5)).toBe(5)
    expect(pickLoop(NaN, BANK, -1)).toBe(0)
    expect(pickLoop(NaN, BANK, 99)).toBe(0)
    expect(pickLoop(NaN, BANK, 1.5)).toBe(0)
  })
})

describe('pickLoop 히스테리시스', () => {
  it('올라갈 때는 경계를 +3% 넘어선 뒤에 바뀐다', () => {
    for (let i = 0; i < BANK.length - 1; i++) {
      const e = edge(i)
      expect(pickLoop(e * 1.0, BANK, i)).toBe(i)
      expect(pickLoop(e * (1 + SWITCH_HYSTERESIS) * 0.999, BANK, i)).toBe(i)
      expect(pickLoop(e * (1 + SWITCH_HYSTERESIS) * 1.001, BANK, i)).toBe(i + 1)
    }
  })

  it('내려올 때는 경계를 −3% 밑돈 뒤에 바뀐다', () => {
    for (let i = 0; i < BANK.length - 1; i++) {
      const e = edge(i)
      expect(pickLoop(e * 1.0, BANK, i + 1)).toBe(i + 1)
      expect(pickLoop(e * (1 - SWITCH_HYSTERESIS) * 1.001, BANK, i + 1)).toBe(i + 1)
      expect(pickLoop(e * (1 - SWITCH_HYSTERESIS) * 0.999, BANK, i)).toBe(i)
      expect(pickLoop(e * (1 - SWITCH_HYSTERESIS) * 0.999, BANK, i + 1)).toBe(i)
    }
  })

  it('경계 ±2%를 오가며 맴돌아도 칸이 바뀌지 않는다', () => {
    for (let i = 0; i < BANK.length - 1; i++) {
      const e = edge(i)
      for (const side of [i, i + 1]) {
        let held = side
        for (let k = 0; k < 40; k++) {
          const rpm = e * (1 + 0.02 * Math.sin(k))
          held = pickLoop(rpm, BANK, held)
          expect(held).toBe(side)
        }
      }
    }
  })

  it('단조 상승 스윕에서 한 칸씩만, 경계+3%에서 올라간다', () => {
    let held = pickLoop(900, BANK, -1)
    expect(held).toBe(0)
    const switches: number[] = []
    for (let rpm = 900; rpm <= 12000; rpm += 1) {
      const next = pickLoop(rpm, BANK, held)
      if (next !== held) {
        expect(next).toBe(held + 1)
        switches.push(rpm)
        held = next
      }
    }
    expect(held).toBe(BANK.length - 1)
    expect(switches).toHaveLength(BANK.length - 1)
    switches.forEach((rpm, i) => expect(rpm).toBeCloseTo(edge(i) * (1 + SWITCH_HYSTERESIS), -1))
  })

  it('단조 하강 스윕에서 한 칸씩만, 경계−3%에서 내려간다', () => {
    let held = pickLoop(12000, BANK, -1)
    expect(held).toBe(BANK.length - 1)
    const switches: number[] = []
    for (let rpm = 12000; rpm >= 900; rpm -= 1) {
      const next = pickLoop(rpm, BANK, held)
      if (next !== held) {
        expect(next).toBe(held - 1)
        switches.push(rpm)
        held = next
      }
    }
    expect(held).toBe(0)
    expect(switches).toHaveLength(BANK.length - 1)
    switches.forEach((rpm, i) =>
      expect(rpm).toBeCloseTo(edge(BANK.length - 2 - i) * (1 - SWITCH_HYSTERESIS), -1),
    )
  })

  it('급가속으로 여러 칸을 건너뛰면 한 번에 옮겨 간다', () => {
    expect(pickLoop(6495.1, BANK, 0)).toBe(BANK.length - 1)
    expect(pickLoop(1325.5, BANK, BANK.length - 1)).toBe(0)
  })

  it('뱅크 바깥(최저 아래·최고 위)에서는 끝 칸에 머문다 — 피치업은 런타임이 한다', () => {
    expect(pickLoop(800, BANK, 0)).toBe(0)
    expect(pickLoop(12000, BANK, BANK.length - 1)).toBe(BANK.length - 1)
  })
})
