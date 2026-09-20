// 주행 물리 v2 — 순수 함수. 프레임마다 RideControls가 돌리고 rideState에 옮겨 담는다.
// rpm은 더 이상 스로틀로 직접 만들지 않는다. 엔진 관성에 토크를 걸어 회전을 굴리고,
// 클러치를 전달 용량이 있는 결합(자유·슬립·직결)으로 두고, 차속을 따로 적분한다.
// 그래서 감속 변속에 rpm이 뛰고, 가속 변속에 떨어지고, 스로틀을 닫으면 엔진 브레이크가 걸린다.
// 실차(EX400G) 제원: 1차 감속 2.219, 2차(스프로킷) 2.929, 1~6단.
// 변속 패턴은 1-N-2-3-4-5-6 (N은 1단과 2단 사이 반 칸).

/** 변속기 기어비 (0번은 중립 자리) */
export const GEAR_RATIOS = [0, 2.929, 2.056, 1.619, 1.333, 1.154, 1.037]
/** 1차 감속비 (크랭크 → 클러치) */
export const PRIMARY = 2.219
/** 2차 감속비 (스프로킷) */
export const FINAL = 2.929
/** 공회전 (rpm) */
export const IDLE_RPM = 1300
/** 리미터 = 레드존 시작 (rpm) */
export const MAX_RPM = 12000
/** 뒷바퀴 유효 반지름 (m) */
export const REAR_TIRE_R_M = 0.306
/** 앞바퀴 유효 반지름 (m) */
export const FRONT_TIRE_R_M = 0.293
/**
 * 변속·재시동을 허용하는 클러치 기준.
 * 판정에 쓰는 것은 키 상태이고(rideState.clutchHeld), 이 값은 그 보조와 표시등 기준이다.
 */
export const CLUTCH_ENGAGED = 0.6

/** 차량 + 라이더 질량 (kg) */
const MASS = 243
/** 엔진 회전 관성 (kg·m²) */
const J_E = 0.03
/** 공기저항 계수 ½·ρ·CdA (N/(m/s)²) — 6단 전개가 190 km/h대에서 수렴하도록 잡았다 */
const CD_A = 0.5 * 1.2 * 0.36
/** 구름저항 (N). 굴러갈 때만 건다 */
const ROLL = 0.015 * MASS * 9.81
/** 앞브레이크 최대 제동력 (N) */
const BRAKE_N = 3200
/** 클러치 전달 용량 (Nm). 물림도를 곱해서 쓴다 */
const CLUTCH_CAP = 90
/** 이 차이 아래면 직결로 본다 (rad/s) */
const LOCK_EPS = 10
/** 슬립 토크가 포화되는 회전차 (rad/s) */
const SLIP_SOFT = 20
/** 결합 상태에서 이 아래로 떨어지면 즉시 시동이 꺼진다 (rpm) */
const STALL_HARD = 1000
/**
 * 물린 기어에서 스로틀을 닫은 채 이 아래로 STALL_AFTER_S 동안 머물면 꺼진다 (rpm).
 * 1050이던 때는 거버너가 붙잡는 1000~1050 사이에서만 죽어서, 러깅으로 엔진을 죽이려면
 * 몇 초씩 끌고 가야 했다(2단 4 m/s에 3.2초). 실차는 아이들 바로 아래에서 이미 꺼진다.
 */
const STALL_SOFT = 1200
/** 약한 스톨 판정에 필요한 시간 (초) */
const STALL_AFTER_S = 0.5
/** 약한 스톨을 보는 클러치 물림도 문턱 (0~1). 반클러치로 살살 물린 상태는 봐준다 */
const STALL_GRIP = 0.5
/** 약한 스톨을 보는 스로틀 문턱 (0~1). 스로틀을 열고 있으면 러깅이라도 죽이지 않는다 */
const STALL_THROTTLE = 0.05
/**
 * 엔진 브레이크 기본 토크 (Nm). 관성이 0.03 kg·m²로 작아서 3 + 2.5·rpm/1000이면
 * 클러치를 잡은 0.3~0.5초짜리 변속 사이에 rpm이 아이들까지 곤두박질쳤다 — 그래서 낮췄다.
 */
const EB_BASE = 2
/** 엔진 브레이크 회전 비례분 (Nm per 1000 rpm). 6000 rpm에서 11 Nm */
const EB_SLOPE = 1.5
/** 이 아래 스로틀이면 아이들 거버너가 붙는다 (0~1) */
const GOV_THROTTLE = 0.05
/**
 * 아이들 거버너 설정점 (rpm). 엔진 브레이크와 평형을 이루는 지점이 IDLE_RPM이 되도록 잡았다 —
 * 0.2·(S − r) = 2 + 1.5·r/1000 을 r = 1300에 대해 풀면 S = 1320.
 */
