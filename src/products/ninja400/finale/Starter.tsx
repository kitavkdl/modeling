import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import type * as THREE from 'three'
import { useAssembly, useAssemblyStore, useMaterials, useProduct } from '../../../engine/context'
import { isAssemblyHidden } from '../../../engine/store'
import { MM } from '../../../engine/types'
import * as engineSound from '../audio/engineSound'
import { STARTER_HOUSING } from '../render/rideLayout'
import { CRANK_S } from './rideModel'
import { clutchHeld, notifyRide, ride, subscribeRide } from './rideState'

// 우측 클립온의 스위치 하우징 자리. keyed에서 누르면 시동이 걸린다.
// 엔진 사운드 시작/정지는 Finale의 phase 효과에서 처리한다 — 건너뛰기(HUD → advancePhase)로
// running에 들어와도 시동이 걸리게 하려면 클릭 이벤트가 아니라 phase 자체에 매야 한다.
// 예외가 하나 있다: 주행 중 시동이 꺼지면(ride.stalled) phase는 running 그대로인 채
// 다시 누를 수 있게 되고, 그때는 여기서 직접 다시 건다. 기어가 들어간 채로는 거부한다.
//
// 그리는 것: 실물 모델(ZX-6R)이 서 있는 동안에는 **아무 형상도 그리지 않는다.** 예전에는
// 30 mm 검은 상자에 빨간 정육면체를 얹어 두었는데, 실물 모델에 이미 스위치 뭉치가 있어서
// 조잡한 블록 두 개가 그 위에 덧붙어 보였다(사용자 스크린샷). 대신 보이지 않는 구(히트 영역)와,
// 누를 수 있을 때만 맥동하는 작은 붉은 점광으로 "여기"를 알린다.
// 실물 모델을 못 받아 절차 조립체로 돌아간 경우(스펙 §1.3)에만 예전의 상자를 그대로 쓴다.

/** 스위치 하우징 중심 (mm) — 실물 모델에서 잰 오른쪽 스위치 뭉치 자리 */
const HOUSING = STARTER_HOUSING
const BUTTON_COLOR = '#b3261e'
/** 거부됐을 때 흔들리는 시간(초)과 진폭(mm) */
const REFUSE_S = 0.3
const REFUSE_MM = 4
/** 보이지 않는 히트 영역 반지름 (mm). 실물 스위치 뭉치를 넉넉히 덮는다 */
const HIT_R_MM = 22
/** 점광 색 — 시동 버튼의 빨강 */
const LAMP_COLOR = '#ff3b30'
/**
 * 점광이 닿는 거리 (mm). 씬 단위가 1 unit = 10 mm(MM = 0.1)라 "0.6 units"는 6 mm밖에 안 된다 —
 * 스위치 하나도 못 덮는다. 손이 닿는 범위인 80 mm(= 8 units)로 잡는다.
 */
const LAMP_DISTANCE_MM = 80
/**
 * 점광 세기. three r155+의 물리 단위(칸델라)라 조도는 세기/거리²이고, 이 장면의 거리가
 * 미터가 아니라 10 mm 단위로 세어진다. 키라이트(directional 2.6)와 견줘 20 mm(2 units)
 * 떨어진 표면에서 비슷한 밝기가 되도록 6에서 시작한다 — 6/2² = 1.5.
 */
const LAMP_INTENSITY = 6
/** 호버하면 이만큼 곱한다 */
const LAMP_HOVER = 1.8
/** 맥동 주파수 (Hz)와 깊이 (0~1) */
const LAMP_HZ = 1.5
const LAMP_DEPTH = 0.45

