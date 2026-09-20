import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type * as THREE from 'three'
import { useMaterials } from '../../../engine/context'
import { PartGeometry } from '../../../engine/geometry/PartGeometry'
import { MM, type RenderInstanceCtx } from '../../../engine/types'
import { frontWheelRpm, wheelRpm } from '../finale/rideModel'
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

/**
 * 부품 원점에서 회전축(뿌리)까지의 거리 (mm, -x 방향). 형상에서 유추하지 않고 부품마다 적는다.
 * - lever: 원점이 이미 퍼치(뿌리)다 → 0
 * - shift_lever: 원점이 샤프트 막대(길이 180) 한가운데라 뒤쪽 끝이 뿌리 → 90
 */
const PIVOT_MM: Record<string, number> = { lever: 0, shift_lever: 90 }
const pivotMm = (ctx: RenderInstanceCtx) => PIVOT_MM[ctx.part.id] ?? 0

function Body({ part, inst }: RenderInstanceCtx) {
  const materials = useMaterials()
  return <PartGeometry geometry={inst.geometry} material={materials.get(part.material)} materials={materials} />
}

/**
 * 브레이크·클러치 레버. 뿌리(퍼치)를 축으로 수직축(y)으로 돌린다 —
 * 끝이 그립 쪽(바깥)으로 쓸려 들어간다. 레버는 원점이 곧 뿌리라 축을 옮기지 않는다.
 */
export function LeverPivot(ctx: RenderInstanceCtx) {
  const pivot = useRef<THREE.Group>(null)
  const clutch = ctx.inst.tag === 'clutch'
  const half = pivotMm(ctx)
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

/**
 * 앞·뒷바퀴와 리어 스프로킷. 전부 축이 z라 z로 돌린다 (앞으로 굴러가는 방향은 -z 회전 —
 * RideModel의 실물 바퀴와 같은 부호). 앞 타이어는 반지름이 작아 같은 속도에서 더 빨리 돈다.
 */
export function Spinner(ctx: RenderInstanceCtx) {
  const spin = useRef<THREE.Group>(null)
  const front = ctx.part.id === 'front_wheel'
  useFrame((_, raw) => {
    const g = spin.current
    if (!g || ride.speed === 0) return
    const rpm = front ? frontWheelRpm(ride.speed) : wheelRpm(ride.speed)
    g.rotation.z -= rpm * RAD_PER_RPM * Math.min(raw, MAX_DT)
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
  const half = pivotMm(ctx)
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
