import { useEffect } from 'react'
import { useAssembly, useProduct } from '../context'
import { isPartComplete } from '../store'
import { VariantPicker } from './VariantPicker'

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
  const mountAll = useAssembly((s) => s.mountAll)
  const sequencing = useAssembly((s) => s.sequencing)
  const hint = useHint()

  const doneCount = product.parts.filter((p) => isPartComplete(mounted, p)).length
  const canUndo = history.length > 0 && (phase === 'assembly' || phase === 'complete')
  const selected = selectedPartId ? product.parts.find((p) => p.id === selectedPartId) ?? null : null
  const showMountAll = selected && selected.count > 1 && !selected.variants

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        undo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo])

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
        ) : showMountAll ? (
          <button className="btn" disabled={sequencing} onClick={() => mountAll(selected.id)}>
            전부 장착
          </button>
        ) : null}
      </div>
    </>
  )
}
