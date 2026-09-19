import { create } from 'zustand'
import type { PartDef } from '../engine/types'
import { PARTS, PART_BY_ID, partOfInstance, type Vec3 } from '../products/keyboard/parts'

export type Phase =
  /** 부품 장착 중 */
  | 'assembly'
  /** 모든 부품 장착 완료, 케이블 대기 */
  | 'complete'
  /** 케이블이 포트로 이동 중 */
  | 'plugging'
  /** 0.3s 정적 */
  | 'still'
  /** RGB 부팅 웨이브 */
  | 'booting'
  /** 정상 점등 */
  | 'on'

export interface MountRecord {
  instanceId: string
  /** performance.now() 기준 장착 시각. 장착 애니메이션에 쓴다. */
  at: number
  /** 장착 애니메이션 출발점 (월드 mm). 드래그로 놓은 자리. 없으면 기본 규칙. */
  from?: Vec3
}

export interface AssemblyState {
  mounted: Record<string, MountRecord>
  history: string[]
  selectedPartId: string | null
  phase: Phase
  /** phase가 바뀐 시각 (performance.now()). 전원 시퀀스 타이밍에 쓴다. */
  phaseAt: number
  /** 마지막 장착 시각 — 카메라 이동 트리거 */
  lastMount: { partId: string; at: number } | null
  /** 부품을 잡고 끄는 중 */
  dragging: boolean
  /** 드래그 중 놓으면 장착될 고스트 인스턴스 */
  dragTarget: string | null
  /** 전부 장착 시퀀스 진행 중 */
  sequencing: boolean

  selectPart: (partId: string | null) => void
  mount: (instanceId: string, from?: Vec3) => boolean
  mountAll: (partId: string, intervalMs?: number) => void
  undo: () => void
  setDragging: (v: boolean) => void
  setDragTarget: (id: string | null) => void
  plugCable: () => void
  setPhase: (p: Phase) => void
  reset: () => void
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

export function mountedCount(mounted: Record<string, MountRecord>, part: PartDef): number {
  let n = 0
  for (const inst of part.instances) if (mounted[inst.id]) n++
  return n
}

export function isPartComplete(mounted: Record<string, MountRecord>, part: PartDef): boolean {
  return mountedCount(mounted, part) === part.count
}

/** 선행 부품이 전부 장착됐고 자신은 아직 남아 있는 부품 */
export function isPartAvailable(mounted: Record<string, MountRecord>, part: PartDef): boolean {
  if (isPartComplete(mounted, part)) return false
  return part.requires.every((id) => isPartComplete(mounted, PART_BY_ID[id]))
}

export function availableParts(mounted: Record<string, MountRecord>): PartDef[] {
  return PARTS.filter((p) => isPartAvailable(mounted, p))
}

export function isAssemblyComplete(mounted: Record<string, MountRecord>): boolean {
  return PARTS.every((p) => isPartComplete(mounted, p))
}

/** 장착 후 이 부품에 의존하는 부품이 하나라도 장착됐으면 되돌릴 수 없다 — history 순서로 보장 */
let sequenceTimer: ReturnType<typeof setTimeout> | null = null

function clearSequence() {
  if (sequenceTimer) {
    clearTimeout(sequenceTimer)
    sequenceTimer = null
  }
}

/** 다음에 장착할 부품 (선행 조건이 갖춰진 첫 부품) */
export function nextAvailablePartId(mounted: Record<string, MountRecord>): string | null {
  return availableParts(mounted)[0]?.id ?? null
}

export const useAssembly = create<AssemblyState>((set, get) => ({
  mounted: {},
  history: [],
  selectedPartId: nextAvailablePartId({}),
  phase: 'assembly',
  phaseAt: 0,
  lastMount: null,
  dragging: false,
  dragTarget: null,
  sequencing: false,

  selectPart: (partId) => {
    if (partId === null) {
      set({ selectedPartId: null })
      return
    }
    const part = PART_BY_ID[partId]
    if (!part || !isPartAvailable(get().mounted, part)) return
    set({ selectedPartId: partId })
  },

  mount: (instanceId, from) => {
    const state = get()
    if (state.phase !== 'assembly') return false
    if (state.mounted[instanceId]) return false
    const part = partOfInstance(instanceId)
    if (!isPartAvailable(state.mounted, part)) return false

    const record: MountRecord = from ? { instanceId, at: now(), from } : { instanceId, at: now() }
    const mounted = { ...state.mounted, [instanceId]: record }
    const history = [...state.history, instanceId]
    const complete = isPartComplete(mounted, part)
    const allDone = isAssemblyComplete(mounted)
    set({
      mounted,
      history,
      lastMount: { partId: part.id, at: now() },
      // 부품 하나가 끝나면 다음 부품을 바로 고른다. 빈 씬을 만들지 않는다.
      selectedPartId: complete ? nextAvailablePartId(mounted) : state.selectedPartId,
      phase: allDone ? 'complete' : 'assembly',
      phaseAt: allDone ? now() : state.phaseAt,
    })
    return true
  },

  mountAll: (partId, intervalMs = 20) => {
    const part = PART_BY_ID[partId]
    if (!part || get().sequencing) return
    const remaining = part.instances
      .filter((i) => !get().mounted[i.id])
      .sort((a, b) => a.order - b.order)
    if (remaining.length === 0) return
    set({ sequencing: true })
    let idx = 0
    const step = () => {
      if (idx >= remaining.length || get().phase !== 'assembly') {
        sequenceTimer = null
        set({ sequencing: false })
        return
      }
      get().mount(remaining[idx].id)
      idx++
      sequenceTimer = setTimeout(step, intervalMs)
    }
    step()
  },

  undo: () => {
    const state = get()
    if (state.phase !== 'assembly' && state.phase !== 'complete') return
    if (state.sequencing) clearSequence()
    const last = state.history[state.history.length - 1]
    if (!last) return
    const mounted = { ...state.mounted }
    delete mounted[last]
    const part = partOfInstance(last)
    set({
      mounted,
      history: state.history.slice(0, -1),
      selectedPartId: part.id,
      phase: 'assembly',
      sequencing: false,
      lastMount: null,
    })
  },

  setDragging: (dragging) => set({ dragging }),
  setDragTarget: (dragTarget) => {
    if (get().dragTarget !== dragTarget) set({ dragTarget })
  },

  plugCable: () => {
    if (get().phase !== 'complete') return
    set({ phase: 'plugging', phaseAt: now(), selectedPartId: null })
  },

  setPhase: (phase) => set({ phase, phaseAt: now() }),

  reset: () => {
    clearSequence()
    set({
      mounted: {},
      history: [],
      selectedPartId: nextAvailablePartId({}),
      phase: 'assembly',
      phaseAt: now(),
      lastMount: null,
      dragging: false,
      dragTarget: null,
      sequencing: false,
    })
  },
}))

// 개발 중 브라우저 콘솔에서 상태를 만질 수 있게 한다. 프로덕션 번들에는 들어가지 않는다.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as { __assembly?: typeof useAssembly }).__assembly = useAssembly
}
