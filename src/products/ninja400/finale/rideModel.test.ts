import { describe, expect, it } from 'vitest'
import {
  FINAL,
  GEAR_RATIOS,
  IDLE_RPM,
  LEAN_MAX,
  MAX_RPM,
  PRIMARY,
  REAR_TIRE_R_M,
  gearRatio,
  shiftDown,
  shiftUp,
  speedKmh,
  stepRide,
  turnRate,
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
  lean: 0,
  ...o,
})

const run = (s: RideSim, input: RideInputs, seconds: number, dt = 1 / 120) => {
  for (let t = 0; t < seconds - 1e-9; t += dt) s = stepRide(s, input, dt)
  return s
}

const idle: RideInputs = {
  throttleKey: false,
  brakeKey: false,
  clutchKey: false,
  throttleMouse: 0,
  leanLeftKey: false,
  leanRightKey: false,
}
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
    // 거버너 설정점(IDLE_SETPOINT)이 엔진 브레이크와 평형을 이루는 지점 — 계기에 1300으로 보여야 한다
    expect(Math.abs(s.rpm - IDLE_RPM)).toBeLessThan(15)
    expect(s.speed).toBe(0)
  })

  // 서브스텝이 제 몫을 하는지 보려면 프레임 길이를 바꿔가며 같은 것을 물어야 한다.
  // 0.1초는 RideControls가 허용하는 최대 프레임(MAX_DT)이다.
  it.each([1 / 120, 1 / 30, 0.1])('2. 중립 전개는 0.6~1.5초에 리미터에 닿고 12,500을 넘지 않는다 (dt=%f)', (dt) => {
    let s = base()
    let reached = 0
    let peak = 0
    for (let t = 0; t < 3; t += dt) {
      s = stepRide(s, wot, dt)
      peak = Math.max(peak, s.rpm)
      if (!reached && s.rpm >= MAX_RPM) reached = t + dt
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

  it('직결로 물리는 순간 차속이 튀지 않는다 — 붙는 쪽은 엔진이다', () => {
    // 엔진을 동기에서 ±9.9 rad/s(직결 판정 문턱 10 바로 아래) 어긋나게 두고 클러치를 놓는다.
    // 차체를 엔진 축으로 환산한 관성이 J_E의 17배쯤이라, 차속은 동기로 시작한 경우와 같아야 한다.
    const sync6 = (speed: number) => (speed / REAR_TIRE_R_M) * gearRatio(6)
    const after = (offset: number) => {
      const s = base({ gear: 6, speed: 50, clutch: 0, rpm: (sync6(50) + offset) * (60 / (2 * Math.PI)) })
      return run(s, idle, 0.05).speed
    }
    const level = after(0)
    expect(Math.abs(after(9.9) - level)).toBeLessThan(0.02)
    expect(Math.abs(after(-9.9) - level)).toBeLessThan(0.02)
  })

  // --- 피드백 2회차: 물린 기어에서의 스톨과 변속 중 rpm 유지 --------------------

  it('10. 1단 3 m/s·스로틀 0·클러치 놓음 — NaN 없이 굴러가거나 꺼진다', () => {
    // 아이들 크롤(계속 굴러감)도 스톨도 다 받아들인다. 수치가 깨지지 않는 것만 본다.
    const s = run(base({ gear: 1, speed: 3, rpm: syncRpm(1, 3) }), idle, 6)
    expect(Number.isNaN(s.rpm)).toBe(false)
    expect(Number.isNaN(s.speed)).toBe(false)
    expect(Number.isNaN(s.distance)).toBe(false)
    expect(s.speed).toBeGreaterThanOrEqual(0)
  })

  it('11. 6단 8 m/s(≈1,700 rpm) 러깅 — 클러치를 안 잡으면 시동이 꺼진다', () => {
    // 거버너가 물린 기어에서도 15 Nm를 밀던 때는 영영 꺼지지 않고 아이들로 기어갔다.
    // GOV_MAX_ENGAGED(2 Nm)로 내려서 구동계가 엔진을 끌어내릴 수 있게 됐다.
    let s = base({ gear: 6, speed: 8, rpm: syncRpm(6, 8) })
    expect(s.rpm).toBeGreaterThan(1600)
    expect(s.rpm).toBeLessThan(1800)
    let at = 0
    for (let t = 0; t < 9; t += 1 / 120) {
      s = stepRide(s, idle, 1 / 120)
      if (s.stalled) {
        at = t + 1 / 120
        break
      }
    }
    // 실측 7.6초 — 6단은 감속비가 낮아 엔진을 끌어내리는 데 시간이 걸린다
    expect(at).toBeGreaterThan(0)
    expect(at).toBeLessThan(9)
    expect(s.stalled).toBe(true)
    expect(s.rpm).toBe(0)
  })

  it('12. 2단 40 km/h에서 브레이크를 잡으면 클러치를 안 잡은 채로 3초 안에 꺼진다', () => {
    const s = run(base({ gear: 2, speed: 40 / 3.6, rpm: syncRpm(2, 40 / 3.6) }), { ...idle, brakeKey: true }, 3)
    expect(s.stalled).toBe(true)
    expect(s.rpm).toBe(0)
  })

  it('13. 중립 6,000 rpm에서 스로틀을 놓아도 변속 길이(0.4초) 동안은 회전이 남는다', () => {
    // 엔진 브레이크가 3 + 2.5·rpm/1000이던 때는 0.4초에 2,000 rpm 아래로 떨어져서
    // 단수만 바꿔도 rpm이 아이들로 곤두박질쳤다. 2 + 1.5·rpm/1000으로 완화했다.
    const short = run(base({ rpm: 6000 }), idle, 0.4)
    expect(short.rpm).toBeGreaterThanOrEqual(4300)
    const long = run(base({ rpm: 6000 }), idle, 2.5)
    expect(Math.abs(long.rpm - IDLE_RPM)).toBeLessThan(100)
  })

  // --- 피드백 3회차: 시동 꺼짐 판정 확대와 스톨 래치 -----------------------------

  it('14. 물린 기어·스로틀 닫힘에서 1,200 rpm 아래로 0.5초면 꺼진다', () => {
    // 이전 규칙(1,050 rpm·0.4초)은 거버너가 붙잡는 1,000~1,050 사이에서만 죽어서
    // 2단 4 m/s 러깅에 3.2초가 걸렸다. 실차 감각대로 아이들 바로 아래에서 죽인다.
    let s = base({ gear: 2, speed: 4, rpm: syncRpm(2, 4) })
    let at = -1
    for (let i = 0; i < 120 * 6; i++) {
      s = stepRide(s, idle, 1 / 120)
      if (s.stalled) {
        at = (i + 1) / 120
        break
      }
    }
    // 실측 3.20초 → 2.33초. 남은 시간은 1,668 rpm에서 1,200까지 러깅으로 내려가는 데 쓰인다
    expect(at).toBeGreaterThan(0)
    expect(at).toBeLessThan(2.6)
    expect(s.rpm).toBe(0)
  })

  it('15. 러깅이어도 스로틀을 열고 있으면 죽지 않는다', () => {
    // 약한 판정은 스로틀 5% 미만에서만 본다 — 저회전에서 붙잡고 가는 것은 정상 주행이다
    const s = run(base({ gear: 1, speed: 3, rpm: syncRpm(1, 3) }), wot, 3)
    expect(s.stalled).toBe(false)
    expect(s.rpm).toBeGreaterThan(1200)
  })

  it('16. 중립·클러치 잡음은 1,200 아래 규칙에 걸리지 않고 아이들을 지킨다', () => {
    const n = run(base(), idle, 5)
    expect(n.stalled).toBe(false)
    expect(Math.abs(n.rpm - IDLE_RPM)).toBeLessThan(20)
    const c = run(base({ gear: 3, clutch: 1 }), { ...idle, clutchKey: true }, 5)
    expect(c.stalled).toBe(false)
    expect(Math.abs(c.rpm - IDLE_RPM)).toBeLessThan(20)
  })

  it('17. 한 번 꺼지면 3초 동안 rpm 0·stalled가 풀리지 않는다 (무엇을 눌러도)', () => {
    // 화면에서는 꺼진 직후 회전계가 1,300으로 튀어 올랐다. 모델 쪽 래치를 못으로 박아 둔다.
    let s = base({ gear: 2, speed: 6, rpm: syncRpm(2, 6) })
    for (let i = 0; i < 120 * 10 && !s.stalled; i++) s = stepRide(s, idle, 1 / 120)
    expect(s.stalled).toBe(true)
    const pokes: RideInputs[] = [
      idle,
      wot,
      { ...idle, clutchKey: true },
      { ...wot, clutchKey: true },
      { ...idle, brakeKey: true },
      { ...idle, throttleMouse: 1 },
    ]
    for (let i = 0; i < 120 * 3; i++) {
      if (i % 40 === 0) s = { ...s, gear: (s.gear + 1) % 7 }
      s = stepRide(s, pokes[i % pokes.length], 1 / 120)
      expect(s.stalled).toBe(true)
      expect(s.rpm).toBe(0)
    }
  })

  it('18. 스톨 직후 프레임이 길어도(0.1초) rpm은 0이고 NaN이 되지 않는다', () => {
    let s = base({ gear: 1, speed: 3, rpm: syncRpm(1, 3), stalled: true })
    for (let i = 0; i < 60; i++) {
      s = stepRide(s, wot, 0.1)
      expect(Number.isFinite(s.rpm)).toBe(true)
      expect(s.rpm).toBe(0)
    }
  })

  // --- 기울이기 (D/F) -----------------------------------------------------------

  const leanL: RideInputs = { ...idle, leanLeftKey: true }
  const leanR: RideInputs = { ...idle, leanRightKey: true }
  const deg = (rad: number) => (rad * 180) / Math.PI

  it('19. 20 m/s에서 왼쪽을 2초 누르면 −38°에 1° 안으로 붙는다', () => {
    const s = run(base({ gear: 4, speed: 20, rpm: syncRpm(4, 20) }), leanL, 2)
    expect(deg(s.lean)).toBeLessThan(0)
    expect(Math.abs(deg(s.lean) + 38)).toBeLessThan(1)
    expect(Math.abs(s.lean)).toBeLessThanOrEqual(LEAN_MAX)
  })

  it('20. 오른쪽도 대칭이고, 놓으면 2초 안에 1° 안으로 돌아온다', () => {
    let s = run(base({ gear: 4, speed: 20, rpm: syncRpm(4, 20) }), leanR, 2)
    expect(Math.abs(deg(s.lean) - 38)).toBeLessThan(1)
    s = run(s, idle, 2)
    expect(Math.abs(deg(s.lean))).toBeLessThan(1)
  })

  it('21. 오래 눌러도 캡을 넘지 않는다', () => {
    const s = run(base({ gear: 4, speed: 20, rpm: syncRpm(4, 20) }), leanR, 30)
    expect(s.lean).toBeLessThanOrEqual(LEAN_MAX)
    expect(Math.abs(deg(s.lean) - 38)).toBeLessThan(0.01)
  })

  it('22. 1 m/s 아래(선 채)에서는 눌러도 기울지 않는다', () => {
    const s = run(base({ gear: 0, speed: 0 }), leanL, 3)
    expect(Math.abs(deg(s.lean))).toBeLessThan(1)
    expect(s.lean).toBe(0)
  })

  it('23. 기울인 채 1 m/s 아래로 서면 눌러도 목표가 0이 되어 세워진다', () => {
    let s = run(base({ gear: 4, speed: 20, rpm: syncRpm(4, 20) }), leanR, 2)
    expect(Math.abs(deg(s.lean) - 38)).toBeLessThan(1)
    // 중립으로 굴려서 세운다 — 기어를 문 채 차속만 0.5로 바꾸면 클러치가 다시 밀어 내보낸다
    s = run({ ...s, gear: 0, speed: 0.5, rpm: IDLE_RPM }, leanR, 2)
    expect(s.speed).toBeLessThan(1)
    expect(Math.abs(deg(s.lean))).toBeLessThan(1)
  })

  it('24. turnRate는 g·tan(lean)/max(v,1)', () => {
    expect(turnRate(0, 10)).toBe(0)
    expect(turnRate(0, 0)).toBe(0)
    expect(turnRate(0.3, 10)).toBeCloseTo((9.81 * Math.tan(0.3)) / 10, 10)
    // 오른쪽(+)이 + 요 레이트, 왼쪽(−)이 − 요 레이트
    expect(turnRate(-0.3, 10)).toBeCloseTo(-turnRate(0.3, 10), 10)
    // 1 m/s 아래에서 발산하지 않는다
    expect(turnRate(LEAN_MAX, 0)).toBeCloseTo(9.81 * Math.tan(LEAN_MAX), 10)
    expect(turnRate(LEAN_MAX, 0.01)).toBe(turnRate(LEAN_MAX, 1))
  })

  it('제원 상수는 EX400G 값 그대로다', () => {
    expect(GEAR_RATIOS).toEqual([0, 2.929, 2.056, 1.619, 1.333, 1.154, 1.037])
    expect(PRIMARY).toBe(2.219)
    expect(FINAL).toBe(2.929)
    expect(IDLE_RPM).toBe(1300)
    expect(MAX_RPM).toBe(12000)
    expect(REAR_TIRE_R_M).toBe(0.306)
    expect(gearRatio(0)).toBe(Infinity)
    expect(gearRatio(6)).toBeCloseTo(6.74, 2)
  })

  it('바퀴 회전은 차속에서 파생된다', () => {
    expect(wheelRpm(2 * Math.PI * REAR_TIRE_R_M)).toBeCloseTo(60, 6)
    expect(wheelRpm(0)).toBe(0)
  })
})
