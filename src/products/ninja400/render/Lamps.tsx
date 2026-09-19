import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type * as THREE from 'three'
import { useAssembly, useMaterials } from '../../../engine/context'
import { PartGeometry } from '../../../engine/geometry/PartGeometry'
import { MM, type RenderInstanceCtx } from '../../../engine/types'
import { throttle } from '../finale/throttleState'

// 헤드라이트·테일라이트·계기판. 키를 꽂으면(keyed 이후) 켜진다.
// 조명은 늘리지 않는다 — lamp_on 재질의 emissive만으로 켜진 것처럼 보이게 한다.

/** 계기판 바의 최대 길이 (mm) */
const BAR_LEN = 120
const BAR_MIN = 0.15

export function Lamps({ part, inst }: RenderInstanceCtx) {
  const materials = useMaterials()
  const lit = useAssembly((s) => s.phase === 'keyed' || s.phase === 'running')
  return (
    <>
      <PartGeometry geometry={inst.geometry} material={materials.get(lit ? 'lamp_on' : 'lamp_off')} materials={materials} />
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
    if (g) g.scale.z = BAR_MIN + (1 - BAR_MIN) * throttle.value
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
