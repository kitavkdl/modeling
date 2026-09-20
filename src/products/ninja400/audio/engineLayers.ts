// 엔진음 합성 층 — 실녹음 루프가 못 내는 세 가지를 얹는다 (engineSound.ts가 엮는다).
//
//  1) 고회전 몸통(high layer): 뱅크 최고 칸(6495 rpm) 위는 루프를 1.85배까지 피치업해 쓰는데,
//     리샘플링은 스펙트럼을 통째로 밀어 올릴 뿐이라 배음이 성기고 몸통이 빠진다("얇고 가볍다").
//     점화 기본파에 물린 정현파 6개를 쌓아 5500→8000 rpm에 걸쳐 섞는다.
//  2) 흡기 그로울(intake): 스로틀을 열 때만 나는 대역 잡음. 점화 주파수로 진폭 변조해
//     루프와 같은 박자로 으르렁거린다.
//  3) 감속 버블(burble): 스로틀을 닫고 회전이 떨어질 때 튀는 짧은 팝.
//
// 여기 있는 것은 (a) 값을 정하는 순수 함수와 (b) 그래프를 만들고 갱신하는 함수뿐이다.
// (a)만 테스트한다 — 노드 환경에는 AudioContext가 없다.
//
// 레벨 기준: 뱅크 루프는 −18 dBFS RMS로 정규화돼 있다(build-engine-bank.py). 그래서 "루프 버스
// 대비 −12 dB"는 곧 −30 dBFS RMS를 뜻한다. 각 층의 체인 RMS(정현파 스택·대역통과 잡음)는
// 미리 재서 상수로 박아 두고, 그 역수를 곱해 목표 RMS에 맞춘다. 이 상수가 틀어지면 약속이
// 조용히 깨지므로, engineLayers.test.ts가 같은 체인을 직접 렌더해 dB를 다시 잰다.

/** 뱅크 루프의 RMS (dBFS) */
export const LOOP_RMS_DBFS = -18

export const clamp01 = (t: number) => (Number.isFinite(t) ? (t < 0 ? 0 : t > 1 ? 1 : t) : 0)
export const dbToGain = (db: number) => Math.pow(10, db / 20)

/** 360° 병렬 트윈은 1회전에 한 번 점화한다 — 뱅크 루프의 f0와 같은 정의를 쓴다 */
export const fireHz = (rpm: number) => (Number.isFinite(rpm) && rpm > 0 ? rpm / 60 : 0)

// ── 고회전 몸통 ────────────────────────────────────────────────────────────────
/** 섞이기 시작하는 rpm과 온전히 실리는 rpm */
export const HIGH_RPM_LO = 5500
export const HIGH_RPM_HI = 8000
/** 정현파 개수 (= OscillatorNode 개수, CPU 상한) */
export const HIGH_PARTIALS = 6
/** 루프 버스 대비 섞는 양 (dB) */
export const HIGH_MIX_DB = -12
/** 공진 저역통과: 컷오프 (Hz, rpm에 따라 상승) 와 Q */
export const HIGH_LPF_LO_HZ = 2500
export const HIGH_LPF_HI_HZ = 4000
export const HIGH_LPF_Q = 1.5
/** 3차 이상 배음에 주는 디튠 (±0.3%) — 완전히 물린 정현파 스택의 기계적인 느낌을 푼다 */
export const HIGH_DETUNE = 0.003
/** tanh 웨이브셰이퍼 드라이브 — 클수록 거칠다 */
export const HIGH_DRIVE = 2.5
/** 정현파 스택 → 저역통과 → tanh 를 지난 뒤의 RMS (진폭 정규화된 스택 기준 — engineLayers.test.ts가 실제로 렌더해 다시 잰다) */
export const HIGH_CHAIN_RMS = 0.62
/** 루프 층에만 걸리는 저역 셸프: 이 rpm 위에서 150 Hz +3 dB */
export const LOOP_SHELF_RPM = 7000
export const LOOP_SHELF_RAMP = 500
export const LOOP_SHELF_HZ = 150
export const LOOP_SHELF_DB = 3

