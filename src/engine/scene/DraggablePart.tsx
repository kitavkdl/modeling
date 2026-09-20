import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { useAssembly, useAssemblyStore, useMaterials, useProduct } from '../context'
import { easeOutCubic } from '../easing'
import { PartGeometry } from '../geometry/PartGeometry'
import { isStationSeated } from '../store'
import { MM, type PartDef, type Vec3 } from '../types'
import { cancelCameraTween, setControlsEnabled } from './controlsRef'
import { resolveAlongSegment, resolveDragTargets, thresholdPx, type GhostPx, type ScreenPt } from './dragMath'

// 트레이에서 고른 부품의 실물. 대기 위치에 놓여 있고, 잡아서 끌 수 있다.
// 단일 부품: 고스트 위에 겹쳐 놓으면 장착. 멀리서 놓으면 제자리로 돌아간다.
// 다수 부품: 하나를 잡고 슬롯 위를 지나가면 지나간 자리마다 장착된다.
//
// 이동면은 잡은 지점을 지나는 "카메라 정면" 평면이다. 카메라를 어느 각도로 돌려놔도
// 부품은 커서에 붙어 다니고, 판정도 화면 좌표로 하므로 눈에 겹쳐 보이면 그대로 장착된다.

/** 놓쳤을 때 제자리로 돌아가는 시간 */
const RETURN_MS = 300
/** 림 조명이 부품 표면에 주는 조도(점광원 세기 = 조도 × 거리²) */
const RIM_IRRADIANCE = 4.5

interface DragState {
  /** 잡은 지점을 지나는, 카메라를 향한 평면 */
  plane: THREE.Plane
  /** 커서 교점 → 부품 원점 오프셋 (units) */
  offset: THREE.Vector3
  /** 커서가 가리키는 부품 위치 (units). 판정·렌더·장착 출발점 모두 이 값 */
  target: THREE.Vector3
}

interface ReturnState {
  from: THREE.Vector3
  start: number
}

