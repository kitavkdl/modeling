// 엔진 사운드 v5 — 실녹음 루프(public/audio/ninja400/engine/) 위에 합성 층 셋을 얹는다.
// 뱅크는 rpm 사다리(1325~6495)로 잘라 둔 이음매 없는 모노 루프 + 시동·정지 원샷이고,
// 각 칸의 rpm은 반올림하지 않은 실측값이다(bank.json, 소수 첫째 자리).
//
// 그래프:
//   활성 칸 ┬ 보이스A ─ lvlA(±2 dB LFO 0.13 Hz) ┐
//           └ 보이스B ─ lvlB(±2 dB LFO 0.17 Hz) ┤ slotGain ┐
//   교체 중인 칸 (같은 모양) ─────────────────────────────┴→ loopMix
//   loopMix → loopShelf(150 Hz, 7000 rpm 위로 +3 dB) ┐
//   고회전 몸통 (정현파 6 + 공진 LPF + tanh) ────────┤
//   흡기 그로울 (대역잡음 × 점화주파수 AM) ──────────┤
//   감속 버블 (300 Hz 짧은 팝) ──────────────────────┴→ loopBus(시동·정지 페이드)
//   loopBus → loadShelf(120 Hz, 부하 +1.5 dB) → antiAlias(9k, 피치업 1.4배 위에서 7k)
//           → tone(lowpass, Q는 부하가 낮춘다) → toneGain → master(0.19) → compressor → destination
//   start.ogg / stop.ogg 원샷 ─────────────────────────────────────────→ master ┘
//
// v5.1에서 고친 것 — 헤드룸:
//   master가 0.8이던 때 9000 rpm 전개·물린 기어의 피크가 +9.6 dBFS로 나갔다(아래 MASTER_GAIN의
//   계산 참조). 기본값 DynamicsCompressor(threshold −24, ratio 12)가 그것을 통째로 눌러서
//   아이들과 전개의 차이가 사라졌다 — "무슨 짓을 해도 같은 크기"다. master를 0.19로 내려
//   피크를 −3 dBFS에 두고, 컴프레서는 −10 dB/4:1로 느슨하게 잡아 과도부만 받게 했다.
//   대신 아이들이 −34 dBFS 아래로 내려가서 닫힌 스로틀의 톤 바닥을 −7 → −5 dB로 올렸다.
//
// 매 tick(25 ms)마다 pickLoop로 칸 하나를 고르고, 그 소스들의 playbackRate를 rpm/루프rpm으로
// 끌고 간다. 칸이 바뀔 때만 새 칸을 걸고 0.25초 등파워 교차 페이드한 뒤 옛 칸을 끊는다.
//
// v4에서 고친 세 가지:
//  1) 고회전이 얇았다 — 6495 rpm 위는 루프를 1.85배까지 피치업할 뿐이라 배음이 성기다.
//     5500→8000 rpm에 걸쳐 합성 몸통을 섞고, 7000 rpm 위로는 루프에 저역 셸프를 준다.
//  2) 스로틀에 반응이 없었다 — 톤 범위를 넓히고(−7 dB/1100 Hz ↔ 0 dB/7000 Hz), 열 때는 30 ms,
//     닫을 때는 120 ms로 시정수를 달리하고, 흡기 그로울과 감속 버블을 붙였다.
//  3) 같은 소리가 되풀이됐다 — 한 칸을 서로 40~60% 떨어진 지점에서 시작한 보이스 둘로 울린다.
//     차이는 점화 주기의 정수배로 스냅해 기본파 위상을 맞춰 두고(voiceOffsets 참조),
//     느린 레벨 LFO(0.13·0.17 Hz, ±2 dB)와 보이스 B의 ±0.15% playbackRate LFO(0.09 Hz)로
//     주기성을 깬다. 루프 하나가 0.9~2초마다 똑같이 돌아오던 느낌이 사라진다.
//
// rpm은 바깥(주행 모델)에서 setRpm으로 들어온다.

import { IDLE_RPM } from '../finale/rideModel'
import {
  antiAliasHz,
  clamp01,
  createBurbleLayer,
  createHighLayer,
  createIntakeLayer,
  createNoiseBuffer,
  dbToGain,
  loopShelfDb,
  LOOP_RMS_DBFS,
  LOOP_SHELF_HZ,
  rpmSlope,
  updateBurbleLayer,
  updateHighLayer,
  updateIntakeLayer,
  type BurbleLayer,
  type HighLayer,
  type IntakeLayer,
  type LayerState,
} from './engineLayers'
import { pickLoop, type Loop } from './pickLoop'

