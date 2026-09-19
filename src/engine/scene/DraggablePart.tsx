import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { useAssembly, useAssemblyStore, useMaterials, useProduct } from '../context'
import { easeOutCubic } from '../easing'
import { PartGeometry } from '../geometry/PartGeometry'
import { isStationSeated, type AssemblyStore } from '../store'
import { MM, type DragConfig, type PartDef, type Vec3 } from '../types'
import { cancelCameraTween, setControlsEnabled } from './controlsRef'
import { resolveDragTargets } from './dragMath'

// 트레이에서 고른 부품의 실물. 대기 위치에 놓여 있고, 잡아서 끌 수 있다.
// 단일 부품: 고스트 근처에서 놓으면 장착. 멀리서 놓으면 제자리로 돌아간다.
// 다수 부품: 하나를 잡고 슬롯 위를 지나가면 지나간 자리마다 장착된다.

/** 놓쳤을 때 제자리로 돌아가는 시간 */
const RETURN_MS = 300

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
  const product = useProduct()
  const selectedPartId = useAssembly((s) => s.selectedPartId)
  const phase = useAssembly((s) => s.phase)
  if (!selectedPartId || phase !== 'assembly') return null
  const part = product.parts.find((p) => p.id === selectedPartId)
  // 숨은 부품은 실물이 없고, 변형 부품은 HUD의 선택기로 장착한다
  if (!part || part.hidden || part.variants) return null
  return <Draggable key={selectedPartId} part={part} />
}

function Draggable({ part }: { part: PartDef }) {
  const group = useRef<THREE.Group>(null)
  const drag = useRef<DragState | null>(null)
  const returning = useRef<ReturnState | null>(null)
  const { camera, gl } = useThree()
  const raycaster = useRef(new THREE.Raycaster()).current
  const ndc = useRef(new THREE.Vector2()).current
  const tmp = useRef(new THREE.Vector3()).current

  const product = useProduct()
  const materials = useMaterials()
  const store = useAssemblyStore()
  const cfg = product.drag

  // mounted 객체 전체를 구독하면 페인팅으로 하나 박힐 때마다 이 컴포넌트가 다시 렌더되고,
  // position으로 넘긴 rest가 새 객체면 R3F가 매번 group.position을 되돌려 잡고 있던 부품이
  // 튕긴다. 그래서 (1) 원시값(결합 여부)만 구독하고 (2) rest 벡터를 memo로 고정한다.
  const seated = useAssembly((s) => isStationSeated(product, s.mounted, part.station ?? ''))

  const rest = useMemo(
    () => new THREE.Vector3(part.restPosition[0] * MM, part.restPosition[1] * MM, part.restPosition[2] * MM),
    [part],
  )
  // 작업대 부품은 결합 전까지 작업대 오프셋만큼 떠 있는 자리에 장착된다
  const [ox, oy, oz] = useMemo<Vec3>(() => {
    if (!part.station || seated) return [0, 0, 0]
    return product.stations.find((s) => s.id === part.station)?.offset ?? [0, 0, 0]
  }, [product, part, seated])
  /** 잡았을 때 떠 있는 높이 (units) */
  const hoverY = (part.mountPosition[1] + oy + cfg.hoverMm) * MM

  const endDrag = useCallback(() => {
    const s = store.getState()
    const g = group.current
    const d = drag.current
    if (d && g) {
      const target = s.dragTarget
      // 작업대 로컬 좌표로 넘긴다. 장착 애니메이션은 작업대 그룹 안에서 돈다.
      const here: Vec3 = [d.target.x / MM - ox, d.target.y / MM - oy, d.target.z / MM - oz]
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
  }, [part, store, ox, oy, oz])

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current
      if (!d) return
      const rect = gl.domElement.getBoundingClientRect()
      ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1)
      raycaster.setFromCamera(ndc, camera)
      if (raycaster.ray.intersectPlane(d.plane, tmp)) {
        d.target.set(tmp.x + d.offset.x, hoverY, tmp.z + d.offset.z)
        resolveTargets(store, part, d.target, cfg, [ox, oy, oz])
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
        const s = store.getState()
        s.setDragTarget(null)
        s.setDragging(false)
        setControlsEnabled(true)
        document.body.style.cursor = ''
      }
    }
  }, [camera, gl, endDrag, ndc, raycaster, tmp, part, store, cfg, ox, oy, oz, hoverY])

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
      store.getState().setDragging(true)
      document.body.style.cursor = 'grabbing'
    },
    [camera, hoverY, raycaster, store],
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

  const grab = cfg.grabMinMm
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
      <PartGeometry geometry={part.geometry} material={materials.get(part.material)} materials={materials} />
      {/* 잡기 영역: 렌더되지 않지만 레이캐스트에는 잡힌다 */}
      <mesh position={[0, (grab / 2) * MM, 0]}>
        <boxGeometry args={[grab * MM, grab * MM, grab * MM]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  )
}

/**
 * 드래그 중 매 프레임: 단일 부품은 가장 가까운 고스트를 dragTarget으로,
 * 다수 부품은 paintMm 안에 들어온 슬롯을 즉시 장착한다.
 */
function resolveTargets(store: AssemblyStore, part: PartDef, pos: THREE.Vector3, cfg: DragConfig, off: Vec3) {
  const s = store.getState()
  const px = pos.x / MM
  const py = pos.y / MM
  const pz = pos.z / MM
  const { snap, paint } = resolveDragTargets(part, [px - off[0], py, pz - off[2]], cfg, s.mounted)
  if (part.count === 1) {
    s.setDragTarget(snap)
    return
  }
  // 출발점은 잡고 있는 실물 위치. 들고 있는 부품에서 튀어나와 박히는 것처럼 보인다.
  for (const id of paint) s.mount(id, [px - off[0], py - off[1], pz - off[2]])
}
