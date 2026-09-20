import { describe, expect, it } from 'vitest'
import {
  COMPRESSOR,
  blip,
  fadeCurve,
  loopChainDb,
  fadeSeconds,
  peakDbfs,
  preload,
  rmsDbfs,
  safeRpm,
  setLoad,
  setRpm,
  setThrottle,
  start,
  stop,
  stopPlan,
  throttleTau,
  toneFor,
  voiceOffsets,
} from './engineSound'

// v5는 실녹음 루프 한 칸을 보이스 둘로 울리고 그 위에 합성 층을 얹는다. 오디오 그래프는
// 노드 환경(window 없음)에서 만들어지지 않으므로 값을 정하는 순수 함수만 여기서 못박는다.
// 칸 고르기는 pickLoop.test.ts, 합성 층은 engineLayers.test.ts가 맡는다.

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
  // v4는 1400~6000 Hz / −5~0 dB로 좁아서 "열고 닫아도 변화가 없다"는 말을 들었다
  it('저역통과는 스로틀 0에서 1100Hz, 1에서 7000Hz', () => {
    expect(toneFor(0, 0).lowpassHz).toBe(1100)
    expect(toneFor(1, 0).lowpassHz).toBe(7000)
    expect(toneFor(0.5, 0).lowpassHz).toBe(4050)
  })
  // 바닥은 −7이었다. master를 0.8 → 0.19로 내리면서 아이들이 −34.4 dBFS로 가라앉아 −5로 올렸다
  it('게인은 스로틀 0에서 −5dB, 1에서 0dB, 부하 1이면 +3dB', () => {
    expect(20 * Math.log10(toneFor(0, 0).gain)).toBeCloseTo(-5, 6)
    expect(20 * Math.log10(toneFor(1, 0).gain)).toBeCloseTo(0, 6)
    expect(20 * Math.log10(toneFor(1, 1).gain)).toBeCloseTo(3, 6)
    expect(20 * Math.log10(toneFor(0, 1).gain)).toBeCloseTo(-2, 6)
  })
  it('부하는 저역통과의 공진을 낮춘다 — 1.0에서 0.7로', () => {
    expect(toneFor(0.5, 0).q).toBeCloseTo(1.0, 10)
    expect(toneFor(0.5, 0.5).q).toBeCloseTo(0.85, 10)
    expect(toneFor(0.5, 1).q).toBeCloseTo(0.7, 10)
  })
  it('스로틀·부하의 NaN과 범위 밖 값은 0~1로 눌린다', () => {
    expect(toneFor(NaN, NaN)).toEqual(toneFor(0, 0))
    expect(toneFor(5, 5)).toEqual(toneFor(1, 1))
    expect(toneFor(-3, -3)).toEqual(toneFor(0, 0))
  })
})

describe('헤드룸', () => {
  // 9000 rpm 전개 · 물린 기어 = 루프 체인이 가장 크게 나가는 자리
  it('루프 체인은 master 앞에서 +12.5 dB를 더한다', () => {
    // 보이스 +5 · loopShelf +3 · loadShelf +1.5 · tone +3
    expect(loopChainDb(9000, 1, 1)).toBeCloseTo(12.51, 2)
  })

  it('9000 rpm 전개의 피크가 −3 dBFS 언저리에 선다 — 컴프레서가 먹기 전에', () => {
    const peak = peakDbfs(9000, 1, 1)
    expect(peak).toBeGreaterThan(-4)
    expect(peak).toBeLessThan(-2)
    // 0 dBFS를 넘기지 않는 것이 요점이다 (고치기 전 +9.6 dBFS)
    expect(peak).toBeLessThan(0)
  })

  it('그 상태의 RMS는 컴프레서 무릎 아래에 있다 — 정상 주행에는 안 걸린다', () => {
    const kneeBottom = COMPRESSOR.threshold - COMPRESSOR.knee / 2
    expect(rmsDbfs(9000, 1, 1)).toBeLessThan(kneeBottom)
  })

  it('아이들이 −34 dBFS 아래로 가라앉지 않는다', () => {
    const idleRms = rmsDbfs(1300, 0, 0)
    expect(idleRms).toBeGreaterThan(-34)
    // 아이들과 전개 사이에 12 dB 넘는 폭이 남아 있어야 스로틀이 들린다 (지금 12.5 dB)
    expect(rmsDbfs(9000, 1, 1) - idleRms).toBeGreaterThan(12)
  })

  it('컴프레서는 리미터가 아니라 과도부만 받는다', () => {
    expect(COMPRESSOR).toEqual({ threshold: -10, knee: 12, ratio: 4, attack: 0.005, release: 0.12 })
  })
})

describe('스로틀 시정수', () => {
  it('열 때는 30 ms, 닫거나 그대로일 때는 120 ms', () => {
    // 같은 속도로 오가면 열고 닫는 것이 소리로 드러나지 않는다 — 열 때만 튀어나와야 한다
    expect(throttleTau(1, 0)).toBeCloseTo(0.03, 10)
    expect(throttleTau(0.31, 0.3)).toBeCloseTo(0.03, 10)
    expect(throttleTau(0, 1)).toBeCloseTo(0.12, 10)
    expect(throttleTau(0.3, 0.3)).toBeCloseTo(0.12, 10)
  })
  it('범위 밖·NaN은 0~1로 눌러 견준다', () => {
    expect(throttleTau(5, 1)).toBe(throttleTau(1, 1))
    expect(throttleTau(NaN, 0.5)).toBe(throttleTau(0, 0.5))
  })
})

describe('두 보이스 시작 지점', () => {
  // 1325.5 rpm 루프: 점화 주기 45.27 ms, 43주기 1.9465 s
  const DUR = 1.9465
  const RPM = 1325.5
  const per = 60 / RPM

  it('차이가 루프 길이의 40% 이상이다 (어느 쪽으로 돌려 재도)', () => {
    for (let i = 0; i <= 20; i++) {
      for (let j = 0; j <= 20; j++) {
        const [a, b] = voiceOffsets(DUR, RPM, i / 20, j / 20)
        expect(a).toBeGreaterThanOrEqual(0)
        expect(a).toBeLessThan(DUR)
        expect(b).toBeGreaterThanOrEqual(0)
        expect(b).toBeLessThan(DUR)
        const d = Math.abs(a - b)
        expect(Math.min(d, DUR - d)).toBeGreaterThan(0.39 * DUR)
      }
    }
  })

  it('차이는 점화 주기의 정수배다 — 두 복사본의 기본파 위상이 맞아야 상쇄되지 않는다', () => {
    for (let j = 0; j <= 20; j++) {
      const [a, b] = voiceOffsets(DUR, RPM, 0.1, j / 20)
      const delta = (b - a + DUR) % DUR
      expect(Math.abs(delta / per - Math.round(delta / per))).toBeLessThan(1e-9)
    }
  })

  it('루프 rpm을 모르면 정수배 스냅 없이 40~60%만 지킨다', () => {
    const [a, b] = voiceOffsets(DUR, 0, 0, 0.5)
    expect(b - a).toBeCloseTo(DUR * 0.5, 10)
  })

  it('길이가 성치 않으면 둘 다 0', () => {
    expect(voiceOffsets(0, RPM, 0.3, 0.7)).toEqual([0, 0])
    expect(voiceOffsets(NaN, RPM, 0.3, 0.7)).toEqual([0, 0])
    expect(voiceOffsets(-1, RPM, 0.3, 0.7)).toEqual([0, 0])
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
