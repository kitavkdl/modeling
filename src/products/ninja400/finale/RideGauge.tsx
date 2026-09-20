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
/** 바늘 1차 평활 시정수 (초). 프레임마다 읽는 rpm의 떨림을 눌러 준다 */
const NEEDLE_TAU = 0.08
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

/** 레드존(12~13) 호를 그리는 path. 240° 중 한 칸(18.5°)이라 큰 호 플래그는 0 */
function redArc(): string {
  const [x0, y0] = point(12, R_OUT)
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
}

const read = (): Snap => ({
  speed: Math.round(speedKmh(ride.speed)),
  rpm: Math.round(ride.rpm),
  gear: ride.gear,
  clutch: ride.clutch,
  brake: ride.brake,
  stalled: ride.stalled,
})

export function RideGauge() {
  const running = useAssembly((s) => s.phase === 'running')
  const [snap, setSnap] = useState<Snap>(read)
  const needle = useRef<SVGGElement>(null)

  useEffect(() => {
    if (!running) return
    setSnap(read())
    const id = setInterval(() => setSnap(read()), POLL_MS)
    return () => clearInterval(id)
  }, [running])

  useEffect(() => {
    if (!running) return
    // 바늘만은 리액트를 거치지 않는다 — ride.rpm을 프레임마다 직접 읽어 1차 평활한 뒤
    // transform만 덮어쓴다. 다시 그려지는 것은 <g> 하나뿐이다.
    let shown = ride.rpm
    let last = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const dt = Math.min(NEEDLE_MAX_DT, (now - last) / 1000)
      last = now
      shown += (ride.rpm - shown) * (1 - Math.exp(-dt / NEEDLE_TAU))
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
                className={k >= 12 ? 'gauge-tick-major over' : 'gauge-tick-major'}
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
        <span className={snap.clutch >= CLUTCH_ENGAGED ? 'on' : undefined}>CLUTCH</span>
        <span className={snap.brake > 0.3 ? 'on' : undefined}>BRAKE</span>
      </div>
      {snap.stalled ? (
        <div className="gauge-note">
          시동 꺼짐 — {snap.gear !== 0 && snap.clutch < CLUTCH_ENGAGED ? '클러치 잡고 시동' : '시동 버튼'}
        </div>
      ) : null}
      <div className="gauge-keys">↑ 스로틀 · ↓ 브레이크 · SHIFT 클러치 · ←→ 변속</div>
    </div>
  )
}
