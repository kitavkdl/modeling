import { useEffect } from 'react'
import { useAssembly, useProduct } from '../context'
import { canSkip, isPartComplete } from '../store'
import { VariantPicker } from './VariantPicker'

const FOCUSED_INPUT_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return FOCUSED_INPUT_TAGS.has(target.tagName) || target.isContentEditable
}

function useHint(): string {
  const product = useProduct()
  const phase = useAssembly((s) => s.phase)
  const selectedPartId = useAssembly((s) => s.selectedPartId)
  const mounted = useAssembly((s) => s.mounted)
  if (phase !== 'assembly') return product.hints[phase] ?? ''
  if (selectedPartId) return product.parts.find((p) => p.id === selectedPartId)?.hint ?? ''
  const next = product.parts.find((p) => !isPartComplete(mounted, p))
  return next ? `${next.nameKo} 선택` : ''
}

export function Hud({ onBack }: { onBack: () => void }) {
  const product = useProduct()
  const mounted = useAssembly((s) => s.mounted)
  const phase = useAssembly((s) => s.phase)
  const undo = useAssembly((s) => s.undo)
  const reset = useAssembly((s) => s.reset)
  const history = useAssembly((s) => s.history)
  const selectedPartId = useAssembly((s) => s.selectedPartId)
  const skipCurrent = useAssembly((s) => s.skipCurrent)
  const advancePhase = useAssembly((s) => s.advancePhase)
  const skippable = useAssembly((s) => canSkip(s))
  const hint = useHint()

  const doneCount = product.parts.filter((p) => isPartComplete(mounted, p)).length
  const canUndo = history.length > 0 && (phase === 'assembly' || phase === 'complete')
  const selected = selectedPartId ? product.parts.find((p) => p.id === selectedPartId) ?? null : null

  const seq = product.phasesAfterComplete
  const lastPhase = seq[seq.length - 1]
  // assembly에서는 부품 건너뛰기, complete 및 그 뒤 단계(마지막 단계 제외)에서는 단계 건너뛰기
  const phaseSkippable = phase !== 'assembly' && phase !== lastPhase
  const onSkip = () => (phase === 'assembly' ? skipCurrent() : advancePhase())
  const showSkip = phase === 'assembly' ? skippable : phaseSkippable

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        undo()
      } else if (e.key === 'Enter' && showSkip) {
        e.preventDefault()
        onSkip()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, showSkip, onSkip])

  return (
    <>
      <div className="hud hud-tl">
        <div className="hud-title">{product.nameEn.toUpperCase()}</div>
        <div className="hud-sub">
          {product.nameKo} · {product.subtitle}
        </div>
        <div className="hud-step">
          {String(doneCount).padStart(2, '0')} / {String(product.parts.length).padStart(2, '0')}
        </div>
        <button className="btn btn-quiet hud-back" onClick={onBack}>
          모델 선택
        </button>
      </div>

      <div className="hud hud-tr">
        <div className="hud-actions">
          <button className="btn" disabled={!canUndo} onClick={undo} title="Ctrl+Z">
            실행 취소
          </button>
          <button className="btn btn-quiet" onClick={reset}>
            초기화
          </button>
        </div>
      </div>

      <div className="hud hud-hint">
        <span className="hint-text">{hint}</span>
        {selected && selected.variants ? (
          <VariantPicker part={selected} />
        ) : showSkip ? (
          <button className="btn" onClick={onSkip} title="Enter">건너뛰기</button>
        ) : null}
      </div>

      {product.hudExtra ? (
        <div className="hud hud-extra">
          <product.hudExtra />
        </div>
      ) : null}
    </>
  )
}
