// 엔진 사운드 v3 — 합성을 버리고 실녹음 루프(public/audio/ninja400/engine/)를 크로스페이드한다.
// 뱅크는 rpm 사다리(1330~6460)로 잘라 둔 이음매 없는 모노 루프 + 시동·정지 원샷이다.
// 그래프:
//   루프 슬롯 A ─ gainA ┐
//   루프 슬롯 B ─ gainB ┴→ loopBus ─→ tone(lowpass) ─→ toneGain ─→ master ─→ compressor ─→ destination
//   start.ogg / stop.ogg 원샷 ───────────────────────────────────→ master ┘
// 매 tick(25 ms)마다 rpm을 감싸는 루프 두 개를 bankMix로 고르고, 각 소스의 playbackRate를
// rpm/루프rpm으로 끌고 가면서 등파워(cos/sin)로 섞는다. 최고 루프 위(6460~12000)는 그대로
// 피치업(최대 1.86배)하고, 비율에 상한을 두지 않는다.
// rpm은 바깥(주행 모델)에서 setRpm으로 들어온다.

import { IDLE_RPM } from '../finale/rideModel'
import { bankMix, type Loop } from './bankMix'
import { planSlots, type SlotHeld } from './slotPlan'

/** 뱅크가 놓인 곳 (Vite가 public/ 그대로 복사한다) */
const BANK_DIR = '/audio/ninja400/engine/'
/** 슬롯 갱신 주기 (ms) */
const TICK_MS = 25
/** 최종 출력 배율 — 루프는 −18 dBFS RMS로 정규화돼 있다 */
const MASTER_GAIN = 0.8
/** stop()의 루프 페이드아웃 (초) */
const STOP_FADE_S = 0.15
/** start.ogg가 점화에 닿는 시점(초)과 루프 페이드인 길이(초) */
const START_DELAY_S = 0.8
const START_FADE_S = 0.3
/** 정지 페이드가 남아 있을 때 시동을 걸면 버스를 0으로 끌어내리는 시간 (초) — 0으로 점프하면 딸깍한다 */
const BUS_DROP_S = 0.02
/** stop() 뒤 컨텍스트를 재우기 전 여유 (초) */
const SUSPEND_PAD_S = 0.05
/** 슬롯을 갈아 끼울 때 옛 소스를 지우는 시간 (초) */
const SLOT_FADE_S = 0.03
/** playbackRate·슬롯 게인 시정수(초)와 톤(lowpass·게인) 시정수(초) */
const RATE_TAU = 0.02
const TONE_TAU = 0.05
/** 머플러 저역통과 (Hz): 스로틀 0 → 1400, 1 → 6000 */
const TONE_HZ_BASE = 1400
const TONE_HZ_SPAN = 4600
/** 톤 게인 (dB): 스로틀 0 → −5, 1 → 0, 부하 1이면 +3 */
const TONE_DB_BASE = -5
const TONE_DB_THROTTLE = 5
const TONE_DB_LOAD = 3
/** blip(): 톤 게인 +4 dB, 8 ms 상승 · 40 ms 유지 · 60 ms 하강 */
const BLIP_DB = 4
const BLIP_ATTACK_S = 0.008
const BLIP_HOLD_S = 0.04
const BLIP_RELEASE_S = 0.06

const clamp01 = (t: number) => (Number.isFinite(t) ? (t < 0 ? 0 : t > 1 ? 1 : t) : 0)
const dbToGain = (db: number) => Math.pow(10, db / 20)

/** 회전수 정리 — 유한하지 않거나 0 이하(시동 꺼짐·스톨)면 0, 그때는 루프를 아예 내린다 */
export function safeRpm(rpm: number): number {
  return Number.isFinite(rpm) && rpm > 0 ? rpm : 0
}

/** 스로틀·부하가 정하는 머플러 저역통과와 톤 게인(선형) */
export function toneFor(throttle: number, load: number): { lowpassHz: number; gain: number } {
  const th = clamp01(throttle)
  return {
    lowpassHz: TONE_HZ_BASE + TONE_HZ_SPAN * th,
    gain: dbToGain(TONE_DB_BASE + TONE_DB_THROTTLE * th + TONE_DB_LOAD * clamp01(load)),
  }
}

/**
 * stop()이 실제로 할 일. 돌고 있지 않으면 전부 아니오 — 두 번째 stop()은 소리도 예약도 남기지 않는다.
 * (스톨 때 RideControls가 한 번, running에서 빠져나갈 때 Finale이 또 한 번 부른다)
 */
