import { useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import { useAssembly } from '../../../engine/context'
import * as engineSound from '../audio/engineSound'
import { shiftDown, shiftUp, stepRide } from './rideModel'
import { notifyRide, ride, rideInput } from './rideState'

// 키보드 주행 조작. 그리는 것은 없고 window 이벤트와 매 프레임 계산만 맡는다.
//   ↑ 스로틀 · ↓ 앞브레이크 · Shift 클러치 · ← 시프트 다운 · → 시프트 업
// Enter(건너뛰기)와 Ctrl+Z(실행 취소)는 엔진 HUD가 이미 쓰므로 건드리지 않는다.

/** 변속 연출이 0으로 돌아오는 시간 (초) */
const KICK_S = 0.15
/** 탭이 멈췄다 돌아왔을 때 한 프레임에 몰아서 계산하지 않도록 */
const MAX_DT = 0.1
/** 이만큼 잡아야 기어가 들어간다 */
const CLUTCH_FOR_SHIFT = 0.6

/** 입력 요소에 포커스가 있으면 주행 조작으로 삼지 않는다 */
function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || typeof el.tagName !== 'string') return false
  const tag = el.tagName.toUpperCase()
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true
}

export function RideControls() {
  const running = useAssembly((s) => s.phase === 'running')

  useEffect(() => {
    if (!running) return
    const clearKeys = () => {
      rideInput.throttleKey = false
      rideInput.brakeKey = false
      rideInput.clutchKey = false
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (typing(e.target)) return
      switch (e.code) {
        case 'ArrowUp':
          e.preventDefault()
          rideInput.throttleKey = true
          return
        case 'ArrowDown':
          e.preventDefault()
          rideInput.brakeKey = true
          return
        case 'ShiftLeft':
        case 'ShiftRight':
          e.preventDefault()
          rideInput.clutchKey = true
          return
        case 'ArrowLeft':
        case 'ArrowRight': {
          e.preventDefault()
          if (e.repeat) return
          if (ride.clutch < CLUTCH_FOR_SHIFT) {
            // 클러치를 안 잡았다 — 기어가 걸리는 시늉만
            ride.shiftKick = -1
            return
          }
          ride.gear = e.code === 'ArrowRight' ? shiftUp(ride.gear) : shiftDown(ride.gear)
          ride.shiftKick = 1
          return
        }
        default:
          return
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      switch (e.code) {
        case 'ArrowUp':
          rideInput.throttleKey = false
          return
        case 'ArrowDown':
          rideInput.brakeKey = false
          return
        case 'ShiftLeft':
        case 'ShiftRight':
          rideInput.clutchKey = false
          return
        default:
          return
      }
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', clearKeys)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', clearKeys)
      clearKeys()
    }
  }, [running])

  useFrame((_, raw) => {
    if (!running) return
    const dt = Math.min(raw, MAX_DT)
    const wasStalled = ride.stalled
    const next = stepRide(ride, { ...rideInput, throttleMouse: ride.throttleMouse }, dt)
    ride.rpm = next.rpm
    ride.throttle = next.throttle
    ride.clutch = next.clutch
    ride.brake = next.brake
    ride.wheelRpm = next.wheelRpm
    ride.stalled = next.stalled
    ride.lowRpmFor = next.lowRpmFor
    if (ride.shiftKick !== 0) {
      const left = Math.abs(ride.shiftKick) - dt / KICK_S
      ride.shiftKick = left <= 0 ? 0 : Math.sign(ride.shiftKick) * left
    }
    // Task 7에서 setRpm/setLoad가 생기면 여기서 같이 넘긴다.
    engineSound.setThrottle(ride.stalled ? 0 : ride.throttle)
    if (!wasStalled && ride.stalled) {
      engineSound.stop()
      notifyRide()
    }
  })

  return null
}