/** 뱅크가 놓인 곳 (Vite가 public/ 그대로 복사한다) */
const BANK_DIR = '/audio/ninja400/engine/'
/** 슬롯 갱신 주기 (ms) */
const TICK_MS = 25
/**
 * 최종 출력 배율. 9000 rpm 전개·물린 기어의 **피크가 −3 dBFS**에 서도록 잡았다.
 *
 * 뱅크 루프는 −18 dBFS RMS / −1 dBFS 피크로 정규화돼 있다(build-engine-bank.py의
 * TARGET_RMS_DBFS·PEAK_CEIL_DBFS). 그 위로 master 앞까지 쌓이는 이득:
 *
 *   보이스 둘   2 × 0.7071 = 1.414 (기본파가 위상 정렬이라 동상으로 더해진다)  +3.0 dB
 *   레벨 LFO    꼭대기                                                        +2.0 dB
 *   loopShelf   7500 rpm 위                                                   +3.0 dB
 *   loadShelf   부하 1                                                        +1.5 dB
 *   tone        −5 + 5·1 + 3·1                                                +3.0 dB
 *                                                                     합계  +12.5 dB
 *
 *   피크(master 전) = −1 + 12.5 = +11.5 dBFS
 *   MASTER_GAIN = 10^((−3 − 11.5)/20) = 10^(−14.5/20) = 0.188 → 0.19 (−14.42 dB)
 *   → 피크 −2.9 dBFS · RMS −19.9 dBFS
 *
 * 0.8(−1.94 dB)이던 때는 피크가 +9.6 dBFS였다. 기본 컴프레서(threshold −24, ratio 12)가
 * 그 13 dB를 통째로 먹어서 아이들과 전개의 폭이 남지 않았다.
 */
const MASTER_GAIN = 0.19
/**
 * 컴프레서 — 기본값(threshold −24 dB, knee 30, ratio 12, release 0.25)은 리미터에 가깝다.
 * 여기서는 −10 dB/4:1로 느슨하게 두어 **과도부(변속 블립·시동)만** 받는다.
 * 전개 RMS가 −19.9 dBFS라 무릎 아래(−16 dB)에 있어서 정상 주행에는 아예 걸리지 않는다.
 */
export const COMPRESSOR = { threshold: -10, knee: 12, ratio: 4, attack: 0.005, release: 0.12 } as const
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
/** 칸을 갈아탈 때 등파워 교차 페이드 (초). 이 동안만 두 칸이 겹친다 */
const SWITCH_FADE_S = 0.25
/** 교차 페이드 곡선을 그릴 점 개수 */
const FADE_POINTS = 33
/** playbackRate·슬롯 게인 시정수(초) */
const RATE_TAU = 0.02
/** 톤(lowpass·게인) 시정수 — 열 때는 빠르게, 닫을 때는 느리게 */
const TONE_TAU_OPEN = 0.03
const TONE_TAU_CLOSE = 0.12
/** 머플러 저역통과 (Hz): 스로틀 0 → 1100, 1 → 7000 */
const TONE_HZ_BASE = 1100
const TONE_HZ_SPAN = 5900
/**
 * 톤 게인 (dB): 스로틀 0 → −5, 1 → 0, 부하 1이면 +3.
 * 바닥이 −7이던 때는 master를 0.19로 내리자 아이들 RMS가 −18 + 5 − 7 − 14.42 = −34.4 dBFS로
 * 떨어져 들리지 않았다. −5로 올려 −32.4 dBFS에 둔다 — 전개 꼭대기(0 dB)는 그대로라
 * MASTER_GAIN의 계산은 건드리지 않는다(span을 7 → 5로 같이 줄였다).
 */
const TONE_DB_BASE = -5
const TONE_DB_THROTTLE = 5
const TONE_DB_LOAD = 3
/** 톤 저역통과 Q: 기본 1.0, 부하 1이면 0.7 — 물린 기어에서는 공진을 죽여 둔탁하게 민다 */
const TONE_Q_BASE = 1.0
const TONE_Q_LOAD = 0.3
/** 부하가 더하는 저역 셸프 (Hz, dB) */
const LOAD_SHELF_HZ = 120
const LOAD_SHELF_DB = 1.5
/** blip(): 톤 게인 +4 dB, 8 ms 상승 · 40 ms 유지 · 60 ms 하강 */
const BLIP_DB = 4
const BLIP_ATTACK_S = 0.008
const BLIP_HOLD_S = 0.04
const BLIP_RELEASE_S = 0.06
/** 한 칸을 울리는 보이스 둘: 등파워 배분, 느린 레벨 LFO(선형 ±0.26배 = +2.0/−2.6 dB),
 *  보이스 B의 rate LFO(±0.15%). 두 레벨 LFO는 주파수가 달라 몇 초 만에 서로 어긋난다 */
