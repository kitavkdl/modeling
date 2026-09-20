import { useEffect } from 'react'
import { useAssembly, useAssemblyStore } from '../../../engine/context'
import { requestCameraView } from '../../../engine/scene/controlsRef'
import * as engineSound from '../audio/engineSound'
import { RideFog, RoadTiles } from '../render/RoadTiles'
import { RideControls } from './RideControls'
import { resetRide, ride } from './rideState'
import { Starter } from './Starter'
import { Throttle } from './Throttle'

/** 키(정규 부품)를 꽂은 뒤: 시동 버튼 → 스로틀. 카메라도 여기서 옮긴다. */
export function NinjaFinale() {
  return (
    <>
      <Starter />
      <Throttle />
      <RideControls />
      <RoadTiles />
      <RideFog />
      <EngineEffect />
      <FinaleCamera />
    </>
  )
}

/**
 * running 진입/이탈에 엔진 사운드와 주행 상태를 건다 — phase 자체에 매어 두어야
 * 건너뛰기(HUD → advancePhase)로 running에 들어와도 시동이 걸린다.
 * 시동이 꺼지는(stalled) 동안에도 phase는 running 그대로다. 사운드를 끊는 것은
 * RideControls가, 다시 거는 것은 Starter가 맡는다.
 */
function EngineEffect() {
  const running = useAssembly((s) => s.phase === 'running')
  useEffect(() => {
    if (!running) return
    resetRide()
    ride.running = true
    engineSound.start()
    return () => {
      engineSound.stop()
      resetRide()
    }
  }, [running])
  return null
}

/** keyed: 계기판 주변, running: 차 전체가 보이는 뷰. 사용자가 조작 중이면 CameraRig의 규칙대로 취소된다. */
function FinaleCamera() {
  const store = useAssemblyStore()
  useEffect(() => {
    return store.subscribe((s, prev) => {
      if (s.phase === prev.phase) return
      if (s.phase === 'keyed') requestCameraView({ azimuth: 15, polar: 55, distance: 2400 }, [520, 950, 0])
      // running: 뒤 왼쪽 3/4 낮은 시점(azimuth 90 = 정면, 270 = 정후방 · 215면 왼쪽 뒤). 바닥이 흘러가는 것이 보인다
      else if (s.phase === 'running') requestCameraView({ azimuth: 215, polar: 72, distance: 3400 }, [0, 600, 0])
    })
  }, [store])
  return null
}
