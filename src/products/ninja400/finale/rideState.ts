// 주행 상태 하나를 사운드·계기·3D 연출이 같이 본다.
// R3F 훅 밖(오디오 스케줄러, 계기 setInterval)에서도 읽으므로 스토어가 아니라 가변 싱글턴으로 둔다.
// 매 프레임 바뀌는 값을 리액트 상태로 올리면 장면 전체가 다시 그려지므로, 화면에 필요한 쪽이
// 각자 폴링(계기)하거나 드물게 바뀌는 값만 구독(stalled)한다.

import type { RideSim } from './rideModel'

export interface RideInput {
  throttleKey: boolean
  brakeKey: boolean
  clutchKey: boolean
}

export interface RideState extends RideSim {
  /** 그립 드래그가 쓰는 스로틀 (0~1). 키 입력과 큰 쪽이 이긴다 */
  throttleMouse: number
  /** 변속 연출 타이머: 부호는 방향(1 성공 · -1 걸림), 크기는 1에서 0으로 줄어든다 */
  shiftKick: number
}

export const ride: RideState = {
  throttle: 0,
  throttleMouse: 0,
  rpm: 0,
  gear: 0,
  clutch: 0,
  brake: 0,
  stalled: false,
  wheelRpm: 0,
  running: false,
  lowRpmFor: 0,
  shiftKick: 0,
}

export const rideInput: RideInput = { throttleKey: false, brakeKey: false, clutchKey: false }

/** 시동이 꺼지거나 조립으로 돌아갈 때 */
export function resetRide(): void {
  ride.throttle = 0
  ride.throttleMouse = 0
  ride.rpm = 0
  ride.gear = 0
  ride.clutch = 0
  ride.brake = 0
  ride.stalled = false
  ride.wheelRpm = 0
  ride.running = false
  ride.lowRpmFor = 0
  ride.shiftKick = 0
  rideInput.throttleKey = false
  rideInput.brakeKey = false
  rideInput.clutchKey = false
  notifyRide()
}

// 드물게 바뀌는 값(stalled)만 리액트에 알린다. 매 프레임 값은 알리지 않는다.
type Listener = () => void
const listeners = new Set<Listener>()

export function subscribeRide(fn: Listener): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function notifyRide(): void {
  for (const fn of [...listeners]) fn()
}
