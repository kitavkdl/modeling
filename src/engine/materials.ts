import * as THREE from 'three'
import type { MaterialSpec } from './types'

export interface MaterialRegistry {
  get(name: string): THREE.Material
  has(name: string): boolean
}

/** 제품 재질표를 three 재질로 만든다. 같은 이름은 같은 인스턴스를 돌려준다. */
export function createMaterialRegistry(specs: Record<string, MaterialSpec>): MaterialRegistry {
  const cache = new Map<string, THREE.Material>()
  return {
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
  }
}

export const ghostMaterial = new THREE.MeshBasicMaterial({
  color: '#ffffff',
  transparent: true,
  opacity: 0.3,
  depthWrite: false,
})

export const ghostHoverMaterial = new THREE.MeshBasicMaterial({
  color: '#ffffff',
  transparent: true,
  opacity: 0.55,
  depthWrite: false,
})
