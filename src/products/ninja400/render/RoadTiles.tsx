import { useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useAssembly } from '../../../engine/context'
import { MM } from '../../../engine/types'
import { ride } from '../finale/rideState'
import { makeTileCanvas, ROAD_M, TEX_M } from './tileTexture'

// 속도를 체감할 바닥(스펙 §3). 차는 원점에 고정이고 타일 무늬가 흘러간다.
// 기존 Floor(검은 평면)는 그대로 밑에 깔린다.

/** 씬 단위 1개가 몇 m인가 — MM(=mm당 단위)에서 나온다. 0.1 → 1 unit = 10 mm = 0.01 m */
const M_PER_UNIT = 1 / (1000 * MM)
/** 바닥 평면 한 변 (씬 단위) = 60 m */
const ROAD_U = (ROAD_M * 1000) * MM
/** 텍스처 한 장이 4.8 m를 덮도록 = 12.5 */
const REPEAT = ROAD_M / TEX_M
/** 기존 Floor(y = -0.002)와 겹치지 않게 살짝 띄운다 (씬 단위) */
/** 타일 평면 높이 (scene units): 엔진 Floor(−0.002) 위, 접촉 그림자(0.001) 아래 — 그림자가 가려지지 않게 (R-5) */
const ROAD_Y = 0.0005
/**
 * 안개 밀도 (1/m → 씬 단위로 ×0.01). 0.045는 22 m 앞을 거의 다 먹어서 타일이 몇 줄 안 보였다.
 * 0.03이면 33 m까지 남는다 — 격자가 더 멀리 보여야 속도가 읽힌다.
 */
const FOG_DENSITY = 0.03 * M_PER_UNIT
/** 장면 배경과 같은 색이라야 멀리가 배경에 녹는다 */
const FOG_COLOR = '#0A0A0B'

export function RoadTiles() {
  const running = useAssembly((s) => s.phase === 'running')
  return running ? <Tiles /> : null
}

function Tiles() {
  const gl = useThree((s) => s.gl)
  const texture = useMemo(() => {
    const tex = new THREE.CanvasTexture(makeTileCanvas())
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    tex.repeat.set(REPEAT, REPEAT)
    tex.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy())
    tex.colorSpace = THREE.SRGBColorSpace
    return tex
  }, [gl])

  useEffect(() => () => texture.dispose(), [texture])

  useFrame(() => {
    // 평면을 x축으로 -90° 돌리면 텍스처 u축이 월드 +x와 같은 방향이다(로컬 +y는 월드 -z).
    // three의 uv 변환은 `uv·repeat + offset`이라, offset.x를 **키우면** 무늬가 -x로 흐른다
    // (s=0인 무늬가 u = -offset/repeat 로 간다). 그래서 스펙의 음수 부호를 뒤집어 양수로 둔다 —
    // 음수면 전진할 때 바닥이 +x(앞)로 흘러 후진처럼 보인다.
    texture.offset.x = (ride.distance % TEX_M) / TEX_M
  })

  return (
    // 그림자 카메라 범위(±2.4 m) 안쪽만 그림자 샘플링으로 살짝 어두워져 네모 판처럼 보였다 —
    // 접촉 그림자만으로 충분하다.
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, ROAD_Y, 0]} receiveShadow={false}>
      <planeGeometry args={[ROAD_U, ROAD_U]} />
      <meshStandardMaterial map={texture} roughness={0.95} metalness={0} />
    </mesh>
  )
}

/**
 * running 동안만 지수 안개를 건다. R3F의 `attach="fog"`는 언마운트해도 원복하지 않으므로
 * 장면 객체를 직접 만진다.
 */
export function RideFog() {
  const running = useAssembly((s) => s.phase === 'running')
  const scene = useThree((s) => s.scene)
  useEffect(() => {
    if (!running) return
    scene.fog = new THREE.FogExp2(FOG_COLOR, FOG_DENSITY)
    return () => {
      scene.fog = null
    }
  }, [running, scene])
  return null
}
