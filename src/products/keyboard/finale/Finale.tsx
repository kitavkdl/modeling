import { useEffect } from 'react'
import { useAssemblyStore } from '../../../engine/context'
import { requestCameraView } from '../../../engine/scene/controlsRef'
import { Cable, PowerSequence } from './Cable'
import { PlateGlow } from './PlateGlow'

/** 완료 후: 케이블 + 전원 시퀀스 + 플레이트 글로우. 완료·부팅 시 카메라도 여기서 옮긴다. */
export function KeyboardFinale() {
  return (
    <>
      <PlateGlow />
      <Cable />
      <PowerSequence />
      <FinaleCamera />
    </>
  )
}

/** complete: 케이블이 보이는 뷰, booting: 정면 뷰. 사용자가 조작 중이면 CameraRig의 규칙대로 취소된다. */
function FinaleCamera() {
  const store = useAssemblyStore()
  useEffect(() => {
    return store.subscribe((s, prev) => {
      if (s.phase === prev.phase) return
      if (s.phase === 'complete') requestCameraView({ azimuth: -32, polar: 52, distance: 640 }, [0, 15, 0])
      else if (s.phase === 'booting') requestCameraView({ azimuth: 8, polar: 46, distance: 540 }, [0, 15, 0])
    })
  }, [store])
  return null
}
