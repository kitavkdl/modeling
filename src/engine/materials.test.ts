import { describe, expect, it } from 'vitest'
import { createMaterialRegistry, fallbackMaterial } from './materials'

describe('createMaterialRegistry', () => {
  it('builds standard and physical materials and caches them', () => {
    const reg = createMaterialRegistry({
      alu: { color: '#8a8d93', metalness: 0.9, roughness: 0.35 },
      paint: { physical: true, color: '#69be28', clearcoat: 1 },
    })
    expect(reg.get('alu').type).toBe('MeshStandardMaterial')
    expect(reg.get('paint').type).toBe('MeshPhysicalMaterial')
    expect(reg.get('alu')).toBe(reg.get('alu'))
    expect(reg.has('nope')).toBe(false)
    expect(() => reg.get('nope')).toThrow(/unknown material/)
  })

  it('getOr returns the fallback when the name is missing', () => {
    const reg = createMaterialRegistry({ alu: { color: '#888' } })
    expect(reg.getOr('alu', fallbackMaterial)).toBe(reg.get('alu'))
    expect(reg.getOr('nope', fallbackMaterial)).toBe(fallbackMaterial)
    expect(reg.getOr(undefined, fallbackMaterial)).toBe(fallbackMaterial)
  })
})
