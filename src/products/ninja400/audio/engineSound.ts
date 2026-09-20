// 엔진 사운드 v4 — 실녹음 루프(public/audio/ninja400/engine/)를 한 번에 하나만 재생한다.
// 뱅크는 rpm 사다리(1325~6495)로 잘라 둔 이음매 없는 모노 루프 + 시동·정지 원샷이고,
// 각 칸의 rpm은 반올림하지 않은 실측값이다(bank.json, 소수 첫째 자리).
// 그래프:
//   루프(활성) ─ gain ┐
//   루프(교체 중) ─ gain ┴→ loopBus ─→ antiAlias(9k) ─→ tone(lowpass) ─→ toneGain ─→ master ─→ compressor ─→ destination
//   start.ogg / stop.ogg 원샷 ──────────────────────────────────────────────────────→ master ┘
// 매 tick(25 ms)마다 pickLoop로 칸 하나를 고르고, 그 소스의 playbackRate를 rpm/루프rpm으로
// 끌고 간다. 칸이 바뀔 때만 새 소스를 걸고 0.25초 등파워 교차 페이드한 뒤 옛 소스를 끊는다.
// v3는 이웃 두 칸을 늘 겹쳐 울렸는데, 뱅크 rpm이 10 단위로 반올림돼 있어 두 소스의 기본파가
// 1%쯤 어긋났고 그게 초당 1회 부푸는 맥놀이("왕(쉬고)왕")가 됐다. 이제 겹치는 250 ms 동안에도
// 두 소스가 같은 목표 rpm으로 울리고, 뱅크 rpm이 정밀하니 그 사이 맥놀이는 무시할 수준이다.
// 최고 루프 위(6495~12000)는 그대로 피치업(최대 1.85배)하고, 비율에 상한을 두지 않는다.
// rpm은 바깥(주행 모델)에서 setRpm으로 들어온다.

import { IDLE_RPM } from '../finale/rideModel'
import { pickLoop, type Loop } from './pickLoop'

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
/** 소스를 급히 거둘 때 지우는 시간 (초) — 정지·중복 교체 때만 쓴다 */
const SLOT_FADE_S = 0.03
/** 칸을 갈아탈 때 등파워 교차 페이드 (초). 이 동안만 두 소스가 겹친다 */
const SWITCH_FADE_S = 0.25
/** 교차 페이드 곡선을 그릴 점 개수 */
const FADE_POINTS = 33
/** 루프 버스 앤티에일리어싱 저역통과 (Hz, 2극). 뱅크 위로 1.6~1.9배 피치업할 때 생기는
 *  리샘플링 에일리어싱이 고역에서 거칠게 들리는 것을 부드럽게 덮는다 */
const LOOP_LPF_HZ = 9000
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

/**
 * 남은 교차 페이드 길이 (초). 페이드 도중에 또 칸이 바뀌면 나가던 소스는 이미 절반쯤 내려와
 * 있으므로, 남은 만큼만 쓰고 끝낸다 (0에서 시작하는 커브는 길이 0이 되므로 최소값을 둔다).
 */
export function fadeSeconds(from: number): number {
  return Math.max(SLOT_FADE_S, SWITCH_FADE_S * (1 - Math.acos(clamp01(from)) / (Math.PI / 2)))
}

/**
 * 등파워 교차 페이드 곡선. 나가는 쪽의 지금 게인 from에서 이어 그리므로, 페이드 도중에
 * 끼어들어도 두 게인의 제곱합은 늘 1이다 — 겹치는 동안 소리가 꺼지거나 부풀지 않는다.
 * rising=true면 √(1−from²) → 1 (들어오는 쪽), false면 from → 0 (나가는 쪽).
 */
export function fadeCurve(from: number, rising: boolean, points: number = FADE_POINTS): Float32Array {
  const a0 = Math.acos(clamp01(from))
  const curve = new Float32Array(points)
  for (let i = 0; i < points; i++) {
    const a = a0 + ((Math.PI / 2 - a0) * i) / (points - 1)
    curve[i] = rising ? Math.sin(a) : Math.cos(a)
  }
  return curve
}

interface Bank { loops: Loop[]; buffers: AudioBuffer[]; start: AudioBuffer | null; stop: AudioBuffer | null }
interface Slot { index: number; src: AudioBufferSourceNode; gain: GainNode }

