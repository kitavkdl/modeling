import { RoundedBox } from '@react-three/drei'
import * as THREE from 'three'
import { frustumGeometry } from '../engine/geometry/frustum'
import type { Geometry } from '../engine/types'
import { MM, type Vec3 } from '../products/keyboard/parts'

// 부품 지오메트리를 프리미티브로 그린다. 그룹 원점은 부품 밑면 중심.
// 모든 입력은 mm이고 여기서 MM을 곱한다.

const u = (mm: number) => mm * MM
const v3 = (p?: Vec3): [number, number, number] => (p ? [u(p[0]), u(p[1]), u(p[2])] : [0, 0, 0])

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
    case 'box':
      return (
        <mesh material={material} position={[0, u(geometry.size[1]) / 2, 0]} castShadow={cast} receiveShadow={cast}>
          <boxGeometry args={v3(geometry.size)} />
        </mesh>
      )
    case 'roundedBox':
      if (simple) {
        return (
          <mesh material={material} position={[0, u(geometry.size[1]) / 2, 0]}>
            <boxGeometry args={v3(geometry.size)} />
          </mesh>
        )
      }
      return (
        <RoundedBox
          args={v3(geometry.size)}
          radius={u(Math.min(geometry.radius, Math.min(...geometry.size) / 2 - 0.01))}
          smoothness={3}
          material={material}
          position={[0, u(geometry.size[1]) / 2, 0]}
          castShadow
          receiveShadow
        />
      )
    case 'cylinder':
      return (
        <mesh material={material} position={[0, u(geometry.height) / 2, 0]} castShadow={cast} receiveShadow={cast}>
          <cylinderGeometry args={[u(geometry.radiusTop), u(geometry.radiusBottom), u(geometry.height), geometry.segments ?? 24]} />
        </mesh>
      )
    case 'sphere':
      return (
        <mesh material={material} position={[0, u(geometry.radius), 0]} castShadow={cast} receiveShadow={cast}>
          <sphereGeometry args={[u(geometry.radius), 24, 16]} />
        </mesh>
      )
    case 'cone':
      return (
        <mesh material={material} position={[0, u(geometry.height) / 2, 0]} castShadow={cast} receiveShadow={cast}>
          <coneGeometry args={[u(geometry.radius), u(geometry.height), 24]} />
        </mesh>
      )
    case 'torus':
      // 도넛 축이 y가 되도록 눕힌다. 밑면이 y=0
      return (
        <mesh material={material} position={[0, u(geometry.tube), 0]} rotation={[Math.PI / 2, 0, 0]} castShadow={cast} receiveShadow={cast}>
          <torusGeometry args={[u(geometry.radius), u(geometry.tube), 16, 48]} />
        </mesh>
      )
    case 'frustum':
      return (
        <mesh
          geometry={frustumGeometry(geometry.bottom, geometry.top, geometry.h)}
          material={material}
          castShadow={cast}
          receiveShadow={cast}
        />
      )
    case 'composite':
      return (
        <group>
          {geometry.children.map((c, i) => (
            <group key={i} position={v3(c.position)} rotation={c.rotation ?? [0, 0, 0]} scale={c.scale ?? [1, 1, 1]}>
              <PartGeometry geometry={c.geometry} material={material} simple={simple} />
            </group>
          ))}
        </group>
      )
  }
}
