// 엔진 사운드 v2 — 오디오 파일 없이 Web Audio API로 합성한다.
// 4행정 병렬 2기통(180° 크랭크)은 720° 한 주기에 0°와 180°에서 점화한다.
// 그래서 주기 P = 120/rpm 초 안에 점화가 두 번, [0, P/4] 위치에 불균등하게 놓인다.
// 점화 하나 = 짧은 임펄스(사각 0.6ms + 지수 감쇠를 건 노이즈 + 사인). 이 임펄스를
// 배기 공명 뱅크(밴드패스 ×3) → 머플러 저역통과에 통과시켜 "두둥" 소리를 만든다.
// 여기에 스로틀에 비례하는 흡기 노이즈와 기계음(기어 휘인)을 상시로 섞는다.
// rpm은 바깥(주행 모델)에서 setRpm으로 들어온다. 하우징 울림은 키보드 switchSound와 같은 2탭 딜레이.

export const IDLE_RPM = 1300
export const MAX_RPM = 10000

/** 예약을 미리 걸어 두는 구간 */
const LOOKAHEAD_S = 0.1
/** 예약 타이머 주기 */
const TICK_MS = 25

const MASTER_GAIN = 0.45
/** stop()의 페이드아웃 시간 */
const STOP_FADE_S = 0.15

/** 점화 임펄스: 사각으로 버티는 구간 0.6ms */
const PULSE_HOLD_S = 0.0006
const PULSE_GAIN = 0.5
/** 임펄스 안에서 노이즈가 차지하는 비율 (사인은 1) */
const PULSE_NOISE_MIX = 0.7
/** 점화 시각·세기가 흔들리는 폭 — 주기의 ±1.5%, 세기 ±10% */
const JITTER_FRAC = 0.03
const AMP_JITTER = 0.2

/** 배기 공명 뱅크의 각 밴드패스 출력 */
const BAND_GAIN = 0.5
/** 필터·게인을 목표로 끌고 가는 시정수 */
const TONE_TAU = 0.05
/** 스로틀 1에서의 흡기 노이즈 게인 */
const INTAKE_GAIN = 0.25
/** 기계음: 기어 휘인 (사인 톱니 → 1500Hz 하이패스) */
const WHINE_GAIN = 0.02
const WHINE_HPF_HZ = 1500
/** 크랭크 한 바퀴에 몇 번 물리는가 — 휘인 주파수 = rpm × 6 / 60 */
const WHINE_ORDER = 6

/** blip()이 흡기를 들어올리는 높이와 길이 */
const BLIP_GAIN = 0.35
const BLIP_HOLD_S = 0.04
const BLIP_RELEASE_S = 0.06

/** 아이들 근처에서만 흔들리는 폭과 속도 */
const WOBBLE = 0.04
const WOBBLE_HZ = 7
/** 아이들의 이 배율까지만 흔든다 */
const WOBBLE_TOP = 1.15

const DELAY_TAPS: Array<{ timeMs: number; gain: number }> = [
  { timeMs: 11, gain: 0.22 },
  { timeMs: 23, gain: 0.12 },
]

const clamp01 = (t: number) => (Number.isFinite(t) ? (t < 0 ? 0 : t > 1 ? 1 : t) : 0)

/** 배기 공명 — 스로틀을 열수록 공명점이 15% 올라가고 Q가 서며 머플러가 열린다 */
export function resonanceFor(throttle: number): { freqs: [number, number, number]; q: number; lowpassHz: number } {
  const t = clamp01(throttle)
  // f * (1 + 0.15t)가 아니라 f + f*0.15t로 쓴다 — 전자는 190에서 218.4999…가 되어 반올림이 한 칸 내려간다
  const lift = (f: number) => f + f * 0.15 * t
  return { freqs: [lift(95), lift(190), lift(285)], q: 6 + 4 * t, lowpassHz: 1200 + 1400 * t }
}

