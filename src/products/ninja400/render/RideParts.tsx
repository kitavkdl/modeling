import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type * as THREE from 'three'
import { useMaterials } from '../../../engine/context'
import { PartGeometry } from '../../../engine/geometry/PartGeometry'
import { MM, type RenderInstanceCtx } from '../../../engine/types'
import { ride } from '../finale/rideState'

// 주행 중에 움직이는 부품들. 전부 ride 싱글턴을 매 프레임 읽기만 한다.

const DEG = Math.PI / 180
/** 레버가 끝까지 당겨졌을 때 */
const CLUTCH_DEG = 15
const BRAKE_DEG = 12
/** 시프트 레버가 차이는 각도 */
const KICK_DEG = 10
/** rpm → rad/s */
const RAD_PER_RPM = (2 * Math.PI) / 60
const MAX_DT = 0.1

/** 박스 부품의 x 길이 절반 (mm). 회전축을 부품 뿌리로 옮기는 데 쓴다 */
const halfLength = (ctx: RenderInstanceCtx, fallback: number) => {
  const g = ctx.inst.geometry
  if (g.type === 'box') return g.size[0] / 2
  if (g.type === 'composite') {
    const first = g.children[0]?.geometry
    if (first && first.type === 'box') return first.size[0] / 2
  }
  return fallback
}

function Body({ part, inst }: RenderInstanceCtx) {
  const materials = useMaterials()
  return <PartGeometry geometry={inst.geometry} material={materials.get(part.material)} materials={materials} />
}

/**
 * 브레이크·클러치 레버. 부품 원점이 레버 한가운데라서 뿌리(뒤쪽 끝)로 축을 옮긴 뒤
 * 수직축(y)으로 돌린다 — 끝이 그립 쪽(바깥)으로 쓸려 들어간다.
 */
export function LeverPivot(ctx: RenderInstanceCtx) {
  const pivot = useRef<THREE.Group>(null)
  const clutch = ctx.inst.tag === 'clutch'
  const half = halfLength(ctx, 75)
  useFrame(() => {
    const g = pivot.current
    if (!g) return
    const pulled = clutch ? ride.clutch : ride.brake
    g.rotation.y = (clutch ? 1 : -1) * pulled * (clutch ? CLUTCH_DEG : BRAKE_DEG) * DEG
  })
  return (
    <group ref={pivot} position={[-half * MM, 0, 0]}>
      <group position={[half * MM, 0, 0]}>
        <Body {...ctx} />
      </group>
    </group>
  )
}

/** 뒷바퀴·리어 스프로킷. 둘 다 축이 z라 z로 돌린다 (앞으로 굴러가는 방향은 -z 회전) */
export function Spinner(ctx: RenderInstanceCtx) {
  const spin = useRef<THREE.Group>(null)
  useFrame((_, raw) => {
    const g = spin.current
    if (!g || ride.wheelRpm === 0) return
    g.rotation.z -= ride.wheelRpm * RAD_PER_RPM * Math.min(raw, MAX_DT)
  })
  return (
    <group ref={spin}>
      <Body {...ctx} />
    </group>
  )
}

/** 시프트 레버. 변속할 때 샤프트(뒤쪽 끝)를 축으로 한 번 차인다 */
export function ShiftLever(ctx: RenderInstanceCtx) {
  const pivot = useRef<THREE.Group>(null)
  const half = halfLength(ctx, 90)
  useFrame(() => {
    const g = pivot.current
    if (!g) return
    const k = ride.shiftKick
    // 크기가 1에서 0으로 줄어드는 타이머라, sin으로 0 → 최대 → 0 한 번을 그린다
    g.rotation.z = k === 0 ? 0 : Math.sign(k) * KICK_DEG * DEG * Math.sin(Math.PI * (1 - Math.abs(k)))
  })
  return (
    <group ref={pivot} position={[-half * MM, 0, 0]}>
      <group position={[half * MM, 0, 0]}>
        <Body {...ctx} />
      </group>
    </group>
  )
}
