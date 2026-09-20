import { describe, expect, it } from 'vitest'
import {
  antiAliasHz,
  burbleRate,
  dbToGain,
  fireHz,
  highCutoffHz,
  highLayerGain,
  highLayerMix,
  intakeGain,
  loopShelfDb,
  partialDetune,
  partialGain,
  popDurationS,
  popGain,
  rpmSlope,
  shaperCurve,
  HIGH_DETUNE,
  HIGH_LPF_Q,
  HIGH_MIX_DB,
  HIGH_PARTIALS,
  INTAKE_DB,
  INTAKE_HZ,
  INTAKE_Q,
  LOOP_RMS_DBFS,
  POP_DB_MAX,
  POP_DB_MIN,
  POP_HZ,
  POP_MAX_S,
  POP_MIN_S,
  POP_Q,
} from './engineLayers'

// 합성 층의 값을 정하는 순수 함수만 여기서 못박는다 (노드에는 AudioContext가 없다).
// 레벨은 말로만 두지 않고 실제로 렌더해서 잰다 — 체인 RMS 상수(HIGH_CHAIN_RMS 등)가
// 틀어지면 "루프 대비 −12 dB"라는 약속이 조용히 깨지므로, 그 약속 자체를 테스트한다.

const FS = 48000

/** RBJ 쌍2차 — WebAudio BiquadFilterNode와 같은 계수 */
function biquad(x: Float64Array, b: [number, number, number], a: [number, number, number]): Float64Array {
  const y = new Float64Array(x.length)
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0
  for (let i = 0; i < x.length; i++) {
    const v = (b[0] * x[i] + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2) / a[0]
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v
    y[i] = v
  }
  return y
}

function lowpass(x: Float64Array, f0: number, q: number): Float64Array {
  const w = (2 * Math.PI * f0) / FS
  const al = Math.sin(w) / (2 * q)
  const c = Math.cos(w)
  return biquad(x, [(1 - c) / 2, 1 - c, (1 - c) / 2], [1 + al, -2 * c, 1 - al])
}

function bandpass(x: Float64Array, f0: number, q: number): Float64Array {
  const w = (2 * Math.PI * f0) / FS
  const al = Math.sin(w) / (2 * q)
  return biquad(x, [al, 0, -al], [1 + al, -2 * Math.cos(w), 1 - al])
}

/** WaveShaperNode가 곡선을 읽는 방식 — (x+1)/2를 인덱스로 보고 선형보간한다 */
function shape(x: Float64Array, curve: Float32Array): Float64Array {
  const y = new Float64Array(x.length)
  const n = curve.length
  for (let i = 0; i < x.length; i++) {
    const p = Math.min(Math.max((x[i] + 1) / 2, 0), 1) * (n - 1)
    const j = Math.min(Math.floor(p), n - 2)
    y[i] = curve[j] + (curve[j + 1] - curve[j]) * (p - j)
  }
  return y
}

const rms = (x: Float64Array, skip = 2000) => {
  let s = 0
  for (let i = skip; i < x.length; i++) s += x[i] * x[i]
  return Math.sqrt(s / (x.length - skip))
}
const dbOf = (g: number) => 20 * Math.log10(g)

