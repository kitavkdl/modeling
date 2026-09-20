import { useEffect, useRef, useState } from 'react'
import { useAssembly } from '../../../engine/context'
import { CLUTCH_ENGAGED, MAX_RPM, speedKmh } from './rideModel'
import { ride } from './rideState'

// HUD 우하단 아날로그 회전계 (product.hudExtra). 매 프레임 값을 리액트 상태로 올리면 장면이
// 통째로 다시 그려지므로, 숫자·표시등만 100 ms 폴링으로 갱신하고 바늘은 리액트 밖에서
// requestAnimationFrame으로 직접 돌린다.

/** 눈금 상한 (×1000 rpm). 리미터(12)보다 한 칸 위까지 그린다 */
const DIAL_MAX_K = 13
/** 눈금 상한 (rpm) */
const DIAL_MAX = DIAL_MAX_K * 1000
/** 레드존 시작 = 리미터 (rpm) */
const REDLINE = MAX_RPM
/** 바늘이 훑는 각도 (도). −SWEEP/2(좌하) ~ +SWEEP/2(우하) */
const SWEEP = 240
/** 숫자·표시등 폴링 간격 (ms) */
const POLL_MS = 100
/**
 * 바늘 1차 평활 시정수 (초). 프레임마다 읽는 rpm의 떨림을 눌러 준다.
 * 0.08초는 리미터 연료 컷의 출렁임(물리 11,690~12,010 = 320 rpm)을 121 rpm까지 깎아서
 * 눈금 위에서 바늘이 거의 멈춘 것처럼 보였다. 0.05초면 170 rpm이 남아 3° 남짓 떨린다 —
 * 실차의 리미터가 바늘을 흔드는 그 모습이다. (측정: .superpowers/sdd/round-4)
 */
const NEEDLE_TAU = 0.05
/** 프레임이 길어도 이만큼까지만 적분한다 (초) — 탭 전환 복귀에 바늘이 튀지 않게 */
const NEEDLE_MAX_DT = 0.1

/** 다이얼 중심·반지름 (viewBox 단위 = px, 지름 220) */
const CX = 110
const CY = 110
/** 눈금 바깥 반지름 */
const R_OUT = 98
/** 큰 눈금 안쪽 반지름 */
const R_MAJOR = 84
/** 작은 눈금(500 단위) 안쪽 반지름 */
const R_MINOR = 91
/** 숫자를 놓는 반지름 */
const R_NUM = 71

/** rpm → 바늘 각도 (도). 12시가 0°이고 시계 방향이 + */
const angleOf = (rpm: number) => -SWEEP / 2 + (Math.min(Math.max(rpm, 0), DIAL_MAX) / DIAL_MAX) * SWEEP

/** ×1000 rpm 값 → 다이얼 위의 점 */
function point(k: number, radius: number): [number, number] {
  const rad = ((angleOf(k * 1000) - 90) * Math.PI) / 180
  return [CX + radius * Math.cos(rad), CY + radius * Math.sin(rad)]
}

const f2 = (v: number) => Math.round(v * 100) / 100

/**
 * 속도 표시의 히스테리시스 폭 (km/h). 0.5의 경계에 걸친 차속은 반올림만 하면 0과 1을
 * 100 ms마다 오갔다 — 정지 직전과 반클러치 미속에서 숫자가 계속 떨렸다.
 */
const SPEED_DEADBAND = 0.3

/**
 * 표시용 정수 속도. 이전에 보여 준 값에서 (0.5 + 폭/2) 넘게 벗어날 때만 갱신한다 —
 * 0 → 1은 0.65 km/h를 넘겨야 하고, 1 → 0은 0.35 km/h 아래로 내려가야 한다.
 */
export function displaySpeed(kmh: number, prev: number): number {
  if (!Number.isFinite(kmh)) return prev
  return Math.abs(kmh - prev) < 0.5 + SPEED_DEADBAND / 2 ? prev : Math.round(kmh)
}

/** 레드존 시작 눈금(×1000 rpm) — 리미터에서 파생한다 */
const REDLINE_K = REDLINE / 1000

/** 레드존(12~13) 호를 그리는 path. 240° 중 한 칸(18.5°)이라 큰 호 플래그는 0 */
function redArc(): string {
  const [x0, y0] = point(REDLINE_K, R_OUT)
  const [x1, y1] = point(DIAL_MAX_K, R_OUT)
  return `M ${f2(x0)} ${f2(y0)} A ${R_OUT} ${R_OUT} 0 0 1 ${f2(x1)} ${f2(y1)}`
}

const MAJORS = Array.from({ length: DIAL_MAX_K + 1 }, (_, k) => k)
const MINORS = Array.from({ length: DIAL_MAX_K }, (_, k) => k + 0.5)

interface Snap {
  /** 표시용 속도 (km/h) */
  speed: number
  rpm: number
  gear: number
  clutch: number
  brake: number
  stalled: boolean
  /** 스타터가 크랭킹 중인가 — 이때 회전계는 300 언저리를 가리킨다 */
  cranking: boolean
  /** 클러치를 안 잡고 변속을 시도했다 */
  clutchWarn: boolean
}

const read = (prevSpeed: number): Snap => ({
  speed: displaySpeed(speedKmh(ride.speed), prevSpeed),
  rpm: Math.round(ride.rpm),
  gear: ride.gear,
  clutch: ride.clutch,
  brake: ride.brake,
  stalled: ride.stalled,
  cranking: ride.crankFor > 0,
  clutchWarn: ride.clutchWarn > 0,
})

