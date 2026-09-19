import { useCallback, useEffect, useState } from 'react'
import type { ThreeEvent } from '@react-three/fiber'
import { useAssembly, useAssemblyStore, useMaterials } from '../../../engine/context'
import { MM, type Vec3 } from '../../../engine/types'
import * as engineSound from '../audio/engineSound'
import { forkPoint, HEAD } from '../spec'
import { resetThrottle } from './throttleState'

// 우측 클립온의 스위치 하우징. keyed에서 빨간 버튼을 누르면 시동이 걸린다.
// running에서도 그대로 보이되 버튼은 눌린 자리에 있고 더는 반응하지 않는다.

const [topX, topY] = forkPoint(HEAD[1])
/** 스위치 하우징 중심 (mm) */
const HOUSING: Vec3 = [topX - 20, topY + 60, 200]
const BUTTON_COLOR = '#b3261e'

export function Starter() {
  const store = useAssemblyStore()
  const materials = useMaterials()
  const phase = useAssembly((s) => s.phase)
  const [hover, setHover] = useState(false)

  // running에서 벗어나거나(되돌리기·리셋) 언마운트되면 엔진을 끈다
  useEffect(() => {
    const unsub = store.subscribe((s, prev) => {
      if (prev.phase === 'running' && s.phase !== 'running') {
        engineSound.stop()
        resetThrottle()
      }
    })
    return () => {
      unsub()
      engineSound.stop()
      resetThrottle()
    }
  }, [store])

  const onPointerDown = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (store.getState().phase !== 'keyed') return
      e.stopPropagation()
      setHover(false)
      document.body.style.cursor = ''
      store.getState().advancePhase()
      engineSound.start()
    },
    [store],
  )

  const onPointerOver = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (store.getState().phase !== 'keyed') return
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

  if (phase !== 'keyed' && phase !== 'running') return null

  const pressed = phase === 'running'
  const buttonX = (pressed ? -18 : -21) * MM
  return (
    <group position={[HOUSING[0] * MM, HOUSING[1] * MM, HOUSING[2] * MM]}>
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
          emissiveIntensity={hover ? 0.6 : 0.15}
          roughness={0.5}
        />
      </mesh>
    </group>
  )
}
