import { useCallback, useEffect, useRef } from 'react'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import type { PartDef } from '../engine/types'
import { ASSEMBLY_LIFT, MM, PART_BY_ID, type Vec3 } from '../products/keyboard/parts'
import { useAssembly } from '../store/assembly'
import { easeOutCubic } from '../utils/easing'
import { cancelCameraTween, setControlsEnabled } from './controlsRef'
import { PartGeometry } from './PartGeometry'
import { materialFor } from './materials'

// 트레이에서 고른 부품의 실물. 대기 위치에 놓여 있고, 잡아서 끌 수 있다.
// 단일 부품: 고스트 근처에서 놓으면 장착. 멀리서 놓으면 제자리로 돌아간다.
// 다수 부품: 하나를 잡고 슬롯 위를 지나가면 지나간 자리마다 장착된다.

/** 단일 부품이 장착되는 수평 거리 (mm) */
const SNAP_MM = 60
/** 다수 부품 슬롯이 장착되는 수평 거리 (mm) */
const PAINT_MM = 12
/** 잡았을 때 장착 높이 위로 떠오르는 양 (mm) */
const HOVER_MM = 30
/** 놓쳤을 때 제자리로 돌아가는 시간 */
const RETURN_MS = 300
/** 작은 부품도 쉽게 잡히도록 두는 보이지 않는 잡기 영역의 최소 크기 (mm) */
const GRAB_MIN_MM = 50

const up = new THREE.Vector3(0, 1, 0)

interface DragState {
  plane: THREE.Plane
  /** 커서 교점 → 부품 위치 오프셋 (units) */
  offset: THREE.Vector3
  /** 커서가 가리키는 부품 목표 위치 (units). 판정은 이 값으로, 렌더는 이 값을 따라간다. */
  target: THREE.Vector3
}

interface ReturnState {
  from: THREE.Vector3
  start: number
}

export function DraggablePart() {
  const selectedPartId = useAssembly((s) => s.selectedPartId)
  const phase = useAssembly((s) => s.phase)
  if (!selectedPartId || phase !== 'assembly') return null
  return <Draggable key={selectedPartId} part={PART_BY_ID[selectedPartId]} />
}

