import { Component, Suspense, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useAssembly, useAssemblyStore, useProduct } from '../../../engine/context'
import type { AssemblyStore } from '../../../engine/store'
import { isAssemblyHidden } from '../../../engine/store'
import { frontWheelRpm, wheelRpm } from '../finale/rideModel'
import { ride } from '../finale/rideState'

// 완성차 실물 모델(ZX-6R, CC-BY). scripts/prepare-ride-model.mjs가 저장소 좌표계로 구워 둔
// ride.glb를 그대로 놓는다 — 좌표·스케일 보정이 없다. 키가 마지막 하나로 남는 순간
// (product.assemblyHidden) 절차 조립체 대신 이것이 선다.
// 못 받거나 디코드가 실패하면 실패를 기록하고 절차 조립체를 그대로 쓴다 (스펙 §1.3).

const URL = '/models/ninja400/ride.glb'
/** 나타날 때 페이드 시간 (초) */
const FADE_S = 0.5
/** rpm → rad/s */
const RAD_PER_RPM = (2 * Math.PI) / 60
/** 탭 전환 등으로 프레임이 밀렸을 때 회전이 튀지 않게 */
const MAX_DT = 0.1

// 조립하는 동안 미리 받아 둔다 — 키를 꽂는 순간에는 이미 디코드가 끝나 있어야 한다.
// meshopt 디코더는 drei가 기본으로 붙여 준다(useGLTF의 useMeshopt 기본값 true).
useGLTF.preload(URL)

const status = { failed: false }

/** 실물 모델을 못 띄웠는가. 한 번 실패하면 새로고침 전까지 유지된다 */
export const rideModelFailed = (): boolean => status.failed

/**
 * 실패를 기록한다. 제품의 assemblyHidden이 이 값을 보고 절차 조립체를 도로 보여 준다.
 * 스토어 값이 바뀐 게 아니라 셀렉터가 다시 돌 이유가 없으므로, 빈 setState로 구독자를 한 번 깨운다.
 */
export function markRideModelFailed(store?: AssemblyStore): void {
  if (status.failed) return
  status.failed = true
  store?.setState({})
}

/** 실물 모델. 보일 조건은 제품의 assemblyHidden과 같다 (조립체가 사라진 자리에 선다) */
export function RideModel() {
  const product = useProduct()
  const store = useAssemblyStore()
  const visible = useAssembly((s) => isAssemblyHidden(product, s))
  return (
    <RideModelBoundary store={store}>
      <Suspense fallback={null}>{visible ? <RideScene /> : null}</Suspense>
    </RideModelBoundary>
  )
}

function RideScene() {
  const { scene } = useGLTF(URL)
  const start = useRef(0)
  const fading = useRef(true)

  // 재질은 원본 하나당 한 번만 clone해서 그 재질을 쓰는 메시 전부에 물린다 — useGLTF 캐시가 준
  // 원본을 직접 건드리면 다음 로드가 반투명해지고, 메시마다 clone하면 같은 재질이 수십 개로 불어난다.
  const { materials, wheelFront, wheelRear } = useMemo(() => {
    const byOriginal = new Map<THREE.Material, THREE.Material>()
    const cloneOf = (m: THREE.Material) => {
      const hit = byOriginal.get(m)
      if (hit) return hit
      const c = m.clone()
      byOriginal.set(m, c)
      return c
    }
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      mesh.castShadow = true
      mesh.receiveShadow = true
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(cloneOf) : cloneOf(mesh.material)
    })
    return {
      materials: [...byOriginal.values()],
      wheelFront: scene.getObjectByName('wheel_front') ?? null,
      wheelRear: scene.getObjectByName('wheel_rear') ?? null,
    }
  }, [scene])

  // 보일 때마다 처음부터 페이드한다. clone은 여기서 만들지 않으므로 다시 보여도 늘어나지 않는다.
  useEffect(() => {
    start.current = 0
    fading.current = true
    for (const m of materials) {
      m.transparent = true
      m.opacity = 0
      m.needsUpdate = true
    }
    return () => {
      for (const m of materials) m.dispose()
    }
  }, [materials])

  useFrame((_, raw) => {
    const dt = Math.min(raw, MAX_DT)

    if (fading.current) {
      if (start.current === 0) start.current = performance.now()
      const k = Math.min(1, (performance.now() - start.current) / (FADE_S * 1000))
      for (const m of materials) m.opacity = k
      if (k >= 1) {
        fading.current = false
        for (const m of materials) {
          m.transparent = false
          m.opacity = 1
          m.needsUpdate = true
        }
      }
    }

    if (ride.speed === 0) return
    // +x가 앞, +z가 오른쪽이면 +z 둘레 양의 회전은 바퀴 위쪽을 뒤로 민다(오른손 법칙:
    // 위 (0,r) → (−r dθ, 0)). 앞으로 굴러가려면 음의 회전이다 — RideParts의 Spinner와 같은 부호.
    if (wheelFront) wheelFront.rotation.z -= frontWheelRpm(ride.speed) * RAD_PER_RPM * dt
    if (wheelRear) wheelRear.rotation.z -= wheelRpm(ride.speed) * RAD_PER_RPM * dt
  })

  return <primitive object={scene} />
}

/** 모델을 못 받거나 디코드가 실패하면 실패를 기록하고 조용히 빠진다 — 경고는 한 번만 */
class RideModelBoundary extends Component<{ store: AssemblyStore; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: unknown) {
    console.warn('[ninja400] 실물 모델을 불러오지 못했다 — 절차 조립체를 그대로 쓴다', error)
    markRideModelFailed(this.props.store)
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}