const VOICE_GAIN = Math.SQRT1_2
const VOICE_LFO_HZ = [0.13, 0.17]
const VOICE_LFO_DB = 2
const RATE_LFO_HZ = 0.09
const RATE_LFO_DEPTH = 0.0015
/** 두 보이스의 시작 지점 차이 (루프 길이 대비) — 40~60%, 점화 주기의 정수배로 스냅한다 */
const VOICE_OFFSET_MIN = 0.4
const VOICE_OFFSET_SPAN = 0.2
/** d(rpm)/dt 지수평활 계수 — tick 하나의 잡음으로 버블이 깜빡이지 않게 */
const DRPM_SMOOTH = 0.35
/** 합성 층 파라미터 시정수 (초) */
const LAYER_TAU = 0.03

/** 회전수 정리 — 유한하지 않거나 0 이하(시동 꺼짐·스톨)면 0, 그때는 루프를 아예 내린다 */
export function safeRpm(rpm: number): number {
  return Number.isFinite(rpm) && rpm > 0 ? rpm : 0
}

/** 스로틀·부하가 정하는 머플러 저역통과(Hz·Q)와 톤 게인(선형) */
export function toneFor(throttle: number, load: number): { lowpassHz: number; gain: number; q: number } {
  const th = clamp01(throttle)
  const ld = clamp01(load)
  return {
    lowpassHz: TONE_HZ_BASE + TONE_HZ_SPAN * th,
    gain: dbToGain(TONE_DB_BASE + TONE_DB_THROTTLE * th + TONE_DB_LOAD * ld),
    q: TONE_Q_BASE - TONE_Q_LOAD * ld,
  }
}

/** 뱅크 루프의 피크 상한 (dBFS) — build-engine-bank.py의 PEAK_CEIL_DBFS */
export const LOOP_PEAK_DBFS = -1
/** 보이스 둘이 더하는 몫 (dB): 2 × 0.7071 = +3.0 (동상) 에 레벨 LFO 꼭대기 +2.0 */
export const VOICE_SUM_DB = 20 * Math.log10(2 * VOICE_GAIN) + VOICE_LFO_DB

/**
 * master 앞까지 루프 체인이 더하는 이득 (dB). MASTER_GAIN 주석의 표를 그대로 코드로 옮긴 것이라,
 * 상수 하나만 바뀌어도 engineSound.test.ts의 헤드룸 못이 어긋난다.
 * 보이스 몫은 LFO 꼭대기를 포함한 최악값이다.
 */
export function loopChainDb(rpm: number, throttle: number, load: number): number {
  return (
    VOICE_SUM_DB +
    loopShelfDb(rpm) +
    LOAD_SHELF_DB * clamp01(load) +
    20 * Math.log10(toneFor(throttle, load).gain)
  )
}

/** destination에 닿는 피크 (dBFS) */
export const peakDbfs = (rpm: number, throttle: number, load: number): number =>
  LOOP_PEAK_DBFS + loopChainDb(rpm, throttle, load) + 20 * Math.log10(MASTER_GAIN)

/** destination에 닿는 RMS (dBFS) */
export const rmsDbfs = (rpm: number, throttle: number, load: number): number =>
  LOOP_RMS_DBFS + loopChainDb(rpm, throttle, load) + 20 * Math.log10(MASTER_GAIN)

/**
 * 톤을 끌고 갈 시정수 (초). 스로틀을 열 때는 30 ms로 튀어나오고 닫을 때는 120 ms로 잦아든다 —
 * 같은 속도로 오가면 "열고 닫아도 그대로"로 들린다. 실제 엔진도 열 때가 훨씬 빠르다.
 */
