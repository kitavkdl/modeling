import { createStore, type StoreApi } from 'zustand/vanilla'
import type { MountRecord, PartDef, PartInstance, Phase, ProductDef, Vec3 } from './types'

export type Mounted = Record<string, MountRecord>

export interface AssemblyState {
  product: ProductDef
  mounted: Mounted
  history: string[]
  selectedPartId: string | null
  phase: Phase
  phaseAt: number
  lastMount: { partId: string; at: number } | null
  dragging: boolean
  dragTarget: string | null
  sequencing: boolean

  selectPart: (partId: string | null) => void
  mount: (instanceId: string, from?: Vec3, variantId?: string) => boolean
  mountAll: (partId: string, intervalMs?: number, from?: Vec3) => void
  skipCurrent: () => void
  undo: () => void
  setDragging: (v: boolean) => void
  setDragTarget: (id: string | null) => void
  /** complete → phasesAfterComplete[0] → ... 마지막에서 멈춘다 */
  advancePhase: () => void
  reset: () => void
}

export type AssemblyStore = StoreApi<AssemblyState>

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

// --- 순수 도우미 --------------------------------------------------------------

export function partOf(product: ProductDef, instanceId: string): PartDef {
  const partId = instanceId.split(':')[0]
  const part = product.parts.find((p) => p.id === partId)
  if (!part) throw new Error(`unknown instance ${instanceId}`)
  return part
}

export function instanceOf(product: ProductDef, instanceId: string): PartInstance {
  const inst = partOf(product, instanceId).instances.find((i) => i.id === instanceId)
  if (!inst) throw new Error(`unknown instance ${instanceId}`)
  return inst
}

export function mountedCount(mounted: Mounted, part: PartDef): number {
  let n = 0
  for (const inst of part.instances) if (mounted[inst.id]) n++
  return n
}

export function isPartComplete(mounted: Mounted, part: PartDef): boolean {
  return mountedCount(mounted, part) === part.count
}

export function isPartAvailable(product: ProductDef, mounted: Mounted, part: PartDef): boolean {
  if (isPartComplete(mounted, part)) return false
  return part.requires.every((id) => {
    const req = product.parts.find((p) => p.id === id)
    return req ? isPartComplete(mounted, req) : false
  })
}

export function availableParts(product: ProductDef, mounted: Mounted): PartDef[] {
  return product.parts.filter((p) => isPartAvailable(product, mounted, p))
}

export function isAssemblyComplete(product: ProductDef, mounted: Mounted): boolean {
  return product.parts.every((p) => isPartComplete(mounted, p))
}

export function nextAvailablePartId(product: ProductDef, mounted: Mounted): string | null {
  return availableParts(product, mounted)[0]?.id ?? null
}

/** 결합 부품(marries === stationId)이 전부 장착됐는가 */
export function isStationSeated(product: ProductDef, mounted: Mounted, stationId: string): boolean {
  const marry = product.parts.filter((p) => p.marries === stationId)
  if (marry.length === 0) return true
  return marry.every((p) => isPartComplete(mounted, p))
}

/** 부품이 작업대 소속이고 아직 결합 전이면 작업대 오프셋, 아니면 0 */
export function stationOffset(product: ProductDef, part: PartDef, mounted: Mounted): Vec3 {
  if (!part.station) return [0, 0, 0]
  if (isStationSeated(product, mounted, part.station)) return [0, 0, 0]
  const st = product.stations.find((s) => s.id === part.station)
  return st ? st.offset : [0, 0, 0]
}

/**
 * 제품 정의 자체의 앞뒤가 맞는지 검사한다 (다음 제품 추가 전 안전장치).
 * 문제를 사람이 읽을 문자열 목록으로 돌려준다. 비어 있으면 문제 없음.
 */
export function validateProduct(product: ProductDef): string[] {
  const out: string[] = []
  const stationIds = new Set(product.stations.map((s) => s.id))
  const partIds = new Set(product.parts.map((p) => p.id))

  for (const part of product.parts) {
    if (part.station && !stationIds.has(part.station)) {
      out.push(`part "${part.id}" references unknown station "${part.station}"`)
    }
    for (const req of part.requires) {
      if (!partIds.has(req)) {
        out.push(`part "${part.id}" requires unknown part "${req}"`)
      }
    }
    if (part.variants && part.count !== 1) {
      out.push(`part "${part.id}" has variants but count is ${part.count} (expected 1)`)
    }
  }

  for (const station of product.stations) {
    const hasParts = product.parts.some((p) => p.station === station.id)
    const isMarried = product.parts.some((p) => p.marries === station.id)
    if (hasParts && !isMarried) {
      out.push(`station "${station.id}" has parts but no part marries it`)
    }
  }

  return out
}

function initialMounted(product: ProductDef): Mounted {
  const m: Mounted = {}
  const t = now()
  for (const p of product.parts) {
    if (!p.preplaced) continue
    for (const inst of p.instances) m[inst.id] = { instanceId: inst.id, at: t - 10_000 }
  }
  return m
}