/** 점화 하나의 엔벨로프 — rpm이 오를수록 짧고(20ms→8ms), 부하가 걸리면 세다 */
export function pulseFor(rpm: number, load: number): { decayS: number; gain: number } {
  const t = clamp01((rpm - IDLE_RPM) / (MAX_RPM - IDLE_RPM))
  return { decayS: 0.02 - 0.012 * t, gain: PULSE_GAIN * (1 + 0.3 * clamp01(load)) }
}

/** [from, to) 구간의 점화 시각(초). 720° 주기 P = 120/rpm, 각 주기에 0과 P/4 */
export function firingTimes(rpm: number, from: number, to: number): number[] {
  const out: number[] = []
  if (!(rpm > 0) || !(to > from)) return out
  const P = 120 / rpm
  for (let k = Math.floor(from / P); k * P < to; k++) {
    for (const f of [0, 0.25]) {
      const t = (k + f) * P
      if (t >= from && t < to) out.push(t)
    }
  }
  return out
}

let ctx: AudioContext | null = null
let master: GainNode | null = null
/** 점화 임펄스가 들어가는 입구 — 여기서 공명 뱅크로 갈라진다 */
let exhaustIn: GainNode | null = null
let bands: BiquadFilterNode[] = []
let mufflerLPF: BiquadFilterNode | null = null
let intakeBPF: BiquadFilterNode | null = null
let intakeGain: GainNode | null = null
let whine: OscillatorNode | null = null
let noiseBuffer: AudioBuffer | null = null
let timer: ReturnType<typeof setInterval> | null = null
/** 여기까지 예약이 끝났다 (AudioContext 시계) */
let cursor = 0
/** 스로틀 0~1 */
let level = 0
/** 바깥에서 받은 회전수. 0 이하면 아무것도 예약하지 않는다 */
let rpmLevel = 0
/** 물린 기어가 거는 부하 0~1 */
let loadLevel = 0
/** blip() 제스처가 끝나는 시각 — 그때까지 tick()은 흡기 게인을 건드리지 않는다 */
let blipUntil = 0
/** stop() 페이드가 끝난 뒤 ctx.suspend()를 걸어 둔 타이머 */
let suspendTimer: ReturnType<typeof setTimeout> | null = null

/** 탭이 백그라운드로 가면 재생을 멈추고, 돌아오면 밀린 예약을 버리고 현재 시각부터 다시 스케줄한다 */
function handleVisibilityChange() {
  if (!ctx) return
  if (document.hidden) {
    if (timer !== null) void ctx.suspend()
  } else if (ctx.state === 'suspended') {
    void ctx.resume().then(() => {
      if (ctx) cursor = ctx.currentTime
    })
  }
}