function Draggable({ part }: { part: PartDef }) {
  const group = useRef<THREE.Group>(null)
  const drag = useRef<DragState | null>(null)
  const returning = useRef<ReturnState | null>(null)
  const { camera, gl } = useThree()
  const raycaster = useRef(new THREE.Raycaster()).current
  const ndc = useRef(new THREE.Vector2()).current
  const tmp = useRef(new THREE.Vector3()).current

  const rest = new THREE.Vector3(part.restPosition[0] * MM, part.restPosition[1] * MM, part.restPosition[2] * MM)
  const seated = useAssembly((s) => Boolean(s.mounted.gasket))
  const lift = Boolean(part.station) && !seated ? ASSEMBLY_LIFT : 0
  /** 잡았을 때 떠 있는 높이 (units) */
  const hoverY = (part.mountPosition[1] + lift + HOVER_MM) * MM

  const endDrag = useCallback(() => {
    const s = useAssembly.getState()
    const g = group.current
    const d = drag.current
    if (d && g) {
      const target = s.dragTarget
      const here: Vec3 = [d.target.x / MM, d.target.y / MM, d.target.z / MM]
      if (target && part.count === 1) {
        s.mount(target, here)
      } else {
        returning.current = { from: g.position.clone(), start: performance.now() }
      }
    }
    drag.current = null
    s.setDragTarget(null)
    s.setDragging(false)
    setControlsEnabled(true)
    document.body.style.cursor = ''
  }, [part])

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current
      if (!d) return
      const rect = gl.domElement.getBoundingClientRect()
      ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1)
      raycaster.setFromCamera(ndc, camera)
      if (raycaster.ray.intersectPlane(d.plane, tmp)) {
        d.target.set(tmp.x + d.offset.x, hoverY, tmp.z + d.offset.z)
        resolveTargets(part, d.target, lift)
      }
    }
    const upHandler = () => {
      if (drag.current) endDrag()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', upHandler)
    window.addEventListener('pointercancel', upHandler)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', upHandler)
      window.removeEventListener('pointercancel', upHandler)
      // 부품이 바뀌어 언마운트되면 드래그도 끝난다
      if (drag.current) {
        drag.current = null
        const s = useAssembly.getState()
        s.setDragTarget(null)
        s.setDragging(false)
        setControlsEnabled(true)
        document.body.style.cursor = ''
      }
    }
  }, [camera, gl, endDrag, ndc, raycaster, tmp, part, lift, hoverY])

  const onPointerDown = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (e.button !== 0 || drag.current) return
      const g = group.current
      if (!g) return
      e.stopPropagation()
      setControlsEnabled(false)
      cancelCameraTween()
      returning.current = null
      const plane = new THREE.Plane(up, -hoverY)
      // 잡은 순간의 커서 교점을 기준으로 오프셋을 잡되, 높이는 hoverY로 들어 올린다
      raycaster.setFromCamera(e.pointer, camera)
      const hit = new THREE.Vector3()
      if (!raycaster.ray.intersectPlane(plane, hit)) hit.set(g.position.x, hoverY, g.position.z)
      const offset = new THREE.Vector3(g.position.x - hit.x, 0, g.position.z - hit.z)
      drag.current = { plane, offset, target: new THREE.Vector3(g.position.x, hoverY, g.position.z) }
      useAssembly.getState().setDragging(true)
      document.body.style.cursor = 'grabbing'
    },
    [camera, hoverY, raycaster],
  )

  useFrame(() => {
    const g = group.current
    if (!g) return
    const d = drag.current
    if (d) {
      g.position.lerp(d.target, 0.4)
      return
    }
    const r = returning.current
    if (r) {
      const t = (performance.now() - r.start) / RETURN_MS
      if (t >= 1) {
        g.position.copy(rest)
        returning.current = null
      } else {
        g.position.lerpVectors(r.from, rest, easeOutCubic(t))
      }
      return
    }
    // 대기 중: 살짝 떠 있는 느낌
    g.position.set(rest.x, rest.y + Math.sin(performance.now() / 900) * 0.12, rest.z)
  })

  return (
    <group
      ref={group}
      position={rest}
      onPointerDown={onPointerDown}
      onPointerOver={(e) => {
        e.stopPropagation()
        if (!drag.current) document.body.style.cursor = 'grab'
      }}
      onPointerOut={() => {
        if (!drag.current) document.body.style.cursor = ''
      }}
    >
      <PartGeometry geometry={part.geometry} material={materialFor(part.material)} />
      {/* 잡기 영역: 렌더되지 않지만 레이캐스트에는 잡힌다 */}
      <mesh position={[0, (GRAB_MIN_MM / 2) * MM, 0]}>
        <boxGeometry args={[GRAB_MIN_MM * MM, GRAB_MIN_MM * MM, GRAB_MIN_MM * MM]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  )
}

/**
 * 드래그 중 매 프레임: 단일 부품은 가장 가까운 고스트를 dragTarget으로,
 * 다수 부품은 PAINT_MM 안에 들어온 슬롯을 즉시 장착한다.
 */
function resolveTargets(part: PartDef, pos: THREE.Vector3, lift: number) {
  const s = useAssembly.getState()
  const px = pos.x / MM
  const pz = pos.z / MM
  if (part.count === 1) {
    const inst = part.instances[0]
    if (s.mounted[inst.id]) return
    const dx = px - inst.mountPosition[0]
    const dz = pz - inst.mountPosition[2]
    s.setDragTarget(Math.hypot(dx, dz) <= SNAP_MM ? inst.id : null)
    return
  }
  const here: Vec3 = [px, pos.y / MM, pz]
  for (const inst of part.instances) {
    if (s.mounted[inst.id]) continue
    const dx = px - inst.mountPosition[0]
    const dz = pz - inst.mountPosition[2]
    if (Math.hypot(dx, dz) <= PAINT_MM) {
      // 출발점은 잡고 있는 실물 위치. 들고 있는 부품에서 튀어나와 박히는 것처럼 보인다.
      s.mount(inst.id, [here[0], here[1] - lift, here[2]])
    }
  }
}
