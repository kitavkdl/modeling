// 엔진음 뱅크에서 지금 rpm을 감쌀 루프 두 개를 고른다 — 순수 함수라 따로 테스트한다.
// loops는 rpm 오름차순이라고 본다(bank.json이 그렇게 나온다).

/** 뱅크 한 칸: 이 rpm에서 녹음된 이음매 없는 루프 */
export interface Loop {
  rpm: number
  file: string
}

/** loops 안의 인덱스 두 개와 그 사이 위치. lower === upper면 한쪽만 울린다 */
export interface Mix {
  lower: number
  upper: number
  /** 0~1. lower에서 upper로 가는 등파워 크로스페이드 위치 */
  t: number
}

const ONE: Mix = { lower: 0, upper: 0, t: 0 }

/**
 * rpm을 감싸는 이웃 루프와 선형 위치를 낸다.
 * 최저 루프 이하·최고 루프 이상이면 한쪽만 쓰고(t=0), 모자란 rpm은 런타임이 playbackRate로 메운다.
 */
export function bankMix(rpm: number, loops: Loop[]): Mix {
  const n = loops.length
  if (n === 0) return { ...ONE }
  // 비유한 rpm은 +Infinity까지 모두 최저 루프로 본다 — 계산이 깨졌을 때 고회전으로 비명을 지르는 것보다 아이들이 안전하다
  const r = Number.isFinite(rpm) ? rpm : loops[0].rpm
  if (r <= loops[0].rpm) return { ...ONE }
  const last = n - 1
  if (r >= loops[last].rpm) return { lower: last, upper: last, t: 0 }
  let i = 0
  while (i < last && loops[i + 1].rpm <= r) i++
  const lo = loops[i].rpm
  const hi = loops[i + 1].rpm
  const span = hi - lo
  return { lower: i, upper: i + 1, t: span > 0 ? (r - lo) / span : 0 }
}
