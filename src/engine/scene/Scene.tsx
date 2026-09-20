import { Canvas } from '@react-three/fiber'
import * as THREE from 'three'
import { useProduct } from '../context'
import { MM } from '../types'
import { Assembly } from './Assembly'
import { CameraRig, viewToPosition } from './CameraRig'
import { DraggablePart } from './DraggablePart'
import { Floor, Lights } from './Environment'
import { setRig } from './rigRef'

export function Scene() {
  const product = useProduct()
  const { Finale, camera } = product
  const target = new THREE.Vector3(camera.target[0] * MM, camera.target[1] * MM, camera.target[2] * MM)
  const pos = viewToPosition(camera.initial, target, camera)
  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ position: [pos.x, pos.y, pos.z], fov: 32, near: 0.5, far: camera.maxDistanceMm * MM * 6 }}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      onPointerMissed={() => {
        /* 빈 곳 클릭은 선택을 유지한다 */
      }}
    >
      <color attach="background" args={['#0A0A0B']} />
      <Lights />
      <Floor />
      {/* 차체에 붙은 것은 전부 이 그룹 안이다 — 제품이 기울이면(rigRef) 조립체·드래그 부품·
          제품 연출이 한 덩어리로 같이 눕는다. 바닥·조명·카메라는 밖에 남는다. */}
      <group ref={setRig}>
        <Assembly />
        <DraggablePart />
        <Finale />
      </group>
      <CameraRig />
    </Canvas>
  )
}
