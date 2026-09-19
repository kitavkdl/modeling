import * as THREE from 'three'
import type { MaterialSpec } from './types'

export interface MaterialRegistry {
  get(name: string): THREE.Material
  has(name: string): boolean
  /** 이름이 없거나 등록되지 않았으면 fallback */
  getOr(name: string | undefined, fallback: THREE.Material): THREE.Material
}

/** 제품 재질표를 three 재질로 만든다. 같은 이름은 같은 인스턴스를 돌려준다. */
export function createMaterialRegistry(specs: Record<string, MaterialSpec>): MaterialRegistry {
  const cache = new Map<string, THREE.Material>()
  const reg: MaterialRegistry = {
    has: (name) => name in specs,
    get(name) {
      let m = cache.get(name)
      if (m) return m
      const spec = specs[name]
      if (!spec) throw new Error(`unknown material: ${name}`)
      if (spec.physical) {
        const { physical, ...params } = spec
        void physical
        m = new THREE.MeshPhysicalMaterial(params)
      } else {
        const { physical, ...params } = spec
        void physical
        m = new THREE.MeshStandardMaterial(params)
      }
      cache.set(name, m)
      return m
    },
    getOr: (name, fallback) => (name && name in specs ? reg.get(name) : fallback),
  }
  return reg
}

export const fallbackMaterial = new THREE.MeshStandardMaterial({ color: '#6b6d70', metalness: 0.2, roughness: 0.8 })

// 고스트는 다른 부품 안쪽(크랭크케이스 속 크랭크축, 포크 사이 액슬)에 놓이는 일이 많아
// 깊이 검사를 끄고 항상 위에 그린다. 불투명도는 Ghosts가 맥동시킨다.
export const ghostMaterial = new THREE.MeshBasicMaterial({
  color: '#ffffff',
  transparent: true,
  opacity: 0.4,
  depthWrite: false,
  depthTest: false,
})

export const ghostHoverMaterial = new THREE.MeshBasicMaterial({
  color: '#ffffff',
  transparent: true,
  opacity: 0.8,
  depthWrite: false,
  depthTest: false,
})
