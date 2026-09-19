import { Canvas } from '@react-three/fiber'
import { Cable, PowerSequence } from './Cable'
import { CameraRig } from './CameraRig'
import { Floor, Lights } from './Environment'
import { Keyboard } from './Keyboard'
import { PlateGlow } from './PlateGlow'
import { StagedPart } from './StagedPart'

export function Scene() {
  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ position: [18, 32, 48], fov: 32, near: 0.5, far: 400 }}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      onPointerMissed={() => {
        /* 빈 곳 클릭은 선택을 유지한다 */
      }}
    >
      <color attach="background" args={['#0A0A0B']} />
      <Lights />
      <Floor />
      <Keyboard />
      <StagedPart />
      <PlateGlow />
      <Cable />
      <PowerSequence />
      <CameraRig />
    </Canvas>
  )
}
