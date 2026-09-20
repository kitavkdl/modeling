import { ContactShadows, Environment, Lightformer } from '@react-three/drei'
import { useAssembly, useProduct } from '../context'
import { isFloorHidden } from '../store'
import { MM } from '../types'

// 조명: 키라이트 1 + 림라이트 1 + 약한 환경광. 그 이상 두지 않는다.
// 알루미늄(metalness 0.9)은 반사할 환경이 없으면 검게 보이므로, 두 조명과 같은 방향에
// 놓인 발광판 2개로 절차적 환경맵을 만든다. 외부 HDR 파일은 쓰지 않는다.
export function Lights() {
  const { shadowBoundsMm } = useProduct().environment
  /** 그림자 카메라 반경 (units). 조명 거리를 제품 크기에 맞춘다. */
  const r = shadowBoundsMm * MM
  // 발광판 위치는 기준 반경 30 units에서 잡은 값이라 같은 비율로 늘린다.
  const k = r / 30
  return (
    <>
      <Environment resolution={256} frames={1} environmentIntensity={1}>
        {/* 어두운 회색 돔: 금속이 반사할 바탕 톤 */}
        <color attach="background" args={['#4a4b4e']} />
        <Lightformer form="rect" intensity={2.5} color="#e9f0ff" position={[14 * k, 20 * k, 11 * k]} scale={[18, 10, 1]} target={[0, 0, 0]} />
        <Lightformer form="rect" intensity={2} color="#cfd6e6" position={[-15 * k, 9 * k, -13 * k]} scale={[14, 6, 1]} target={[0, 0, 0]} />
        <Lightformer form="rect" intensity={0.35} color="#ffffff" position={[0, 25 * k, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[30, 30, 1]} />
      </Environment>
      <ambientLight intensity={0.18} color="#dfe4ee" />
      <directionalLight
        position={[r * 0.93, r * 1.33, r * 0.73]}
        intensity={2.6}
        color="#e9f0ff"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-camera-left={-r}
        shadow-camera-right={r}
        shadow-camera-top={r}
        shadow-camera-bottom={-r}
        shadow-camera-near={Math.max(0.5, r * 0.15)}
        shadow-camera-far={r * 4}
      />
      <directionalLight position={[-r, r * 0.6, -r * 0.87]} intensity={1.1} color="#cfd6e6" />
    </>
  )
}

// 바닥: 무한 평면 + 접촉 그림자. 반사 없음.
//
// 제품이 이 위에 자기 바닥을 깔면(닌자 400의 주행 타일, y = +0.0005 units = +0.005 mm) 두 평면이
// 0.0025 units(= 0.025 mm)밖에 안 떨어져 있다. near 0.5 / far 4200 units의 깊이 버퍼는 2000~4000 units
// (20~40 m) 거리에서 이만큼을 구분하지 못해, 이 평면이 덮는 ±1000 units(±10 m) 안쪽에서만 타일이 지고
// 바깥에는 남는다 — 화면에 20 m짜리 '네모칸'이 생긴다. 그래서 두 가지를 같이 건다:
//   1) polygonOffset으로 이 평면을 깊이 방향으로 밀어낸다 (제품 바닥이 없을 때도 안전한 일반 조치)
//   2) 제품이 floorHidden을 올리면 아예 그리지 않는다 — 밀어내기만으로는 스치는 각도에서
//      이 평면의 색이 여전히 배어 나온다
// 접촉 그림자는 두 경우 모두 그린다. 높이 순서는 기본 바닥(−0.002) < 타일(+0.0005) < 그림자(+0.001)라
// 그림자가 타일 위에 남는다 — 여기서 바꿀 것이 없다.
export function Floor() {
  const product = useProduct()
  const { contactShadowSizeMm, shadowBoundsMm } = product.environment
  const hidden = useAssembly((s) => isFloorHidden(product, s))
  const [w, d] = contactShadowSizeMm
  const r = shadowBoundsMm * MM
  return (
    <>
      {hidden ? null : (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.002, 0]} receiveShadow>
          <planeGeometry args={[2000, 2000]} />
          <meshStandardMaterial
            color="#0d0d0f"
            metalness={0}
            roughness={1}
            polygonOffset
            polygonOffsetFactor={4}
            polygonOffsetUnits={4}
          />
        </mesh>
      )}
      <ContactShadows
        position={[0, 0.001, 0]}
        width={w * MM}
        height={d * MM}
        far={r * 0.4}
        blur={2.2}
        opacity={0.75}
        resolution={1024}
        frames={Infinity}
      />
    </>
  )
}
