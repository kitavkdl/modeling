import { describe, expect, it } from 'vitest'
import { frustumGeometry } from './frustum'

describe('frustumGeometry', () => {
  it('scales the top face and keeps the bottom on y=0', () => {
    const g = frustumGeometry([20, 10], [10, 6], 8)
    const pos = g.attributes.position
    let minY = Infinity, maxY = -Infinity, topMaxX = 0, bottomMaxX = 0
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i), x = Math.abs(pos.getX(i))
      minY = Math.min(minY, y); maxY = Math.max(maxY, y)
      if (y > 0.4) topMaxX = Math.max(topMaxX, x)
      else bottomMaxX = Math.max(bottomMaxX, x)
    }
    expect(minY).toBeCloseTo(0, 5)
    expect(maxY).toBeCloseTo(0.8, 5)
    expect(bottomMaxX).toBeCloseTo(1.0, 5)
    expect(topMaxX).toBeCloseTo(0.5, 5)
  })

  it('caches by dimensions', () => {
    expect(frustumGeometry([20, 10], [10, 6], 8)).toBe(frustumGeometry([20, 10], [10, 6], 8))
  })
})
