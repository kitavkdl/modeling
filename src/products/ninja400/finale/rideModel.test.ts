import { describe, expect, it } from 'vitest'
import { GEAR_RATIOS, IDLE_RPM, shiftDown, shiftUp, stepRide, type RideSim } from './rideModel'

const base = (o: Partial<RideSim> = {}): RideSim => ({ rpm: IDLE_RPM, throttle: 0, clutch: 0, brake: 0, gear: 0, wheelRpm: 0, stalled: false, running: true, lowRpmFor: 0, ...o })
const run = (s: RideSim, input: Parameters<typeof stepRide>[1], seconds: number) => { for (let t = 0; t < seconds; t += 1 / 60) s = stepRide(s, input, 1 / 60); return s }
const idle = { throttleKey: false, brakeKey: false, clutchKey: false, throttleMouse: 0 }

describe('shift pattern 1-N-2-3-4-5-6', () => {
  it('N에서 다운은 1단, 1단에서 업은 N, N에서 업은 2단', () => {
    expect(shiftDown(0)).toBe(1); expect(shiftUp(1)).toBe(0); expect(shiftUp(0)).toBe(2)
    expect(shiftUp(6)).toBe(6); expect(shiftDown(1)).toBe(1); expect(shiftDown(2)).toBe(0)
  })
})

describe('stepRide', () => {
  it('스로틀 키를 누르면 rpm이 올라가고 떼면 아이들로 돌아온다', () => {
    let s = run(base(), { ...idle, throttleKey: true }, 1)
    expect(s.rpm).toBeGreaterThan(8000)
    s = run(s, idle, 2)
    expect(s.rpm).toBeCloseTo(IDLE_RPM, -1)
  })
  it('N에서는 뒷바퀴가 돌지 않고, 2단에 클러치를 풀면 기어비대로 돈다', () => {
    const n = run(base(), { ...idle, throttleKey: true }, 1)
    expect(n.wheelRpm).toBe(0)
    let s = run(base({ gear: 2, clutch: 1 }), { ...idle, throttleKey: true, clutchKey: true }, 1)
    s = run(s, { ...idle, throttleKey: true }, 1) // 클러치 풀림
    const ratio = 3.087 * GEAR_RATIOS[2] * 3.071
    expect(s.wheelRpm).toBeCloseTo(s.rpm / ratio, -1)
  })
  it('브레이크를 잡으면 뒷바퀴가 멈춘다', () => {
    let s = run(base({ gear: 2 }), { ...idle, throttleKey: true }, 1)
    s = run(s, { ...idle, throttleKey: true, brakeKey: true }, 1)
    expect(s.wheelRpm).toBeLessThan(5)
  })
  it('기어가 들어간 채 클러치를 풀고 스로틀이 없으면 0.4초 뒤 시동이 꺼진다', () => {
    let s = base({ gear: 1, clutch: 1 })
    s = run(s, idle, 1)
    expect(s.stalled).toBe(true)
    expect(s.rpm).toBe(0)
  })
  it('클러치를 잡고 있으면 기어가 들어가도 꺼지지 않는다', () => {
    const s = run(base({ gear: 1, clutch: 1 }), { ...idle, clutchKey: true }, 2)
    expect(s.stalled).toBe(false)
  })
  it('running이 아니면 rpm은 0으로 내려간다', () => {
    const s = run(base({ running: false }), idle, 1)
    expect(s.rpm).toBe(0)
  })
})