export function Starter() {
  const store = useAssemblyStore()
  const product = useProduct()
  const materials = useMaterials()
  const phase = useAssembly((s) => s.phase)
  // 실물 모델이 서 있는가. 못 받았으면(rideModelFailed) false가 되어 절차 상자로 돌아간다.
  const realModel = useAssembly((s) => isAssemblyHidden(product, s))
  const stalled = useSyncExternalStore(subscribeRide, () => ride.stalled, () => false)
  const [hover, setHover] = useState(false)
  const housing = useRef<THREE.Group>(null)
  const lamp = useRef<THREE.PointLight>(null)
  const refusedFor = useRef(0)

  const armed = phase === 'keyed' || (phase === 'running' && stalled)

  const onPointerDown = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      // 왼쪽 버튼만 받는다. OrbitControls는 오른쪽 드래그가 팬·가운데가 줌이라, 그 시작점이
      // 시동 버튼 위였다는 이유만으로 꺼진 엔진이 조용히 다시 걸려 아이들(1,300 rpm)로 올라갔다.
      if (e.button !== 0) return
      const current = store.getState().phase
      if (current === 'keyed') {
        e.stopPropagation()
        setHover(false)
        document.body.style.cursor = ''
        store.getState().advancePhase()
        return
      }
      if (current !== 'running' || !ride.stalled) return
      e.stopPropagation()
      if (ride.gear !== 0 && !clutchHeld()) {
        refusedFor.current = REFUSE_S
        return
      }
      ride.stalled = false
      ride.running = true
      ride.lowRpmFor = 0
      ride.fuelCut = false
      // 스타터가 크랭크를 돌리는 한 박자. 이 동안 rideModel은 연소 없이 300 rpm으로만 돌린다 —
      // 예전에는 거버너가 한 프레임에 아이들까지 끌어올려서 버튼을 누르는 즉시 엔진이 "생겼다".
      ride.crankFor = CRANK_S
      engineSound.start()
      notifyRide()
    },
    [store],
  )

  const onPointerOver = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      const current = store.getState().phase
      if (current !== 'keyed' && !(current === 'running' && ride.stalled)) return
      e.stopPropagation()
      setHover(true)
      document.body.style.cursor = 'pointer'
    },
    [store],
  )
  const onPointerOut = useCallback(() => {
    setHover(false)
    document.body.style.cursor = ''
  }, [])

  // 호버한 채로 사라지면(실행 취소·초기화·단계 전환) onPointerOut이 오지 않아 포인터 커서가 남는다
  useEffect(() => {
    return () => {
      document.body.style.cursor = ''
    }
  }, [])

  useFrame((state, dt) => {
    const g = housing.current
    if (g) {
      if (refusedFor.current <= 0) {
        g.position.z = HOUSING[2] * MM
      } else {
        refusedFor.current = Math.max(0, refusedFor.current - dt)
        const k = refusedFor.current / REFUSE_S
        g.position.z = (HOUSING[2] + Math.sin(k * Math.PI * 6) * REFUSE_MM * k) * MM
      }
    }
    const l = lamp.current
    // 맥동은 1.5 Hz 한 번. 누를 수 있을 때만 켠다 — 시동이 걸려 있는 동안 계기 옆에서
    // 빨간 점이 깜빡이면 경고등으로 읽힌다.
    if (l) {
      const pulse = 1 - LAMP_DEPTH * (0.5 - 0.5 * Math.cos(2 * Math.PI * LAMP_HZ * state.clock.elapsedTime))
      l.intensity = armed ? LAMP_INTENSITY * pulse * (hover ? LAMP_HOVER : 1) : 0
    }
  })

  if (phase !== 'keyed' && phase !== 'running') return null

  const pressed = phase === 'running' && !stalled
  const buttonX = (pressed ? -18 : -21) * MM
  return (
    <group ref={housing} position={[HOUSING[0] * MM, HOUSING[1] * MM, HOUSING[2] * MM]}>
      {realModel ? (
        // 실물 모델에는 이미 스위치 뭉치가 있다 — 위치만 빛으로 알린다
        <pointLight ref={lamp} color={LAMP_COLOR} intensity={0} distance={LAMP_DISTANCE_MM * MM} />
      ) : (
        // 실물 모델을 못 받았을 때의 절차 조립체용 상자 + 빨간 버튼
        <>
          <mesh material={materials.get('plastic_black')} castShadow>
            <boxGeometry args={[30 * MM, 30 * MM, 40 * MM]} />
          </mesh>
          <mesh position={[buttonX, 0, 0]} castShadow>
            <boxGeometry args={[12 * MM, 12 * MM, 14 * MM]} />
            <meshStandardMaterial
              color={BUTTON_COLOR}
              emissive={BUTTON_COLOR}
              emissiveIntensity={armed && hover ? 0.6 : armed ? 0.3 : 0.15}
              roughness={0.5}
            />
          </mesh>
        </>
      )}
      {/* 누르는 자리 — 보이지 않는 구 하나가 두 경우 모두의 히트 영역이다 */}
      <mesh onPointerDown={onPointerDown} onPointerOver={onPointerOver} onPointerOut={onPointerOut}>
        <sphereGeometry args={[HIT_R_MM * MM, 12, 8]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  )
}