export function stopPlan(running: boolean, stopSoundS: number): { fade: boolean; oneShot: boolean; suspendAfterS: number } {
  if (!running) return { fade: false, oneShot: false, suspendAfterS: 0 }
  // stop.ogg가 끝나기 전에 재우면 잘린다 — 페이드와 원샷 중 긴 쪽을 기다린다
  return { fade: true, oneShot: true, suspendAfterS: Math.max(STOP_FADE_S + SLOT_FADE_S, stopSoundS) + SUSPEND_PAD_S }
}

/** 등파워 크로스페이드 — 두 게인의 제곱합이 1이라 합쳐도 소리가 꺼지거나 부풀지 않는다 */
export function loopGains(t: number): { lower: number; upper: number } {
  const k = (clamp01(t) * Math.PI) / 2
  return { lower: Math.cos(k), upper: Math.sin(k) }
}

interface Bank { loops: Loop[]; buffers: AudioBuffer[]; start: AudioBuffer | null; stop: AudioBuffer | null }
interface Slot { index: number; src: AudioBufferSourceNode; gain: GainNode }

let ctx: AudioContext | null = null
let master: GainNode | null = null
/** 루프만 지나가는 버스 — start/stop 페이드가 여기에 걸린다 (원샷은 영향받지 않는다) */
let loopBus: GainNode | null = null
let toneLPF: BiquadFilterNode | null = null
let toneGain: GainNode | null = null
/** [0] = lower 루프, [1] = upper 루프. 둘이 같은 인덱스면 [1]은 비운다 */
const slots: Array<Slot | null> = [null, null]

let bank: Bank | null = null
let bankPromise: Promise<void> | null = null
const warned = { load: false, cold: false }
let timer: ReturnType<typeof setInterval> | null = null
let suspendTimer: ReturnType<typeof setTimeout> | null = null
/** 스로틀 0~1 */
let level = 0
/** 바깥에서 받은 회전수. 0이면 루프를 내린다 */
let rpmLevel = 0
/** 물린 기어가 거는 부하 0~1 */
let loadLevel = 0
/** blip() 제스처가 끝나는 시각 — 그때까지 tick()은 톤 게인을 건드리지 않는다 */
let blipUntil = 0

function warnOnce(key: 'load' | 'cold', message: string, err?: unknown) {
  if (warned[key]) return
  warned[key] = true
  console.warn(`[engineSound] ${message}`, err ?? '')
}

/** 탭이 백그라운드로 가면 멈추고, 돌아오면 깨운다. stop()이 재운 컨텍스트는 깨우지 않는다 */
function handleVisibilityChange() {
  if (!ctx) return
  if (document.hidden) {
    if (timer !== null) void ctx.suspend()
  } else if (timer !== null && ctx.state === 'suspended') {
    void ctx.resume()
  }
}

/** 컨텍스트와 그래프를 만들기만 한다 — resume은 하지 않는다 (사용자 제스처 전에는 금지) */
function audioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AC) return null
  if (ctx) return ctx
  ctx = new AC()
  const compressor = ctx.createDynamicsCompressor()
  compressor.connect(ctx.destination)
  master = ctx.createGain()
  master.gain.value = MASTER_GAIN
  master.connect(compressor)

  const tone = toneFor(0, 0)
  toneGain = ctx.createGain()
  toneGain.gain.value = tone.gain
  toneGain.connect(master)
  toneLPF = ctx.createBiquadFilter()
  toneLPF.type = 'lowpass'
  toneLPF.frequency.value = tone.lowpassHz
  toneLPF.connect(toneGain)
  loopBus = ctx.createGain()
  loopBus.gain.value = 0
  loopBus.connect(toneLPF)

  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', handleVisibilityChange)
  return ctx
}

/** 사용자 제스처 뒤에 부른다 — 만들고 깨운다 */
function ensureContext(): AudioContext | null {
  const ac = audioContext()
  if (ac && ac.state === 'suspended') void ac.resume()
  return ac
}