/** 월드 좌표를 캔버스 좌상단 기준 픽셀로 옮겨 out에 덮어쓴다. pointermove마다 도는 자리라 새 객체를 만들지 않는다. */
function projectPx(v: THREE.Vector3, camera: THREE.Camera, rect: DOMRect, ndc: THREE.Vector3, out: ScreenPt): ScreenPt {
  ndc.copy(v).project(camera)
  out.x = ((ndc.x + 1) / 2) * rect.width
  out.y = ((1 - ndc.y) / 2) * rect.height
  return out
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
  const visual = useRef<THREE.Group>(null)
  const grabMesh = useRef<THREE.Mesh>(null)
  const drag = useRef<DragState | null>(null)
  const returning = useRef<ReturnState | null>(null)
  /** 직전 pointermove에서의 부품 화면 좌표. 그 사이 구간을 잘라 밟으며 페인팅한다.
   *  값을 덮어쓰는 고정 객체라 "직전 값이 있는가"는 hasPrev로 따로 든다. */
  const prevPx = useRef<ScreenPt>({ x: 0, y: 0 }).current
  const hasPrev = useRef(false)
  /** 이번 pointermove의 부품 화면 좌표 */
  const partPx = useRef<ScreenPt>({ x: 0, y: 0 }).current
  const { camera, gl } = useThree()
  const raycaster = useRef(new THREE.Raycaster()).current
  const ndc = useRef(new THREE.Vector2()).current
  const tmp = useRef(new THREE.Vector3()).current
  const anchor = useRef(new THREE.Vector3()).current
  const proj = useRef(new THREE.Vector3()).current

  const product = useProduct()
  const materials = useMaterials()
  const store = useAssemblyStore()
  const cfg = product.drag

  // 고스트 목록을 pointermove마다 새로 쌓으면 인스턴스 수만큼 객체가 쏟아진다(키캡 83개 × 2).
  // 부품이 바뀔 때 한 번만 인스턴스당 하나씩 만들어 두고, 매 move에서는 좌표만 덮어쓴다.
  const ghostPool = useMemo<GhostPx[]>(
    () => part.instances.map((inst) => ({ id: inst.id, px: { x: 0, y: 0 }, radiusPx: 0 })),
    [part],
  )
  /** 이번 move에서 아직 장착되지 않은 고스트만 담는 재사용 배열 */
  const ghostList = useRef<GhostPx[]>([]).current

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
    hasPrev.current = false
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
      if (!raycaster.ray.intersectPlane(d.plane, tmp)) return
      d.target.copy(tmp).add(d.offset)

      // 판정은 화면에서 한다: 고스트와 부품을 둘 다 픽셀로 투영하고, 반경 안에 들어오면 장착.
      const fov = (camera as THREE.PerspectiveCamera).fov ?? 40
      const radiusMm = part.count === 1 ? cfg.snapMm : cfg.paintMm
      const mounted = store.getState().mounted
      const ghosts = ghostList
      ghosts.length = 0
      for (let i = 0; i < part.instances.length; i++) {
        const inst = part.instances[i]
        if (mounted[inst.id]) continue
        anchor.set(
          (inst.mountPosition[0] + ox) * MM,
          (inst.mountPosition[1] + oy) * MM,
          (inst.mountPosition[2] + oz) * MM,
        )
        const dist = camera.position.distanceTo(anchor)
        const g = ghostPool[i]
        projectPx(anchor, camera, rect, proj, g.px)
        g.radiusPx = thresholdPx(radiusMm, dist, rect.height, fov)
        ghosts.push(g)
      }
      projectPx(d.target, camera, rect, proj, partPx)
      const s = store.getState()
      if (part.count === 1) {
        s.setDragTarget(resolveDragTargets(part, partPx, ghosts, mounted).snap)
        prevPx.x = partPx.x
        prevPx.y = partPx.y
        hasPrev.current = true
        return
      }
      // 포인터가 한 번에 판정 반경의 2배 넘게 뛰면 사이의 슬롯이 빠진다.
      // 직전 위치에서 지금 위치까지를 가장 작은 반경의 절반 간격으로 밟으며 지나간 자리를 전부 박는다.
      const from = hasPrev.current ? prevPx : partPx
      const stepPx = ghosts.reduce((m, g) => Math.min(m, g.radiusPx), Infinity) / 2
      // 출발점은 잡고 있는 실물 위치. 들고 있는 부품에서 튀어나와 박히는 것처럼 보인다.
      const dropAt: Vec3 = [d.target.x / MM - ox, d.target.y / MM - oy, d.target.z / MM - oz]
      for (const id of resolveAlongSegment(part, from, partPx, ghosts, mounted, stepPx)) s.mount(id, dropAt)
      prevPx.x = partPx.x
      prevPx.y = partPx.y
      hasPrev.current = true
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
        hasPrev.current = false
        const s = store.getState()
        s.setDragTarget(null)
        s.setDragging(false)
        setControlsEnabled(true)
        document.body.style.cursor = ''
      }
    }
  }, [camera, gl, endDrag, ndc, raycaster, tmp, anchor, proj, part, store, cfg, ox, oy, oz, ghostPool, ghostList, partPx, prevPx])

  const onPointerDown = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (e.button !== 0 || drag.current) return
      const g = group.current
      if (!g) return
      e.stopPropagation()
      setControlsEnabled(false)
      cancelCameraTween()
      returning.current = null
      // 잡은 지점을 지나는 카메라 정면 평면 위에서만 움직인다. 이 평면은 화면에 평행하므로
      // 커서를 따라가는 동안 잡은 지점이 늘 커서 아래에 있고, 화면에서 겹쳐 보이면 실제로도 맞는다.
      const normal = camera.getWorldDirection(new THREE.Vector3()).negate()
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, e.point)
      const offset = g.position.clone().sub(e.point)
      drag.current = { plane, offset, target: g.position.clone() }
      hasPrev.current = false
      store.getState().setDragging(true)
      document.body.style.cursor = 'grabbing'
    },
    [camera, store],
  )

  // 잡기 영역: 그려진 지오메트리의 실제 크기(Box3)에 맞추고, 너무 작으면 grabMinMm까지 키운다.
  const grabSized = useRef(false)
  const grabRetry = useRef(true)
  /** 대기 부품을 뒤에서 비추는 림 조명. 카메라 반대편 위에 두어 윤곽이 배경에서 떨어져 보이게 한다 */
  const rim = useRef<THREE.PointLight>(null)
  const rimDist = useRef(3)
  const rimTmp = useRef(new THREE.Vector3()).current
  const sizeGrab = useCallback(() => {
    const v = visual.current
    const m = grabMesh.current
    if (!v || !m) return false
    v.updateWorldMatrix(true, true)
    const box = new THREE.Box3().setFromObject(v)
    if (box.isEmpty()) return false
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    const minSide = cfg.grabMinMm * MM
    // 렌더 그룹은 회전 없이 rest에 놓여 있으므로 월드 차이가 그대로 그룹 로컬 오프셋이다
    m.position.copy(center).sub(v.getWorldPosition(new THREE.Vector3()))
    rimDist.current = Math.max(2, Math.max(size.x, size.y, size.z) * 1.6)
      m.scale.set(Math.max(size.x, minSide), Math.max(size.y, minSide), Math.max(size.z, minSide))
    return true
  }, [cfg.grabMinMm])

  useLayoutEffect(() => {
    grabSized.current = sizeGrab()
    grabRetry.current = !grabSized.current
  }, [part, sizeGrab])

  useFrame(() => {
    // 첫 레이아웃에서 박스가 비어 있었다면(지오메트리가 아직 없던 경우) 한 번만 더 잰다
    if (grabRetry.current) {
      grabRetry.current = false
      grabSized.current = sizeGrab()
    }
    const g = group.current
    if (!g) return
    if (rim.current) {
      // 카메라 → 부품 방향으로 부품 뒤쪽, 그리고 위로 띄운다. 그룹 로컬 좌표(그룹은 회전 없음)
      rimTmp.copy(g.position).sub(camera.position).normalize().multiplyScalar(rimDist.current)
      rimTmp.y += rimDist.current * 0.35
      rim.current.position.copy(rimTmp)
      rim.current.intensity = RIM_IRRADIANCE * rimDist.current * rimDist.current
      rim.current.distance = rimDist.current * 3
    }
    const d = drag.current
    if (d) {
      g.position.lerp(d.target, 0.5)
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
      <group ref={visual}>
        <PartGeometry geometry={part.geometry} material={materials.get(part.material)} materials={materials} />
      </group>
      <pointLight ref={rim} color="#dfe8ff" intensity={40} distance={9} decay={2} />
      {/* 잡기 영역: 렌더되지 않지만 레이캐스트에는 잡힌다 */}
      <mesh ref={grabMesh}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  )
}
