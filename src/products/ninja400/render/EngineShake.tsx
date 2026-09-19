import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type * as THREE from 'three'
import { useAssembly, useMaterials } from '../../../engine/context'
import { PartGeometry } from '../../../engine/geometry/PartGeometry'
import { MM, type RenderInstanceCtx } from '../../../engine/types'
import { MAX_RPM } from '../finale/rideModel'
import { ride } from '../finale/rideState'

// 엔진 작업대 부품. 돌고 있으면 미세하게 떤다. 주기가 서로 어긋나서 진동처럼 보인다.
// 진폭은 rpm을 따라간다 — 시동이 꺼지면(rpm 0) 완전히 멈춘다.

const AMP_X = 0.6
const AMP_Y = 0.4
/** 이 rpm이면 아이들 진폭의 바닥에 닿는다 */
const IDLE_FULL_RPM = 1300
/** 아이들에서 이미 나는 몫과 회전수를 따라 커지는 몫 */
const IDLE_SHARE = 0.4

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t)

export function EngineShake({ part, inst }: RenderInstanceCtx) {
  const materials = useMaterials()
  const running = useAssembly((s) => s.phase === 'running')
  const group = useRef<THREE.Group>(null)
  useFrame(() => {
    const g = group.current
    if (!g) return
    const k = running ? IDLE_SHARE * clamp01(ride.rpm / IDLE_FULL_RPM) + (1 - IDLE_SHARE) * clamp01(ride.rpm / MAX_RPM) : 0
    if (k <= 0) {
      g.position.set(0, 0, 0)
      return
    }
    const now = performance.now()
    g.position.set(Math.sin(now / 16) * AMP_X * k * MM, Math.cos(now / 13) * AMP_Y * k * MM, 0)
  })
  return (
    <group ref={group}>
      <PartGeometry geometry={inst.geometry} material={materials.get(part.material)} materials={materials} />
    </group>
  )
}
