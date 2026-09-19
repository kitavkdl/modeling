import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type * as THREE from 'three'
import { useAssembly, useMaterials } from '../../../engine/context'
import { PartGeometry } from '../../../engine/geometry/PartGeometry'
import { MM, type RenderInstanceCtx } from '../../../engine/types'
import { ride } from '../finale/rideState'

// 헤드라이트·테일라이트·계기판. 키를 꽂으면(keyed 이후) 켜진다.
// 조명은 늘리지 않는다 — lamp_on 재질의 emissive만으로 켜진 것처럼 보이게 한다.

/** 계기판 바의 최대 길이 (mm) */
const BAR_LEN = 120
const BAR_MIN = 0.15
/** 브레이크를 잡았을 때 테일라이트가 밝아지는 배수 */
const BRAKE_BOOST = 3
const BRAKE_ON = 0.3

export function Lamps({ part, inst }: RenderInstanceCtx) {
  const materials = useMaterials()
  const lit = useAssembly((s) => s.phase === 'keyed' || s.phase === 'running')
  const running = useAssembly((s) => s.phase === 'running')
  const isTail = part.id === 'taillight'
  // 테일라이트만 lamp_on을 복제해서 쓴다 — 공유 재질의 emissive를 건드리면 헤드라이트까지 밝아진다.
  const tail = useMemo(() => {
    if (!isTail) return null
    const m = materials.get('lamp_on').clone() as THREE.MeshStandardMaterial
    return { m, base: m.emissiveIntensity }
  }, [isTail, materials])
  useEffect(() => () => tail?.m.dispose(), [tail])
  useFrame(() => {
    if (!tail) return
    tail.m.emissiveIntensity = tail.base * (running && ride.brake > BRAKE_ON ? BRAKE_BOOST : 1)
  })
  const material = tail && lit ? tail.m : materials.get(lit ? 'lamp_on' : 'lamp_off')
  return (
    <>
      <PartGeometry geometry={inst.geometry} material={material} materials={materials} />
      {part.id === 'instrument_cluster' && lit ? <TachBar /> : null}
    </>
  )
}

/** 계기판 눈금 바. 스로틀을 열면 길어진다. */
function TachBar() {
  const materials = useMaterials()
  const bar = useRef<THREE.Group>(null)
  useFrame(() => {
    const g = bar.current
    if (g) g.scale.z = BAR_MIN + (1 - BAR_MIN) * ride.throttle
  })
  // 계기판 박스(40 x 90 x 200, 밑면 중심 기준)의 뒤쪽 면에 얹고, 한쪽 끝에서 자란다
  return (
    <group ref={bar} position={[-21 * MM, 45 * MM, (-BAR_LEN / 2) * MM]}>
      <mesh material={materials.get('lamp_on')} position={[0, 0, (BAR_LEN / 2) * MM]}>
        <boxGeometry args={[4 * MM, 12 * MM, BAR_LEN * MM]} />
      </mesh>
    </group>
  )
}
