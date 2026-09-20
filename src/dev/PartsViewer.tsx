import { Suspense, useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import { Html, OrbitControls, useGLTF } from '@react-three/drei'
import * as THREE from 'three'

// 개발 전용: 나눠 놓은 모델 조각을 색으로 구분해 보여 준다. 조각 이름 붙이기(부품 매핑) 작업용.
// 쿼리: ?min=100 (라벨 최소 삼각형 수) &only=0,3,5 (그 조각만) &labels=0 (라벨 끄기) &dim=1 (only 밖은 흐리게)
//   &url=/models/ninja400/ride.glb (다른 모델 보기) &scale=1 (이미 저장소 좌표(1u=10mm)로 구운 모델은 1)

const DEFAULT_URL = '/models/ninja400/parts.gltf'
/** parts.gltf는 m 단위라 100배, 저장소 좌표로 구운 ride.glb는 1배 */
const DEFAULT_SCALE = 100

function colorFor(i: number) {
  const c = new THREE.Color()
  c.setHSL(((i * 0.618034) % 1), 0.7, 0.55)
  return c
}

function Model({ url, scale, only, min, labels, dim }: { url: string; scale: number; only: Set<number> | null; min: number; labels: boolean; dim: boolean }) {
  const gltf = useGLTF(url)
  const items = useMemo(() => {
    const out: { i: number; label: string; mesh: THREE.Mesh; tris: number; center: THREE.Vector3 }[] = []
    gltf.scene.traverse((o) => {
      if (!(o as THREE.Mesh).isMesh) return
      const mesh = o as THREE.Mesh
      // split-gltf가 만든 조각은 이름이 '#12'다. 이름이 붙은 모델(ride.glb)은 이름을 그대로 쓴다
      const n = Number(mesh.name.slice(1))
      const i = Number.isFinite(n) ? n : out.length
      const geo = mesh.geometry
      geo.computeBoundingBox()
      const center = new THREE.Vector3()
      geo.boundingBox!.getCenter(center)
      out.push({ i, label: Number.isFinite(n) ? String(i) : mesh.name, mesh, tris: (geo.index?.count ?? 0) / 3, center })
    })
    return out.sort((a, b) => a.i - b.i)
  }, [gltf])
  return (
    <group scale={scale}>
      {items.map(({ i, label, mesh, tris, center }) => {
        const inOnly = !only || only.has(i)
        if (!inOnly && !dim) return null
        return (
          <group key={i}>
            <mesh geometry={mesh.geometry}>
              <meshStandardMaterial color={colorFor(i)} transparent={!inOnly} opacity={inOnly ? 1 : 0.08} depthWrite={inOnly} />
            </mesh>
            {labels && inOnly && tris >= min ? (
              <Html position={center} center style={{ font: '11px monospace', color: '#fff', background: 'rgba(0,0,0,0.6)', padding: '1px 3px', pointerEvents: 'none' }}>
                {label}
              </Html>
            ) : null}
          </group>
        )
      })}
    </group>
  )
}

export function PartsViewer() {
  const q = new URLSearchParams(window.location.search)
  const only = q.get('only') ? new Set(q.get('only')!.split(',').map(Number)) : null
  const min = Number(q.get('min') ?? 100)
  const labels = q.get('labels') !== '0'
  const dim = q.get('dim') === '1'
  const url = q.get('url') ?? DEFAULT_URL
  const scale = Number(q.get('scale') ?? (url === DEFAULT_URL ? DEFAULT_SCALE : 1))
  const az = Number(q.get('az') ?? 35) * Math.PI / 180
  const el = Number(q.get('el') ?? 25) * Math.PI / 180
  const dist = Number(q.get('dist') ?? 350)
  const pos: [number, number, number] = [dist * Math.cos(el) * Math.sin(az), dist * Math.sin(el) + 60, dist * Math.cos(el) * Math.cos(az)]
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#202226' }}>
      <Canvas camera={{ position: pos, fov: 40, near: 1, far: 5000 }}>
        <ambientLight intensity={0.8} />
        <directionalLight position={[300, 500, 200]} intensity={1.5} />
        <directionalLight position={[-300, 200, -200]} intensity={0.6} />
        <gridHelper args={[400, 40, '#555', '#333']} />
        <axesHelper args={[100]} />
        <Suspense fallback={null}>
          <Model url={url} scale={scale} only={only} min={min} labels={labels} dim={dim} />
        </Suspense>
        <OrbitControls target={[0, 60, 0]} />
      </Canvas>
    </div>
  )
}