/** 배음 진폭 1/k 를 합의 최댓값이 1이 되도록 정규화한 값 */
const HARMONIC_SUM = Array.from({ length: HIGH_PARTIALS }, (_, i) => 1 / (i + 1)).reduce((a, b) => a + b, 0)
export function partialGain(k: number): number {
  return 1 / k / HARMONIC_SUM
}

/** k번째 배음의 디튠 배수 — 3차부터 ±0.3%를 번갈아 준다 */
export function partialDetune(k: number): number {
  return k < 3 ? 1 : 1 + (k % 2 === 1 ? HIGH_DETUNE : -HIGH_DETUNE)
}

/** 5500→8000 rpm 사이 0→1 (양 끝에서 기울기가 0인 smoothstep — 섞이는 순간이 티나지 않는다) */
export function highLayerMix(rpm: number): number {
  const t = clamp01((rpm - HIGH_RPM_LO) / (HIGH_RPM_HI - HIGH_RPM_LO))
  return t * t * (3 - 2 * t)
}

/** 공진 저역통과 컷오프 (Hz) — 같은 구간에서 2.5→4 kHz로 선형 상승 */
export function highCutoffHz(rpm: number): number {
  const t = clamp01((rpm - HIGH_RPM_LO) / (HIGH_RPM_HI - HIGH_RPM_LO))
  return HIGH_LPF_LO_HZ + (HIGH_LPF_HI_HZ - HIGH_LPF_LO_HZ) * t
}

/** 고회전 층의 최종 게인 (선형) — 전 섞임에서 −30 dBFS RMS가 되도록 체인 RMS로 나눈다 */
export function highLayerGain(rpm: number): number {
  return (highLayerMix(rpm) * dbToGain(LOOP_RMS_DBFS + HIGH_MIX_DB)) / HIGH_CHAIN_RMS
}

/** 루프 층 저역 셸프 (dB) — 7000 rpm에서 0, 7500 rpm 위로 +3 (계단이 되지 않게 500 rpm에 걸쳐 올린다) */
export function loopShelfDb(rpm: number): number {
  return LOOP_SHELF_DB * clamp01((rpm - LOOP_SHELF_RPM) / LOOP_SHELF_RAMP)
}

/** tanh 새추레이션 곡선 (−1~1 입력을 그대로 −1~1로) */
export function shaperCurve(points = 1024): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(points)
  const norm = Math.tanh(HIGH_DRIVE)
  for (let i = 0; i < points; i++) {
    const x = (i / (points - 1)) * 2 - 1
    curve[i] = Math.tanh(HIGH_DRIVE * x) / norm
  }
  return curve
}

// ── 흡기 그로울 ────────────────────────────────────────────────────────────────
/** 대역통과 (Hz, Q) — 400~1200 Hz의 기하 중심 */
export const INTAKE_LO_HZ = 400
export const INTAKE_HI_HZ = 1200
export const INTAKE_HZ = Math.sqrt(INTAKE_LO_HZ * INTAKE_HI_HZ)
export const INTAKE_Q = 0.7
/** 스로틀 1에서 루프 버스 대비 (dB). 실제 레벨은 스로틀² 배 */
export const INTAKE_DB = -14
/** 80 ms 페이드인 ≈ 시정수 27 ms (3τ에서 95%) */
export const INTAKE_TAU = 0.027
/** RMS 1인 백색잡음이 위 대역통과를 지나고 (0.5+0.5·sin) 변조를 받은 뒤의 RMS (테스트가 다시 잰다) */
export const INTAKE_CHAIN_RMS = 0.2458 * 0.6124

