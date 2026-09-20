import { Component, Suspense, useMemo, useRef, type ReactNode } from 'react'
import { useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import type { GLTFLoader } from 'three-stdlib'
import { useAssembly, useProduct } from '../../../engine/context'
import { isAssemblyHidden } from '../../../engine/store'
import { frontWheelRpm, wheelRpm } from '../finale/rideModel'
import { ride } from '../finale/rideState'

// 완성차 실물 모델(ZX-6R, CC-BY). scripts/prepare-ride-model.mjs가 저장소 좌표계로 구워 둔
// ride.glb를 그대로 놓는다 — 좌표·스케일 보정이 없다. 키가 마지막 하나로 남는 순간
// (product.assemblyHidden) 절차 조립체 대신 이것이 선다.

const URL = '/models/ninja400/ride.glb'
/** 나타날 때 페이드 시간 (초) */
const FADE_S = 0.5
/** rpm → rad/s */
const RAD_PER_RPM = (2 * Math.PI) / 60
/** 탭 전환 등으로 프레임이 밀렸을 때 회전이 튀지 않게 */
const MAX_DT = 0.1

const withMeshopt = (loader: GLTFLoader) => {
  loader.setMeshoptDecoder(MeshoptDecoder)
}

// 조립하는 동안 미리 받아 둔다 — 키를 꽂는 순간에는 이미 디코드가 끝나 있어야 한다.
useGLTF.preload(URL, undefined, undefined, withMeshopt)

/** 실물 모델. 보일 조건은 제품의 assemblyHidden과 같다 (조립체가 사라진 자리에 선다) */
export function RideModel() {
  const product = useProduct()
  const visible = useAssembly((s) => isAssemblyHidden(product, s))
  return (
    <RideModelBoundary>
      <Suspense fallback={null}>{visible ? <RideScene /> : null}</Suspense>
    </RideModelBoundary>
  )
}

function RideScene() {
  const { scene } = useGLTF(URL, undefined, undefined, withMeshopt)
  const start = useRef(0)
  const fading = useRef(true)

  // 재질은 한 번만 clone한다 — useGLTF 캐시가 준 원본을 그대로 건드리면 다음 로드가 반투명해진다
  const { materials, wheelFront, wheelRear } = useMemo(() => {
    const materials: THREE.Material[] = []
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      mesh.castShadow = true
      mesh.receiveShadow = true
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      const cloned = list.map((m) => {
        const c = m.clone()
        c.transparent = true
        c.opacity = 0
        materials.push(c)
        return c
      })
      mesh.material = Array.isArray(mesh.material) ? cloned : cloned[0]
    })
    return {
      materials,
      wheelFront: scene.getObjectByName('wheel_front') ?? null,
      wheelRear: scene.getObjectByName('wheel_rear') ?? null,
    }
  }, [scene])

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

/** 모델을 못 받거나 디코드가 실패하면 조용히 없던 일로 한다 — 경고는 한 번만 */
class RideModelBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: unknown) {
    console.warn('[ninja400] 실물 모델을 불러오지 못했다 — 조립체만 보여 준다', error)
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}
