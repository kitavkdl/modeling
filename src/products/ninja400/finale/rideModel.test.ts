import { describe, expect, it } from 'vitest'
import {
  CRANK_RPM,
  CRANK_S,
  FINAL,
  GEAR_RATIOS,
  IDLE_RPM,
  LEAN_MAX,
  LIMITER_BAND,
  MAX_RPM,
  OVERREV_MAX,
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
  fuelCut: false,
  lean: 0,
  lurch: 0,
  crankFor: 0,
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
  // "12,000에 정확히 닿는 첫 프레임"은 더는 물을 수 없다 — 리미터가 연료를 끊었다 붙이며
  // 위아래로 튀므로 프레임 경계에 12,000이 잡힐지가 dt에 따라 갈린다. 대역 진입으로 바꿨다.
  it.each([1 / 120, 1 / 30, 0.1])('2. 중립 전개는 0.6~1.5초에 리미터 대역에 닿는다 (dt=%f)', (dt) => {
    let s = base()
    let reached = 0
    let peak = 0
    for (let t = 0; t < 3; t += dt) {
      s = stepRide(s, wot, dt)
      peak = Math.max(peak, s.rpm)
      if (!reached && s.rpm >= MAX_RPM - LIMITER_BAND) reached = t + dt
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
    // 꺼진 그 프레임에 바늘이 0으로 처박히지는 않는다 — 크랭크가 STALL_TAU로 멎는다 (아래 38번)
    expect(s.rpm).toBeLessThan(1200)
    expect(run(s, idle, 0.6).rpm).toBe(0)
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
    expect(s.rpm).toBeLessThan(1200)
    expect(run(s, idle, 0.6).rpm).toBe(0)
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
    // 스핀다운(STALL_TAU)이 끝난 뒤로는 무엇을 눌러도 0에서 움직이지 않는다
    let peak = 0
    for (let i = 0; i < 120 * 3; i++) {
      if (i % 40 === 0) s = { ...s, gear: (s.gear + 1) % 7 }
      s = stepRide(s, pokes[i % pokes.length], 1 / 120)
      expect(s.stalled).toBe(true)
      if (i < 120 * 0.6) peak = Math.max(peak, s.rpm)
      else expect(s.rpm).toBe(0)
    }
    // 스핀다운 구간에도 회전이 되살아나지는 않는다 — 내려가기만 한다
    expect(peak).toBeLessThan(1200)
  })

  it('18. 스톨 직후 프레임이 길어도(0.1초) rpm은 0이고 NaN이 되지 않는다', () => {
    let s = base({ gear: 1, speed: 3, rpm: syncRpm(1, 3), stalled: true })
    for (let i = 0; i < 60; i++) {
      s = stepRide(s, wot, 0.1)
      expect(Number.isFinite(s.rpm)).toBe(true)
      // 1,783 rpm(3 m/s의 1단 동기)에서 STALL_TAU로 내려오느라 0.5초까지는 0이 아니다.
      if (i >= 5) expect(s.rpm).toBe(0)
      else expect(s.rpm).toBeLessThan(syncRpm(1, 3))
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
    // 스로틀을 열어 둔다 — 스로틀을 닫고 30초를 굴리면 이제 러깅으로 꺼지고,
    // 꺼진 엔진의 항력(DEAD_EB_FACTOR)까지 걸려 1 m/s 아래로 서 버린다. 그러면
    // 목표 뱅크각이 0이 되어 차가 스스로 일어서므로 캡을 보는 시험이 되지 않는다.
    const s = run(base({ gear: 4, speed: 20, rpm: syncRpm(4, 20) }), { ...leanR, throttleKey: true }, 30)
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

  // --- 피드백 4회차: 시나리오 배터리로 잡은 것들 -------------------------------
  // (.superpowers/sdd/round-3/trace.ts 로 14가지 주행 시나리오를 돌려 찾았다)

  it('25. 리미터는 벽이 아니라 바운스다 — 12,000에 얼어붙지 않고 위아래로 튄다', () => {
    // 고치기 전: 전개로 리미터에 닿으면 rpm이 12,000~12,010에 붙어 정지했다. 실차의 소프트 컷은
    // 연료를 끊었다 붙이기를 반복해서 회전이 눈에 보이게 출렁인다.
    let s = base({ gear: 1, speed: 19, rpm: 11000, clutch: 0 })
    let lo = Infinity
    let hi = 0
    for (let i = 0; i < 60 * 8; i++) {
      s = stepRide(s, wot, 1 / 60)
      if (i > 60 * 2) {
        lo = Math.min(lo, s.rpm)
        hi = Math.max(hi, s.rpm)
      }
    }
    expect(hi).toBeGreaterThan(MAX_RPM - 100)
    expect(hi).toBeLessThan(12300)
    expect(hi - lo).toBeGreaterThan(150)
    expect(hi - lo).toBeLessThan(LIMITER_BAND + 120)
  })

  it('26. 출발에서 차속이 프레임당 1 km/h씩 뛰지 않는다 — 뒷바퀴 접지 한계', () => {
    // 고치기 전: 클러치 용량 90 Nm이 1단(총감속 19.0)에서 5,600 N = 2.3 g를 밀어서
    // 1/60초에 1.4 km/h씩 튀었다. 실차의 윌리 한계는 1.1 g다.
    let s = base({ gear: 1, clutch: 1 })
    let worst = 0
    for (let i = 0; i < 60 * 6; i++) {
      const prev = s.speed
      s = stepRide(s, i < 30 ? { ...wot, clutchKey: true } : wot, 1 / 60)
      worst = Math.max(worst, speedKmh(s.speed) - speedKmh(prev))
    }
    expect(worst).toBeLessThan(1)
    // 그래도 출발은 한다 — 한계를 걸었다고 못 나가면 안 된다
    expect(s.stalled).toBe(false)
    expect(speedKmh(s.speed)).toBeGreaterThan(50)
  })

  it('27. 1단 출발에서 100 km/h까지 4~6초 (실차 5초대)', () => {
    // 클러치를 잡은 채 0.5초 전개로 회전을 올렸다가 놓는다 — 실제 출발 동작
    let s = base({ gear: 1, clutch: 1 })
    let t100 = -1
    let holdClutch = 0.5
    let launching = true
    let shiftAt = 0
    for (let i = 0; i < 60 * 12 && t100 < 0; i++) {
      const dt = 1 / 60
      const t = i * dt
      // 11,500에서 클러치를 0.3초 잡고 한 단 올린다 — 스로틀은 그동안 닫는다
      if (holdClutch <= 0 && s.rpm >= 11500 && s.gear < 6 && t - shiftAt > 0.4) {
        s = { ...s, gear: s.gear === 1 ? 2 : s.gear + 1 }
        holdClutch = 0.3
        shiftAt = t
      }
      const clutching = holdClutch > 0
      if (clutching) holdClutch -= dt
      else launching = false
      const input = clutching ? { ...(launching ? wot : idle), clutchKey: true } : wot
      s = stepRide(s, input, dt)
      if (speedKmh(s.speed) >= 100) t100 = t + dt
    }
    expect(s.stalled).toBe(false)
    expect(t100).toBeGreaterThan(4)
    expect(t100).toBeLessThan(6)
  })

  it('28. 1단 리미터 연료 컷의 엔진 브레이크도 뒷바퀴 접지 한계를 넘지 못한다', () => {
    // 고치기 전: 접지 상한(REAR_DRIVE_N/REAR_BRAKE_N)이 슬립 가지에만 있었다. 직결 가지는
    // (torque − load)/jEff × MASS·r/ratio를 그대로 차체에 밀어서, 1단 12,300 rpm 연료 컷이
    // 0.55 g로 차를 세웠다 — 뒷바퀴가 전할 수 있는 몫(900 N = 0.377 g)의 1.5배다.
    // 실차라면 그 전에 뒤가 미끄러진다.
    const speed = (12300 / gearRatio(1)) * 2 * Math.PI * REAR_TIRE_R_M / 60   // 20.7 m/s = 74.5 km/h
    const state = { gear: 1, speed, clutch: 0, rpm: 12300, fuelCut: true }
    let s = base(state)
    // 같은 차속의 순수 항력 (중립 타력) — 접지력이 아니라 공기·구름 저항 몫이다
    let coast = base({ ...state, gear: 0, rpm: IDLE_RPM, fuelCut: false })
    let worst = 0
    let worstTyre = 0
    for (let i = 0; i < 60; i++) {
      const before = s.speed
      const beforeCoast = coast.speed
      s = stepRide(s, idle, 1 / 60)
      coast = stepRide(coast, idle, 1 / 60)
      const decel = (before - s.speed) * 60
      worst = Math.max(worst, decel)
      worstTyre = Math.max(worstTyre, decel - (beforeCoast - coast.speed) * 60)
    }
    // 뒷타이어가 전하는 몫만 떼어 보면 상한(900 N / 243 kg = 0.377 g)에 정확히 맞는다
    expect(worstTyre / 9.81).toBeLessThanOrEqual(0.38)
    // 총감속은 거기에 74 km/h의 항력(0.054 g)이 얹힌 값이다 — 0.55 g에서 0.43 g로 내려왔다
    expect(worst / 9.81).toBeLessThan(0.44)
    // 그래도 엔진 브레이크는 걸린다 — 상한을 씌웠다고 타력 주행이 되면 안 된다
    expect(worst / 9.81).toBeGreaterThan(0.3)
  })

  it('29. 고속에서 중립으로 빼면 엔진은 아이들로 내려가고 차는 항력으로만 느려진다', () => {
    // 사용자 신고: "특히 고속에서 N단으로 바꿨을 때". 6단 140 km/h → 클러치 → N → 클러치 놓기.
    let s = cruising(6, 140 / 3.6)
    s = run(s, { ...idle, clutchKey: true }, 0.4)
    s = { ...s, gear: 0 }
    s = run(s, { ...idle, clutchKey: true }, 0.2)
    const before = s.speed
    s = run(s, idle, 1)
    // 항력만 — 140 km/h에서 (½ρCdA·v² + 구름)/m ≈ 1.5 m/s²
    const decel = (before - s.speed) / 1
    expect(decel).toBeGreaterThan(1.2)
    expect(decel).toBeLessThan(1.8)
    s = run(s, idle, 4)
    expect(s.stalled).toBe(false)
    expect(Math.abs(s.rpm - IDLE_RPM)).toBeLessThan(60)
    expect(speedKmh(s.speed)).toBeGreaterThan(100)
  })

  it('30. 중립 140 km/h에서 2단을 넣고 클러치를 놓아도 과회전하지 않는다', () => {
    // 동기 회전이 16,200 rpm이다. 고치기 전에는 엔진이 끌려 올라가는 대신 차가 1.4 g로 섰다.
    // 지금은 뒷바퀴가 미끄러지는 몫(REAR_BRAKE_N)만 전해지고 회전은 상한 아래에 머문다.
    let s = base({ gear: 2, speed: 140 / 3.6, rpm: IDLE_RPM })
    let peak = 0
    let worstDecel = 0
    for (let i = 0; i < 60 * 4; i++) {
      const prev = s.speed
      s = stepRide(s, idle, 1 / 60)
      peak = Math.max(peak, s.rpm)
      worstDecel = Math.max(worstDecel, (prev - s.speed) * 60)
      expect(Number.isFinite(s.rpm)).toBe(true)
      expect(Number.isFinite(s.speed)).toBe(true)
      expect(s.speed).toBeGreaterThanOrEqual(0)
    }
    expect(peak).toBeLessThan(12800)
    // 뒤가 미끄러지는 한계 ≈ 0.37 g + 공기저항. 1 g로 서지 않는다
    expect(worstDecel).toBeLessThan(0.6 * 9.81)
    expect(s.speed).toBeLessThan(140 / 3.6)
  })

  it('31. 어떤 조합으로도 엔진 회전은 기계적 상한(OVERREV_MAX)을 넘지 않는다', () => {
    const cases: RideSim[] = [
      base({ gear: 1, speed: 120 / 3.6, rpm: IDLE_RPM }),
      base({ gear: 2, speed: 160 / 3.6, rpm: 11000 }),
      base({ gear: 1, speed: 200 / 3.6, rpm: 14000 }),
      base({ gear: 3, speed: 180 / 3.6, rpm: 12500, clutch: 0.3 }),
    ]
    for (const start of cases) {
      let s = start
      for (let i = 0; i < 60 * 4; i++) {
        s = stepRide(s, i % 2 ? wot : idle, 1 / 60)
        expect(s.rpm).toBeLessThanOrEqual(OVERREV_MAX)
        expect(Number.isFinite(s.rpm)).toBe(true)
        expect(s.speed).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('32. 3단 60 km/h에서 1단으로 떨어뜨리면 회전이 뛰고 차는 느려진다 — 다만 뒷바퀴 한계 안에서', () => {
    let s = cruising(3, 60 / 3.6)
    s = run(s, { ...idle, clutchKey: true }, 0.3)
    s = { ...s, gear: 1 }
    s = run(s, { ...idle, clutchKey: true }, 0.1)
    const before = s.speed
    let peak = 0
    let worstDecel = 0
    for (let i = 0; i < 60 * 2; i++) {
      const prev = s.speed
      s = stepRide(s, idle, 1 / 60)
      peak = Math.max(peak, s.rpm)
      worstDecel = Math.max(worstDecel, (prev - s.speed) * 60)
    }
    expect(peak).toBeGreaterThan(5500)
    expect(peak).toBeLessThanOrEqual(OVERREV_MAX)
    expect(s.speed).toBeLessThan(before)
    expect(worstDecel).toBeLessThan(0.6 * 9.81)
  })

  it('33. 중립 100 km/h 급제동은 0.7~0.95 g로 40~50 m 안에 선다', () => {
    // 고치기 전 BRAKE_N 3200은 1.34 g·30 m였다 — 로드 스포츠가 낼 수 없는 값이다.
    let s = base({ gear: 0, speed: 100 / 3.6, rpm: IDLE_RPM })
    const d0 = s.distance
    let stopped = -1
    let worstDecel = 0
    for (let i = 0; i < 60 * 8 && stopped < 0; i++) {
      const prev = s.speed
      s = stepRide(s, { ...idle, brakeKey: true }, 1 / 60)
      worstDecel = Math.max(worstDecel, (prev - s.speed) * 60)
      if (s.speed <= 0) stopped = (i + 1) / 60
    }
    expect(stopped).toBeGreaterThan(0)
    expect(worstDecel).toBeGreaterThan(0.7 * 9.81)
    expect(worstDecel).toBeLessThan(0.95 * 9.81)
    expect(s.distance - d0).toBeGreaterThan(38)
    expect(s.distance - d0).toBeLessThan(52)
    expect(s.stalled).toBe(false)
    expect(Math.abs(s.rpm - IDLE_RPM)).toBeLessThan(20)
  })

  it('34. 시동이 꺼진 채 기어를 물고 있으면 중립 타력보다 빨리 선다', () => {
    // 고치기 전: 꺼지는 순간 구동계를 끊어서 중립 타력과 똑같이 굴러갔다.
    // 실차는 꺼진 엔진의 압축·마찰이 브레이크로 걸린다.
    let geared = base({ gear: 6, speed: 20 / 3.6, rpm: syncRpm(6, 20 / 3.6) })
    for (let i = 0; i < 120 * 4 && !geared.stalled; i++) geared = stepRide(geared, idle, 1 / 120)
    expect(geared.stalled).toBe(true)
    const v0 = geared.speed
    let neutral = base({ gear: 0, speed: v0, rpm: IDLE_RPM })
    for (let i = 0; i < 120 * 10; i++) {
      geared = stepRide(geared, idle, 1 / 120)
      neutral = stepRide(neutral, idle, 1 / 120)
    }
    expect(geared.speed).toBeLessThan(neutral.speed - 1)
    expect(geared.speed).toBeGreaterThanOrEqual(0)
    expect(geared.rpm).toBe(0)
  })

  it('35. 구르는 중에 다시 걸면 클러치를 놓아도 안 꺼진다 (3단 30 km/h 범프)', () => {
    // 꺼진 상태에서 Starter가 하는 일 그대로: stalled=false·running=true·rpm 0에서 시작
    let s = base({ gear: 3, speed: 30 / 3.6, rpm: 0 })
    s = run(s, { ...idle, clutchKey: true }, 1)
    expect(Math.abs(s.rpm - IDLE_RPM)).toBeLessThan(60)
    s = run(s, idle, 2)
    expect(s.stalled).toBe(false)
    // 동기(≈2,700)까지 끌려 올라가 계속 돈다
    expect(s.rpm).toBeGreaterThan(1800)
    expect(Math.abs(s.rpm / syncRpm(3, s.speed) - 1)).toBeLessThan(0.05)
  })

  it('36. 중립에서 0.15초 블립은 3,000 언저리까지 갔다 아이들로 돌아온다', () => {
    let s = base()
    let peak = 0
    for (let i = 0; i < 9; i++) {
      s = stepRide(s, wot, 1 / 60)
      peak = Math.max(peak, s.rpm)
    }
    for (let i = 0; i < 180; i++) {
      s = stepRide(s, idle, 1 / 60)
      peak = Math.max(peak, s.rpm)
    }
    expect(peak).toBeGreaterThan(2500)
    expect(peak).toBeLessThan(4500)
    expect(Math.abs(s.rpm - IDLE_RPM)).toBeLessThan(20)
  })

  it('37. 스로틀을 살짝 열면 회전이 떨어지지 않고 올라간다', () => {
    // 고치기 전: 토크를 개도에 선형으로 곱해서 5~17% 사이는 엔진 브레이크를 못 이겼다 —
    // 스로틀을 조금 여는데 rpm이 내려가는 구멍이 있었다.
    for (const throttle of [0.08, 0.15, 0.3, 0.5]) {
      const s = run(base(), { ...idle, throttleMouse: throttle }, 2)
      expect(s.rpm).toBeGreaterThan(IDLE_RPM)
      expect(s.rpm).toBeLessThan(MAX_RPM)
    }
  })

  // --- 피드백 5회차: 상태 전환 (실주행 점검) -----------------------------------

  it('38. N → 1단 클러치 덤프(스로틀 0·정지): 몇 cm 튀어나가고 0.5초 안에 회전이 멎는다', () => {
    // 고치기 전: stalled가 서는 프레임(0.09초)에 rpm을 0으로 눌러서 바늘이 한 프레임에
    // 바닥으로 처박혔다 — "꺼졌다"가 아니라 "사라졌다". 실차는 크랭크가 관성으로 더 돈다.
    let s = base({ gear: 1, clutch: 1, rpm: IDLE_RPM })
    let stallAt = -1
    let zeroAt = -1
    let peakSpeed = 0
    for (let i = 0; i < 120 * 2; i++) {
      s = stepRide(s, idle, 1 / 120)
      const t = (i + 1) / 120
      if (stallAt < 0 && s.stalled) stallAt = t
      if (zeroAt < 0 && s.rpm === 0) zeroAt = t
      peakSpeed = Math.max(peakSpeed, s.speed)
    }
    expect(stallAt).toBeGreaterThan(0)
    expect(stallAt).toBeLessThan(0.2)
    // 연소가 끊긴 뒤 크랭크가 멎기까지 — 0.3~0.5초 안이다
    expect(zeroAt).toBeGreaterThan(0.3)
    expect(zeroAt).toBeLessThan(0.5)
    // 앞으로 한 번 튀어나간다: 몇 cm — 미터 단위로 기어가지도, 제자리에 얼어붙지도 않는다
    expect(s.distance).toBeGreaterThan(0.03)
    expect(s.distance).toBeLessThan(0.4)
    expect(peakSpeed).toBeGreaterThan(0.1)
    expect(s.speed).toBe(0)
  })

  it('39. 클러치 덤프의 반동이 lurch로 나온다 — 가속은 +, 제동은 −', () => {
    let s = base({ gear: 1, clutch: 1, rpm: IDLE_RPM })
    let peak = 0
    for (let i = 0; i < 120; i++) {
      s = stepRide(s, idle, 1 / 120)
      peak = Math.max(peak, s.lurch)
    }
    // 정지에서 0.3 m/s대로 튀어나가는 한 번의 끄덕임
    expect(peak).toBeGreaterThan(1)
    expect(peak).toBeLessThan(11)
    // 급제동은 음수 — 앞브레이크 0.88 g
    let b = base({ gear: 0, speed: 25, rpm: IDLE_RPM })
    let dip = 0
    for (let i = 0; i < 120; i++) {
      b = stepRide(b, { ...idle, brakeKey: true }, 1 / 120)
      dip = Math.min(dip, b.lurch)
    }
    expect(dip).toBeLessThan(-6)
    expect(dip).toBeGreaterThan(-12)
    // 가만히 서 있으면 0
    const still = run(base({ gear: 0 }), idle, 1)
    expect(Math.abs(still.lurch)).toBeLessThan(1e-6)
  })

  it('40. 재시동은 0.6초 크랭킹을 거친다 — 300 rpm으로 돌다가 아이들로 붙는다', () => {
    // 고치기 전: 거버너가 한 프레임에 아이들까지 끌어올려서 버튼을 누르는 즉시 엔진이 생겼다.
    let s = base({ gear: 0, rpm: 0, stalled: false, crankFor: CRANK_S })
    const at = (t: number) => Math.round(t * 120)
    const rpms: number[] = []
    for (let i = 0; i < 120 * 1.5; i++) {
      s = stepRide(s, idle, 1 / 120)
      rpms.push(s.rpm)
    }
    // 크랭킹 구간(0.3~0.6초)은 CRANK_RPM 언저리에 머문다
    expect(rpms[at(0.3)]).toBeGreaterThan(CRANK_RPM * 0.8)
    expect(rpms[at(0.3)]).toBeLessThan(CRANK_RPM * 1.1)
    expect(rpms[at(0.55)]).toBeLessThan(CRANK_RPM * 1.1)
    // 크랭킹이 끝나면 불이 붙어 아이들로 올라간다
    expect(rpms[at(1.2)]).toBeGreaterThan(IDLE_RPM - 30)
    expect(rpms[at(1.2)]).toBeLessThan(IDLE_RPM + 30)
    expect(s.crankFor).toBe(0)
    expect(s.stalled).toBe(false)
  })

  it('41. 크랭킹 동안에는 스로틀이 듣지 않고 스톨 판정도 꺼진다', () => {
    // 전개로 눌러도 크랭크는 CRANK_RPM을 넘지 않는다 — 연소가 없으니 당연하다
    let s = base({ gear: 0, rpm: 0, crankFor: CRANK_S })
    let peak = 0
    for (let i = 0; i < 120 * 0.6; i++) {
      s = stepRide(s, wot, 1 / 120)
      peak = Math.max(peak, s.rpm)
    }
    expect(peak).toBeLessThan(CRANK_RPM * 1.1)
    // 기어를 물고 클러치를 놓은 채 크랭킹해도 그 0.6초 동안은 죽지 않는다
    let g = base({ gear: 1, clutch: 0, rpm: 0, crankFor: CRANK_S })
    for (let i = 0; i < 120 * 0.55; i++) g = stepRide(g, idle, 1 / 120)
    expect(g.stalled).toBe(false)
  })

  it('42. 구르는 중에 클러치를 잡고 재시동해도 크랭킹을 거쳐 아이들로 붙는다', () => {
    let s = base({ gear: 2, speed: 8, clutch: 1, rpm: 0, crankFor: CRANK_S })
    const held: RideInputs = { ...idle, clutchKey: true }
    for (let i = 0; i < 120 * 0.5; i++) s = stepRide(s, held, 1 / 120)
    expect(s.rpm).toBeLessThan(CRANK_RPM * 1.1)
    // 크랭킹 동안 차속은 스타터가 아니라 항력만 먹는다 — 거의 그대로다
    expect(s.speed).toBeGreaterThan(7.7)
    for (let i = 0; i < 120 * 1; i++) s = stepRide(s, held, 1 / 120)
    expect(s.stalled).toBe(false)
    expect(Math.abs(s.rpm - IDLE_RPM)).toBeLessThan(40)
  })

  it('43. 선 채로 앞브레이크를 잡고 있으면 클러치를 놓아도 기어 나가지 않는다', () => {
    // 고치기 전: res가 speed > 0일 때만 제동을 담아서, 서 있는 차는 브레이크를 꽉 잡아도
    // 반클러치 구동력을 그대로 받아 스멀스멀 굴러갔다. 정지 마찰이 먼저 버텨야 한다.
    const braked: RideInputs = { ...idle, brakeKey: true }
    let s = base({ gear: 1, clutch: 1, rpm: IDLE_RPM, brake: 1 })
    for (let i = 0; i < 120 * 2; i++) s = stepRide(s, braked, 1 / 120)
    // 클러치 용량이 순간적으로 앞브레이크를 넘기는 스텝이 있어 완전히 0은 아니지만 1 mm 미만이다
    expect(s.distance).toBeLessThan(0.002)
    expect(s.speed).toBe(0)
    // 브레이크를 놓으면 그때는 튀어나간다 — 붙잡는 것이 브레이크임을 확인
    let free = base({ gear: 1, clutch: 1, rpm: IDLE_RPM })
    for (let i = 0; i < 120 * 2; i++) free = stepRide(free, idle, 1 / 120)
    expect(free.distance).toBeGreaterThan(0.05)
  })

  it('44. 브레이크는 정지한 차를 뒤로 밀지 않는다', () => {
    const s = run(base({ gear: 0, speed: 0 }), { ...idle, brakeKey: true }, 3)
    expect(s.speed).toBe(0)
    expect(s.distance).toBe(0)
  })

  it('45. 기울기 캡은 차속에 비례한다 — 보행 속도에서 38°는 못 눕는다', () => {
    const leanR: RideInputs = { ...idle, leanRightKey: true, clutchKey: true }
    const deg = (rad: number) => (rad * 180) / Math.PI
    /** 차속을 붙잡아 둔 채(중립·클러치) 4초 동안 눕힌다 */
    const holdLean = (kmh: number) => {
      let s = base({ gear: 0, speed: kmh / 3.6, rpm: IDLE_RPM, clutch: 1 })
      for (let i = 0; i < 120 * 4; i++) {
        s = stepRide(s, leanR, 1 / 120)
        s = { ...s, speed: kmh / 3.6 } // 항력으로 느려지지 않게 고정해서 캡만 본다
      }
      return deg(s.lean)
    }
    // 5 km/h(1.39 m/s)는 캡이 38° × 1.39/8 = 6.6°
    expect(holdLean(5)).toBeGreaterThan(5)
    expect(holdLean(5)).toBeLessThan(8)
    // 29 km/h(8.06 m/s) 위로는 캡이 다 열린다
    expect(holdLean(29)).toBeGreaterThan(37.5)
    expect(holdLean(60)).toBeLessThan(deg(LEAN_MAX) + 0.01)
    // 캡은 단조 증가한다
    expect(holdLean(10)).toBeGreaterThan(holdLean(5))
    expect(holdLean(20)).toBeGreaterThan(holdLean(10))
  })

  it('46. 눕힌 채 속도가 떨어지면 캡이 같이 닫혀 차가 일어선다', () => {
    const leanR: RideInputs = { ...idle, leanRightKey: true }
    let s = base({ gear: 0, speed: 20, rpm: IDLE_RPM, clutch: 1 })
    for (let i = 0; i < 120 * 3; i++) s = stepRide(s, { ...leanR, clutchKey: true }, 1 / 120)
    const leaned = s.lean
    expect(leaned).toBeGreaterThan(0.6)
    // 계속 누른 채 급제동 — 속도가 떨어지는 만큼 캡이 닫혀야 한다
    for (let i = 0; i < 120 * 3; i++) s = stepRide(s, { ...leanR, clutchKey: true, brakeKey: true }, 1 / 120)
    expect(s.speed).toBeLessThan(4)
    expect(s.lean).toBeLessThan(leaned)
    expect(s.lean).toBeLessThanOrEqual(LEAN_MAX * Math.min(1, s.speed / 8) + 1e-9)
  })

  it('47. N → 1단을 60 km/h에서 넣고 클러치를 놓아도 계기 눈금(13,000) 안이다', () => {
    // 동기 회전은 9,900 rpm. 뒷바퀴 접지 한계(REAR_BRAKE_N) 안에서만 끌려 올라가므로
    // 리미터까지 가지 않고, 차는 뒤가 미끄러지듯 0.4 g로 느려진다.
    const v0 = 60 / 3.6
    expect(syncRpm(1, v0)).toBeGreaterThan(9000)
    let s = base({ gear: 1, speed: v0, rpm: IDLE_RPM })
    let peak = 0
    for (let i = 0; i < 120 * 2; i++) {
      s = stepRide(s, idle, 1 / 120)
      peak = Math.max(peak, s.rpm)
      expect(s.rpm).toBeLessThanOrEqual(OVERREV_MAX)
    }
    expect(peak).toBeGreaterThan(4000)
    expect(s.speed).toBeLessThan(v0)
    // 0.4 g 언저리 — 1 g로 서지 않는다
    const decel = (v0 - s.speed) / 2
    expect(decel).toBeGreaterThan(2)
    expect(decel).toBeLessThan(6)
  })

  it('48. dt = 0.1로 기어·입력을 마구 바꿔도 값이 깨지지 않는다', () => {
    const pokes: RideInputs[] = [
      idle,
      wot,
      { ...idle, clutchKey: true },
      { ...idle, brakeKey: true },
      { ...wot, clutchKey: true },
      { ...idle, leanLeftKey: true },
      { ...idle, leanRightKey: true, brakeKey: true },
    ]
    for (const gear of [0, 1, 3, 6]) {
      for (const speed of [0, 1, 10, 40]) {
        let s = base({ gear, speed, rpm: gear === 0 ? IDLE_RPM : syncRpm(gear, speed) })
        for (let i = 0; i < 120; i++) {
          if (i % 17 === 0) s = { ...s, gear: (s.gear + 1) % 7 }
          if (i % 51 === 0) s = { ...s, crankFor: CRANK_S, stalled: false, running: true }
          s = stepRide(s, pokes[i % pokes.length], 0.1)
          for (const v of [s.rpm, s.speed, s.distance, s.lean, s.lurch, s.crankFor, s.clutch, s.brake, s.throttle]) {
            expect(Number.isFinite(v)).toBe(true)
          }
          expect(s.speed).toBeGreaterThanOrEqual(0)
          expect(s.rpm).toBeGreaterThanOrEqual(0)
          expect(s.rpm).toBeLessThanOrEqual(OVERREV_MAX + 1e-6)
          expect(Math.abs(s.lean)).toBeLessThanOrEqual(LEAN_MAX + 1e-9)
          expect(s.crankFor).toBeGreaterThanOrEqual(0)
        }
      }
    }
  })

  it('49. 스로틀은 키와 그립 중 큰 쪽이 이긴다 — 한쪽을 놓아도 다른 쪽 값이 남는다', () => {
    // 그립을 60%까지 끌어 둔 채 ↑를 눌렀다 놓는다
    let s = base({ gear: 0, rpm: IDLE_RPM })
    s = run(s, { ...idle, throttleMouse: 0.6 }, 1)
    expect(s.throttle).toBeCloseTo(0.6, 3)
    s = run(s, { ...idle, throttleMouse: 0.6, throttleKey: true }, 1)
    expect(s.throttle).toBe(1)
    // ↑를 놓아도 그립은 그대로 60%로 돌아온다 (닫히는 시정수 0.25초라 1초 뒤 0.607)
    s = run(s, { ...idle, throttleMouse: 0.6 }, 1)
    expect(s.throttle).toBeLessThan(0.62)
    expect(s.throttle).toBeGreaterThan(0.6)
    s = run(s, { ...idle, throttleMouse: 0.6 }, 1)
    expect(s.throttle).toBeCloseTo(0.6, 3)
    // 반대로 그립을 놓아도 ↑가 눌려 있으면 전개
    s = run(s, { ...idle, throttleMouse: 0.6, throttleKey: true }, 1)
    s = run(s, { ...idle, throttleKey: true }, 1)
    expect(s.throttle).toBe(1)
    // 둘 다 놓으면 완전히 닫힌다
    s = run(s, idle, 2)
    expect(s.throttle).toBe(0)
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
