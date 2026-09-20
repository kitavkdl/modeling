import { describe, expect, it } from 'vitest'
import type { Mix } from './bankMix'
import { planSlots } from './slotPlan'

const mix = (lower: number, upper: number, t: number): Mix => ({ lower, upper, t })
const start = (index: number) => ({ kind: 'start', index })
const keep = (index: number) => ({ kind: 'keep', index })
const release = { kind: 'release' }

describe('planSlots', () => {
  it('빈 슬롯에서는 필요한 만큼 새로 켠다', () => {
    expect(planSlots([null, null], mix(2, 3, 0.4))).toEqual({ swap: false, actions: [start(2), start(3)] })
  })

  it('이미 맞는 루프를 물고 있으면 아무것도 하지 않는다', () => {
    expect(planSlots([2, 3], mix(2, 3, 0.7))).toEqual({ swap: false, actions: [keep(2), keep(3)] })
  })

  it('rpm이 올라 구간을 넘으면 자리를 바꿔 들리던 소스를 살린다', () => {
    // [k, k+1] → [k+1, k+2]: k+1은 자리만 옮기고(keep) 다시 켜지 않는다
    expect(planSlots([2, 3], mix(3, 4, 0.05))).toEqual({ swap: true, actions: [keep(3), start(4)] })
  })

  it('rpm이 내려 구간을 넘을 때도 마찬가지', () => {
    // [k, k+1] → [k-1, k]: k가 upper 자리로 옮겨 간다
    expect(planSlots([2, 3], mix(1, 2, 0.95))).toEqual({ swap: true, actions: [start(1), keep(2)] })
  })

  it('두 구간을 한 번에 건너뛰면 둘 다 새로 켠다', () => {
    expect(planSlots([2, 3], mix(5, 6, 0.3))).toEqual({ swap: false, actions: [start(5), start(6)] })
  })

  it('lower === upper(뱅크 끝)면 두 번째 슬롯을 내린다', () => {
    // 최고 루프 위 — 마지막 루프는 이미 upper 자리에 있으니 옮겨서 살린다
    expect(planSlots([6, 7], mix(7, 7, 0))).toEqual({ swap: true, actions: [keep(7), release] })
    // 최저 루프 아래 — lower 자리가 이미 맞다
    expect(planSlots([0, 1], mix(0, 0, 0))).toEqual({ swap: false, actions: [keep(0), release] })
  })

  it('한쪽만 차 있어도 옮길 수 있으면 옮긴다', () => {
    expect(planSlots([null, 4], mix(4, 5, 0.1))).toEqual({ swap: true, actions: [keep(4), start(5)] })
    expect(planSlots([4, null], mix(3, 4, 0.9))).toEqual({ swap: true, actions: [start(3), keep(4)] })
  })

  it('한 루프만 필요한데 슬롯이 비어 있으면 하나만 켠다', () => {
    expect(planSlots([null, null], mix(0, 0, 0))).toEqual({ swap: false, actions: [start(0), release] })
  })

  it('1330~12000 rpm 사다리를 훑는 동안 소리나는 쪽이 다시 켜지는 일이 없다', () => {
    // 경계를 한 칸씩 넘어갈 때마다 t는 1 근처 → 0 근처로 넘어간다. 그 순간 게인 1에 가까운 쪽(upper)이
    // 다음 구간의 lower가 되는데, 이때 start가 나오면 위상이 튄다.
    let prev: [number | null, number | null] = [null, null]
    for (let i = 0; i < 7; i++) {
      // 구간 i의 끝(t≈1) → 구간 i+1의 시작(t≈0)
      for (const m of [mix(i, i + 1, 0.99), mix(i + 1, i + 2 > 7 ? i + 1 : i + 2, 0.01)]) {
        const plan = planSlots(prev, m)
        const held: [number | null, number | null] = plan.swap ? [prev[1], prev[0]] : prev
        // 넘어가는 순간 새로 켜지는 것은 "아직 안 들리던" 쪽뿐이다
        if (m.t < 0.5 && held[0] !== null) expect(plan.actions[0].kind).not.toBe('start')
        prev = plan.actions.map((a, k) => (a.kind === 'release' ? null : a.kind === 'keep' ? held[k] : a.index)) as [
          number | null,
          number | null,
        ]
      }
    }
  })
})
