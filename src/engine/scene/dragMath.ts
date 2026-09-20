import type { Mounted } from '../store'
import { MM, type PartDef } from '../types'

export interface ScreenPt {
  x: number
  y: number
}

/** 고스트 하나의 화면 위치와 판정 반경 (px) */
export interface GhostPx {
  id: string
  px: ScreenPt
  radiusPx: number
}

export interface DragTargets {
  /** 단일 부품: 놓으면 장착될 인스턴스 */
  snap: string | null
  /** 다수 부품: 지금 지나가고 있어 장착할 인스턴스들 */
  paint: string[]
}

export const THRESHOLD_MIN_PX = 18
export const THRESHOLD_MAX_PX = 120

/** mm 반경을 고스트의 카메라 거리(units)에서 화면 픽셀로 환산한다 */
export function thresholdPx(mm: number, distUnits: number, viewportHeightPx: number, fovDeg: number): number {
  const pxPerUnit = viewportHeightPx / (2 * distUnits * Math.tan((fovDeg * Math.PI) / 360))
  const px = mm * MM * pxPerUnit
  return Math.min(THRESHOLD_MAX_PX, Math.max(THRESHOLD_MIN_PX, px))
}

/**
 * 부품 화면 좌표와 고스트 화면 좌표로 판정한다. 겹쳐 보이면 장착.
 * 다수 부품(페인팅)은 반경 안의 슬롯 중 **커서에 가장 가까운 하나만** 고른다. 낮은 앙각에서는 뒷줄 슬롯이
 * 화면에서 몇 px 뒤에 겹쳐 오므로, 반경 안 전부를 박으면 지나가지 않은 줄까지 한꺼번에 장착된다.
 * 포인터 이동 이벤트는 초당 수십 번 오므로 한 번에 하나씩이어도 연속 장착("다라락")은 그대로다.
 */
export function resolveDragTargets(part: PartDef, partPx: ScreenPt, ghosts: GhostPx[], mounted: Mounted): DragTargets {
  const dist = (g: GhostPx) => Math.hypot(partPx.x - g.px.x, partPx.y - g.px.y)
  const within = (g: GhostPx) => dist(g) <= g.radiusPx
  if (part.count === 1) {
    const g = ghosts.find((x) => x.id === part.instances[0].id)
    if (!g || mounted[g.id]) return { snap: null, paint: [] }
    return { snap: within(g) ? g.id : null, paint: [] }
  }
  let best: GhostPx | null = null
  let bestD = Infinity
  for (const g of ghosts) {
    if (mounted[g.id] || !within(g)) continue
    const d = dist(g)
    if (d < bestD) { best = g; bestD = d }
  }
  return { snap: null, paint: best ? [best.id] : [] }
}

/** 한 번의 pointermove에서 훑을 최대 표본 수 */
export const MAX_SEGMENT_STEPS = 12

/**
 * 이전 포인터 위치 → 지금 위치를 잇는 선분을 stepPx 간격으로 훑으면서, 지나간 슬롯을 순서대로 모은다.
 * pointermove 한 번에 슬롯 하나만 박으므로, 빠르게 쓸면 이동 폭이 판정 반경의 2배를 넘어
 * 사이의 슬롯이 통째로 빠진다. 선분을 잘라 밟으면 손이 지나간 자리는 전부 박힌다.
 * 표본은 최대 MAX_SEGMENT_STEPS개로 끊는다 (화면을 가로지르는 한 방에 수백 번 돌지 않게).
 * 단일 부품(count === 1)은 페인팅이 없으므로 항상 빈 배열이다.
 */
export function resolveAlongSegment(
  part: PartDef,
  from: ScreenPt,
  to: ScreenPt,
  ghosts: GhostPx[],
  mounted: Mounted,
  stepPx: number,
): string[] {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const span = Math.hypot(dx, dy)
  const steps = Math.max(1, Math.min(MAX_SEGMENT_STEPS, Math.ceil(span / Math.max(1, stepPx))))
  const taken: string[] = []
  // 이미 고른 것을 장착된 셈 치고 넘겨야 다음 표본이 같은 슬롯을 다시 고르지 않는다
  const seen: Mounted = { ...mounted }
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    const at = { x: from.x + dx * t, y: from.y + dy * t }
    for (const id of resolveDragTargets(part, at, ghosts, seen).paint) {
      taken.push(id)
      seen[id] = { instanceId: id, at: 0 }
    }
  }
  return taken
}
