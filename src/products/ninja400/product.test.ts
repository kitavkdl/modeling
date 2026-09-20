import { describe, expect, it } from 'vitest'
import { validateProduct } from '../../engine/store'
import { ninja400Product } from './index'

describe('ninja400Product', () => {
  it('declares phases, hints and drag config', () => {
    expect(ninja400Product.phasesAfterComplete).toEqual(['keyed', 'running'])
    expect(ninja400Product.hints.keyed).toBe('시동')
    expect(ninja400Product.hints.running).toBe('스로틀 개방')
    expect(ninja400Product.drag).toEqual({ snapMm: 150, paintMm: 25, grabMinMm: 200 })
  })
  it('lists three stations without bench props', () => {
    expect(ninja400Product.stations.map((s) => s.id)).toEqual(['engine', 'front_wheel', 'rear_wheel'])
    for (const s of ninja400Product.stations) expect(s.prop).toBeUndefined()
  })
  it('passes the engine product validator', () => {
    expect(validateProduct(ninja400Product)).toEqual([])
  })
})