let ctx: AudioContext | null = null
let master: GainNode | null = null
/** 루프만 지나가는 버스 — start/stop 페이드가 여기에 걸린다 (원샷은 영향받지 않는다) */
let loopBus: GainNode | null = null
let loopLPF: BiquadFilterNode | null = null
let toneLPF: BiquadFilterNode | null = null
let toneGain: GainNode | null = null
/** 지금 울리는 칸 하나. outgoing은 교차 페이드로 물러나는 중인 옛 칸(없으면 null) */
let active: Slot | null = null
let outgoing: Slot | null = null

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
  // 뱅크 최고 칸 위에서는 playbackRate가 1.9배까지 올라간다. 44.1 kHz 소스를 그만큼 끌어올리면
  // 고역에 리샘플링 찌꺼기가 끼는데, 9 kHz 2극 저역통과로 살짝 덮는다 (톤 필터와 별개로 늘 걸린다).
  loopLPF = ctx.createBiquadFilter()
  loopLPF.type = 'lowpass'
  loopLPF.frequency.value = LOOP_LPF_HZ
  loopLPF.connect(toneLPF)
  loopBus = ctx.createGain()
  loopBus.gain.value = 0
  loopBus.connect(loopLPF)

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
  try {
    g.cancelScheduledValues(now)
    g.setValueAtTime(g.value, now)
    g.linearRampToValueAtTime(0.0001, now + SLOT_FADE_S)
  } catch {
    /* 진행 중인 setValueCurve를 자르지 못하는 브라우저 — 페이드 없이 바로 멈춘다 */
  }
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

/** 울리고 있는 것을 모두 거둔다 (정지·뱅크 없음·시동 꺼짐) */
function releaseLoops(now: number) {
  if (outgoing) retire(outgoing, now)
  if (active) retire(active, now)
  outgoing = null
  active = null
}

/** index 루프를 게인 0으로 새로 건다 (임의 지점에서 시작 — 앞뒤 칸과 위상이 겹치지 않게) */
function startSlot(index: number, rate: number, now: number): Slot | null {
  const ac = ctx
  if (!ac || !loopBus || !bank) return null
  const buffer = bank.buffers[index]
  if (!buffer) return null
  const gain = ac.createGain()
  gain.gain.value = 0
  gain.connect(loopBus)
  const src = ac.createBufferSource()
  src.buffer = buffer
  src.loop = true
  src.playbackRate.value = rate
  src.connect(gain)
  src.start(now, Math.random() * buffer.duration)
  return { index, src, gain }
}

/** 등파워 곡선으로 페이드. setValueCurveAtTime을 못 쓰는 환경이면 선형으로 갈음한다 */
function fadeParam(param: AudioParam, from: number, rising: boolean, now: number, secs: number) {
  param.cancelScheduledValues(now)
  try {
    param.setValueCurveAtTime(fadeCurve(from, rising), now, secs)
  } catch {
    param.setValueAtTime(rising ? Math.sqrt(1 - from * from) : from, now)
    param.linearRampToValueAtTime(rising ? 1 : 0.0001, now + secs)
  }
}

/**
 * 칸 갈아타기. 새 소스를 걸고 0.25초 등파워 교차 페이드한 뒤 옛 소스를 끊는다.
 * 페이드가 끝나기 전에 또 바뀌면 물러나던 소스는 즉시 거둔다 — 셋이 동시에 울리지 않게.
 */
function switchTo(index: number, rate: number, now: number) {
  if (outgoing) retire(outgoing, now)
  outgoing = null
  const next = startSlot(index, rate, now)
  if (!next) return                     // 버퍼가 아직 없다 — 울리던 칸을 그대로 둔다
  const prev = active
  active = next
  if (!prev) {
    next.gain.gain.setValueAtTime(1, now)   // 처음 켜는 것 — 페이드인은 loopBus가 맡는다
    return
  }
  outgoing = prev
  const from = clamp01(prev.gain.gain.value)
  const secs = fadeSeconds(from)
  fadeParam(next.gain.gain, from, true, now, secs)
  fadeParam(prev.gain.gain, from, false, now, secs)
  prev.src.onended = () => {
    prev.src.disconnect()
    prev.gain.disconnect()
    if (outgoing === prev) outgoing = null
  }
  try {
    prev.src.stop(now + secs + 0.02)
  } catch {
    /* 이미 멈춘 소스 */
  }
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
    releaseLoops(now)
    return
  }
  const want = pickLoop(rpmLevel, loops, active ? active.index : -1)
  if (!active || active.index !== want) switchTo(want, rpmLevel / loops[want].rpm, now)
  // 물러나는 칸도 같은 목표 rpm으로 끌고 간다 — 겹치는 250 ms 동안 둘이 정확히 같은 주파수라야
  // 맥놀이가 생기지 않는다 (뱅크 rpm이 실측값이라 어긋남이 0.1% 아래다)
  for (const slot of [active, outgoing]) {
    if (!slot) continue
    slot.src.playbackRate.setTargetAtTime(rpmLevel / loops[slot.index].rpm, now, RATE_TAU)
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
  releaseLoops(now + STOP_FADE_S)
  if (plan.oneShot) playOneShot(bank?.stop)
  if (suspendTimer !== null) clearTimeout(suspendTimer)
  suspendTimer = setTimeout(() => {
    suspendTimer = null
    void ac.suspend()
  }, plan.suspendAfterS * 1000)
}
