import { useCallback, useMemo, useRef } from 'react'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { useAssemblyStore, useMaterials } from '../../../engine/context'
import { easeOutCubic } from '../../../engine/easing'
import { PartGeometry } from '../../../engine/geometry/PartGeometry'
import { MM, type RenderInstanceCtx } from '../../../engine/types'
import { playKeyPress } from '../audio/switchSound'
import { applyGlow, keyGlow, makeGlowMaterial } from './rgb'

const KEYPRESS_DEPTH_MM = 3
const KEYPRESS_DOWN_MS = 55
const KEYPRESS_UP_MS = 85

/** 키캡: 발광 슬랩 + 타건. 조립 완료 뒤에만 눌린다. */
export function Keycap({ part, inst }: RenderInstanceCtx) {
  const store = useAssemblyStore()
  const materials = useMaterials()
  const glowMat = useMemo(() => makeGlowMaterial(), [])
  const pressGroup = useRef<THREE.Group>(null)
  const pressAt = useRef<number | null>(null)
  const geo = inst.geometry
  if (geo.type !== 'frustum') throw new Error('keycap must be a frustum')

  useFrame(() => {
    const s = store.getState()
    applyGlow(glowMat, keyGlow(inst.order, s.phase, s.phaseAt, performance.now()))
    const g = pressGroup.current
    if (!g) return
    if (pressAt.current === null) { g.position.y = 0; return }
    const dt = performance.now() - pressAt.current
    let depth: number
    if (dt < KEYPRESS_DOWN_MS) depth = easeOutCubic(dt / KEYPRESS_DOWN_MS)
    else if (dt < KEYPRESS_DOWN_MS + KEYPRESS_UP_MS) depth = 1 - easeOutCubic((dt - KEYPRESS_DOWN_MS) / KEYPRESS_UP_MS)
    else { depth = 0; pressAt.current = null }
    g.position.y = -depth * KEYPRESS_DEPTH_MM * MM
  })

  const onPointerDown = useCallback((e: ThreeEvent<PointerEvent>) => {
    if (store.getState().phase === 'assembly') return
    e.stopPropagation()
    pressAt.current = performance.now()
    playKeyPress(inst.tag ?? inst.id, 0.6 + Math.random() * 0.4)
  }, [inst, store])

  const [bw, bd] = geo.bottom
  return (
    <group
      ref={pressGroup}
      onPointerDown={onPointerDown}
      onPointerOver={(e) => { if (store.getState().phase === 'assembly') return; e.stopPropagation(); document.body.style.cursor = 'pointer' }}
      onPointerOut={() => { document.body.style.cursor = '' }}
    >
      <PartGeometry geometry={geo} material={materials.get(part.material)} />
      <mesh material={glowMat} position={[0, -0.7 * MM, 0]}>
        <boxGeometry args={[(bw + 1) * MM, 1.2 * MM, (bd + 1) * MM]} />
      </mesh>
    </group>
  )
}
