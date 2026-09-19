import { ContactShadows, Environment, Lightformer } from '@react-three/drei'
import { useProduct } from '../context'
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
        shadow-camera-near={5}
        shadow-camera-far={r * 4}
      />
      <directionalLight position={[-r, r * 0.6, -r * 0.87]} intensity={1.1} color="#cfd6e6" />
    </>
  )
}

// 바닥: 무한 평면 + 접촉 그림자. 반사 없음.
export function Floor() {
  const [w, d] = useProduct().environment.contactShadowSizeMm
  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.002, 0]} receiveShadow>
        <planeGeometry args={[2000, 2000]} />
        <meshStandardMaterial color="#0d0d0f" metalness={0} roughness={1} />
      </mesh>
      <ContactShadows
        position={[0, 0.001, 0]}
        width={w * MM}
        height={d * MM}
        far={12}
        blur={2.2}
        opacity={0.75}
        resolution={1024}
        frames={Infinity}
      />
    </>
  )
}
