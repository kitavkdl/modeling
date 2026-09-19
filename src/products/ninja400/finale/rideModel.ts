// 주행 물리 — 순수 함수. 프레임마다 RideControls가 돌리고 rideState에 옮겨 담는다.
// 실차(EX400G) 기어비: 1차 감속 3.087, 2차(스프로킷) 3.071, 1~6단.
// 변속 패턴은 1-N-2-3-4-5-6 (N은 1단과 2단 사이 반 칸).

export const GEAR_RATIOS = [0, 2.929, 1.947, 1.545, 1.333, 1.185, 1.095]
export const PRIMARY = 3.087
export const FINAL = 3.071
export const IDLE_RPM = 1300
export const MAX_RPM = 10000

/** 이 아래로 떨어진 채 STALL_AFTER_S가 지나면 시동이 꺼진다 */
const STALL_RPM = 1100
const STALL_AFTER_S = 0.4
/** 물린 기어가 엔진을 끄는 정도 (rpm) */
const DRAG_RPM = 600
/** 값이 목표에 이 정도까지 붙으면 그대로 목표로 둔다 — 아이들 제어기가 붙잡는 셈 */
const RPM_SNAP = 25
/** 클러치가 다 물리면 바퀴는 엔진에 거의 직결이다 — 따라가는 시정수 (초) */
const WHEEL_TAU = 0.1
/** 스로틀은 이 아래면 완전히 닫힌 것으로 본다 */
const THROTTLE_SNAP = 0.004

export interface RideSim {
  rpm: number
  throttle: number
  clutch: number
  brake: number
  gear: number
  wheelRpm: number
  stalled: boolean
  running: boolean
  /** STALL_RPM 아래로 머문 시간 (초) */
  lowRpmFor: number
}

export interface RideInputs {
  throttleKey: boolean
  brakeKey: boolean
  clutchKey: boolean
  /** 그립 드래그. 키 입력과 큰 쪽이 이긴다 */
  throttleMouse: number
}

/** 1 → N → 2 → … → 6. 6단에서는 더 올라가지 않는다 */
export const shiftUp = (g: number) => (g === 1 ? 0 : g === 0 ? 2 : Math.min(6, g + 1))
/** 6 → … → 2 → N → 1. 1단에서는 더 내려가지 않는다 */
export const shiftDown = (g: number) => (g === 0 ? 1 : g === 2 ? 0 : g === 1 ? 1 : g - 1)

/** 기어비(엔진 회전 / 바퀴 회전). N이면 Infinity */
export const gearRatio = (gear: number) => (gear === 0 ? Infinity : PRIMARY * GEAR_RATIOS[gear] * FINAL)

/** 1차 시정수 응답 */
const approach = (v: number, target: number, tau: number, dt: number) => v + (target - v) * (1 - Math.exp(-dt / tau))

export function stepRide(s: RideSim, input: RideInputs, dt: number): RideSim {
  const throttleTarget = Math.max(input.throttleKey ? 1 : 0, input.throttleMouse)
  let throttle = approach(s.throttle, throttleTarget, throttleTarget > s.throttle ? 0.35 : 0.25, dt)
  if (throttle < THROTTLE_SNAP && throttleTarget === 0) throttle = 0
  const clutch = approach(s.clutch, input.clutchKey ? 1 : 0, 0.12, dt)
  const brake = approach(s.brake, input.brakeKey ? 1 : 0, 0.1, dt)
  const inGear = s.gear !== 0
  /** 0 = 완전히 잡음, 1 = 완전히 풀림 */
  const clutchOpen = 1 - clutch
  const engaged = inGear ? clutchOpen : 0
  const load = engaged * 0.6

  let rpm = s.rpm
  let stalled = s.stalled
  let lowRpmFor = s.lowRpmFor
  if (!s.running || stalled) {
    rpm = approach(rpm, 0, 0.2, dt)
    if (rpm < 30) rpm = 0
    lowRpmFor = 0
  } else {
    const target = IDLE_RPM + throttle * (MAX_RPM - IDLE_RPM) - engaged * (1 - throttle) * DRAG_RPM
    const tau = target > rpm ? 0.25 + 0.35 * load : 0.25
    rpm = approach(rpm, target, tau, dt)
    if (Math.abs(rpm - target) < RPM_SNAP) rpm = target
    lowRpmFor = inGear && clutchOpen > 0.7 && rpm < STALL_RPM ? lowRpmFor + dt : 0
    if (lowRpmFor >= STALL_AFTER_S) {
      stalled = true
      lowRpmFor = 0
    }
  }

  // 브레이크는 목표 자체를 눌러서(1 - brake) 클러치가 물려 있어도 바퀴를 세운다.
  const wheelTarget = inGear && !stalled ? (rpm / gearRatio(s.gear)) * engaged * (1 - brake) : 0
  let wheelRpm = approach(s.wheelRpm, wheelTarget, WHEEL_TAU, dt)
  if (brake > 0.5) wheelRpm = approach(wheelRpm, 0, 0.2, dt)
  if (wheelRpm < 0.5 && wheelTarget === 0) wheelRpm = 0
  return { ...s, rpm: stalled ? 0 : rpm, throttle, clutch, brake, wheelRpm, stalled, lowRpmFor }
}
