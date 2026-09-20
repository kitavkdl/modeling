import { describe, expect, it } from 'vitest'
import { blip, loopGains, preload, safeRpm, setLoad, setRpm, setThrottle, start, stop, toneFor } from './engineSound'

// v3는 실녹음 루프를 재생한다. 오디오 그래프는 노드 환경(window 없음)에서 만들어지지 않으므로
// 여기서는 순수 함수와 "무슨 순서로 불러도 터지지 않는다"는 계약만 확인한다.

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

describe('루프 크로스페이드 게인', () => {
  it('등파워 — 제곱합이 항상 1', () => {
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const { lower, upper } = loopGains(t)
      expect(lower * lower + upper * upper).toBeCloseTo(1, 10)
    }
  })
  it('t=0이면 lower만, t=1이면 upper만', () => {
    expect(loopGains(0).lower).toBeCloseTo(1, 10)
    expect(loopGains(0).upper).toBeCloseTo(0, 10)
    expect(loopGains(1).lower).toBeCloseTo(0, 10)
    expect(loopGains(1).upper).toBeCloseTo(1, 10)
  })
})

describe('공개 API 계약', () => {
  it('start() 없이 부르는 stop()은 아무 일도 하지 않는다', () => {
    expect(() => stop()).not.toThrow()
  })
  it('오디오가 없는 환경에서도 전부 무음으로 넘어간다', () => {
    expect(() => {
      start()
      setRpm(NaN)
      setThrottle(NaN)
      setLoad(NaN)
      blip()
      stop()
      stop()
    }).not.toThrow()
  })
  it('preload()는 오디오가 없으면 조용히 resolve하고 같은 약속을 돌려준다', async () => {
    const first = preload()
    expect(preload()).toBe(first)
    await expect(first).resolves.toBeUndefined()
  })
})