function makeNoise(ac: AudioContext, seconds: number): AudioBuffer {
  const len = Math.ceil(ac.sampleRate * seconds)
  const buf = ac.createBuffer(1, len, ac.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
  return buf
}

function ensureContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AC) return null
  if (!ctx) {
    ctx = new AC()
    master = ctx.createGain()
    master.gain.value = MASTER_GAIN

    const compressor = ctx.createDynamicsCompressor()
    compressor.connect(ctx.destination)

    const dry = ctx.createGain()
    dry.gain.value = 1
    master.connect(dry)
    dry.connect(compressor)
    for (const tap of DELAY_TAPS) {
      const delay = ctx.createDelay(0.1)
      delay.delayTime.value = tap.timeMs / 1000
      const g = ctx.createGain()
      g.gain.value = tap.gain
      master.connect(delay)
      delay.connect(g)
      g.connect(compressor)
    }

    // 배기: 임펄스 → 공명 뱅크(밴드패스 ×3) → 머플러 저역통과 → 마스터
    const tone = resonanceFor(0)
    mufflerLPF = ctx.createBiquadFilter()
    mufflerLPF.type = 'lowpass'
    mufflerLPF.frequency.value = tone.lowpassHz
    mufflerLPF.connect(master)
    exhaustIn = ctx.createGain()
    exhaustIn.gain.value = 1
    bands = tone.freqs.map((f) => {
      const bp = ctx!.createBiquadFilter()
      bp.type = 'bandpass'
      bp.frequency.value = f
      bp.Q.value = tone.q
      const g = ctx!.createGain()
      g.gain.value = BAND_GAIN
      exhaustIn!.connect(bp)
      bp.connect(g)
      g.connect(mufflerLPF!)
      return bp
    })

    // 흡기: 루프 노이즈 → 밴드패스 → 스로틀에 비례하는 게인
    intakeBPF = ctx.createBiquadFilter()
    intakeBPF.type = 'bandpass'
    intakeBPF.frequency.value = 400
    intakeBPF.Q.value = 0.8
    intakeGain = ctx.createGain()
    intakeGain.gain.value = 0
    const intake = ctx.createBufferSource()
    intake.buffer = makeNoise(ctx, 2)
    intake.loop = true
    intake.connect(intakeBPF)
    intakeBPF.connect(intakeGain)
    intakeGain.connect(master)
    intake.start()

    // 기계음: 톱니 → 하이패스 → 아주 작은 게인
    whine = ctx.createOscillator()
    whine.type = 'sawtooth'
    whine.frequency.value = 0
    const whineHPF = ctx.createBiquadFilter()
    whineHPF.type = 'highpass'
    whineHPF.frequency.value = WHINE_HPF_HZ
    const whineGain = ctx.createGain()
    whineGain.gain.value = WHINE_GAIN
    whine.connect(whineHPF)
    whineHPF.connect(whineGain)
    whineGain.connect(master)
    whine.start()

    noiseBuffer = makeNoise(ctx, 0.1)

    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', handleVisibilityChange)
  }
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

/** 아이들 근처에서만 ±4%로 흔든다. 회전을 올리면 흔들림이 사라진다 */
function wobbled(rpm: number, now: number): number {
  if (!(rpm > 0)) return 0
  const near = clamp01((IDLE_RPM * WOBBLE_TOP - rpm) / (IDLE_RPM * (WOBBLE_TOP - 1)))
  return rpm * (1 + WOBBLE * near * Math.sin(now * WOBBLE_HZ))
}

/** 점화 하나를 at 시각에 예약한다 */
function scheduleFiring(at: number, throttle: number, rpm: number, load: number) {
  const ac = ctx
  if (!ac || !exhaustIn || !noiseBuffer) return
  const { decayS, gain } = pulseFor(rpm, load)
  const amp = gain * (1 - AMP_JITTER / 2 + Math.random() * AMP_JITTER)

  const env = ac.createGain()
  const hold = at + PULSE_HOLD_S
  const end = hold + decayS
  env.gain.setValueAtTime(0.0001, at)
  env.gain.linearRampToValueAtTime(amp, at + 0.0002)
  env.gain.setValueAtTime(amp, hold)
  env.gain.exponentialRampToValueAtTime(0.0005, end)
  env.connect(exhaustIn)

  const osc = ac.createOscillator()
  osc.type = 'sine'
  osc.frequency.value = 60 + clamp01(throttle) * 50
  osc.connect(env)
  osc.start(at)
  osc.stop(end + 0.01)

  const src = ac.createBufferSource()
  src.buffer = noiseBuffer
  const nGain = ac.createGain()
  nGain.gain.value = PULSE_NOISE_MIX
  src.connect(nGain)
  nGain.connect(env)
  src.start(at)
  src.stop(end + 0.01)
}

/** 상시 소리(공명·흡기·기계음)를 지금 값으로 끌고 간다 */
function updateTone(now: number) {
  const { freqs, q, lowpassHz } = resonanceFor(level)
  bands.forEach((bp, i) => {
    bp.frequency.setTargetAtTime(freqs[i], now, TONE_TAU)
    bp.Q.setTargetAtTime(q, now, TONE_TAU)
  })
  mufflerLPF?.frequency.setTargetAtTime(lowpassHz, now, TONE_TAU)
  intakeBPF?.frequency.setTargetAtTime(400 + 500 * clamp01(rpmLevel / MAX_RPM), now, TONE_TAU)
  whine?.frequency.setTargetAtTime((rpmLevel * WHINE_ORDER) / 60, now, TONE_TAU)
  if (now >= blipUntil) intakeGain?.gain.setTargetAtTime(level * level * INTAKE_GAIN, now, TONE_TAU)
}

