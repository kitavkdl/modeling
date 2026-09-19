// 엔진 사운드 — 오디오 파일 없이 Web Audio API로 합성한다.
// 4행정 병렬 2기통(180° 크랭크)은 720° 한 주기에 0°와 180°에서 점화한다.
// 그래서 주기 P = 120/rpm 초 안에 점화가 두 번, [0, P/4] 위치에 불균등하게 놓인다.
// 점화 하나 = 사인 저역 펄스 + 노이즈 버스트. 하우징 울림은 키보드 switchSound와 같은 2탭 딜레이.

export const IDLE_RPM = 1300
export const MAX_RPM = 10000

/** 예약을 미리 걸어 두는 구간 */
const LOOKAHEAD_S = 0.1
/** 예약 타이머 주기 */
const TICK_MS = 25

const MASTER_GAIN = 0.45
/** stop()의 페이드아웃 시간 */
const STOP_FADE_S = 0.15

const PULSE_HOLD_S = 0.008
const PULSE_DECAY_S = 0.04
const PULSE_GAIN = 0.5
const NOISE_BURST_S = 0.012
const NOISE_GAIN = 0.28

const DELAY_TAPS: Array<{ timeMs: number; gain: number }> = [
  { timeMs: 11, gain: 0.22 },
  { timeMs: 23, gain: 0.12 },
]

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t)

/** 스로틀 0~1 → 회전수 */
export const rpmFor = (t: number) => IDLE_RPM + clamp01(t) * (MAX_RPM - IDLE_RPM)

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
let noiseBuffer: AudioBuffer | null = null
let timer: ReturnType<typeof setInterval> | null = null
/** 여기까지 예약이 끝났다 (AudioContext 시계) */
let cursor = 0
let level = 0

function ensureContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AC) return null
  if (!ctx) {
    ctx = new AC()
    master = ctx.createGain()
    master.gain.value = MASTER_GAIN

    const dry = ctx.createGain()
    dry.gain.value = 1
    master.connect(dry)
    dry.connect(ctx.destination)
    for (const tap of DELAY_TAPS) {
      const delay = ctx.createDelay(0.1)
      delay.delayTime.value = tap.timeMs / 1000
      const g = ctx.createGain()
      g.gain.value = tap.gain
      master.connect(delay)
      delay.connect(g)
      g.connect(ctx.destination)
    }

    const len = Math.ceil(ctx.sampleRate * 0.1)
    noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate)
    const data = noiseBuffer.getChannelData(0)
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
  }
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

/** 점화 하나를 at 시각에 예약한다. t는 스로틀 0~1 */
function scheduleFiring(at: number, t: number) {
  const ac = ctx
  if (!ac || !master || !noiseBuffer) return

  const osc = ac.createOscillator()
  osc.type = 'sine'
  osc.frequency.value = 60 + t * 50
  const env = ac.createGain()
  const hold = at + PULSE_HOLD_S
  const end = hold + PULSE_DECAY_S
  env.gain.setValueAtTime(0.0001, at)
  env.gain.linearRampToValueAtTime(PULSE_GAIN, at + 0.001)
  env.gain.setValueAtTime(PULSE_GAIN, hold)
  env.gain.exponentialRampToValueAtTime(0.0005, end)
  osc.connect(env)
  env.connect(master)
  osc.start(at)
  osc.stop(end + 0.01)

  const src = ac.createBufferSource()
  src.buffer = noiseBuffer
  const lp = ac.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 1200 + t * 2500
  const nEnv = ac.createGain()
  const nEnd = at + NOISE_BURST_S
  nEnv.gain.setValueAtTime(0.0001, at)
  nEnv.gain.linearRampToValueAtTime(NOISE_GAIN, at + 0.0008)
  nEnv.gain.exponentialRampToValueAtTime(0.0005, nEnd)
  src.connect(lp)
  lp.connect(nEnv)
  nEnv.connect(master)
  src.start(at)
  src.stop(nEnd + 0.01)
}

function tick() {
  const ac = ctx
  if (!ac || !master) return
  const now = ac.currentTime
  if (cursor < now) cursor = now
  const horizon = now + LOOKAHEAD_S
  if (horizon <= cursor) return
  for (const at of firingTimes(rpmFor(level), cursor, horizon)) scheduleFiring(at, level)
  cursor = horizon
}

/** 시동. 두 번 불러도 예약이 겹치지 않는다. */
export function start(): void {
  const ac = ensureContext()
  if (!ac || !master) return
  master.gain.cancelScheduledValues(ac.currentTime)
  master.gain.setValueAtTime(MASTER_GAIN, ac.currentTime)
  if (timer !== null) return
  cursor = ac.currentTime
  tick()
  timer = setInterval(tick, TICK_MS)
}

/** 스로틀 0~1. 다음 예약 구간부터 반영된다 (위상 연속은 보장하지 않는다) */
export function setThrottle(t: number): void {
  level = clamp01(t)
}

/** 정지. 예약을 끊고 마스터를 0.15초에 걸쳐 내린다. */
export function stop(): void {
  if (timer !== null) {
    clearInterval(timer)
    timer = null
  }
  const ac = ctx
  if (!ac || !master) return
  const now = ac.currentTime
  master.gain.cancelScheduledValues(now)
  master.gain.setValueAtTime(master.gain.value, now)
  master.gain.linearRampToValueAtTime(0.0001, now + STOP_FADE_S)
}