const IDLE_SETPOINT = 1320
/** 아이들 거버너 이득 (Nm per rpm) */
const GOV_GAIN = 0.2
/**
 * 아이들 거버너 최대 토크 (Nm) — 클러치가 끊겼거나 중립일 때.
 * 중립 공회전을 붙잡아 두는 몫이라 넉넉히 준다.
 */
const GOV_MAX_FREE = 15
/**
 * 아이들 거버너 최대 토크 (Nm) — 기어가 물려 클러치가 붙어 있을 때.
 * 15 Nm를 그대로 구동계로 흘리면 스로틀을 놓고 클러치를 놓아도 차가 아이들로 기어가서
 * rpm이 1300 밑으로 내려가지 않았다(시동이 안 꺼짐). 실차의 아이들 거버너도
 * 부하가 걸리면 이만큼 못 버틴다.
 */
const GOV_MAX_ENGAGED = 2
/** 전개 토크 곡선 (rpm, Nm@크랭크). 사이는 선형보간 */
const TORQUE_CURVE: [number, number][] = [
  [1000, 18],
  [2000, 24],
  [3000, 28],
  [4000, 31],
  [5000, 33],
  [6000, 35],
  [7000, 37],
  [8000, 38],
  [9000, 37.5],
  [10000, 36],
  [11000, 32],
  [12000, 26],
]

/** 스로틀 그립이 열리는 시정수 (초) */
const THROTTLE_OPEN_TAU = 0.25
/** 스로틀 그립이 닫히는 시정수 (초) */
const THROTTLE_CLOSE_TAU = 0.25
/** 클러치 레버 시정수 (초) */
const CLUTCH_TAU = 0.12
/** 브레이크 레버 시정수 (초) */
const BRAKE_TAU = 0.1
/** 스로틀은 목표까지 이만큼 남으면 목표에 붙인다 — 다 감은 그립은 전개, 놓은 그립은 완전히 닫힘 */
const THROTTLE_SNAP = 0.004
/** 시동을 걸지 않은(running=false) 엔진의 회전이 0으로 내려가는 시정수 (초). 스톨은 rpm을 바로 0으로 둔다 */
const OFF_TAU = 0.2
/** 물림/직결 전환이 프레임 길이에 흔들리지 않도록 내부에서 이만큼씩 쪼개 적분한다 (초) */
const SUB_DT = 1 / 240

/** 최대 뱅크각 (rad = 38°). 키를 오래 누를수록 여기까지 눕고 더는 안 눕는다 */
export const LEAN_MAX = (38 * Math.PI) / 180
/** 눕는 시정수 (초) */
const LEAN_IN_TAU = 0.35
/** 세우는 시정수 (초) */
const LEAN_OUT_TAU = 0.4
/** 이 차속 아래에서는 목표 뱅크각을 0으로 둔다 (m/s) — 선 채로는 못 기운다 */
const LEAN_MIN_SPEED = 1
/** 중력가속도 (m/s²) */
const G = 9.81

const RPM_PER_RAD_S = 60 / (2 * Math.PI)
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

export interface RideSim {
  rpm: number
  throttle: number
  clutch: number
  brake: number
  gear: number
  /** 차속 (m/s) */
  speed: number
  /** 달린 거리 (m) */
  distance: number
  stalled: boolean
  running: boolean
  /** STALL_SOFT 아래로 머문 시간 (초) */
  lowRpmFor: number
  /** 뱅크각 (rad). + = 오른쪽 · − = 왼쪽 */
  lean: number
}

export interface RideInputs {
  throttleKey: boolean
  brakeKey: boolean
  clutchKey: boolean
  /** 그립 드래그. 키 입력과 큰 쪽이 이긴다 */
  throttleMouse: number
  /** D — 왼쪽으로 기울이기 */
  leanLeftKey: boolean
  /** F — 오른쪽으로 기울이기 */
  leanRightKey: boolean
}

/**
 * 뱅크각에서 나오는 요 레이트 (rad/s). 바이크 기구학: 횡가속도 = g·tan(lean)이고
 * 그것을 차속으로 나누면 선회 각속도다. 저속에서 발산하지 않도록 1 m/s로 바닥을 깐다.
 */
export function turnRate(leanRad: number, speedMps: number): number {
  return (G * Math.tan(leanRad)) / Math.max(speedMps, 1)
}