function tick() {
  const ac = ctx
  if (!ac || !master) return
  const now = ac.currentTime
  updateTone(now)
  if (cursor < now) cursor = now
  const horizon = now + LOOKAHEAD_S
  if (horizon <= cursor) return
  const rpm = wobbled(rpmLevel, now)
  if (rpm > 0) {
    const jitterS = (120 / rpm) * JITTER_FRAC
    for (const at of firingTimes(rpm, cursor, horizon)) {
      scheduleFiring(Math.max(at + (Math.random() - 0.5) * jitterS, now), level, rpm, loadLevel)
    }
  }
  cursor = horizon
}

/** 시동. 두 번 불러도 예약이 겹치지 않는다. */
export function start(): void {
  const ac = ensureContext()
  if (!ac || !master) return
  if (suspendTimer !== null) {
    clearTimeout(suspendTimer)
    suspendTimer = null
  }
  if (ac.state === 'suspended') void ac.resume()
  master.gain.cancelScheduledValues(ac.currentTime)
  master.gain.setValueAtTime(MASTER_GAIN, ac.currentTime)
  if (timer !== null) return
  level = 0
  loadLevel = 0
  // 바깥에서 setRpm이 오기 전까지는 아이들로 돈다
  rpmLevel = IDLE_RPM
  blipUntil = 0
  cursor = ac.currentTime
  tick()
  timer = setInterval(tick, TICK_MS)
}

/** 회전수. 0 이하(시동 꺼짐·스톨)면 점화를 예약하지 않는다 */
export function setRpm(rpm: number): void {
  rpmLevel = Number.isFinite(rpm) && rpm > 0 ? rpm : 0
}

/** 스로틀 0~1. 다음 예약 구간부터 반영된다 (위상 연속은 보장하지 않는다) */
export function setThrottle(t: number): void {
  level = clamp01(t)
}

/** 물린 기어가 엔진에 거는 부하 0~1. 점화가 세진다 */
export function setLoad(l: number): void {
  loadLevel = clamp01(l)
}

/** 변속 순간의 흡기 "쉭" — 흡기 게인을 40ms 들어올렸다 내린다 */
export function blip(): void {
  const ac = ctx
  if (!ac || !intakeGain) return
  const now = ac.currentTime
  const top = now + BLIP_HOLD_S
  blipUntil = top + BLIP_RELEASE_S
  intakeGain.gain.cancelScheduledValues(now)
  intakeGain.gain.setValueAtTime(intakeGain.gain.value, now)
  intakeGain.gain.linearRampToValueAtTime(BLIP_GAIN, now + 0.008)
  intakeGain.gain.setValueAtTime(BLIP_GAIN, top)
  intakeGain.gain.linearRampToValueAtTime(level * level * INTAKE_GAIN, blipUntil)
}

/** 정지. 예약을 끊고 마스터를 0.15초에 걸쳐 내린다. 스로틀·회전수도 되돌린다. */
export function stop(): void {
  level = 0
  rpmLevel = 0
  loadLevel = 0
  if (timer !== null) {
    clearInterval(timer)
    timer = null
  }
  const ac = ctx
  if (!ac || !master) return
  const now = ac.currentTime
  blipUntil = 0
  intakeGain?.gain.cancelScheduledValues(now)
  intakeGain?.gain.setTargetAtTime(0, now, TONE_TAU)
  master.gain.cancelScheduledValues(now)
  master.gain.setValueAtTime(master.gain.value, now)
  master.gain.linearRampToValueAtTime(0.0001, now + STOP_FADE_S)
  if (suspendTimer !== null) clearTimeout(suspendTimer)
  suspendTimer = setTimeout(() => {
    suspendTimer = null
    void ac.suspend()
  }, (STOP_FADE_S + 0.05) * 1000)
}