export function throttleTau(next: number, prev: number): number {
  return clamp01(next) > clamp01(prev) ? TONE_TAU_OPEN : TONE_TAU_CLOSE
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
 * 남은 교차 페이드 길이 (초). 페이드 도중에 또 칸이 바뀌면 나가던 칸은 이미 절반쯤 내려와
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

/**
 * 두 보이스의 시작 지점 (초). r0·r1은 0~1 난수.
 *
 * 차이는 루프 길이의 40~60%로 잡되 **점화 주기의 정수배로 스냅한다**. 루프는 점화 주기의
 * 정수배로 잘려 있으므로(build-engine-bank.py), 정수 주기만큼 어긋난 두 복사본은 기본파의
 * 위상이 정확히 맞는다 — 기본파는 +6 dB로 더해지고, 점화마다 다른 잔결만 비상관으로 섞인다.
 * 스냅하지 않으면 위상차가 칸을 갈아탈 때마다 무작위가 되어, 운 나쁘면 기본파가 상쇄돼
 * 속이 빈 소리가 나거나(φ≈π) 쿵 하고 부푼다. 스냅해 두면 보이스 B의 rate LFO(±0.15%)가
 * 위상을 ±1.7 rad 안에서만 흔들고, 그만큼의 느린 숨결(−3.5 dB 폭, 0.09 Hz)만 남는다.
 */
export function voiceOffsets(duration: number, loopRpm: number, r0: number, r1: number): [number, number] {
  const dur = Number.isFinite(duration) && duration > 0 ? duration : 0
  if (dur <= 0) return [0, 0]
  const want = dur * (VOICE_OFFSET_MIN + VOICE_OFFSET_SPAN * clamp01(r1))
  const period = Number.isFinite(loopRpm) && loopRpm > 0 ? 60 / loopRpm : 0
  const delta = period > 0 && period < dur / 2 ? period * Math.round(want / period) : want
  const a = (clamp01(r0) * dur) % dur     // r0=1이면 dur가 되므로 0으로 되돌린다
  return [a, (a + delta) % dur]
}

interface Bank { loops: Loop[]; buffers: AudioBuffer[]; start: AudioBuffer | null; stop: AudioBuffer | null }
/** 한 칸을 울리는 소스 하나 — 소스·레벨 게인과 거기 매달린 LFO들 */
interface Voice { src: AudioBufferSourceNode; lvl: GainNode; oscs: OscillatorNode[]; gains: GainNode[]; rateDepth: GainNode | null }
/** 지금 울리는 칸 하나 — 보이스 둘이 하나의 교차 페이드 게인 아래 묶여 있다 */
interface Slot { index: number; gain: GainNode; voices: Voice[] }

let ctx: AudioContext | null = null
let master: GainNode | null = null
/** 루프 보이스만 모이는 곳 — 저역 셸프가 여기에만 걸린다(합성 층은 지나지 않는다) */
let loopMix: GainNode | null = null
let loopShelf: BiquadFilterNode | null = null
/** 루프와 합성 층이 모두 지나가는 버스 — start/stop 페이드가 여기에 걸린다 (원샷은 영향받지 않는다) */
let loopBus: GainNode | null = null
let loadShelf: BiquadFilterNode | null = null
let antiAlias: BiquadFilterNode | null = null
let toneLPF: BiquadFilterNode | null = null
let toneGain: GainNode | null = null
let high: HighLayer | null = null
let intake: IntakeLayer | null = null
let burble: BurbleLayer | null = null
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
/** 직전 tick의 스로틀 — 열고 있는지 닫고 있는지로 시정수를 고른다 */
let lastLevel = 0
/** 바깥에서 받은 회전수. 0이면 루프를 내린다 */
let rpmLevel = 0
/** 물린 기어가 거는 부하 0~1 */
let loadLevel = 0
/** 평활한 d(rpm)/dt (rpm/s)와 그것을 재는 데 쓰는 직전 tick의 값 */
let dRpm = 0
let lastRpm = 0
let lastTickAt = 0
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
  compressor.threshold.value = COMPRESSOR.threshold
  compressor.knee.value = COMPRESSOR.knee
  compressor.ratio.value = COMPRESSOR.ratio
  compressor.attack.value = COMPRESSOR.attack
  compressor.release.value = COMPRESSOR.release
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
  toneLPF.Q.value = tone.q
  toneLPF.connect(toneGain)
  // 뱅크 최고 칸 위에서는 playbackRate가 1.9배까지 올라간다. 44.1 kHz 소스를 그만큼 끌어올리면
  // 고역에 리샘플링 찌꺼기가 끼는데, 1.4배를 넘을 때만 9 kHz → 7 kHz로 내려 덮는다.
  antiAlias = ctx.createBiquadFilter()
  antiAlias.type = 'lowpass'
  antiAlias.frequency.value = antiAliasHz(1)
  antiAlias.connect(toneLPF)
  // 물린 기어가 거는 부하는 저역을 조금 부풀린다 (엔진이 버티는 느낌)
  loadShelf = ctx.createBiquadFilter()
  loadShelf.type = 'lowshelf'
  loadShelf.frequency.value = LOAD_SHELF_HZ
  loadShelf.gain.value = 0
  loadShelf.connect(antiAlias)
  loopBus = ctx.createGain()
  loopBus.gain.value = 0
  loopBus.connect(loadShelf)
  // 고회전에서 루프에만 주는 저역 셸프 — 합성 층은 이미 제 저역을 갖고 있어 지나지 않는다
  loopShelf = ctx.createBiquadFilter()
  loopShelf.type = 'lowshelf'
  loopShelf.frequency.value = LOOP_SHELF_HZ
  loopShelf.gain.value = 0
  loopShelf.connect(loopBus)
  loopMix = ctx.createGain()
  loopMix.gain.value = 1
  loopMix.connect(loopShelf)

  const now = ctx.currentTime
  const noise = createNoiseBuffer(ctx)
  high = createHighLayer(ctx, loopBus, now)
  intake = createIntakeLayer(ctx, loopBus, noise, now)
  burble = createBurbleLayer(ctx, loopBus, noise)

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

/** 보이스 하나를 at에 멈추고, 끝나면 매달린 노드를 전부 떼어 낸다 */
function stopVoice(v: Voice, at: number) {
  v.src.onended = () => {
    v.src.disconnect()
    v.lvl.disconnect()
    for (const g of v.gains) g.disconnect()
    for (const o of v.oscs) o.disconnect()
  }
  for (const o of v.oscs) {
    try {
      o.stop(at)
    } catch {
      /* 이미 멈춘 오실레이터 */
    }
  }
  try {
    v.src.stop(at)
  } catch {
    /* 이미 멈춘 소스 */
  }
}

/**
 * 옛 칸을 30 ms에 걸쳐 지우고 끊는다.
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
  for (const v of slot.voices) stopVoice(v, now + SLOT_FADE_S + 0.02)
  slot.voices[0]?.src.addEventListener('ended', () => slot.gain.disconnect())
}

/** 울리고 있는 것을 모두 거둔다 (정지·뱅크 없음·시동 꺼짐) */
function releaseLoops(now: number) {
  if (outgoing) retire(outgoing, now)
  if (active) retire(active, now)
  outgoing = null
  active = null
}

/**
 * index 루프를 게인 0으로 새로 건다. 같은 버퍼를 서로 40% 이상(점화 주기의 정수배) 떨어진
 * 지점에서 시작하는 보이스 둘로 울려 "0.9~2초마다 같은 대목"이라는 느낌을 지운다. 둘은 등파워로
 * 섞이고 각자 느린 레벨 LFO(0.13·0.17 Hz)를 받는다. 보이스 B에는 ±0.15% playbackRate LFO(0.09 Hz)가
 * 더 붙어 맞춰 둔 위상을 ±1.7 rad 안에서 천천히 흔든다 — 상쇄 없이 숨 쉬는 느낌만 남는다.
 */
function startSlot(index: number, rate: number, now: number): Slot | null {
  const ac = ctx
  if (!ac || !loopMix || !bank) return null
  const buffer = bank.buffers[index]
  if (!buffer) return null
  const gain = ac.createGain()
  gain.gain.value = 0
  gain.connect(loopMix)
  const offsets = voiceOffsets(buffer.duration, bank.loops[index]?.rpm ?? 0, Math.random(), Math.random())
  const voices: Voice[] = []
  for (let i = 0; i < 2; i++) {
    const lvl = ac.createGain()
    lvl.gain.value = VOICE_GAIN
    lvl.connect(gain)
    const depth = ac.createGain()
    depth.gain.value = VOICE_GAIN * (dbToGain(VOICE_LFO_DB) - 1)
    depth.connect(lvl.gain)
    const lfo = ac.createOscillator()
    lfo.type = 'sine'
    lfo.frequency.value = VOICE_LFO_HZ[i]
    lfo.connect(depth)
    lfo.start(now)

    const src = ac.createBufferSource()
    src.buffer = buffer
    src.loop = true
    src.playbackRate.value = rate
    src.connect(lvl)

    const oscs = [lfo]
    const gains = [depth]
    let rateDepth: GainNode | null = null
    if (i === 1) {
      rateDepth = ac.createGain()
      rateDepth.gain.value = rate * RATE_LFO_DEPTH
      rateDepth.connect(src.playbackRate)
      const rateLfo = ac.createOscillator()
      rateLfo.type = 'sine'
      rateLfo.frequency.value = RATE_LFO_HZ
      rateLfo.connect(rateDepth)
      rateLfo.start(now)
      oscs.push(rateLfo)
      gains.push(rateDepth)
    }
    src.start(now, offsets[i])
    voices.push({ src, lvl, oscs, gains, rateDepth })
  }
  return { index, gain, voices }
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
 * 칸 갈아타기. 새 칸(보이스 둘)을 걸고 0.25초 등파워 교차 페이드한 뒤 옛 칸을 끊는다.
 * 페이드가 끝나기 전에 또 바뀌면 물러나던 칸은 즉시 거둔다 — 셋이 동시에 울리지 않게.
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
  for (const v of prev.voices) stopVoice(v, now + secs + 0.02)
  prev.voices[0]?.src.addEventListener('ended', () => {
    prev.gain.disconnect()
    if (outgoing === prev) outgoing = null
  })
}

/** 스로틀·부하가 정하는 톤을 지금 값으로 끌고 간다 (열 때 빠르게, 닫을 때 느리게) */
function updateTone(now: number) {
  const { lowpassHz, gain, q } = toneFor(level, loadLevel)
  const tau = throttleTau(level, lastLevel)
  lastLevel = level
  toneLPF?.frequency.setTargetAtTime(lowpassHz, now, tau)
  toneLPF?.Q.setTargetAtTime(q, now, TONE_TAU_CLOSE)
  loadShelf?.gain.setTargetAtTime(LOAD_SHELF_DB * clamp01(loadLevel), now, TONE_TAU_CLOSE)
  if (now >= blipUntil) toneGain?.gain.setTargetAtTime(gain, now, tau)
}

/** 합성 층 셋을 지금 상태로 끌고 간다 */
function updateLayers(state: LayerState, now: number) {
  if (high) updateHighLayer(high, state, now, LAYER_TAU)
  if (intake) updateIntakeLayer(intake, state, now, LAYER_TAU)
  if (burble) updateBurbleLayer(burble, state, now)
  loopShelf?.gain.setTargetAtTime(loopShelfDb(state.rpm), now, LAYER_TAU)
}

function tick() {
  const ac = ctx
  if (!ac) return
  const now = ac.currentTime
  // rpm 기울기는 tick 간격으로 재고 지수평활한다 — 한 tick의 잡음으로 버블이 깜빡이지 않게
  const dt = lastTickAt > 0 ? now - lastTickAt : TICK_MS / 1000
  lastTickAt = now
  dRpm += (rpmSlope(lastRpm, rpmLevel, dt) - dRpm) * DRPM_SMOOTH
  lastRpm = rpmLevel
  updateTone(now)
  updateLayers({ rpm: rpmLevel, throttle: level, load: loadLevel, dRpm }, now)
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
    const rate = rpmLevel / loops[slot.index].rpm
    for (const v of slot.voices) {
      v.src.playbackRate.setTargetAtTime(rate, now, RATE_TAU)
      v.rateDepth?.gain.setTargetAtTime(rate * RATE_LFO_DEPTH, now, RATE_TAU)
    }
  }
  const rate = active ? rpmLevel / loops[active.index].rpm : 1
  antiAlias?.frequency.setTargetAtTime(antiAliasHz(rate), now, LAYER_TAU)
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
  lastLevel = 0
  loadLevel = 0
  // 바깥에서 setRpm이 오기 전까지는 아이들로 돈다
  rpmLevel = IDLE_RPM
  lastRpm = IDLE_RPM
  lastTickAt = 0
  dRpm = 0
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

/** 스로틀 0~1. 머플러가 열리고 톤 게인이 오르고 흡기 그로울이 붙는다 */
export function setThrottle(t: number): void {
  level = clamp01(t)
}

/** 물린 기어가 엔진에 거는 부하 0~1. 톤 +3 dB, 120 Hz +1.5 dB, 저역통과 Q −0.3 */
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
  lastLevel = 0
  rpmLevel = 0
  loadLevel = 0
  dRpm = 0
  lastRpm = 0
  lastTickAt = 0
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
