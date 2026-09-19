import { useEffect } from 'react'
import { useAssemblyStore } from '../../../engine/context'
import { requestCameraView } from '../../../engine/scene/controlsRef'
import { Key } from './Key'
import { Starter } from './Starter'
import { Throttle } from './Throttle'

/** 조립 완료 후: 키 → 시동 버튼 → 스로틀. 카메라도 여기서 옮긴다. */
export function NinjaFinale() {
  return (
    <>
      <Key />
      <Starter />
      <Throttle />
      <FinaleCamera />
    </>
  )
}

/** complete: 계기판 주변, running: 차 전체가 보이는 뷰. 사용자가 조작 중이면 CameraRig의 규칙대로 취소된다. */
function FinaleCamera() {
  const store = useAssemblyStore()
  useEffect(() => {
    return store.subscribe((s, prev) => {
      if (s.phase === prev.phase) return
      if (s.phase === 'complete') requestCameraView({ azimuth: 15, polar: 55, distance: 2400 }, [520, 950, 0])
      else if (s.phase === 'running') requestCameraView({ azimuth: 35, polar: 62, distance: 3800 }, [0, 550, 0])
    })
  }, [store])
  return null
}