/** 재현 가능한 난수 (백색잡음용) */
function lcg(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

/** RMS 1인 정규분포 잡음 */
function noise(n: number, seed = 12345): Float64Array {
  const r = lcg(seed)
  const y = new Float64Array(n)
  for (let i = 0; i < n; i += 2) {
    const u = Math.max(r(), 1e-12)
    const m = Math.sqrt(-2 * Math.log(u))
    const a = 2 * Math.PI * r()
    y[i] = m * Math.cos(a)
    if (i + 1 < n) y[i + 1] = m * Math.sin(a)
  }
  return y
}

/** 고회전 층 한 채널을 실제로 그려 본다 (게인까지 먹인 최종 신호) */
function renderHigh(rpm: number, seconds = 2): Float64Array {
  const f = fireHz(rpm)
  const n = Math.floor(FS * seconds)
  const x = new Float64Array(n)
  for (let k = 1; k <= HIGH_PARTIALS; k++) {
    const g = partialGain(k)
    const w = (2 * Math.PI * f * k * partialDetune(k)) / FS
    for (let i = 0; i < n; i++) x[i] += g * Math.sin(w * i)
  }
  const y = shape(lowpass(x, highCutoffHz(rpm), HIGH_LPF_Q), shaperCurve())
  const g = highLayerGain(rpm)
  for (let i = 0; i < n; i++) y[i] *= g
  return y
}

describe('고회전 몸통 섞임', () => {
  it('5500 rpm 아래는 0, 8000 rpm 위는 1', () => {
    expect(highLayerMix(0)).toBe(0)
    expect(highLayerMix(5500)).toBe(0)
    expect(highLayerMix(5000)).toBe(0)
    expect(highLayerMix(8000)).toBe(1)
    expect(highLayerMix(12000)).toBe(1)
    expect(highLayerMix(NaN)).toBe(0)
  })

  it('가운데(6750 rpm)에서 0.5이고 단조 증가한다', () => {
    expect(highLayerMix(6750)).toBeCloseTo(0.5, 10)
    let prev = -1
    for (let rpm = 5000; rpm <= 8500; rpm += 25) {
      const v = highLayerMix(rpm)
      expect(v).toBeGreaterThanOrEqual(prev)
      prev = v
    }
  })

  it('양 끝에서 기울기가 0이다 — 섞이기 시작하는 순간에 계단이 생기지 않는다', () => {
    expect(highLayerMix(5510)).toBeLessThan(1e-4)
    expect(1 - highLayerMix(7990)).toBeLessThan(1e-4)
  })

  it('공진 저역통과는 2.5 kHz에서 4 kHz로 오른다', () => {
    expect(highCutoffHz(5000)).toBe(2500)
    expect(highCutoffHz(6750)).toBeCloseTo(3250, 6)
    expect(highCutoffHz(9000)).toBe(4000)
  })
})

describe('고회전 몸통 배음', () => {
  it('오실레이터는 6개를 넘지 않는다 (CPU 상한)', () => {
    expect(HIGH_PARTIALS).toBeLessThanOrEqual(6)
  })

  it('진폭은 1/k 비율이고, 합의 최댓값이 1이다', () => {
    for (let k = 2; k <= HIGH_PARTIALS; k++) {
      expect(partialGain(1) / partialGain(k)).toBeCloseTo(k, 10)
    }
    let sum = 0
    for (let k = 1; k <= HIGH_PARTIALS; k++) sum += partialGain(k)
    expect(sum).toBeCloseTo(1, 10)
  })

  it('디튠은 3차부터 ±0.3%를 번갈아 준다', () => {
    expect(partialDetune(1)).toBe(1)
    expect(partialDetune(2)).toBe(1)
    expect(partialDetune(3)).toBeCloseTo(1 + HIGH_DETUNE, 12)
    expect(partialDetune(4)).toBeCloseTo(1 - HIGH_DETUNE, 12)
    expect(partialDetune(5)).toBeCloseTo(1 + HIGH_DETUNE, 12)
    expect(partialDetune(6)).toBeCloseTo(1 - HIGH_DETUNE, 12)
  })

  it('tanh 곡선은 홀함수이고 ±1로 끝난다', () => {
    const c = shaperCurve(1025)
    expect(c[0]).toBeCloseTo(-1, 6)
    expect(c[c.length - 1]).toBeCloseTo(1, 6)
    expect(c[512]).toBeCloseTo(0, 6)
    for (let i = 1; i < c.length; i++) expect(c[i]).toBeGreaterThan(c[i - 1])
    expect(c[600] + c[1024 - 600]).toBeCloseTo(0, 6)
  })
})

describe('층 레벨 (실제로 렌더해서 잰다)', () => {
  it('고회전 몸통은 완전히 실렸을 때 루프 버스 대비 −12 dB다', () => {
    // 루프는 −18 dBFS RMS로 정규화돼 있으므로 목표는 −30 dBFS.
    const got = dbOf(rms(renderHigh(9000)))
    expect(got).toBeCloseTo(LOOP_RMS_DBFS + HIGH_MIX_DB, 0)
    expect(Math.abs(got - (LOOP_RMS_DBFS + HIGH_MIX_DB))).toBeLessThan(0.5)
  })

  it('8000 rpm과 9000 rpm은 같은 레벨이다 (섞임이 이미 1)', () => {
    expect(dbOf(rms(renderHigh(8000))) - dbOf(rms(renderHigh(9000)))).toBeCloseTo(0, 1)
  })

  it('5500 rpm에서는 완전히 꺼져 있다', () => {
    expect(highLayerGain(5500)).toBe(0)
    expect(highLayerGain(3000)).toBe(0)
  })

  it('6000 rpm은 완전 섞임보다 약 20 dB 낮다 (smoothstep 0.104)', () => {
    expect(highLayerMix(6000)).toBeCloseTo(0.104, 3)
    expect(dbOf(highLayerMix(6000))).toBeCloseTo(-19.66, 1)
  })

  it('흡기 그로울은 스로틀 1에서 루프 버스 대비 −14 dB다', () => {
    const n = FS * 4
    const am = new Float64Array(n)
    const band = bandpass(noise(n), INTAKE_HZ, INTAKE_Q)
    const w = (2 * Math.PI * 100) / FS // 점화 6000 rpm — 변조 깊이만 보므로 주파수는 아무거나
    for (let i = 0; i < n; i++) am[i] = band[i] * (0.5 + 0.5 * Math.sin(w * i)) * intakeGain(1)
    const got = dbOf(rms(am))
    expect(Math.abs(got - (LOOP_RMS_DBFS + INTAKE_DB))).toBeLessThan(0.5)
  })

  it('흡기 그로울은 스로틀의 제곱에 비례한다 — 반만 열면 −12 dB', () => {
    expect(intakeGain(0)).toBe(0)
    expect(dbOf(intakeGain(0.5) / intakeGain(1))).toBeCloseTo(-12.04, 2)
    expect(intakeGain(2)).toBe(intakeGain(1))
    expect(intakeGain(NaN)).toBe(0)
  })

  it('팝은 루프 버스 대비 −18~−10 dB 안에서 난다', () => {
    const n = FS * 4
    const band = bandpass(noise(n, 777), POP_HZ, POP_Q)
    for (const [r, db] of [[0, POP_DB_MIN], [1, POP_DB_MAX]] as const) {
      const y = new Float64Array(n)
      const g = popGain(r)
      for (let i = 0; i < n; i++) y[i] = band[i] * g
      expect(Math.abs(dbOf(rms(y)) - (LOOP_RMS_DBFS + db))).toBeLessThan(0.5)
    }
  })

  it('팝 길이는 10~25 ms다', () => {
    expect(popDurationS(0)).toBeCloseTo(POP_MIN_S, 10)
    expect(popDurationS(1)).toBeCloseTo(POP_MAX_S, 10)
    expect(popDurationS(0.5)).toBeCloseTo((POP_MIN_S + POP_MAX_S) / 2, 10)
    expect(popDurationS(NaN)).toBe(POP_MIN_S)
  })
})

describe('루프 저역 셸프', () => {
  it('7000 rpm까지 0, 7500 rpm 위로 +3 dB', () => {
    expect(loopShelfDb(6000)).toBe(0)
    expect(loopShelfDb(7000)).toBe(0)
    expect(loopShelfDb(7250)).toBeCloseTo(1.5, 10)
    expect(loopShelfDb(7500)).toBe(3)
    expect(loopShelfDb(12000)).toBe(3)
  })
})

describe('감속 버블', () => {
  const falling = -1500

  it('스로틀이 열려 있으면 절대 울리지 않는다', () => {
    expect(burbleRate(0.1, 5000, falling)).toBe(0)
    expect(burbleRate(0.5, 5000, falling)).toBe(0)
    expect(burbleRate(1, 5000, falling, true)).toBe(0)
  })

  it('닫고 · 3500 rpm 위 · 회전이 −800 rpm/s보다 빠르게 떨어질 때 시작한다', () => {
    expect(burbleRate(0, 3400, falling)).toBe(0)     // rpm이 낮다
    expect(burbleRate(0, 5000, -700)).toBe(0)        // 충분히 빨리 떨어지지 않는다
    expect(burbleRate(0, 5000, +2000)).toBe(0)       // 오르는 중
    expect(burbleRate(0, 5000, falling)).toBeGreaterThan(0)
    expect(burbleRate(0.09, 5000, falling)).toBeGreaterThan(0)
  })

  it('빈도는 초당 2~6개, 급하게 떨어질수록 잦다', () => {
    expect(burbleRate(0, 5000, -800)).toBe(0)       // 문턱은 '−800보다 빨리'다
    expect(burbleRate(0, 5000, -800.001)).toBeCloseTo(2, 4)
    expect(burbleRate(0, 5000, -1900)).toBeCloseTo(4, 10)
    expect(burbleRate(0, 5000, -3000)).toBeCloseTo(6, 10)
    expect(burbleRate(0, 5000, -9000)).toBeCloseTo(6, 10)   // 상한을 넘지 않는다
  })

  it('한 번 시작하면 2500 rpm까지 이어진다 — 회전이 잠깐 평평해져도 끊기지 않는다', () => {
    // 감속 중 회전이 순간 멎는 tick 하나로 팝이 뚝 끊기면 딱딱하게 들린다
    expect(burbleRate(0, 3000, -100, true)).toBeGreaterThan(0)
    expect(burbleRate(0, 3000, -100, false)).toBe(0)
    expect(burbleRate(0, 2499, -2000, true)).toBe(0)
    expect(burbleRate(0, 2501, -2000, true)).toBeGreaterThan(0)
  })

  it('NaN은 조용히 0으로 본다', () => {
    expect(burbleRate(NaN, 5000, falling)).toBeGreaterThan(0)   // 스로틀 NaN → 닫힘
    expect(burbleRate(0, NaN, falling)).toBe(0)
    expect(burbleRate(0, 5000, NaN)).toBe(0)
  })
})

describe('앤티에일리어싱과 rpm 기울기', () => {
  it('피치업 1.4배를 넘을 때만 7 kHz로 내려간다', () => {
    expect(antiAliasHz(1)).toBe(9000)
    expect(antiAliasHz(1.4)).toBe(9000)
    expect(antiAliasHz(1.41)).toBe(7000)
    expect(antiAliasHz(1.85)).toBe(7000)
    expect(antiAliasHz(NaN)).toBe(9000)
  })

  it('기울기는 (다음−이전)/dt이고, dt가 성치 않으면 0', () => {
    expect(rpmSlope(3000, 3025, 0.025)).toBeCloseTo(1000, 6)
    expect(rpmSlope(5000, 4900, 0.05)).toBeCloseTo(-2000, 6)
    expect(rpmSlope(3000, 3000, 0)).toBe(0)
    expect(rpmSlope(NaN, 3000, 0.025)).toBe(0)
    expect(rpmSlope(3000, NaN, 0.025)).toBe(0)
  })

  it('점화 주파수는 rpm/60이고, 시동이 꺼져 있으면 0', () => {
    expect(fireHz(6000)).toBe(100)
    expect(fireHz(0)).toBe(0)
    expect(fireHz(-5)).toBe(0)
    expect(fireHz(NaN)).toBe(0)
  })

  it('dbToGain은 왕복한다', () => {
    expect(dbToGain(0)).toBe(1)
    expect(dbOf(dbToGain(-12))).toBeCloseTo(-12, 10)
  })
})

describe('리미터 바운스에서는 버블이 울지 않는다', () => {
  // 물리의 소프트 컷은 11,700~12,000을 오간다 — 떨어지는 쪽 기울기가 −6,000 rpm/s를 넘어
  // rpm·dRpm 조건만 보면 버블 조건에 그대로 걸린다. 막는 것은 스로틀뿐이다.
  it('전개로 리미터를 치는 동안은 스로틀이 막는다', () => {
    expect(burbleRate(1, 12000, -6000)).toBe(0)
    expect(burbleRate(1, 12000, -6000, true)).toBe(0)
    expect(burbleRate(0.5, 11800, -3000, true)).toBe(0)
  })
  it('같은 회전이라도 스로틀을 닫으면 그때는 진짜 감속이라 운다', () => {
    expect(burbleRate(0, 12000, -6000)).toBeGreaterThan(0)
    expect(burbleRate(0.09, 12000, -6000)).toBeGreaterThan(0)
  })
})
