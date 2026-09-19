// 스위치 타건음 — 플레이스홀더.
// 나중에 실제 녹음 샘플로 교체한다. 외부에 노출하는 인터페이스는 playKeyPress 하나뿐이다.
// 오디오 파일은 포함하지 않고 Web Audio API로 합성한다.

import { isStabilizedKey } from '../parts'

const DOWN_BURST_MS = 5
const DOWN_DECAY_MS = 40
const UP_BURST_MS = 3
const UP_DECAY_MS = 25
const UP_DELAY_MS = 90
const UP_GAIN = 0.45

const BANDPASS_CENTER_HZ = 2500
const BANDPASS_Q = 4
const KEY_DETUNE_RANGE = 0.08 // ±8%

const STAB_FREQ_SCALE = 0.7
const STAB_DECAY_SCALE = 2

const DELAY_TAPS: Array<{ timeMs: number; gain: number }> = [
  { timeMs: 11, gain: 0.22 },
  { timeMs: 23, gain: 0.12 },
]

let ctx: AudioContext | null = null
let master: GainNode | null = null
let noiseBuffer: AudioBuffer | null = null
const keyDetune = new Map<string, number>()

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) / 4294967295
}

function detuneFor(keyId: string): number {
  let d = keyDetune.get(keyId)
  if (d === undefined) {
    d = 1 + (hash(keyId) * 2 - 1) * KEY_DETUNE_RANGE
    keyDetune.set(keyId, d)
  }
  return d
}

function ensureContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AC) return null
  if (!ctx) {
    ctx = new AC()
    master = ctx.createGain()
    master.gain.value = 0.8

    // 알루미늄 하우징 느낌: 짧은 2탭 딜레이를 드라이에 섞는다
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

interface Click {
  at: number
  burstMs: number
  decayMs: number
  centerHz: number
  gain: number
}

function scheduleClick(c: Click) {
  if (!ctx || !master || !noiseBuffer) return
  const src = ctx.createBufferSource()
  src.buffer = noiseBuffer

  const bp = ctx.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = c.centerHz
  bp.Q.value = BANDPASS_Q

  const env = ctx.createGain()
  const t0 = c.at
  const burstEnd = t0 + c.burstMs / 1000
  const end = burstEnd + c.decayMs / 1000
  env.gain.setValueAtTime(0, t0)
  env.gain.linearRampToValueAtTime(c.gain, t0 + 0.0008)
  env.gain.setValueAtTime(c.gain, burstEnd)
  env.gain.exponentialRampToValueAtTime(0.0005, end)

  src.connect(bp)
  bp.connect(env)
  env.connect(master)
  src.start(t0)
  src.stop(end + 0.01)
}

/**
 * 키 하나를 누른 소리를 낸다 (다운스트로크 + 업스트로크).
 * @param keyId  parts.ts의 키 id. 키마다 음색이 조금씩 다르다.
 * @param velocity 0~1. 음량과 밝기에 반영.
 */
export function playKeyPress(keyId: string, velocity = 0.8): void {
  const ac = ensureContext()
  if (!ac) return
  const v = Math.min(1, Math.max(0.05, velocity))
  const stab = isStabilizedKey(keyId)
  const center = BANDPASS_CENTER_HZ * detuneFor(keyId) * (stab ? STAB_FREQ_SCALE : 1) * (0.94 + v * 0.1)
  const decayScale = stab ? STAB_DECAY_SCALE : 1
  const now = ac.currentTime + 0.005

  scheduleClick({
    at: now,
    burstMs: DOWN_BURST_MS,
    decayMs: DOWN_DECAY_MS * decayScale,
    centerHz: center,
    gain: 0.35 + v * 0.55,
  })
  scheduleClick({
    at: now + UP_DELAY_MS / 1000,
    burstMs: UP_BURST_MS,
    decayMs: UP_DECAY_MS * decayScale,
    centerHz: center * 1.12,
    gain: (0.35 + v * 0.55) * UP_GAIN,
  })
}
