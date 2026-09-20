import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import type * as THREE from 'three'
import { useAssembly, useAssemblyStore, useMaterials } from '../../../engine/context'
import { MM } from '../../../engine/types'
import * as engineSound from '../audio/engineSound'
import { STARTER_HOUSING } from '../render/rideLayout'
import { clutchHeld, notifyRide, ride, subscribeRide } from './rideState'

// 우측 클립온의 스위치 하우징. keyed에서 빨간 버튼을 누르면 시동이 걸린다.
// running에서도 그대로 보이되 버튼은 눌린 자리에 있고 더는 반응하지 않는다.
// 엔진 사운드 시작/정지는 Finale의 phase 효과에서 처리한다 — 건너뛰기(HUD → advancePhase)로
// running에 들어와도 시동이 걸리게 하려면 클릭 이벤트가 아니라 phase 자체에 매야 한다.
// 예외가 하나 있다: 주행 중 시동이 꺼지면(ride.stalled) phase는 running 그대로인 채
// 버튼이 다시 튀어나오고, 그때는 여기서 직접 다시 건다. 기어가 들어간 채로는 거부한다.

/** 스위치 하우징 중심 (mm) — 실물 모델에서 잰 오른쪽 스위치 뭉치 자리 */
const HOUSING = STARTER_HOUSING
const BUTTON_COLOR = '#b3261e'
/** 거부됐을 때 흔들리는 시간(초)과 진폭(mm) */
const REFUSE_S = 0.3
const REFUSE_MM = 4

export function Starter() {
  const store = useAssemblyStore()
  const materials = useMaterials()
  const phase = useAssembly((s) => s.phase)
  const stalled = useSyncExternalStore(subscribeRide, () => ride.stalled, () => false)
  const [hover, setHover] = useState(false)
  const housing = useRef<THREE.Group>(null)
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

  useFrame((_, dt) => {
    const g = housing.current
    if (!g) return
    if (refusedFor.current <= 0) {
      g.position.z = HOUSING[2] * MM
      return
    }
    refusedFor.current = Math.max(0, refusedFor.current - dt)
    const k = refusedFor.current / REFUSE_S
    g.position.z = (HOUSING[2] + Math.sin(k * Math.PI * 6) * REFUSE_MM * k) * MM
  })

  if (phase !== 'keyed' && phase !== 'running') return null

  const pressed = phase === 'running' && !stalled
  const buttonX = (pressed ? -18 : -21) * MM
  return (
    <group ref={housing} position={[HOUSING[0] * MM, HOUSING[1] * MM, HOUSING[2] * MM]}>
      <mesh material={materials.get('plastic_black')} castShadow>
        <boxGeometry args={[30 * MM, 30 * MM, 40 * MM]} />
      </mesh>
      <mesh
        position={[buttonX, 0, 0]}
        castShadow
        onPointerDown={onPointerDown}
        onPointerOver={onPointerOver}
        onPointerOut={onPointerOut}
      >
        <boxGeometry args={[12 * MM, 12 * MM, 14 * MM]} />
        <meshStandardMaterial
          color={BUTTON_COLOR}
          emissive={BUTTON_COLOR}
          emissiveIntensity={armed && hover ? 0.6 : armed ? 0.3 : 0.15}
          roughness={0.5}
        />
      </mesh>
    </group>
  )
}
