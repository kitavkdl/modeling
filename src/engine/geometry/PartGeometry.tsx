import { RoundedBox } from '@react-three/drei'
import type * as THREE from 'three'
import type { MaterialRegistry } from '../materials'
import { MM, type Geometry, type Vec3 } from '../types'
import { frustumGeometry } from './frustum'

// 프리미티브와 composite를 그린다. 그룹 원점은 부품 밑면 중심(제품 데이터가 그렇게 정의한다).
// 입력은 mm, 여기서 MM을 곱한다. 제품을 모른다.

const u = (mm: number) => mm * MM
const v3 = (p?: Vec3): [number, number, number] => (p ? [u(p[0]), u(p[1]), u(p[2])] : [0, 0, 0])

interface Props {
  geometry: Geometry
  material: THREE.Material
  /** composite 자식이 재질 이름을 덮어쓸 때 해석에 쓴다 */
  materials?: MaterialRegistry
  /** 고스트: 그림자 없음, roundedBox 대신 box */
  simple?: boolean
}

export function PartGeometry({ geometry, material, materials, simple = false }: Props) {
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
          radius={u(Math.max(0.01, Math.min(geometry.radius, Math.min(...geometry.size) / 2 - 0.01)))}
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
              <PartGeometry
                geometry={c.geometry}
                material={c.material && materials ? materials.get(c.material) : material}
                materials={materials}
                simple={simple}
              />
            </group>
          ))}
        </group>
      )
  }
}
