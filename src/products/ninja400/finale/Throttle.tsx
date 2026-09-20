import { useCallback, useEffect, useRef } from 'react'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import type * as THREE from 'three'
import { useAssembly, useMaterials } from '../../../engine/context'
import { clamp01 } from '../../../engine/easing'
import { cancelCameraTween, setControlsEnabled } from '../../../engine/scene/controlsRef'
import { MM } from '../../../engine/types'
import { GRIP } from '../render/rideLayout'
import { ride } from './rideState'

// 우측 그립. 누른 채 화면 위로 끌면 스로틀이 열린다. 값 자체는 rideModel이 굴리고
// (키보드 ↑와 큰 쪽이 이긴다) 여기서는 ride.throttleMouse만 쓰고 ride.throttle을 보여 준다.
// 그립 중심(GRIP, mm)은 실물 모델에서 잰 오른쪽 그립 자리다 (render/rideLayout.ts).

const GRIP_LEN = 120
/** 슬리브는 clip_on 고무 그립보다 2mm 짧게 — 끝면이 겹쳐 z-파이팅하지 않도록 */
const SLEEVE_LEN = 118
const GRIP_R = 17
/** 전개까지 끌어야 하는 화면 거리 (px) */
const DRAG_RANGE_PX = 200
/** 최대 비틀림 */
const MAX_TWIST = (60 * Math.PI) / 180

export function Throttle() {
  const phase = useAssembly((s) => s.phase)
  const running = phase === 'running'
  const materials = useMaterials()
  const grip = useRef<THREE.Group>(null)
  const startY = useRef<number | null>(null)

  const release = useCallback(() => {
    startY.current = null
    ride.throttleMouse = 0
    setControlsEnabled(true)
    document.body.style.cursor = ''
  }, [])

  useEffect(() => {
    if (!running) return
    const move = (e: PointerEvent) => {
      if (startY.current === null) return
      ride.throttleMouse = clamp01((startY.current - e.clientY) / DRAG_RANGE_PX)
    }
    const upHandler = () => {
      if (startY.current !== null) release()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', upHandler)
    window.addEventListener('pointercancel', upHandler)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', upHandler)
      window.removeEventListener('pointercancel', upHandler)
      if (startY.current !== null) release()
      ride.throttleMouse = 0
    }
  }, [running, release])

  useFrame(() => {
    if (!running) return
    const g = grip.current
    // +x가 앞이므로 양의 회전이 그립 윗면을 라이더 쪽(뒤)으로 굴린다
    if (g) g.rotation.z = ride.throttle * MAX_TWIST
  })

  const onPointerDown = useCallback((e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0 || startY.current !== null) return
    e.stopPropagation()
    setControlsEnabled(false)
    cancelCameraTween()
    startY.current = e.clientY
    document.body.style.cursor = 'grabbing'
  }, [])

  if (!running) return null

  const rubber = materials.get('rubber')
  return (
    <group position={[GRIP[0] * MM, GRIP[1] * MM, GRIP[2] * MM]}>
      <group ref={grip}>
        <mesh material={rubber} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[GRIP_R * MM, GRIP_R * MM, SLEEVE_LEN * MM, 16]} />
        </mesh>
        {/* 비틀림이 보이도록 얹은 리브 */}
        <mesh material={rubber} position={[0, (GRIP_R + 1) * MM, 0]} castShadow>
          <boxGeometry args={[5 * MM, 4 * MM, (SLEEVE_LEN - 10) * MM]} />
        </mesh>
      </group>
      {/* 잡기 영역 */}
      <mesh
        onPointerDown={onPointerDown}
        onPointerOver={(e) => {
          e.stopPropagation()
          if (startY.current === null) document.body.style.cursor = 'grab'
        }}
        onPointerOut={() => {
          if (startY.current === null) document.body.style.cursor = ''
        }}
      >
        <boxGeometry args={[60 * MM, 60 * MM, GRIP_LEN * MM]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  )
}
