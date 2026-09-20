import { describe, expect, it } from 'vitest'
import {
  IDLE_RPM,
  MAX_RPM,
  REAR_TIRE_R_M,
  gearRatio,
  shiftDown,
  shiftUp,
  speedKmh,
  stepRide,
  wheelRpm,
  type RideInputs,
  type RideSim,
} from './rideModel'

const base = (o: Partial<RideSim> = {}): RideSim => ({
  rpm: IDLE_RPM,
  throttle: 0,
  clutch: 0,
  brake: 0,
  gear: 0,
  speed: 0,
  distance: 0,
  stalled: false,
  running: true,
  lowRpmFor: 0,
  ...o,
})

const run = (s: RideSim, input: RideInputs, seconds: number, dt = 1 / 120) => {
  for (let t = 0; t < seconds - 1e-9; t += dt) s = stepRide(s, input, dt)
  return s
}

const idle: RideInputs = { throttleKey: false, brakeKey: false, clutchKey: false, throttleMouse: 0 }
const wot: RideInputs = { ...idle, throttleKey: true }

/** 그 기어·그 차속에서 클러치가 직결이면 나와야 하는 엔진 회전 (rpm) */
const syncRpm = (gear: number, speed: number) => gearRatio(gear) * wheelRpm(speed)

/** 직결 정상 주행 상태를 계산으로 만들어 둔다 (60 km/h = 16.67 m/s) */
const cruising = (gear: number, speed: number) => base({ gear, speed, clutch: 0, rpm: syncRpm(gear, speed) })

describe('shift pattern 1-N-2-3-4-5-6', () => {
  it('N에서 다운은 1단, 1단에서 업은 N, N에서 업은 2단', () => {
    expect(shiftDown(0)).toBe(1)
    expect(shiftUp(1)).toBe(0)
    expect(shiftUp(0)).toBe(2)
    expect(shiftUp(6)).toBe(6)
    expect(shiftDown(1)).toBe(1)
    expect(shiftDown(2)).toBe(0)
  })
})

describe('구동계 물리 v2', () => {
  it('1. 중립·스로틀 0에서 2초 돌리면 아이들을 지킨다', () => {
    const s = run(base(), idle, 2)
    expect(s.rpm).toBeGreaterThan(IDLE_RPM - 60)
    expect(s.rpm).toBeLessThan(IDLE_RPM + 60)
    expect(s.speed).toBe(0)
  })

  it('2. 중립 전개는 0.6~1.5초에 리미터에 닿고 12,500을 넘지 않는다', () => {
    let s = base()
    let reached = 0
    let peak = 0
    for (let t = 0; t < 3; t += 1 / 120) {
      s = stepRide(s, wot, 1 / 120)
      peak = Math.max(peak, s.rpm)
      if (!reached && s.rpm >= MAX_RPM) reached = t + 1 / 120
    }
    expect(reached).toBeGreaterThan(0.6)
    expect(reached).toBeLessThan(1.5)
    expect(peak).toBeLessThan(12500)
    expect(s.speed).toBe(0)
  })

  it('3. 1단·클러치 놓음·스로틀 0·정지면 1초 안에 시동이 꺼진다', () => {
    const s = run(base({ gear: 1 }), idle, 1)
    expect(s.stalled).toBe(true)
    expect(s.rpm).toBe(0)
  })

  it('4. 1단 전개로 클러치를 놓으면 출발한다', () => {
    let s = run(base({ gear: 1, clutch: 1 }), { ...wot, clutchKey: true }, 0.8)
    s = run(s, wot, 3)
    expect(s.stalled).toBe(false)
    expect(s.speed).toBeGreaterThan(5)
    expect(s.distance).toBeGreaterThan(0)
  })

  it('5. 감속 변속(4→3)은 클러치를 놓는 순간 rpm을 끌어올린다', () => {
    const before = cruising(4, 16.67)
    let s = run(before, { ...idle, clutchKey: true }, 0.6)
    s = { ...s, gear: 3 }
    s = run(s, idle, 0.5)
    expect(s.rpm).toBeGreaterThan(before.rpm)
    expect(s.rpm).toBeCloseTo(syncRpm(3, s.speed), -2)
    expect(Math.abs(s.rpm / syncRpm(3, s.speed) - 1)).toBeLessThan(0.05)
  })

  it('6. 가속 변속(4→5)은 rpm을 떨어뜨린다', () => {
    const before = cruising(4, 16.67)
    let s = run(before, { ...idle, clutchKey: true }, 0.6)
    s = { ...s, gear: 5 }
    s = run(s, idle, 0.5)
    expect(s.rpm).toBeLessThan(before.rpm)
    expect(Math.abs(s.rpm / syncRpm(5, s.speed) - 1)).toBeLessThan(0.05)
  })

  it('7. 직결에서 스로틀을 닫으면 엔진 브레이크로 느려지고 rpm은 차속에 붙어 있다', () => {
    const before = cruising(4, 16.67)
    const s = run(before, idle, 2)
    expect(s.speed).toBeLessThan(before.speed - 1)
    expect(s.stalled).toBe(false)
    expect(Math.abs(s.rpm / syncRpm(4, s.speed) - 1)).toBeLessThan(0.02)
  })

  it('8. 6단 전개 60초면 최고 속도에서 수렴한다', () => {
    const s = run(cruising(6, 20), wot, 60)
    expect(speedKmh(s.speed)).toBeGreaterThan(190)
    expect(speedKmh(s.speed)).toBeLessThan(210)
    expect(s.rpm).toBeLessThan(12500)
  })

  it('9. 앞브레이크를 꽉 잡으면 3초 안에 서고, 클러치를 안 잡았으면 시동이 꺼진다', () => {
    const s = run(cruising(4, 16.67), { ...idle, brakeKey: true }, 3)
    expect(s.speed).toBeLessThan(0.1)
    expect(s.stalled).toBe(true)
  })

  it('클러치를 잡고 있으면 기어가 들어가도 꺼지지 않는다', () => {
    const s = run(base({ gear: 1, clutch: 1 }), { ...idle, clutchKey: true }, 2)
    expect(s.stalled).toBe(false)
    expect(s.speed).toBe(0)
  })

  it('running이 아니면 rpm은 0으로 내려가고 차체는 굴러가다 선다', () => {
    const s = run(base({ running: false, speed: 10 }), idle, 1)
    expect(s.rpm).toBe(0)
    expect(s.speed).toBeLessThan(10)
    expect(s.speed).toBeGreaterThan(0)
  })

  it('기어를 문 채 재시동하면 클러치 레버가 늦게 따라와도 시동이 걸린다', () => {
    // Starter는 클러치 "키"를 기준으로 재시동을 허용하므로, 레버(시정수 0.12초)는
    // rpm이 0에서 올라오는 동안 아직 물려 있다. 여기서 다시 꺼지면 영영 못 건다.
    const s = run(base({ rpm: 0, gear: 1, clutch: 0 }), { ...idle, clutchKey: true }, 1.5)
    expect(s.stalled).toBe(false)
    expect(s.rpm).toBeGreaterThan(IDLE_RPM - 60)
  })

  it('바퀴 회전은 차속에서 파생된다', () => {
    expect(wheelRpm(2 * Math.PI * REAR_TIRE_R_M)).toBeCloseTo(60, 6)
    expect(wheelRpm(0)).toBe(0)
  })
})
