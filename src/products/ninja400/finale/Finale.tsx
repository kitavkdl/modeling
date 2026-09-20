import { useEffect } from 'react'
import { useAssembly, useAssemblyStore } from '../../../engine/context'
import { requestCameraView } from '../../../engine/scene/controlsRef'
import * as engineSound from '../audio/engineSound'
import { RefineSweep } from '../render/Refine'
import { preloadRideModel, RideModel } from '../render/RideModel'
import { IGNITION } from '../render/rideLayout'
import { RideFog, RoadTiles } from '../render/RoadTiles'
import { RideControls } from './RideControls'
import { CRANK_S } from './rideModel'
import { resetRide, ride } from './rideState'
import { Starter } from './Starter'
import { Throttle } from './Throttle'

/** 키(정규 부품)를 꽂은 뒤: 시동 버튼 → 스로틀. 실물 모델과 카메라도 여기서 얹는다. */
export function NinjaFinale() {
  // 엔진음 뱅크와 실물 모델(glb)은 제품이 뜰 때 한 번만 받아 둔다 — 시동을 누르는 순간, 키를 꽂는
  // 순간엔 이미 디코드가 끝나 있어야 한다. glb preload를 RideModel 모듈 최상위가 아니라 여기서
  // 부르는 이유는 그 모듈이 제품 목록을 통해 App에 정적으로 딸려 들어가기 때문이다 —
  // 최상위면 닌자 400을 고르지도 않은 화면에서 5 MB를 내려받는다.
  // 오디오 쪽은 suspended 상태의 AudioContext를 만들기만 한다. 소리를 내지 않으니 자동재생 정책에
  // 막히지는 않지만, Chrome은 제스처 전에 만들어진 컨텍스트에 경고를 한 줄 남긴다.
  // 실제 resume은 시동 버튼 클릭(engineSound.start)에서 일어난다.
  useEffect(() => {
    void engineSound.preload()
    preloadRideModel()
  }, [])
  return (
    <>
      <RideModel />
      {/* 조립 중에도 떠 있어야 한다 — 스윕 시작 조건(키만 남음)이 assembly 단계 안에서 걸린다 */}
      <RefineSweep />
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
    // 첫 시동도 재시동과 똑같이 크랭킹 0.6초를 거친다 — 계기는 ~300 rpm, 소리는 스타터 원샷
    ride.crankFor = CRANK_S
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
      if (s.phase === 'keyed') requestCameraView({ azimuth: 15, polar: 55, distance: 2400 }, IGNITION)
      // running: 뒤 왼쪽 3/4 낮은 시점(azimuth 90 = 정면, 270 = 정후방 · 215면 왼쪽 뒤). 바닥이 흘러가는 것이 보인다
      else if (s.phase === 'running') requestCameraView({ azimuth: 215, polar: 72, distance: 3400 }, [0, 600, 0])
    })
  }, [store])
  return null
}