/** 흡기 그로울 레벨 (선형) — 스로틀²에 비례한다 */
export function intakeGain(throttle: number): number {
  const th = clamp01(throttle)
  return (th * th * dbToGain(LOOP_RMS_DBFS + INTAKE_DB)) / INTAKE_CHAIN_RMS
}

// ── 감속 버블 ──────────────────────────────────────────────────────────────────
/** 켜지는 조건: 스로틀 < 0.1, rpm > 3500, d(rpm)/dt < −800 */
export const BURBLE_THROTTLE = 0.1
export const BURBLE_RPM_ON = 3500
export const BURBLE_RPM_OFF = 2500
export const BURBLE_DRPM = -800
/** 이만큼 급하게 떨어지면 최대 빈도 */
export const BURBLE_DRPM_FULL = -3000
export const BURBLE_RATE_MIN = 2
export const BURBLE_RATE_MAX = 6
/** 팝 하나: 길이 (s), 레벨 (루프 버스 대비 dB), 대역통과 (Hz, Q) */
export const POP_MIN_S = 0.01
export const POP_MAX_S = 0.025
export const POP_DB_MIN = -18
export const POP_DB_MAX = -10
export const POP_HZ = 300
export const POP_Q = 1
/** RMS 1인 백색잡음이 300 Hz 대역통과를 지난 뒤의 RMS (테스트가 다시 잰다) */
export const POP_CHAIN_RMS = 0.1386

/**
 * 초당 팝 개수. 조건에 안 맞으면 0.
 *
 * active(직전에 울리고 있었는지)를 주면 히스테리시스가 붙는다 — 한 번 시작한 버블은
 * 스로틀이 열리거나 rpm이 2500 밑으로 내려갈 때까지 이어진다. 회전이 잠깐 평평해졌다고
 * (dRpm이 −800을 넘었다고) 끊기면 딱딱 끊어져 들린다.
 */
export function burbleRate(throttle: number, rpm: number, dRpm: number, active = false): number {
  const th = clamp01(throttle)
  const r = Number.isFinite(rpm) ? rpm : 0
  const d = Number.isFinite(dRpm) ? dRpm : 0
  if (th >= BURBLE_THROTTLE) return 0
  if (active) {
    if (r < BURBLE_RPM_OFF) return 0
  } else if (r <= BURBLE_RPM_ON || d >= BURBLE_DRPM) {
    return 0
  }
  const hard = clamp01((d - BURBLE_DRPM) / (BURBLE_DRPM_FULL - BURBLE_DRPM))
  return BURBLE_RATE_MIN + (BURBLE_RATE_MAX - BURBLE_RATE_MIN) * hard
}

/** 팝 하나의 길이 (s) — r은 0~1 난수 */
export function popDurationS(r: number): number {
  return POP_MIN_S + (POP_MAX_S - POP_MIN_S) * clamp01(r)
}

/** 팝 하나의 최고 게인 (선형) — r은 0~1 난수 */
export function popGain(r: number): number {
  return dbToGain(LOOP_RMS_DBFS + POP_DB_MIN + (POP_DB_MAX - POP_DB_MIN) * clamp01(r)) / POP_CHAIN_RMS
}

// ── 공통 ───────────────────────────────────────────────────────────────────────
/** 앤티에일리어싱 저역통과 (Hz). 1.4배 넘게 피치업할 때만 7 kHz로 내려 리샘플 잡음을 덮는다 */
export const ANTI_ALIAS_HZ = 9000
export const ANTI_ALIAS_HOT_HZ = 7000
export const ANTI_ALIAS_RATE = 1.4
export function antiAliasHz(rate: number): number {
  return Number.isFinite(rate) && rate > ANTI_ALIAS_RATE ? ANTI_ALIAS_HOT_HZ : ANTI_ALIAS_HZ
}

/** d(rpm)/dt (rpm/s). dt가 0이거나 값이 성치 않으면 0 */
export function rpmSlope(prev: number, next: number, dt: number): number {
  if (!Number.isFinite(prev) || !Number.isFinite(next) || !Number.isFinite(dt) || dt <= 0) return 0
  return (next - prev) / dt
}

