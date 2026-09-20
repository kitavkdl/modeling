import { describe, expect, it } from 'vitest'
import {
  COMPRESSOR,
  blip,
  crankPlan,
  fadeCurve,
  limiterCutDue,
  loopChainDb,
  fadeSeconds,
  oneShotVoicing,
  peakDbfs,
  preload,
  rmsDbfs,
  safeRpm,
  setLoad,
  setRpm,
  setThrottle,
  smoothTo,
  stallRate,
  start,
  stop,
  stopPlan,
  subIdleGain,
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
    const none = { fade: false, oneShot: false, stall: false, fadeS: 0, oneShotDelayS: 0, suspendAfterS: 0 }
    expect(stopPlan(false, 1.2)).toEqual(none)
    // 시동 전(preload가 컨텍스트만 만들어 둔 상태)에 부르는 stop()도 같은 자리에 걸린다
    expect(stopPlan(false, 0)).toEqual(none)
    // 스톨이라고 알려 줘도 돌고 있지 않으면 아무것도 하지 않는다
    expect(stopPlan(false, 1.2, true)).toEqual(none)
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

describe('원샷 레벨 — 사용자 신고: "스톨하면 소리가 갑자기 커진다"', () => {
  // 실제 ogg를 렌더해 잰 값 (200 ms 단기 RMS, destination 기준):
  //   아이들 루프(LFO 꼭대기) 평탄 −32.5 dBFS · A가중 −49.3 dBFS
  //   stop.ogg를 master로 직결 평탄 −29.2 · A가중 −32.9  →  +3.2 dB / +16.4 dB(A)
  // 원샷이 톤 게인(−5 dB)과 1100 Hz 저역통과를 건너뛴 탓이다.
  const db = (g: number) => 20 * Math.log10(g)

  it('크랭크·키 끄기 원샷은 지금 톤 게인을 그대로 따라간다 — master 직결(0 dB)이 아니라', () => {
    expect(db(oneShotVoicing('crank', 0, 0).gain)).toBeCloseTo(-5, 6)
    expect(db(oneShotVoicing('keyOff', 0, 0).gain)).toBeCloseTo(-5, 6)
    // 스로틀을 연 채 끄면 루프도 원샷도 같이 커진다 — 둘 사이의 층계는 생기지 않는다
    expect(db(oneShotVoicing('keyOff', 1, 0).gain)).toBeCloseTo(0, 6)
    expect(db(oneShotVoicing('keyOff', 1, 1).gain)).toBeCloseTo(3, 6)
    expect(oneShotVoicing('crank', 0, 0).delayS).toBe(0)
  })

  it('스톨 원샷은 아이들 톤보다 10 dB 낮고 머플러와 같은 자리(1100 Hz)까지 닫힌다', () => {
    const v = oneShotVoicing('stall', 0, 0)
    expect(db(v.gain)).toBeCloseTo(-15, 6)
    expect(v.lowpassHz).toBe(1100)
    // 죽어가는 연출이 끝난 뒤에 온다
    expect(v.delayS).toBeCloseTo(0.25, 10)
  })

  it('스톨 원샷은 스로틀·부하가 남아 있어도 올라가지 않는다 — 죽은 엔진에는 부하가 없다', () => {
    expect(oneShotVoicing('stall', 1, 1)).toEqual(oneShotVoicing('stall', 0, 0))
  })

  it('스톨이 아이들보다 **작다** — 이 부등호가 신고된 버그 그 자체다', () => {
    const idleTone = db(toneFor(0, 0).gain)
    expect(db(oneShotVoicing('stall', 0, 0).gain)).toBeLessThan(idleTone)
    // 고치기 전에는 원샷이 master 직결(0 dB)이라 아이들 톤보다 5 dB 위였다
    expect(0).toBeGreaterThan(idleTone)
  })

  it('원샷 저역통과는 톤(1100 Hz)보다 열려 있다 — 크랭킹은 배기음이 아니다', () => {
    expect(oneShotVoicing('crank', 0, 0).lowpassHz).toBeGreaterThan(toneFor(0, 0).lowpassHz)
    expect(oneShotVoicing('crank', 0, 0).lowpassHz).toBe(2200)
  })
})

describe('스톨 연출', () => {
  it('stopPlan은 스톨에 0.25초를 주고 원샷을 그 뒤로 미룬다', () => {
    const p = stopPlan(true, 1.2, true)
    expect(p.stall).toBe(true)
    expect(p.fadeS).toBeCloseTo(0.25, 10)
    expect(p.oneShotDelayS).toBeCloseTo(0.25, 10)
    // 0.25(연출) + 1.2(stop.ogg) + 0.05(여유) — 원샷이 잘리기 전에 재우지 않는다
    expect(p.suspendAfterS).toBeCloseTo(1.5, 10)
  })

  it('키 끄기는 예전 그대로 0.15초에 곧바로 운다', () => {
    const p = stopPlan(true, 1.2, false)
    expect(p.stall).toBe(false)
    expect(p.fadeS).toBeCloseTo(0.15, 10)
    expect(p.oneShotDelayS).toBe(0)
    expect(p.suspendAfterS).toBeCloseTo(1.25, 10)
  })

  it('playbackRate는 0.4까지만 내려간다 — 0으로 가면 루프가 멎어 무음이 된다', () => {
    expect(stallRate(1)).toBeCloseTo(0.4, 10)
    expect(stallRate(0.75)).toBeCloseTo(0.4, 10)
    // 이미 더 느리면 끌어올리지 않는다
    expect(stallRate(0.3)).toBeCloseTo(0.3, 10)
    expect(stallRate(0)).toBeCloseTo(0.4, 10)
    expect(stallRate(NaN)).toBeCloseTo(0.4, 10)
  })
})

describe('아이들 아래 루프 배율', () => {
  it('아이들 위는 1, 600 rpm 아래는 0', () => {
    expect(subIdleGain(1300)).toBe(1)
    expect(subIdleGain(9000)).toBe(1)
    expect(subIdleGain(600)).toBe(0)
    expect(subIdleGain(0)).toBe(0)
    expect(subIdleGain(NaN)).toBe(0)
  })
  it('죽어가는 회전을 따라 내려간다 — 900 rpm에서 −7.4 dB', () => {
    expect(20 * Math.log10(subIdleGain(900))).toBeCloseTo(-7.4, 1)
    expect(subIdleGain(950)).toBeGreaterThan(subIdleGain(900))
  })
  it('스타터가 돌리는 300 rpm에서는 0 — 늘어진 테이프가 새어 나오지 않는다', () => {
    expect(subIdleGain(300)).toBe(0)
    expect(subIdleGain(599)).toBe(0)
  })
})

describe('리미터 스터터', () => {
  it('11,900 위에서 회전이 꺾일 때만 판다', () => {
    expect(limiterCutDue(11950, -5000, 10, 0)).toBe(true)
    // 올라가며 리미터를 치는 순간에는 아직 연료가 붙어 있다
    expect(limiterCutDue(11950, 5000, 10, 0)).toBe(false)
    // 리미터 아래에서 회전이 떨어지는 것은 그냥 감속이다 (버블이 맡는다)
    expect(limiterCutDue(9000, -5000, 10, 0)).toBe(false)
    expect(limiterCutDue(11900, -5000, 10, 0)).toBe(false)
  })
  it('초당 12번을 넘지 않는다', () => {
    expect(limiterCutDue(11950, -5000, 10, 9.99)).toBe(false)
    expect(limiterCutDue(11950, -5000, 10, 10 - 1 / 12)).toBe(true)
    expect(limiterCutDue(11950, -5000, 10, 9.9)).toBe(true)
  })
  it('성치 않은 값에는 걸리지 않는다', () => {
    expect(limiterCutDue(NaN, -5000, 10, 0)).toBe(false)
    expect(limiterCutDue(11950, NaN, 10, 0)).toBe(false)
    expect(limiterCutDue(11950, -5000, NaN, 0)).toBe(false)
  })
})

describe('부하 평활', () => {
  it('클러치를 잡는 순간의 4.5 dB가 계단이 되지 않는다 — 0.15초 시정수', () => {
    // 25 ms tick 하나에 15%만 움직인다 (1 − e^(−0.025/0.15))
    expect(smoothTo(1, 0, 0.025, 0.15)).toBeCloseTo(Math.exp(-0.025 / 0.15), 10)
    // 3τ면 95%
    expect(smoothTo(1, 0, 0.45, 0.15)).toBeLessThan(0.05)
  })
  it('dt·tau가 성치 않으면 목표에 바로 붙는다 (첫 tick·복귀 직후)', () => {
    expect(smoothTo(1, 0, 0, 0.15)).toBe(0)
    expect(smoothTo(1, 0, NaN, 0.15)).toBe(0)
    expect(smoothTo(NaN, 0.5, 0.025, 0.15)).toBe(0.5)
    expect(smoothTo(0.5, NaN, 0.025, 0.15)).toBe(0.5)
  })
})

describe('크랭크 정렬', () => {
  // start.ogg는 1.012초, 그 안의 점화는 0.8초 지점이다.
  // 물리(rideModel.CRANK_S)는 0.6초 동안 300 rpm으로 돌리다 그때 연소를 붙인다.
  it('녹음의 점화가 물리의 점화에 앉는다 — 루프는 그 순간 올라온다', () => {
    const p = crankPlan(1.012, 0.6)
    expect(p.offsetS).toBeCloseTo(0.2, 10)   // 앞 0.2초(크랭킹만 있는 대목)를 버린다
    expect(p.delayS).toBeCloseTo(0.6, 10)    // = 물리의 점화 시각
    // 잘라 낸 만큼과 기다리는 만큼을 더하면 늘 녹음의 점화 지점이다
    expect(p.offsetS + p.delayS).toBeCloseTo(0.8, 10)
  })
  it('물리 크랭킹이 길어지면 녹음을 앞에서부터 다 쓴다 (범프 스타트로 짧아지면 그만큼 잘린다)', () => {
    expect(crankPlan(1.012, 0.8)).toEqual({ offsetS: 0, delayS: 0.8 })
    expect(crankPlan(1.012, 2)).toEqual({ offsetS: 0, delayS: 0.8 })
    const short = crankPlan(1.012, 0.15)
    expect(short.offsetS).toBeCloseTo(0.65, 10)
    expect(short.delayS).toBeCloseTo(0.15, 10)
  })
  it('버퍼가 없거나 값이 성치 않아도 늘 유효한 지연을 돌려준다', () => {
    expect(crankPlan(0, 0.6)).toEqual({ offsetS: 0, delayS: 0.8 })
    expect(crankPlan(NaN, 0.6)).toEqual({ offsetS: 0, delayS: 0.8 })
    expect(crankPlan(1.012, NaN)).toEqual({ offsetS: 0, delayS: 0.8 })
    // 버퍼보다 많이 잘라 내지 않는다
    expect(crankPlan(0.1, 0.1).offsetS).toBeLessThanOrEqual(0.1)
  })
})

describe('칸 교차 페이드의 헤드룸', () => {
  // 교차 페이드 중에는 칸 둘이 같은 rpm으로 동시에 운다. 제곱합은 1이지만(등파워),
  // 두 녹음의 기본파 위상은 무작위라 운 좋게(나쁘게) 맞으면 선형으로 더해진다.
  it('가장 나쁜 경우가 +3.01 dB — MASTER_GAIN 표가 세지 않은 몫이다', () => {
    const c = fadeCurve(1, true)
    const d = fadeCurve(1, false)
    let worst = 0
    for (let i = 0; i < c.length; i++) worst = Math.max(worst, c[i] + d[i])
    expect(20 * Math.log10(worst)).toBeCloseTo(3.01, 2)
    // 피크 −2.9 dBFS + 3.01 = +0.1 dBFS. 컴프레서(−10 dB/4:1)가 이 과도부를 받으라고 있다
    expect(peakDbfs(9000, 1, 1) + 20 * Math.log10(worst)).toBeLessThan(1)
  })
})