async function fetchBuffer(ac: AudioContext, url: string): Promise<AudioBuffer> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url} → ${res.status}`)
  return await ac.decodeAudioData(await res.arrayBuffer())
}

/** bank.json과 모든 ogg를 받아 디코드한다. 한 번만 돌고, 실패하면 경고 한 줄 남기고 조용히 끝낸다 */
export function preload(): Promise<void> {
  if (bankPromise) return bankPromise
  bankPromise = (async () => {
    const ac = audioContext()
    if (!ac) return
    try {
      const res = await fetch(`${BANK_DIR}bank.json`)
      if (!res.ok) throw new Error(`bank.json → ${res.status}`)
      const json = (await res.json()) as { loops: Loop[]; start: string; stop: string }
      const files = [...json.loops.map((l) => l.file), json.start, json.stop]
      const bufs = await Promise.all(files.map((f) => fetchBuffer(ac, BANK_DIR + f)))
      const n = json.loops.length
      bank = { loops: json.loops, buffers: bufs.slice(0, n), start: bufs[n] ?? null, stop: bufs[n + 1] ?? null }
    } catch (err) {
      warnOnce('load', '뱅크를 불러오지 못했다 — 엔진음 없이 진행한다', err)
    }
  })()
  return bankPromise
}

/** 진행 중인 loopBus 자동화를 지금 값에서 끊는다. cancelAndHoldAtTime이 없는 브라우저는 손으로 붙잡는다 */
function holdLoopBus(now: number) {
  const g = loopBus?.gain
  if (!g) return
  const hold = (g as AudioParam & { cancelAndHoldAtTime?: (t: number) => AudioParam }).cancelAndHoldAtTime
  if (typeof hold === 'function') hold.call(g, now)
  else {
    g.cancelScheduledValues(now)
    g.setValueAtTime(g.value, now)
  }
}

/** 원샷(시동·정지)은 톤을 거치지 않고 master로 바로 간다 */
function playOneShot(buf: AudioBuffer | null | undefined) {
  const ac = ctx
  if (!ac || !master || !buf) return
  const src = ac.createBufferSource()
  src.buffer = buf
  src.connect(master)
  src.onended = () => src.disconnect()
  src.start()
}

/**
 * 옛 소스를 30 ms에 걸쳐 지우고 끊는다.
 * 붙잡는 값 `g.value`는 호출 시점(ctx.currentTime)의 값이다 — tick에서는 now가 바로 지금이라 정확하고,
 * stop()이 now+STOP_FADE_S로 미뤄 부를 때는 살짝 낡은 값이지만 그때는 loopBus가 이미 0에 가깝다.
 */
function retire(slot: Slot, now: number) {
  const g = slot.gain.gain
  g.cancelScheduledValues(now)
  g.setValueAtTime(g.value, now)
  g.linearRampToValueAtTime(0.0001, now + SLOT_FADE_S)
  slot.src.onended = () => {
    slot.src.disconnect()
    slot.gain.disconnect()
  }
  try {
    slot.src.stop(now + SLOT_FADE_S + 0.02)
  } catch {
    /* 이미 멈춘 소스 */
  }
}

function releaseSlot(i: number, now: number) {
  const slot = slots[i]
  if (!slot) return
  retire(slot, now)
  slots[i] = null
}

/** 슬롯 i에 index 루프를 임의 오프셋에서 새로 건다 */
function startSlot(i: number, index: number, rate: number, now: number) {
  const ac = ctx
  if (!ac || !loopBus || !bank) return
  const buffer = bank.buffers[index]
  if (!buffer) return
  releaseSlot(i, now)
  const gain = ac.createGain()
  gain.gain.value = 0
  gain.connect(loopBus)
  const src = ac.createBufferSource()
  src.buffer = buffer
  src.loop = true
  src.playbackRate.value = rate
  src.connect(gain)
  // 같은 루프를 두 슬롯이 물어도 위상이 겹치지 않도록 임의 지점에서 시작한다
  src.start(now, Math.random() * buffer.duration)
  slots[i] = { index, src, gain }
}

/** 스로틀·부하가 정하는 톤을 지금 값으로 끌고 간다 */
function updateTone(now: number) {
  const { lowpassHz, gain } = toneFor(level, loadLevel)
  toneLPF?.frequency.setTargetAtTime(lowpassHz, now, TONE_TAU)
  if (now >= blipUntil) toneGain?.gain.setTargetAtTime(gain, now, TONE_TAU)
}

function tick() {
  const ac = ctx
  if (!ac) return
  const now = ac.currentTime
  updateTone(now)
  const loops = bank?.loops
  // 뱅크가 아직 없거나 시동이 꺼졌으면 루프를 모두 내린다. 디코드가 끝나면 다음 tick이 집어 든다
  if (!loops || loops.length === 0 || rpmLevel <= 0) {
    releaseSlot(0, now)
    releaseSlot(1, now)
    return
  }
  const mix = bankMix(rpmLevel, loops)
  const held: SlotHeld = [slots[0]?.index ?? null, slots[1]?.index ?? null]
  const plan = planSlots(held, mix)
  if (plan.swap) {
    const a = slots[0]
    slots[0] = slots[1]
    slots[1] = a
  }
  const g = loopGains(mix.t)
  const target = [g.lower, g.upper]
  for (let i = 0; i < 2; i++) {
    const action = plan.actions[i]
    if (action.kind === 'release') {
      releaseSlot(i, now)
      continue
    }
    const rate = rpmLevel / loops[action.index].rpm
    if (action.kind === 'start') startSlot(i, action.index, rate, now)
    const slot = slots[i]
    if (!slot) continue
    slot.src.playbackRate.setTargetAtTime(rate, now, RATE_TAU)
    slot.gain.gain.setTargetAtTime(target[i], now, RATE_TAU)
  }
}

/** 시동. 두 번 불러도 겹치지 않는다. start.ogg를 울리고 0.8초 뒤부터 루프를 0.3초에 걸쳐 올린다 */
export function start(): void {
  const ac = ensureContext()
  if (!ac || !loopBus) return
  void preload()
  if (suspendTimer !== null) {
    clearTimeout(suspendTimer)
    suspendTimer = null
  }
  if (timer !== null) return
  const now = ac.currentTime
  level = 0
  loadLevel = 0
  // 바깥에서 setRpm이 오기 전까지는 아이들로 돈다
  rpmLevel = IDLE_RPM
  blipUntil = 0
  if (!bank) warnOnce('cold', '뱅크가 아직 준비되지 않았다 — 디코드가 끝나면 소리가 붙는다')
  playOneShot(bank?.start)
  // 정지 페이드가 아직 돌고 있을 수 있다. 현재 값을 붙잡고 20 ms에 걸쳐 0으로 내린 뒤 예약을 건다 —
  // 곧바로 0을 찍으면 딸깍한다. 꺼져 있던 상태면 0 → 0이라 아무 일도 일어나지 않는다.
  holdLoopBus(now)
  loopBus.gain.linearRampToValueAtTime(0, now + BUS_DROP_S)
  loopBus.gain.setValueAtTime(0, now + START_DELAY_S)
  loopBus.gain.linearRampToValueAtTime(1, now + START_DELAY_S + START_FADE_S)
  tick()
  timer = setInterval(tick, TICK_MS)
}

/** 회전수. 0 이하(시동 꺼짐·스톨)면 루프를 내린다 — playbackRate는 0이 될 수 없다 */
export function setRpm(rpm: number): void {
  rpmLevel = safeRpm(rpm)
}

/** 스로틀 0~1. 머플러가 열리고 톤 게인이 오른다 */
export function setThrottle(t: number): void {
  level = clamp01(t)
}

/** 물린 기어가 엔진에 거는 부하 0~1. 최대 +3 dB */
export function setLoad(l: number): void {
  loadLevel = clamp01(l)
}

/** 변속 순간의 "쉭" — 톤 게인을 +4 dB 들었다 놓는다 */
export function blip(): void {
  const ac = ctx
  if (!ac || !toneGain) return
  const now = ac.currentTime
  const base = toneFor(level, loadLevel).gain
  const peak = base * dbToGain(BLIP_DB)
  const top = now + BLIP_ATTACK_S + BLIP_HOLD_S
  blipUntil = top + BLIP_RELEASE_S
  toneGain.gain.cancelScheduledValues(now)
  toneGain.gain.setValueAtTime(toneGain.gain.value, now)
  toneGain.gain.linearRampToValueAtTime(peak, now + BLIP_ATTACK_S)
  toneGain.gain.setValueAtTime(peak, top)
  toneGain.gain.linearRampToValueAtTime(base, blipUntil)
}

/**
 * 정지. 루프를 0.15초에 걸쳐 내리고 stop.ogg를 울린 뒤 컨텍스트를 재운다.
 * 돌고 있을 때만 그렇게 한다 — 두 번째 stop()은 조용한 no-op이다(stopPlan 참조).
 */
export function stop(): void {
  level = 0
  rpmLevel = 0
  loadLevel = 0
  const plan = stopPlan(timer !== null, bank?.stop?.duration ?? 0)
  if (timer !== null) {
    clearInterval(timer)
    timer = null
  }
  const ac = ctx
  if (!ac || !loopBus || !plan.fade) return
  const now = ac.currentTime
  blipUntil = 0
  holdLoopBus(now)
  loopBus.gain.linearRampToValueAtTime(0.0001, now + STOP_FADE_S)
  releaseSlot(0, now + STOP_FADE_S)
  releaseSlot(1, now + STOP_FADE_S)
  if (plan.oneShot) playOneShot(bank?.stop)
  if (suspendTimer !== null) clearTimeout(suspendTimer)
  suspendTimer = setTimeout(() => {
    suspendTimer = null
    void ac.suspend()
  }, plan.suspendAfterS * 1000)
}
