import { describe, expect, it } from 'vitest'
import { PRODUCTS, productForPath } from './index'

describe('product registry', () => {
  it('has unique ids and resolves paths', () => {
    expect(new Set(PRODUCTS.map((p) => p.id)).size).toBe(PRODUCTS.length)
    expect(productForPath('/keyboard')?.id).toBe('keyboard')
    expect(productForPath('/ninja400')?.id).toBe('ninja400')
    expect(productForPath('/keyboard/')?.id).toBe('keyboard')
    expect(productForPath('/')).toBeNull()
    expect(productForPath('/nope')).toBeNull()
  })

  it('ignores query strings and hash fragments', () => {
    expect(productForPath('/keyboard?utm=x')?.id).toBe('keyboard')
    expect(productForPath('/keyboard#top')?.id).toBe('keyboard')
  })
})
