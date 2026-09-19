import { describe, expect, it } from 'vitest'
import { validateProduct } from '../../engine/store'
import { keyboardProduct } from './index'

describe('keyboardProduct', () => {
  it('passes the engine-wide product validation', () => {
    expect(validateProduct(keyboardProduct)).toEqual([])
  })
  it('references only materials in its table', () => {
    for (const p of keyboardProduct.parts) expect(keyboardProduct.materials[p.material], p.id).toBeDefined()
  })
  it('has a finale and the power phases', () => {
    expect(typeof keyboardProduct.Finale).toBe('function')
    expect(keyboardProduct.phasesAfterComplete).toEqual(['plugging', 'still', 'booting', 'on'])
    expect(keyboardProduct.hints.complete).toBe('케이블 연결')
  })
  it('gives every part a camera target', () => {
    for (const p of keyboardProduct.parts) expect(p.cameraView.target, p.id).toBeDefined()
  })
})