/** 매 tick의 상태 — 그래프 갱신 함수가 받는 것 전부 */
export interface LayerState {
  rpm: number
  throttle: number
  load: number
  dRpm: number
}

// ── 그래프 ─────────────────────────────────────────────────────────────────────

/** 팝과 흡기 그로울이 함께 쓰는 백색잡음 (RMS 1). Box–Muller로 정규분포를 만든다 */
export function createNoiseBuffer(ctx: BaseAudioContext, seconds = 2): AudioBuffer {
  const buf = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * seconds)), ctx.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < d.length; i += 2) {
    const u = Math.max(Math.random(), 1e-12)
    const r = Math.sqrt(-2 * Math.log(u))
    const a = 2 * Math.PI * Math.random()
    d[i] = r * Math.cos(a)
    if (i + 1 < d.length) d[i + 1] = r * Math.sin(a)
  }
  // ±4σ를 넘는 값만 눌러 튀는 샘플을 없앤다 (가우시안의 0.006%라 RMS는 1 그대로다).
  // 버퍼는 RMS 1로 둔다 — 층마다 곱하는 게인이 체인 RMS 상수를 기준으로 잡혀 있다.
  for (let i = 0; i < d.length; i++) d[i] = Math.max(-4, Math.min(4, d[i]))
  return buf
}

export interface HighLayer {
  oscs: OscillatorNode[]
  lpf: BiquadFilterNode
  mix: GainNode
}

/** 고회전 몸통을 만들어 dest에 건다. 오실레이터는 계속 돌고, 안 쓸 때는 mix가 0이다 */
export function createHighLayer(ctx: BaseAudioContext, dest: AudioNode, when: number): HighLayer {
  const mix = ctx.createGain()
  mix.gain.value = 0
  const shaper = ctx.createWaveShaper()
  shaper.curve = shaperCurve()
  shaper.oversample = '2x'
  shaper.connect(mix)
  const lpf = ctx.createBiquadFilter()
  lpf.type = 'lowpass'
  lpf.frequency.value = HIGH_LPF_LO_HZ
  lpf.Q.value = HIGH_LPF_Q
  lpf.connect(shaper)
  const oscs: OscillatorNode[] = []
  for (let k = 1; k <= HIGH_PARTIALS; k++) {
    const g = ctx.createGain()
    g.gain.value = partialGain(k)
    g.connect(lpf)
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.value = 0
    osc.connect(g)
    osc.start(when)
    oscs.push(osc)
  }
  mix.connect(dest)
  return { oscs, lpf, mix }
}

/** 배음 주파수·컷오프·섞임을 지금 값으로 끌고 간다 */
export function updateHighLayer(layer: HighLayer, s: LayerState, now: number, tau: number): void {
  const f = fireHz(s.rpm)
  for (let i = 0; i < layer.oscs.length; i++) {
    const k = i + 1
    layer.oscs[i].frequency.setTargetAtTime(f * k * partialDetune(k), now, tau)
  }
  layer.lpf.frequency.setTargetAtTime(highCutoffHz(s.rpm), now, tau)
  layer.mix.gain.setTargetAtTime(highLayerGain(s.rpm), now, tau)
}

export interface IntakeLayer {
  level: GainNode
  /** 점화 주파수로 도는 진폭변조 오실레이터 */
  lfo: OscillatorNode
}

/**
 * 흡기 그로울을 만들어 dest에 건다.
 * 대역 잡음 → 진폭변조 게인 → 레벨 게인. 변조 게인의 AudioParam은 값을 0으로 두고
 * ConstantSource(0.5)와 Oscillator(±0.5)를 더해 0~1로 흔든다 (AudioParam = 내부값 + 입력합).
 */
