import { useCallback, useMemo, useRef } from 'react'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { ASSEMBLY_LIFT, MM, type PartDef, type PartInstance, type Vec3 } from '../data/parts'
import { useAssembly, type MountRecord } from '../store/assembly'
import { easeOutBack, easeOutCubic, lerp } from '../utils/easing'
import { playKeyPress } from '../audio/switchSound'
import { PartGeometry } from './PartGeometry'
import { materialFor } from './materials'
import { applyGlow, keyGlow, makeGlowMaterial } from './rgb'

export const MOUNT_MS = 350
/** 다수 부품이 내려앉기 시작하는 높이 */
const DROP_MM = 30
/** 단일 부품이 대기 위치에서 날아올 때의 아치 높이 */
const ARC_MM = 18

const KEYPRESS_DEPTH_MM = 3
const KEYPRESS_DOWN_MS = 55
const KEYPRESS_UP_MS = 85

interface Props {
  part: PartDef
  inst: PartInstance
  record: MountRecord
}

/** 장착된 인스턴스 하나. 장착 시각부터 MOUNT_MS 동안 내려앉는다. */
export function MountedInstanceView({ part, inst, record }: Props) {
  const group = useRef<THREE.Group>(null)
  const end = inst.mountPosition

  // 시작점: 드래그로 놓았다면 그 자리(record.from, 월드 mm → 그룹 로컬).
  // 아니면 단일 부품은 대기 위치에서, 다수 부품은 바로 위에서.
  const start = useMemo<Vec3>(() => {
    const lift = part.subassembly ? ASSEMBLY_LIFT : 0
    if (record.from) {
      const f = record.from
      return part.count === 1 ? [f[0], f[1] - lift, f[2]] : f
    }
    if (part.count === 1) {
      const r = part.restPosition
      return [r[0], r[1] - lift, r[2]]
    }
    return [end[0], end[1] + DROP_MM, end[2]]
  }, [part, end, record.from])

  // 대기 위치에서 날아올 때만 아치를 그린다. 드래그로 놓은 것은 바로 내려앉는다.
  const arc = part.count === 1 && !record.from ? ARC_MM : 0

  useFrame(() => {
    const g = group.current
    if (!g) return
    const t = (performance.now() - record.at) / MOUNT_MS
    if (t >= 1) {
      g.position.set(end[0] * MM, end[1] * MM, end[2] * MM)
      return
    }
    const k = easeOutCubic(t)
    const ky = easeOutBack(t, 1.4)
    const x = lerp(start[0], end[0], k)
    const z = lerp(start[2], end[2], k)
    const y = lerp(start[1], end[1], ky) + arc * Math.sin(Math.PI * Math.min(1, t))
    g.position.set(x * MM, y * MM, z * MM)
  })

  const r = inst.mountRotation
  const material = materialFor(part.material)
  const body =
    inst.geometry.type === 'keycap' ? (
      <Keycap inst={inst} material={material} />
    ) : (
      <PartGeometry geometry={inst.geometry} material={material} />
    )

  return (
    <group ref={group} position={[start[0] * MM, start[1] * MM, start[2] * MM]} rotation={[r[0], r[1], r[2]]}>
      {body}
    </group>
  )
}

/** 키캡: 발광 슬랩 + 타건 인터랙션 */
function Keycap({ inst, material }: { inst: PartInstance; material: THREE.Material }) {
  const glowMat = useMemo(() => makeGlowMaterial(), [])
  const pressGroup = useRef<THREE.Group>(null)
  const pressAt = useRef<number | null>(null)
  const geo = inst.geometry
  if (geo.type !== 'keycap') throw new Error('not a keycap')

  useFrame(() => {
    const s = useAssembly.getState()
    applyGlow(glowMat, keyGlow(inst.order, s.phase, s.phaseAt, performance.now()))

    const g = pressGroup.current
    if (!g) return
    if (pressAt.current === null) {
      g.position.y = 0
      return
    }
    const dt = performance.now() - pressAt.current
    let depth: number
    if (dt < KEYPRESS_DOWN_MS) depth = easeOutCubic(dt / KEYPRESS_DOWN_MS)
    else if (dt < KEYPRESS_DOWN_MS + KEYPRESS_UP_MS) depth = 1 - easeOutCubic((dt - KEYPRESS_DOWN_MS) / KEYPRESS_UP_MS)
    else {
      depth = 0
      pressAt.current = null
    }
    g.position.y = -depth * KEYPRESS_DEPTH_MM * MM
  })

  const onPointerDown = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      const s = useAssembly.getState()
      if (s.phase === 'assembly') return
      e.stopPropagation()
      pressAt.current = performance.now()
      playKeyPress(inst.keyId ?? inst.id, 0.6 + Math.random() * 0.4)
    },
    [inst],
  )

  const onPointerOver = useCallback((e: ThreeEvent<PointerEvent>) => {
    if (useAssembly.getState().phase === 'assembly') return
    e.stopPropagation()
    document.body.style.cursor = 'pointer'
  }, [])
  const onPointerOut = useCallback(() => {
    document.body.style.cursor = ''
  }, [])

  const [bw, bd] = geo.bottom
  return (
    <group ref={pressGroup} onPointerDown={onPointerDown} onPointerOver={onPointerOver} onPointerOut={onPointerOut}>
      <PartGeometry geometry={geo} material={material} />
      {/* 키캡 밑면 아래 틈에 놓이는 발광 슬랩. 키캡보다 살짝 넓어 위에서도 가장자리가 보인다. */}
      <mesh material={glowMat} position={[0, -0.7 * MM, 0]}>
        <boxGeometry args={[(bw + 1) * MM, 1.2 * MM, (bd + 1) * MM]} />
      </mesh>
    </group>
  )
}
