import { describe, expect, it } from 'vitest'
import type { Mounted } from '../../engine/types'
import { ninja400Product } from './index'
import { PARTS } from './parts'
import { refine } from './render/Refine'
import { markRideModelFailed, markRideModelReady, rideModelFailed, rideModelReady } from './render/RideModel'

/** 키를 뺀 모든 부품을 장착한 표 */
function allButKey(): Mounted {
  const m: Mounted = {}
  for (const p of PARTS) {
    if (p.id === 'ignition_key') continue
    for (const i of p.instances) m[i.id] = { instanceId: i.id, at: 0 }
  }
  return m
}

// 이 파일은 모듈 전역 플래그(ready·failed)를 켠다. 순서가 중요해서 한 파일 안에서 앞뒤로 나눠 검사한다.
describe('실물 모델이 설 수 있을 때만 조립체를 감춘다 (스펙 §1.3)', () => {
  it('디코드 전에는 어느 phase에서도 감추지 않는다 — 빈 무대를 만들지 않는다', () => {
    expect(rideModelReady()).toBe(false)
    expect(rideModelFailed()).toBe(false)
    expect(ninja400Product.assemblyHidden!({ phase: 'assembly', mounted: allButKey() })).toBe(false)
    expect(ninja400Product.assemblyHidden!({ phase: 'keyed', mounted: {} })).toBe(false)
  })

  it('디코드가 끝나도 전문가의 손길(스윕) 전에는 조립체를 감추지 않는다', () => {
    markRideModelReady()
    expect(rideModelReady()).toBe(true)
    expect(refine.done).toBe(false)
    // 스윕이 도는 동안에는 두 차가 칼날을 경계로 반씩 보여야 한다 — 절차 조립체가 살아 있어야 한다
    expect(ninja400Product.assemblyHidden!({ phase: 'assembly', mounted: allButKey() })).toBe(false)
    // 단계가 넘어갔다는 것은 키가 이미 꽂혔다는 뜻이다 — 그때는 스윕과 무관하게 실물 모델만 남는다
    expect(ninja400Product.assemblyHidden!({ phase: 'keyed', mounted: {} })).toBe(true)
  })

  it('스윕이 끝나면 키만 남을 때 조립체를 감춘다', () => {
    refine.done = true
    try {
      expect(ninja400Product.assemblyHidden!({ phase: 'assembly', mounted: allButKey() })).toBe(true)
      // 아직 남은 부품이 있으면 그대로 조립을 보여 준다
      expect(ninja400Product.assemblyHidden!({ phase: 'assembly', mounted: {} })).toBe(false)
    } finally {
      refine.done = false
    }
  })

  it('키는 조립체를 감춘 뒤에도 그린다', () => {
    expect(ninja400Product.alwaysVisibleParts).toEqual(['ignition_key'])
  })

  it('디코드가 끝났어도 실패를 기록하면 어느 phase에서도 감추지 않는다', () => {
    markRideModelFailed()
    expect(rideModelReady()).toBe(true)
    expect(rideModelFailed()).toBe(true)
    expect(ninja400Product.assemblyHidden!({ phase: 'assembly', mounted: allButKey() })).toBe(false)
    expect(ninja400Product.assemblyHidden!({ phase: 'running', mounted: {} })).toBe(false)
  })
})
