// 소스 슬롯 두 개를 어떻게 굴릴지 정하는 순수 함수 — Web Audio 없이 테스트하려고 떼어 냈다.
// 핵심은 "들리고 있던 소스를 다시 켜지 않는 것"이다. 루프 경계를 넘는 순간 upper(게인 ≈1)가
// 다음 구간의 lower가 되는데, 여기서 새 소스를 켜면 임의 오프셋으로 점프해 위상이 튄다.
// 그래서 반대편 슬롯이 이미 원하는 루프를 물고 있으면 소스는 그대로 두고 자리만 맞바꾼다.

import type { Mix } from './bankMix'

/** 슬롯 하나에 내리는 지시 */
export type SlotAction =
  | { kind: 'keep'; index: number }
  | { kind: 'start'; index: number }
  | { kind: 'release' }

export interface SlotPlan {
  /** true면 두 슬롯의 자리를 먼저 맞바꾸고 actions를 적용한다 */
  swap: boolean
  /** [0] = lower 자리, [1] = upper 자리. 맞바꾼 뒤 기준이다 */
  actions: [SlotAction, SlotAction]
}

/** 각 슬롯이 물고 있는 루프 인덱스(비었으면 null) */
export type SlotHeld = [number | null, number | null]

/**
 * 지금 물고 있는 것(prev)과 원하는 배합(mix)으로 슬롯 지시를 낸다.
 * lower === upper면 upper 슬롯은 내린다 — 한쪽만 게인 1로 울린다.
 */
export function planSlots(prev: SlotHeld, mix: Mix): SlotPlan {
  const want: SlotHeld = [mix.lower, mix.upper === mix.lower ? null : mix.upper]
  const swap =
    (prev[1] !== null && prev[1] === want[0]) || (prev[0] !== null && want[1] !== null && prev[0] === want[1])
  const held: SlotHeld = swap ? [prev[1], prev[0]] : prev
  const act = (i: 0 | 1): SlotAction => {
    const index = want[i]
    if (index === null) return { kind: 'release' }
    return held[i] === index ? { kind: 'keep', index } : { kind: 'start', index }
  }
  return { swap, actions: [act(0), act(1)] }
}
