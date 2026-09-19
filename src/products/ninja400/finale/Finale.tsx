import { useEffect } from 'react'
import { useAssembly, useAssemblyStore } from '../../../engine/context'
import { requestCameraView } from '../../../engine/scene/controlsRef'
import * as engineSound from '../audio/engineSound'
import { Starter } from './Starter'
import { resetThrottle } from './throttleState'
import { Throttle } from './Throttle'

/** 키(정규 부품)를 꽂은 뒤: 시동 버튼 → 스로틀. 카메라도 여기서 옮긴다. */
export function NinjaFinale() {
  return (
    <>
      <Starter />
      <Throttle />
      <EngineEffect />
      <FinaleCamera />
    </>
  )
}

/**
 * running 진입/이탈에 엔진 사운드와 진동을 건다 — phase 자체에 매어 두어야
 * 건너뛰기(HUD → advancePhase)로 running에 들어와도 시동이 걸린다.
 * (EngineShake는 phase === 'running'을 직접 구독하므로 진동은 따로 손대지 않아도 된다.)
 */
function EngineEffect() {
  const running = useAssembly((s) => s.phase === 'running')
  useEffect(() => {
    if (!running) return
    engineSound.start()
    return () => {
      engineSound.stop()
      resetThrottle()
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
      else if (s.phase === 'running') requestCameraView({ azimuth: 35, polar: 62, distance: 3800 }, [0, 550, 0])
    })
  }, [store])
  return null
}
