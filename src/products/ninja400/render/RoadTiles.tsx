import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useAssembly } from '../../../engine/context'
import { MM } from '../../../engine/types'
import { turnRate } from '../finale/rideModel'
import { ride } from '../finale/rideState'
import { makeTileCanvas, ROAD_M, TEX_M } from './tileTexture'

// 속도를 체감할 바닥(스펙 §3). 차는 원점에 고정이고 타일 무늬가 흘러간다.
// running 동안에는 엔진 Floor(검은 평면)를 제품이 내린다 (product.floorHidden) — 0.0025 units
// 차이로 겹쳐 있어 20 m 밖에서 z-파이팅이 났다. 이 평면 하나가 바닥을 전부 맡는다.

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
/** 탭 전환 등으로 프레임이 밀렸을 때 무늬가 튀지 않게 (초) */
const MAX_DT = 0.1

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

  // 무늬가 흘러간 누적량(텍스처 장 수)과 진행 방향. Tiles는 running 동안에만 마운트되므로
  // running이 끝나면 이 ref가 통째로 버려진다 — 그것이 heading 초기화다.
  const flow = useRef({ u: 0, v: 0, heading: 0 })

  useFrame((_, raw) => {
    const dt = Math.min(raw, MAX_DT)
    const speed = ride.speed // m/s

    // 평면을 x축으로 -90° 돌리면 텍스처 u축이 월드 +x, v축이 월드 −z와 같은 방향이다
    // (로컬 +y → 월드 −z). three의 uv 변환은 `uv·repeat + offset`이라, offset을 키우면
    // 무늬는 그 축의 **음의 방향**으로 흐른다 (한 장 = TEX_M 미터).
    //
    // 차는 원점에 고정이고 무늬가 흐르므로, 무늬의 변위는 차 속도의 반대다.
    // 기울기가 선회를 만들고(turnRate), 선회가 진행 방향(heading, 월드 +x 기준 rad)을 돌린다.
    flow.current.heading += turnRate(ride.lean, speed) * dt
    const h = flow.current.heading
    const dx = speed * Math.cos(h) * dt // m, 월드 +x (차 앞쪽)
    const dz = speed * Math.sin(h) * dt // m, 월드 +z (차 오른쪽)
    // u축(= +x): 무늬를 −dx 만큼 옮기려면 offset을 +dx/TEX_M 만큼 키운다.
    // v축(= −z): 무늬를 −dz 만큼(월드 z 기준) 옮기는 것은 v축으로 +dz 이므로 offset은 −dz/TEX_M.
    // 오른쪽으로 기울면 dz > 0 → 바닥이 −z(화면 왼쪽)로 흘러 차가 오른쪽으로 도는 것으로 읽힌다.
    flow.current.u += dx / TEX_M
    flow.current.v -= dz / TEX_M
    // 부동소수 정밀도를 지키려고 소수부만 남긴다. ride.distance는 다른 소비자(계기·사운드)를 위해 그대로 둔다.
    texture.offset.x = flow.current.u - Math.floor(flow.current.u)
    texture.offset.y = flow.current.v - Math.floor(flow.current.v)
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