/** 1 → N → 2 → … → 6. 6단에서는 더 올라가지 않는다 */
export const shiftUp = (g: number) => (g === 1 ? 0 : g === 0 ? 2 : Math.min(6, g + 1))
/** 6 → … → 2 → N → 1. 1단에서는 더 내려가지 않는다 */
export const shiftDown = (g: number) => (g === 0 ? 1 : g === 2 ? 0 : g === 1 ? 1 : g - 1)

/** 총감속비(엔진 회전 / 바퀴 회전). N이면 Infinity */
export const gearRatio = (gear: number) => (gear === 0 ? Infinity : PRIMARY * GEAR_RATIOS[gear] * FINAL)

/** 클러치 물림도 0~1. 레버 0.2까지는 완전히 물리고 0.7을 넘기면 끊긴다 */
export const engagement = (clutch: number) => clamp01((0.7 - clutch) / 0.5)

/** 뒷바퀴 회전 (rpm) — 상태가 아니라 차속에서 파생된다 */
export const wheelRpm = (speed: number) => (speed / (2 * Math.PI * REAR_TIRE_R_M)) * 60
/** 앞바퀴 회전 (rpm) */
export const frontWheelRpm = (speed: number) => (speed / (2 * Math.PI * FRONT_TIRE_R_M)) * 60
/** 차속 (km/h) */
export const speedKmh = (speed: number) => speed * 3.6

/** 물린 기어가 엔진에 거는 부하 0~1 (사운드용). 중립이거나 클러치를 다 잡으면 0 */
export const rideLoad = (s: Pick<RideSim, 'gear' | 'clutch' | 'throttle'>) =>
  s.gear === 0 ? 0 : engagement(s.clutch) * s.throttle

/** 전개 토크 (Nm@크랭크). 곡선 밖은 양 끝 값으로 잡는다 */
export function torqueWot(rpm: number): number {
  const last = TORQUE_CURVE.length - 1
  if (rpm <= TORQUE_CURVE[0][0]) return TORQUE_CURVE[0][1]
  if (rpm >= TORQUE_CURVE[last][0]) return TORQUE_CURVE[last][1]
  for (let i = 1; i <= last; i++) {
    const [r1, t1] = TORQUE_CURVE[i]
    if (rpm <= r1) {
      const [r0, t0] = TORQUE_CURVE[i - 1]
      return t0 + ((t1 - t0) * (rpm - r0)) / (r1 - r0)
    }
  }
  return TORQUE_CURVE[last][1]
}

/** 1차 시정수 응답 */
const approach = (v: number, target: number, tau: number, dt: number) => v + (target - v) * (1 - Math.exp(-dt / tau))

/**
 * 순 엔진 토크 (Nm). 리미터·엔진 브레이크·아이들 거버너를 모두 포함한다.
 * grip은 클러치 물림도 0~1 — 물려 있을수록 거버너 상한이 GOV_MAX_ENGAGED로 내려간다.
 */
function engineTorque(rpm: number, throttle: number, grip: number): number {
  const brake = EB_BASE + (EB_SLOPE * rpm) / 1000
  let t = (rpm > MAX_RPM ? 0 : torqueWot(rpm)) * throttle - brake * (1 - throttle)
  if (throttle < GOV_THROTTLE) {
    const govMax = GOV_MAX_FREE * (1 - grip) + GOV_MAX_ENGAGED * grip
    t += Math.min(Math.max(GOV_GAIN * (IDLE_SETPOINT - rpm), 0), govMax)
  }
  return t
}

