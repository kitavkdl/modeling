import { describe, expect, it } from 'vitest'
import type { Mounted } from '../../engine/types'
import { ninja400Product } from './index'
import { PARTS } from './parts'
import { markRideModelFailed, rideModelFailed } from './render/RideModel'

/** 키를 뺀 모든 부품을 장착한 표 */
function allButKey(): Mounted {
  const m: Mounted = {}
  for (const p of PARTS) {
    if (p.id === 'ignition_key') continue
    for (const i of p.instances) m[i.id] = { instanceId: i.id, at: 0 }
  }
  return m
}

// 이 파일은 모듈 전역 실패 플래그를 켠다. 순서가 중요해서 한 파일 안에서 앞뒤로 나눠 검사한다.
describe('실물 모델 로딩 실패 시 조립체 유지 (스펙 §1.3)', () => {
  it('실패 전에는 키만 남으면 조립체를 감춘다', () => {
    expect(rideModelFailed()).toBe(false)
    expect(ninja400Product.assemblyHidden!({ phase: 'assembly', mounted: allButKey() })).toBe(true)
    expect(ninja400Product.assemblyHidden!({ phase: 'keyed', mounted: {} })).toBe(true)
  })

  it('키는 조립체를 감춘 뒤에도 그린다', () => {
    expect(ninja400Product.alwaysVisibleParts).toEqual(['ignition_key'])
  })

  it('실패를 기록하면 어느 phase에서도 감추지 않는다', () => {
    markRideModelFailed()
    expect(rideModelFailed()).toBe(true)
    expect(ninja400Product.assemblyHidden!({ phase: 'assembly', mounted: allButKey() })).toBe(false)
    expect(ninja400Product.assemblyHidden!({ phase: 'running', mounted: {} })).toBe(false)
  })
})
