import { useCallback, useRef, useState } from 'react'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { useAssembly, useAssemblyStore, useMaterials } from '../../../engine/context'
import { easeInOutCubic, lerp } from '../../../engine/easing'
import { CABLE, MM } from '../parts'
import { BOOT_WAVE_MS, STILL_MS } from './rgb'

const PLUG_MS = 450

/** USB-C 케이블. 조립 완료 후 등장하고, 클릭하면 포트에 꽂힌다. */
export function Cable() {
  const store = useAssemblyStore()
  const materials = useMaterials()
  const phase = useAssembly((s) => s.phase)
  const group = useRef<THREE.Group>(null)
  const [hover, setHover] = useState(false)

  useFrame(() => {
    const g = group.current
    if (!g) return
    const s = store.getState()
    const rest = CABLE.restPosition
    const dst = CABLE.pluggedPosition
    if (s.phase === 'complete') {
      const bob = Math.sin(performance.now() / 700) * 1.2
      g.position.set(rest[0] * MM, (rest[1] + bob) * MM, rest[2] * MM)
      return
    }
    if (s.phase === 'plugging') {
      const t = (performance.now() - s.phaseAt) / PLUG_MS
      const k = easeInOutCubic(t)
      g.position.set(lerp(rest[0], dst[0], k) * MM, lerp(rest[1], dst[1], k) * MM, lerp(rest[2], dst[2], k) * MM)
      return
    }
    g.position.set(dst[0] * MM, dst[1] * MM, dst[2] * MM)
  })

  const onPointerDown = useCallback((e: ThreeEvent<PointerEvent>) => {
    if (store.getState().phase !== 'complete') return
    e.stopPropagation()
    setHover(false)
    document.body.style.cursor = ''
    if (store.getState().phase === 'complete') store.getState().advancePhase()
  }, [store])

  const onPointerOver = useCallback((e: ThreeEvent<PointerEvent>) => {
    if (store.getState().phase !== 'complete') return
    e.stopPropagation()
    setHover(true)
    document.body.style.cursor = 'pointer'
  }, [store])
  const onPointerOut = useCallback(() => {
    setHover(false)
    document.body.style.cursor = ''
  }, [])

  if (phase === 'assembly') return null

  const [pw, ph, pd] = CABLE.plug
  return (
    <group ref={group} onPointerDown={onPointerDown} onPointerOver={onPointerOver} onPointerOut={onPointerOut}>
      <mesh material={materials.get('plug')} castShadow>
        <boxGeometry args={[pw * MM, ph * MM, pd * MM]} />
      </mesh>
      <mesh material={materials.get('cable')} position={[0, 0, (-pd / 2 - CABLE.cordLength / 2) * MM]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[CABLE.cordR * MM, CABLE.cordR * MM, CABLE.cordLength * MM, 12]} />
      </mesh>
      {hover ? (
        <mesh position={[0, 0, 0]}>
          <boxGeometry args={[(pw + 3) * MM, (ph + 3) * MM, (pd + 3) * MM]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.18} depthWrite={false} />
        </mesh>
      ) : null}
    </group>
  )
}

/** 전원 시퀀스 타이머: plugging → still(0.3s) → booting(0.8s) → on */
export function PowerSequence() {
  const store = useAssemblyStore()

  useFrame(() => {
    const s = store.getState()
    const dt = performance.now() - s.phaseAt
    if (s.phase === 'plugging' && dt >= PLUG_MS) s.advancePhase()
    else if (s.phase === 'still' && dt >= STILL_MS) s.advancePhase()
    else if (s.phase === 'booting' && dt >= BOOT_WAVE_MS) s.advancePhase()
  })
  return null
}
