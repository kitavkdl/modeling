import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type * as THREE from 'three'
import { useAssembly, useMaterials } from '../../../engine/context'
import { PartGeometry } from '../../../engine/geometry/PartGeometry'
import { MM, type RenderInstanceCtx } from '../../../engine/types'

// 엔진 작업대 부품. running이면 미세하게 떤다. 주기가 서로 어긋나서 진동처럼 보인다.

const AMP_X = 0.6
const AMP_Y = 0.4

export function EngineShake({ part, inst }: RenderInstanceCtx) {
  const materials = useMaterials()
  const running = useAssembly((s) => s.phase === 'running')
  const group = useRef<THREE.Group>(null)
  useFrame(() => {
    const g = group.current
    if (!g) return
    if (!running) {
      g.position.set(0, 0, 0)
      return
    }
    const now = performance.now()
    g.position.set(Math.sin(now / 16) * AMP_X * MM, Math.cos(now / 13) * AMP_Y * MM, 0)
  })
  return (
    <group ref={group}>
      <PartGeometry geometry={inst.geometry} material={materials.get(part.material)} materials={materials} />
    </group>
  )
}
