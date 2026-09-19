import { useMemo } from 'react'
import * as THREE from 'three'
import { RoundedBox } from '@react-three/drei'
import { MM, type Geometry, type Vec3 } from '../data/parts'

// 부품 지오메트리를 프리미티브로 그린다. 그룹 원점은 부품 밑면 중심.
// 모든 입력은 mm이고 여기서 MM을 곱한다.

const u = (mm: number) => mm * MM
const v3 = (p: Vec3): [number, number, number] => [u(p[0]), u(p[1]), u(p[2])]

const keycapCache = new Map<string, THREE.BufferGeometry>()

/** 사다리꼴 키캡: BoxGeometry의 윗면 꼭짓점을 안쪽으로 당긴다. */
export function keycapGeometry(bottom: [number, number], top: [number, number], h: number) {
  const key = `${bottom[0]},${bottom[1]},${top[0]},${top[1]},${h}`
  let g = keycapCache.get(key)
  if (g) return g
  g = new THREE.BoxGeometry(u(bottom[0]), u(h), u(bottom[1]))
  const pos = g.attributes.position as THREE.BufferAttribute
  const sx = top[0] / bottom[0]
  const sz = top[1] / bottom[1]
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) > 0) {
      pos.setX(i, pos.getX(i) * sx)
      pos.setZ(i, pos.getZ(i) * sz)
    }
  }
  pos.needsUpdate = true
  g.computeVertexNormals()
  g.translate(0, u(h) / 2, 0)
  keycapCache.set(key, g)
  return g
}

interface Props {
  geometry: Geometry
  material: THREE.Material
  /** true면 RoundedBox 대신 Box를 써서 고스트를 가볍게 그린다 */
  simple?: boolean
}

export function PartGeometry({ geometry, material, simple = false }: Props) {
  // 고스트(simple)는 그림자를 드리우지 않는다
  const cast = !simple
  switch (geometry.type) {
    case 'box': {
      const [w, h, d] = geometry.size
      return (
        <mesh material={material} position={[0, u(h) / 2, 0]} castShadow={cast} receiveShadow={cast}>
          <boxGeometry args={[u(w), u(h), u(d)]} />
        </mesh>
      )
    }
    case 'roundedBox': {
      const [w, h, d] = geometry.size
      if (simple) {
        return (
          <mesh material={material} position={[0, u(h) / 2, 0]}>
            <boxGeometry args={[u(w), u(h), u(d)]} />
          </mesh>
        )
      }
      return (
        <RoundedBox
          args={[u(w), u(h), u(d)]}
          radius={u(geometry.radius)}
          smoothness={3}
          material={material}
          position={[0, u(h) / 2, 0]}
          castShadow
          receiveShadow
        />
      )
    }
    case 'tub': {
      const [w, h, d] = geometry.size
      const wall = geometry.wall
      const floor = geometry.floor
      const wh = h - floor
      return (
        <group>
          {simple ? (
            <mesh material={material} position={[0, u(floor) / 2, 0]}>
              <boxGeometry args={[u(w), u(floor), u(d)]} />
            </mesh>
          ) : (
            <RoundedBox
              args={[u(w), u(floor), u(d)]}
              radius={u(Math.min(geometry.radius, floor / 2 - 0.01))}
              smoothness={3}
              material={material}
              position={[0, u(floor) / 2, 0]}
              castShadow
              receiveShadow
            />
          )}
          <Walls w={w} d={d} h={wh} wall={wall} y={floor} material={material} cast={cast} />
        </group>
      )
    }
    case 'frame': {
      const [w, h, d] = geometry.size
      return <Walls w={w} d={d} h={h} wall={geometry.wall} y={0} material={material} cast={cast} />
    }
    case 'stabilizer': {
      const [hw, hh, hd] = geometry.housing
      const half = geometry.span / 2
      return (
        <group>
          {[-half, half].map((x) => (
            <mesh key={x} material={material} position={[u(x), u(hh) / 2, 0]} castShadow={cast}>
              <boxGeometry args={[u(hw), u(hh), u(hd)]} />
            </mesh>
          ))}
          <mesh material={material} position={[0, u(-2.5), u(hd / 2 - 1)]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[u(geometry.wireR), u(geometry.wireR), u(geometry.span + hw), 8]} />
          </mesh>
        </group>
      )
    }
    case 'switch': {
      const [w, h, d] = geometry.body
      return (
        <group>
          <mesh material={material} position={[0, u(h) / 2, 0]} castShadow={cast}>
            <boxGeometry args={[u(w), u(h), u(d)]} />
          </mesh>
          <mesh material={material} position={[0, u(h + geometry.stemH / 2), 0]}>
            <cylinderGeometry args={[u(geometry.stemR), u(geometry.stemR), u(geometry.stemH), 12]} />
          </mesh>
        </group>
      )
    }
    case 'keycap': {
      return <KeycapMesh geometry={geometry} material={material} cast={cast} />
    }
    case 'gasketSet': {
      return (
        <group>
          {geometry.strips.map((s, i) => (
            <mesh key={i} material={material} position={[u(s.pos[0]), u(s.size[1]) / 2 + u(s.pos[1]), u(s.pos[2])]}>
              <boxGeometry args={v3(s.size)} />
            </mesh>
          ))}
        </group>
      )
    }
  }
}

function KeycapMesh({
  geometry,
  material,
  cast,
}: {
  geometry: Extract<Geometry, { type: 'keycap' }>
  material: THREE.Material
  cast: boolean
}) {
  const geo = useMemo(
    () => keycapGeometry(geometry.bottom, geometry.top, geometry.h),
    [geometry.bottom, geometry.top, geometry.h],
  )
  return <mesh geometry={geo} material={material} castShadow={cast} receiveShadow={cast} />
}

function Walls({
  w,
  d,
  h,
  wall,
  y,
  material,
  cast,
}: {
  w: number
  d: number
  h: number
  wall: number
  y: number
  material: THREE.Material
  cast: boolean
}) {
  const cy = u(y) + u(h) / 2
  return (
    <group>
      <mesh material={material} position={[0, cy, u(-(d / 2 - wall / 2))]} castShadow={cast} receiveShadow={cast}>
        <boxGeometry args={[u(w), u(h), u(wall)]} />
      </mesh>
      <mesh material={material} position={[0, cy, u(d / 2 - wall / 2)]} castShadow={cast} receiveShadow={cast}>
        <boxGeometry args={[u(w), u(h), u(wall)]} />
      </mesh>
      <mesh material={material} position={[u(-(w / 2 - wall / 2)), cy, 0]} castShadow={cast} receiveShadow={cast}>
        <boxGeometry args={[u(wall), u(h), u(d - wall * 2)]} />
      </mesh>
      <mesh material={material} position={[u(w / 2 - wall / 2), cy, 0]} castShadow={cast} receiveShadow={cast}>
        <boxGeometry args={[u(wall), u(h), u(d - wall * 2)]} />
      </mesh>
    </group>
  )
}
