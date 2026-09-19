import { describe, expect, it } from 'vitest'
import { validateGeometry, type Geometry } from './types'

describe('validateGeometry', () => {
  it('accepts positive primitives', () => {
    expect(validateGeometry({ type: 'box', size: [1, 2, 3] })).toEqual([])
    expect(validateGeometry({ type: 'cylinder', radiusTop: 1, radiusBottom: 1, height: 2 })).toEqual([])
    expect(validateGeometry({ type: 'frustum', bottom: [10, 10], top: [6, 6], h: 4 })).toEqual([])
  })

  it('rejects non-positive dimensions with a path', () => {
    expect(validateGeometry({ type: 'box', size: [1, 0, 3] })).toEqual(['box.size[1] must be > 0'])
    expect(validateGeometry({ type: 'torus', radius: 5, tube: -1 })).toEqual(['torus.tube must be > 0'])
  })

  it('recurses into composites and reports nested paths', () => {
    const g: Geometry = {
      type: 'composite',
      children: [
        { geometry: { type: 'box', size: [1, 1, 1] } },
        { geometry: { type: 'sphere', radius: 0 }, position: [0, 1, 0] },
      ],
    }
    expect(validateGeometry(g)).toEqual(['children[1].sphere.radius must be > 0'])
  })

  it('rejects composites deeper than 4 levels', () => {
    let g: Geometry = { type: 'box', size: [1, 1, 1] }
    for (let i = 0; i < 5; i++) g = { type: 'composite', children: [{ geometry: g }] }
    expect(validateGeometry(g)[0]).toMatch(/depth/)
  })
})