// --- 스토어 -----------------------------------------------------------------

export function createAssemblyStore(product: ProductDef): AssemblyStore {
  let sequenceTimer: ReturnType<typeof setTimeout> | null = null
  const clearSequence = () => {
    if (sequenceTimer) clearTimeout(sequenceTimer)
    sequenceTimer = null
  }

  return createStore<AssemblyState>((set, get) => ({
    product,
    mounted: initialMounted(product),
    history: [],
    selectedPartId: nextAvailablePartId(product, initialMounted(product)),
    phase: 'assembly',
    phaseAt: 0,
    lastMount: null,
    dragging: false,
    dragTarget: null,
    sequencing: false,

    selectPart: (partId) => {
      if (partId === null) return set({ selectedPartId: null })
      const part = product.parts.find((p) => p.id === partId)
      if (!part || !isPartAvailable(product, get().mounted, part)) return
      set({ selectedPartId: partId })
    },

    mount: (instanceId, from, variantId) => {
      const state = get()
      if (state.phase !== 'assembly') return false
      if (state.mounted[instanceId]) return false
      const part = partOf(product, instanceId)
      if (!isPartAvailable(product, state.mounted, part)) return false
      if (part.variants) {
        if (!variantId || !part.variants.some((v) => v.id === variantId)) return false
      }
      const record: MountRecord = { instanceId, at: now() }
      if (from) record.from = from
      if (variantId) record.variant = variantId
      const mounted = { ...state.mounted, [instanceId]: record }
      const complete = isPartComplete(mounted, part)
      const allDone = isAssemblyComplete(product, mounted)
      set({
        mounted,
        history: [...state.history, instanceId],
        lastMount: { partId: part.id, at: now() },
        selectedPartId: complete ? nextAvailablePartId(product, mounted) : state.selectedPartId,
        phase: allDone ? (part.phaseOnMount ?? 'complete') : 'assembly',
        phaseAt: allDone ? now() : state.phaseAt,
      })
      return true
    },

    mountAll: (partId, intervalMs = 20, from?: Vec3) => {
      const part = product.parts.find((p) => p.id === partId)
      if (!part || get().sequencing || part.variants) return
      const remaining = part.instances.filter((i) => !get().mounted[i.id]).sort((a, b) => a.order - b.order)
      if (remaining.length === 0) return
      set({ sequencing: true })
      let idx = 0
      const step = () => {
        if (idx >= remaining.length || get().phase !== 'assembly') {
          sequenceTimer = null
          set({ sequencing: false })
          return
        }
        get().mount(remaining[idx].id, from)
        idx++
        sequenceTimer = setTimeout(step, intervalMs)
      }
      step()
    },

    skipCurrent: () => {
      const { selectedPartId, sequencing, phase } = get()
      if (!selectedPartId || sequencing || phase !== 'assembly') return
      const part = product.parts.find((p) => p.id === selectedPartId)
      if (!part || part.variants) return
      get().mountAll(part.id, 20, part.restPosition)
    },

    undo: () => {
      const state = get()
      const last = state.history[state.history.length - 1]
      const lastPart = last ? partOf(product, last) : null
      const allowed =
        state.phase === 'assembly' ||
        state.phase === 'complete' ||
        (lastPart?.phaseOnMount !== undefined && state.phase === lastPart.phaseOnMount)
      if (!allowed || !last) return
      if (state.sequencing) clearSequence()
      const mounted = { ...state.mounted }
      delete mounted[last]
      set({
        mounted,
        history: state.history.slice(0, -1),
        selectedPartId: partOf(product, last).id,
        phase: 'assembly',
        sequencing: false,
        lastMount: null,
      })
    },

    setDragging: (dragging) => set({ dragging }),
    setDragTarget: (dragTarget) => {
      if (get().dragTarget !== dragTarget) set({ dragTarget })
    },

    advancePhase: () => {
      const { phase } = get()
      const seq = product.phasesAfterComplete
      if (phase === 'assembly') return
      const next = phase === 'complete' ? seq[0] : seq[seq.indexOf(phase) + 1]
      if (!next) return
      set({ phase: next, phaseAt: now(), selectedPartId: null })
    },

    reset: () => {
      clearSequence()
      const mounted = initialMounted(product)
      set({
        mounted,
        history: [],
        selectedPartId: nextAvailablePartId(product, mounted),
        phase: 'assembly',
        phaseAt: now(),
        lastMount: null,
        dragging: false,
        dragTarget: null,
        sequencing: false,
      })
    },
  }))
}

export const canSkip = (s: Pick<AssemblyState, 'selectedPartId' | 'sequencing' | 'phase' | 'product'>): boolean =>
  s.phase === 'assembly' &&
  !s.sequencing &&
  !!s.selectedPartId &&
  !s.product.parts.find((p) => p.id === s.selectedPartId)?.variants