export function stepRide(s: RideSim, input: RideInputs, dt: number): RideSim {
  const throttleTarget = Math.max(input.throttleKey ? 1 : 0, input.throttleMouse)
  let throttle = approach(
    s.throttle,
    throttleTarget,
    throttleTarget > s.throttle ? THROTTLE_OPEN_TAU : THROTTLE_CLOSE_TAU,
    dt,
  )
  if (Math.abs(throttle - throttleTarget) < THROTTLE_SNAP) throttle = throttleTarget
  const clutch = approach(s.clutch, input.clutchKey ? 1 : 0, CLUTCH_TAU, dt)
  const brake = approach(s.brake, input.brakeKey ? 1 : 0, BRAKE_TAU, dt)

  const gear = s.gear
  const ratio = gearRatio(gear)
  const r = REAR_TIRE_R_M
  const grip = gear === 0 ? 0 : engagement(clutch)
  const cap = CLUTCH_CAP * grip

  let omega = s.rpm / RPM_PER_RAD_S
  let speed = s.speed
  let distance = s.distance
  let stalled = s.stalled
  let lowRpmFor = s.lowRpmFor

  const steps = Math.max(1, Math.ceil(dt / SUB_DT))
  const h = dt / steps
  for (let i = 0; i < steps; i++) {
    const alive = s.running && !stalled
    const prevRpm = omega * RPM_PER_RAD_S
    // 저항력 (N). 구름·제동은 굴러갈 때만 — 멈춘 차를 뒤로 밀지 않는다.
    const res = CD_A * speed * speed + (speed > 0 ? ROLL + brake * BRAKE_N : 0)

    if (!alive || grip <= 0) {
      // 자유 — 엔진과 차체가 따로 논다
      if (alive) omega += (engineTorque(omega * RPM_PER_RAD_S, throttle, grip) / J_E) * h
      speed = Math.max(0, speed - (res / MASS) * h)
    } else {
      const torque = engineTorque(omega * RPM_PER_RAD_S, throttle, grip)
      const sync = (speed / r) * ratio
      const slip = omega - sync
      // 직결을 버틸 만한 요구 토크인지 — 저항을 엔진 축으로 환산해서 본다
      const load = (res * r) / ratio
      if (Math.abs(slip) <= LOCK_EPS && Math.abs(torque - load) <= cap) {
        // 직결 진입 — 남은 회전차는 엔진이 접는다. 차체를 엔진 축으로 환산한 관성이
        // J_E의 17배쯤이라(6단 기준) 붙는 쪽은 엔진이다. 이미 직결이면 slip이 0이라 무연산.
        omega = sync
        // 직결 — 엔진과 차체가 한 덩어리로 돈다
        const jEff = J_E + (MASS * r * r) / (ratio * ratio)
        omega += ((torque - load) / jEff) * h
        if (omega < 0) omega = 0
        speed = (omega * r) / ratio
      } else {
        // 슬립 — 클러치가 용량만큼만 전한다
        const clutchTorque = cap * Math.tanh(slip / SLIP_SOFT)
        omega += ((torque - clutchTorque) / J_E) * h
        if (omega < 0) omega = 0
        speed = Math.max(0, speed + (((clutchTorque * ratio) / r - res) / MASS) * h)
      }
    }

    distance += speed * h
    if (alive) {
      const rpm = omega * RPM_PER_RAD_S
      // 하드 스톨은 "위에서 떨어져 내려온" 경우만이다. 재시동 직후 0에서 회전이 올라오는
      // 동안에는 걸지 않는다 — 기어를 문 채 시동을 걸면 손이 클러치를 다 잡기 전에
      // 다시 꺼져서 영영 걸리지 않는다. 그 구간은 약한 판정(STALL_SOFT)이 받는다.
      if (grip > 0 && rpm < STALL_HARD && prevRpm >= STALL_HARD) {
        stalled = true
        lowRpmFor = 0
      } else if (grip > STALL_GRIP && throttle < STALL_THROTTLE && rpm < STALL_SOFT) {
        lowRpmFor += h
        if (lowRpmFor >= STALL_AFTER_S) {
          stalled = true
          lowRpmFor = 0
        }
      } else {
        lowRpmFor = 0
      }
    } else {
      lowRpmFor = 0
    }
  }

  let rpm = omega * RPM_PER_RAD_S
  if (!s.running || stalled) {
    rpm = approach(rpm, 0, OFF_TAU, dt)
    if (rpm < 30) rpm = 0
  }
  // 수치가 한 번이라도 깨지면 계기 바늘·사운드가 영영 NaN에 얼어붙는다 — 여기서 끊는다
  if (!Number.isFinite(rpm)) rpm = 0

  // 기울이기 — D가 왼쪽(−) · F가 오른쪽(+). 누르고 있는 동안 캡까지 자라고 놓으면 돌아온다.
  const leanDir = (input.leanRightKey ? 1 : 0) - (input.leanLeftKey ? 1 : 0)
  const leanTarget = speed < LEAN_MIN_SPEED ? 0 : leanDir * LEAN_MAX
  let lean = approach(s.lean, leanTarget, leanTarget === 0 ? LEAN_OUT_TAU : LEAN_IN_TAU, dt)
  // 1차 응답은 목표를 넘지 않지만, 캡이 줄어드는 경우(감속으로 목표가 0이 됨)까지 잘라 둔다
  if (lean > LEAN_MAX) lean = LEAN_MAX
  else if (lean < -LEAN_MAX) lean = -LEAN_MAX

  return { ...s, rpm: stalled ? 0 : rpm, throttle, clutch, brake, speed, distance, stalled, lowRpmFor, lean }
}
