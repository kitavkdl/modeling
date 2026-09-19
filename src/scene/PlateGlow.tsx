import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { LAYOUT_D, LAYOUT_W, MM, Y_KEYCAP } from '../products/keyboard/parts'
import { useAssembly } from '../store/assembly'
import { RGB_COLOR } from './materials'
import { BOOT_WAVE_MS, BREATH_PERIOD_MS } from './rgb'

// 키 개수만큼 PointLight를 두는 대신, 키캡 바로 아래(스위치 윗면 높이)에 얹은
// 가산 혼합 평면 하나로 키캡 사이 틈에서 새어 나오는 빛을 흉내 낸다. 드로우콜 1개.

const vertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const fragment = /* glsl */ `
  uniform float uFront;   // 웨이브 전선 위치 (0~1), 점등 후에는 2
  uniform float uLevel;   // 정상 밝기 0~1
  uniform vec3 uColor;
  varying vec2 vUv;
  void main() {
    // 좌하단 0 → 우상단 1 (평면은 -x/2 로 회전했으므로 uv.y가 앞뒤)
    float order = (vUv.x + vUv.y) * 0.5;
    float d = uFront - order;
    float lit = d <= 0.0 ? 0.0 : min(1.0, d * 6.0);
    float peak = exp(-d * d * 220.0);
    float a = lit * uLevel * 0.45 + peak * 0.7;
    // 가장자리로 갈수록 옅게
    float edge = smoothstep(0.0, 0.08, vUv.x) * smoothstep(0.0, 0.08, 1.0 - vUv.x)
               * smoothstep(0.0, 0.12, vUv.y) * smoothstep(0.0, 0.12, 1.0 - vUv.y);
    gl_FragColor = vec4(mix(uColor, vec3(1.0), peak) * a * edge, 1.0);
  }
`

export function PlateGlow() {
  const mat = useRef<THREE.ShaderMaterial>(null)
  const uniforms = useMemo(
    () => ({
      uFront: { value: -1 },
      uLevel: { value: 0 },
      uColor: { value: RGB_COLOR.clone() },
    }),
    [],
  )

  useFrame(() => {
    const m = mat.current
    if (!m) return
    const s = useAssembly.getState()
    const now = performance.now()
    if (s.phase === 'booting') {
      const t = (now - s.phaseAt) / BOOT_WAVE_MS
      m.uniforms.uFront.value = t * 1.15 - 0.05
      m.uniforms.uLevel.value = 1
    } else if (s.phase === 'on') {
      m.uniforms.uFront.value = 2
      m.uniforms.uLevel.value = 0.72 + 0.28 * Math.cos(((now - s.phaseAt) / BREATH_PERIOD_MS) * Math.PI * 2)
    } else {
      m.uniforms.uFront.value = -1
      m.uniforms.uLevel.value = 0
    }
  })

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, (Y_KEYCAP - 1.6) * MM, 0]}>
      <planeGeometry args={[LAYOUT_W * MM, LAYOUT_D * MM]} />
      <shaderMaterial
        ref={mat}
        vertexShader={vertex}
        fragmentShader={fragment}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  )
}