export function createIntakeLayer(ctx: BaseAudioContext, dest: AudioNode, noise: AudioBuffer, when: number): IntakeLayer {
  const level = ctx.createGain()
  level.gain.value = 0
  level.connect(dest)
  const am = ctx.createGain()
  am.connect(level)
  const bp = ctx.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = INTAKE_HZ
  bp.Q.value = INTAKE_Q
  bp.connect(am)
  const src = ctx.createBufferSource()
  src.buffer = noise
  src.loop = true
  src.connect(bp)
  src.start(when)

  const make = ctx.createConstantSource as undefined | (() => ConstantSourceNode)
  if (typeof make === 'function') {
    am.gain.value = 0
    const bias = ctx.createConstantSource()
    bias.offset.value = 0.5
    bias.connect(am.gain)
    bias.start(when)
  } else {
    am.gain.value = 0.5 // ConstantSourceNode가 없는 브라우저 — 내부값으로 대신한다
  }
  const depth = ctx.createGain()
  depth.gain.value = 0.5
  depth.connect(am.gain)
  const lfo = ctx.createOscillator()
  lfo.type = 'sine'
  lfo.frequency.value = 0
  lfo.connect(depth)
  lfo.start(when)
  return { level, lfo }
}

/** 변조 주파수를 점화 주파수에, 레벨을 스로틀²에 맞춘다 */
export function updateIntakeLayer(layer: IntakeLayer, s: LayerState, now: number, tau: number): void {
  layer.lfo.frequency.setTargetAtTime(fireHz(s.rpm), now, tau)
  layer.level.gain.setTargetAtTime(intakeGain(s.throttle), now, INTAKE_TAU)
}

export interface BurbleLayer {
  ctx: BaseAudioContext
  out: GainNode
  noise: AudioBuffer
  /** 다음 팝을 터뜨릴 시각 (ctx.currentTime 기준). 0이면 곧바로 */
  nextAt: number
  active: boolean
}

export function createBurbleLayer(ctx: BaseAudioContext, dest: AudioNode, noise: AudioBuffer): BurbleLayer {
  const out = ctx.createGain()
  out.gain.value = 1
  out.connect(dest)
  return { ctx, out, noise, nextAt: 0, active: false }
}

/** 팝 하나 — 2 ms에 솟았다 dur에 걸쳐 사그라지는 300 Hz 대역 잡음 */
export function schedulePop(layer: BurbleLayer, now: number, rDur: number, rLvl: number): void {
  const { ctx, out, noise } = layer
  const dur = popDurationS(rDur)
  const peak = popGain(rLvl)
  const g = ctx.createGain()
  g.gain.setValueAtTime(0, now)
  g.gain.linearRampToValueAtTime(peak, now + 0.002)
  g.gain.exponentialRampToValueAtTime(peak * 0.001, now + dur)
  g.connect(out)
  const bp = ctx.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = POP_HZ
  bp.Q.value = POP_Q
  bp.connect(g)
  const src = ctx.createBufferSource()
  src.buffer = noise
  src.loop = true
  src.connect(bp)
  src.onended = () => {
    src.disconnect()
    bp.disconnect()
    g.disconnect()
  }
  src.start(now, Math.random() * noise.duration)
  try {
    src.stop(now + dur + 0.02)
  } catch {
    /* 이미 멈춘 소스 */
  }
}

/** 조건이 맞는 동안 초당 2~6개의 팝을 흩뿌린다. 간격은 평균 1/rate로 무작위다 */
export function updateBurbleLayer(layer: BurbleLayer, s: LayerState, now: number): void {
  const rate = burbleRate(s.throttle, s.rpm, s.dRpm, layer.active)
  if (rate <= 0) {
    layer.active = false
    layer.nextAt = 0
    return
  }
  if (!layer.active) layer.nextAt = now
  layer.active = true
  if (now < layer.nextAt) return
  schedulePop(layer, now, Math.random(), Math.random())
  layer.nextAt = now + (0.5 + Math.random()) / rate
}
