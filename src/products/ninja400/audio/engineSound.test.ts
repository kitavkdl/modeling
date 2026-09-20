import { describe, expect, it } from 'vitest'
import {
  blip,
  fadeCurve,
  fadeSeconds,
  preload,
  safeRpm,
  setLoad,
  setRpm,
  setThrottle,
  start,
  stop,
  stopPlan,
  toneFor,
} from './engineSound'

// v4는 실녹음 루프를 한 번에 하나만 재생한다. 오디오 그래프는 노드 환경(window 없음)에서
// 만들어지지 않으므로 값을 정하는 순수 함수만 여기서 못박는다. 칸 고르기는 pickLoop.test.ts가 맡는다.

describe('회전수 정리', () => {
  it('유한하지 않거나 0 이하면 0 — playbackRate가 0이 될 수 없어 루프를 내려야 한다', () => {
    expect(safeRpm(NaN)).toBe(0)
    expect(safeRpm(Infinity)).toBe(0)
    expect(safeRpm(-1)).toBe(0)
    expect(safeRpm(0)).toBe(0)
    expect(safeRpm(3000)).toBe(3000)
  })
})

describe('톤', () => {
  it('저역통과는 스로틀 0에서 1400Hz, 1에서 6000Hz', () => {
    expect(toneFor(0, 0).lowpassHz).toBe(1400)
    expect(toneFor(1, 0).lowpassHz).toBe(6000)
    expect(toneFor(0.5, 0).lowpassHz).toBe(3700)
  })
  it('게인은 스로틀 0에서 −5dB, 1에서 0dB, 부하 1이면 +3dB', () => {
    expect(20 * Math.log10(toneFor(0, 0).gain)).toBeCloseTo(-5, 6)
    expect(20 * Math.log10(toneFor(1, 0).gain)).toBeCloseTo(0, 6)
    expect(20 * Math.log10(toneFor(1, 1).gain)).toBeCloseTo(3, 6)
  })
  it('스로틀·부하의 NaN과 범위 밖 값은 0~1로 눌린다', () => {
    expect(toneFor(NaN, NaN)).toEqual(toneFor(0, 0))
    expect(toneFor(5, 5)).toEqual(toneFor(1, 1))
    expect(toneFor(-3, -3)).toEqual(toneFor(0, 0))
  })
})

describe('교차 페이드 곡선', () => {
  it('등파워 — 들어오는 쪽과 나가는 쪽의 제곱합이 어느 지점에서나 1', () => {
    // 겹치는 250 ms 동안 소리가 꺼지거나 부풀면 그것도 한 번씩 '왕' 하는 것으로 들린다
    for (const from of [1, 0.9, 0.5, 0.2, 0]) {
      const rise = fadeCurve(from, true)
      const fall = fadeCurve(from, false)
      expect(rise).toHaveLength(fall.length)
      for (let i = 0; i < rise.length; i++) {
        expect(rise[i] * rise[i] + fall[i] * fall[i]).toBeCloseTo(1, 6)
      }
    }
  })

  it('나가는 쪽은 지금 값에서 0으로, 들어오는 쪽은 그 짝에서 1로 — 페이드 도중에 끼어들어도 이어진다', () => {
    const from = 0.6
    const rise = fadeCurve(from, true)
    const fall = fadeCurve(from, false)
    expect(fall[0]).toBeCloseTo(from, 6)
    expect(fall[fall.length - 1]).toBeCloseTo(0, 6)
    expect(rise[0]).toBeCloseTo(Math.sqrt(1 - from * from), 6)
    expect(rise[rise.length - 1]).toBeCloseTo(1, 6)
  })

  it('두 곡선 모두 단조롭다 (되돌아가지 않는다)', () => {
    const rise = fadeCurve(0.8, true)
    const fall = fadeCurve(0.8, false)
    for (let i = 1; i < rise.length; i++) {
      expect(rise[i]).toBeGreaterThanOrEqual(rise[i - 1])
      expect(fall[i]).toBeLessThanOrEqual(fall[i - 1])
    }
  })
})

describe('남은 페이드 길이', () => {
  it('게인 1(온전히 울리는 칸)에서 시작하면 0.25초를 다 쓴다', () => {
    expect(fadeSeconds(1)).toBeCloseTo(0.25, 10)
  })

  it('이미 내려와 있으면 남은 각도만큼만 쓴다', () => {
    expect(fadeSeconds(Math.cos(Math.PI / 4))).toBeCloseTo(0.125, 10)
    expect(fadeSeconds(0)).toBeCloseTo(0.03, 10) // 0이면 길이 0이 되므로 최소 30 ms
  })

  it('범위 밖·NaN은 0~1로 눌린다', () => {
    expect(fadeSeconds(NaN)).toBe(fadeSeconds(0))
    expect(fadeSeconds(2)).toBe(fadeSeconds(1))
    expect(fadeSeconds(-1)).toBe(fadeSeconds(0))
  })
})

describe('stop()의 멱등성', () => {
  it('돌고 있지 않으면 페이드도 원샷도 suspend 예약도 없다', () => {
    // 스톨 때 RideControls가 한 번, running에서 빠져나갈 때 Finale이 또 한 번 부른다.
    // 두 번째 호출이 stop.ogg를 다시 울리면 정지음이 두 번 난다.
    expect(stopPlan(false, 1.2)).toEqual({ fade: false, oneShot: false, suspendAfterS: 0 })
    // 시동 전(preload가 컨텍스트만 만들어 둔 상태)에 부르는 stop()도 같은 자리에 걸린다
    expect(stopPlan(false, 0)).toEqual({ fade: false, oneShot: false, suspendAfterS: 0 })
  })
  it('돌고 있으면 페이드·원샷을 걸고 stop.ogg가 끝날 때까지 기다렸다 재운다', () => {
    const p = stopPlan(true, 1.2)
    expect(p.fade).toBe(true)
    expect(p.oneShot).toBe(true)
    // 0.15(페이드) + 0.03(슬롯) = 0.18보다 stop.ogg가 길다 → 원샷 길이가 기준이 된다
    expect(p.suspendAfterS).toBeCloseTo(1.25, 10)
  })
  it('원샷이 없거나 짧으면 페이드 길이가 기준이 된다', () => {
    expect(stopPlan(true, 0).suspendAfterS).toBeCloseTo(0.23, 10)
    expect(stopPlan(true, 0.1).suspendAfterS).toBeCloseTo(0.23, 10)
  })
})

describe('오디오가 없는 환경', () => {
  it('전 API가 무음으로 넘어가고 preload()는 같은 약속을 돌려준다', async () => {
    stop() // start() 전에 불러도 무해해야 한다
    start()
    setRpm(NaN)
    setThrottle(NaN)
    setLoad(NaN)
    blip()
    stop()
    stop()
    const first = preload()
    expect(preload()).toBe(first)
    await expect(first).resolves.toBeUndefined()
  })
})
