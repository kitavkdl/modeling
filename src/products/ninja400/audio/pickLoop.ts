// 지금 rpm에 쓸 루프 한 칸을 고른다 — 순수 함수라 따로 테스트한다.
//
// v3는 이웃한 두 루프를 늘 동시에 울렸다. 두 소스를 각자의 뱅크 rpm으로 나눠 같은 목표 rpm에
// 맞췄지만, 뱅크의 rpm이 10 단위로 반올림돼 있어 실제 기본파가 1%쯤 어긋났다. 100 Hz에서 1%면
// 초당 한 번 부풀었다 꺼지는 맥놀이다 — 사용자가 말한 "왕(쉬고)왕"이 바로 이것이다.
// 그래서 한 번에 한 칸만 울리고, 칸을 바꾸는 0.25초 동안에만 겹친다.
//
// loops는 rpm 오름차순이라고 본다(bank.json이 그렇게 나온다).

/** 뱅크 한 칸: 이 rpm에서 녹음된 이음매 없는 루프. rpm은 실측값(소수 첫째 자리)이다 */
export interface Loop {
  rpm: number
  file: string
}

/** 경계를 이만큼 넘어서야 칸을 바꾼다 — 경계 근처를 맴돌 때 칸이 깜빡이지 않게 */
export const SWITCH_HYSTERESIS = 0.03

/** 로그 거리로 가장 가까운 칸 (물고 있는 것이 없을 때만 쓴다) */
function nearest(rpm: number, loops: Loop[]): number {
  let best = 0
  let bestDist = Infinity
  for (let i = 0; i < loops.length; i++) {
    const dist = Math.abs(Math.log(rpm / loops[i].rpm))
    if (dist < bestDist) {
      bestDist = dist
      best = i
    }
  }
  return best
}

/**
 * rpm에 쓸 루프 인덱스.
 *
 * - 물고 있는 칸이 없으면(current가 인덱스가 아니면) 로그 거리로 가장 가까운 칸.
 * - 물고 있으면 이웃과의 기하 중점 √(rpm_i·rpm_{i+1})을 ±3% 넘어설 때만 옮긴다.
 *   한 번에 여러 칸을 건너뛰어도 된다(급가속).
 * - rpm이 유한하지 않거나 0 이하면 물고 있던 칸 그대로, 없으면 0 — 계산이 깨졌을 때
 *   고회전으로 비명을 지르는 것보다 아이들이 안전하다.
 */
export function pickLoop(rpm: number, loops: Loop[], current: number): number {
  const n = loops.length
  if (n === 0) return 0
  const held = Number.isInteger(current) && current >= 0 && current < n ? current : -1
  if (!Number.isFinite(rpm) || rpm <= 0) return held < 0 ? 0 : held
  if (held < 0) return nearest(rpm, loops)
  let i = held
  // 두 while 중 하나만 돈다. 경계(기하 중점)를 히스테리시스만큼 확실히 넘었을 때만 움직인다.
  while (i + 1 < n && rpm > Math.sqrt(loops[i].rpm * loops[i + 1].rpm) * (1 + SWITCH_HYSTERESIS)) i++
  while (i > 0 && rpm < Math.sqrt(loops[i - 1].rpm * loops[i].rpm) * (1 - SWITCH_HYSTERESIS)) i--
  return i
}
