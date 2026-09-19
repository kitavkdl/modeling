import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { useAssembly, useAssemblyStore, useMaterials } from '../../../engine/context'
import { easeOutCubic } from '../../../engine/easing'
import { cancelCameraTween, setControlsEnabled } from '../../../engine/scene/controlsRef'
import { MM, type Vec3 } from '../../../engine/types'

// 조립이 끝나면 계기판 앞에 키가 떠 있다. 잡아서 키실린더에 놓으면 keyed 단계로 넘어간다.
// 드래그는 engine/scene/DraggablePart.tsx와 같은 방식 — 윈도우 pointermove/pointerup + 평면 교차.

/** 떠 있는 자리 (mm) */
const REST: Vec3 = [560, 1080, 120]
/** 키실린더 (mm) */
const CYLINDER: Vec3 = [540, 980, 60]
/** 꽂힘 판정 반경 (mm) */
const SNAP_MM = 150
/** 잡고 끄는 평면 높이 (mm) */
const HOVER_Y = 1080
/** 놓쳤을 때 제자리로 돌아가는 시간 */
const RETURN_MS = 300

const up = new THREE.Vector3(0, 1, 0)

interface DragState {
  plane: THREE.Plane
  /** 커서 교점 → 키 위치 오프셋 (units) */
  offset: THREE.Vector3
  /** 커서가 가리키는 키 목표 위치 (units) */
  target: THREE.Vector3
}

export function Key() {
  const phase = useAssembly((s) => s.phase)
  if (phase !== 'complete') return null
  return <KeyBody />
}

function KeyBody() {
  const { camera, gl } = useThree()
  const store = useAssemblyStore()
  const materials = useMaterials()
  const group = useRef<THREE.Group>(null)
  const drag = useRef<DragState | null>(null)
  const returning = useRef<{ from: THREE.Vector3; start: number } | null>(null)
  const raycaster = useRef(new THREE.Raycaster()).current
  const ndc = useRef(new THREE.Vector2()).current
  const tmp = useRef(new THREE.Vector3()).current

  const rest = useMemo(() => new THREE.Vector3(REST[0] * MM, REST[1] * MM, REST[2] * MM), [])
  const hoverY = HOVER_Y * MM

  const release = useCallback(() => {
    drag.current = null
    setControlsEnabled(true)
    document.body.style.cursor = ''
  }, [])

  const endDrag = useCallback(() => {
    const d = drag.current
    release()
    if (!d) return
    const x = d.target.x / MM
    const y = d.target.y / MM
    const z = d.target.z / MM
    const near = Math.hypot(x - CYLINDER[0], y - CYLINDER[1], z - CYLINDER[2]) <= SNAP_MM
    if (near) {
      store.getState().advancePhase()
      return
    }
    const g = group.current
    if (g) returning.current = { from: g.position.clone(), start: performance.now() }
  }, [release, store])

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current
      if (!d) return
      const rect = gl.domElement.getBoundingClientRect()
      ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1)
      raycaster.setFromCamera(ndc, camera)
      if (raycaster.ray.intersectPlane(d.plane, tmp)) d.target.set(tmp.x + d.offset.x, hoverY, tmp.z + d.offset.z)
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
      // 단계가 넘어가 언마운트되면 드래그도 끝난다
      if (drag.current) release()
    }
  }, [camera, gl, ndc, raycaster, tmp, hoverY, endDrag, release])

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
      raycaster.setFromCamera(e.pointer, camera)
      const hit = new THREE.Vector3()
      if (!raycaster.ray.intersectPlane(plane, hit)) hit.set(g.position.x, hoverY, g.position.z)
      const offset = new THREE.Vector3(g.position.x - hit.x, 0, g.position.z - hit.z)
      drag.current = { plane, offset, target: new THREE.Vector3(g.position.x, hoverY, g.position.z) }
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
    g.position.set(rest.x, rest.y + Math.sin(performance.now() / 700) * 1.2 * MM, rest.z)
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
      {/* 키 날 */}
      <mesh material={materials.get('steel')} position={[20 * MM, 0, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[6 * MM, 6 * MM, 40 * MM, 12]} />
      </mesh>
      {/* 손잡이 */}
      <mesh material={materials.get('plastic_black')} position={[-15 * MM, 0, 0]} castShadow>
        <boxGeometry args={[30 * MM, 4 * MM, 20 * MM]} />
      </mesh>
      {/* 잡기 영역: 보이지 않지만 레이캐스트에는 잡힌다 */}
      <mesh>
        <boxGeometry args={[80 * MM, 40 * MM, 40 * MM]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  )
}
