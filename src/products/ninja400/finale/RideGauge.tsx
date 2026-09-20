import { useEffect, useState } from 'react'
import { useAssembly } from '../../../engine/context'
import { CLUTCH_ENGAGED, MAX_RPM, speedKmh } from './rideModel'
import { ride } from './rideState'

// HUD 우하단 계기 (product.hudExtra). 매 프레임 값을 리액트 상태로 올리면 장면이 통째로
// 다시 그려지므로 100ms 간격으로 폴링해서 필요한 값만 복사한다.

/** 눈금 상한 (rpm). 리미터보다 조금 위까지만 그린다 */
const BAR_MAX = 13000
/** 레드존 시작 = 리미터 (rpm). 전개로 감으면 채움이 정확히 이 눈금에 닿는다 */
const REDLINE = MAX_RPM
const POLL_MS = 100

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

  useEffect(() => {
    if (!running) return
    setSnap(read())
    const id = setInterval(() => setSnap(read()), POLL_MS)
    return () => clearInterval(id)
  }, [running])

  if (!running) return null

  const over = snap.rpm >= REDLINE
  const width = `${Math.min(100, (snap.rpm / BAR_MAX) * 100)}%`
  return (
    <div className="gauge">
      <div className="gauge-top">
        <div className="gauge-speed">
          {snap.speed}
          <b>km/h</b>
        </div>
        <div className="gauge-gear">{snap.gear === 0 ? 'N' : snap.gear}</div>
      </div>
      <div className={over ? 'gauge-bar over' : 'gauge-bar'}>
        <i style={{ width }} />
        <span className="gauge-redline" style={{ left: `${(REDLINE / BAR_MAX) * 100}%` }} />
      </div>
      <div className="gauge-rpm">{snap.stalled ? '시동 꺼짐' : `${snap.rpm} RPM`}</div>
      <div className="gauge-lamps">
        <span className={snap.clutch >= CLUTCH_ENGAGED ? 'on' : undefined}>CLUTCH</span>
        <span className={snap.brake > 0.3 ? 'on' : undefined}>BRAKE</span>
      </div>
      {snap.stalled ? (
        <div className="gauge-note">{snap.gear !== 0 && snap.clutch < CLUTCH_ENGAGED ? '클러치 잡고 시동' : '시동 버튼'}</div>
      ) : null}
      <div className="gauge-keys">↑ 스로틀 · ↓ 브레이크 · SHIFT 클러치 · ←→ 변속</div>
    </div>
  )
}