export function RideGauge() {
  const running = useAssembly((s) => s.phase === 'running')
  const [snap, setSnap] = useState<Snap>(() => read(0))
  const needle = useRef<SVGGElement>(null)

  useEffect(() => {
    if (!running) return
    // 히스테리시스가 붙었으므로 직전에 보여 준 값을 넘겨 준다
    let shown = 0
    const poll = () =>
      setSnap(() => {
        const next = read(shown)
        shown = next.speed
        return next
      })
    poll()
    const id = setInterval(poll, POLL_MS)
    return () => clearInterval(id)
  }, [running])

  useEffect(() => {
    if (!running) return
    // 바늘만은 리액트를 거치지 않는다 — ride.rpm을 프레임마다 직접 읽어 1차 평활한 뒤
    // transform만 덮어쓴다. 다시 그려지는 것은 <g> 하나뿐이다.
    let shown = Number.isFinite(ride.rpm) ? ride.rpm : 0
    let last = performance.now()
    let raf = 0
    const tick = (now: number) => {
      // dt를 0 아래로 내려보내지 않는다 — rAF 타임스탬프는 프레임 시작 시각이라 effect가 잡아 둔
      // performance.now()보다 이를 수 있고, 음수 dt는 평활 계수를 -Infinity까지 보낸다.
      // 그때 (target − shown)이 0이면 0 × -Infinity = NaN이 되고, 한 번 NaN이 된 shown은
      // 영영 NaN이라 rotate(NaNdeg)가 조용히 무시되면서 바늘이 마지막 각도에 얼어붙는다.
      const dt = Math.min(NEEDLE_MAX_DT, Math.max(0, (now - last) / 1000))
      last = now
      // 숫자와 같은 값을 본다 — 바늘만 다른 값을 가리키는 일이 없도록.
      // 꺼진 엔진의 rpm은 rideModel이 STALL_TAU로 0까지 내려 주므로 여기서 눌러 둘 것이 없다:
      // 0으로 못 박아 두던 때는 시동이 꺼지는 순간 바늘이 한 프레임에 바닥으로 처박혔다.
      const target = Number.isFinite(ride.rpm) ? ride.rpm : 0
      shown += (target - shown) * (1 - Math.exp(-dt / NEEDLE_TAU))
      if (!Number.isFinite(shown)) shown = target
      const el = needle.current
      if (el) el.style.transform = `rotate(${angleOf(shown).toFixed(2)}deg)`
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [running])

  if (!running) return null

  return (
    <div className="gauge">
      <svg className="gauge-dial" viewBox="0 0 220 220" width="220" height="220" aria-hidden="true">
        <circle className="gauge-face" cx={CX} cy={CY} r={R_OUT + 8} />
        <path className="gauge-redzone" d={redArc()} />
        {MINORS.map((k) => {
          const [x1, y1] = point(k, R_OUT)
          const [x2, y2] = point(k, R_MINOR)
          return <line key={`m${k}`} className="gauge-tick-minor" x1={f2(x1)} y1={f2(y1)} x2={f2(x2)} y2={f2(y2)} />
        })}
        {MAJORS.map((k) => {
          const [x1, y1] = point(k, R_OUT)
          const [x2, y2] = point(k, R_MAJOR)
          const [nx, ny] = point(k, R_NUM)
          return (
            <g key={`M${k}`}>
              <line
                className={k >= REDLINE_K ? 'gauge-tick-major over' : 'gauge-tick-major'}
                x1={f2(x1)}
                y1={f2(y1)}
                x2={f2(x2)}
                y2={f2(y2)}
              />
              <text className="gauge-num" x={f2(nx)} y={f2(ny) + 4} textAnchor="middle">
                {k}
              </text>
            </g>
          )
        })}
        <g className="gauge-needle" ref={needle}>
          <line x1={CX} y1={CY + 16} x2={CX} y2={CY - (R_OUT - 8)} />
        </g>
        <circle className="gauge-hub" cx={CX} cy={CY} r={5} />
        <text className="gauge-readout" x={CX} y={152} textAnchor="middle">
          <tspan className="gauge-speed">{snap.speed}</tspan>
          <tspan className="gauge-unit" dx="5">
            km/h
          </tspan>
          <tspan className="gauge-gear" dx="10">
            {snap.gear === 0 ? 'N' : snap.gear}
          </tspan>
        </text>
        <text
          className={snap.rpm >= REDLINE ? 'gauge-rpm over' : 'gauge-rpm'}
          x={CX}
          y={174}
          textAnchor="middle"
        >
          {snap.rpm} RPM
        </text>
      </svg>
      <div className="gauge-lamps">
        <span className={snap.clutchWarn ? 'warn' : snap.clutch >= CLUTCH_ENGAGED ? 'on' : undefined}>CLUTCH</span>
        <span className={snap.brake > 0.3 ? 'on' : undefined}>BRAKE</span>
      </div>
      {snap.cranking ? (
        <div className="gauge-note">시동 거는 중…</div>
      ) : snap.stalled ? (
        <div className="gauge-note">
          시동 꺼짐 — {snap.gear !== 0 && snap.clutch < CLUTCH_ENGAGED ? '클러치 잡고 시동' : '시동 버튼'}
        </div>
      ) : null}
      <div className="gauge-keys">↑ 스로틀 · ↓ 브레이크 · SHIFT 클러치 · ←→ 변속 · D F 기울이기</div>
    </div>
  )
}
