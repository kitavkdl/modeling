import { useEffect } from 'react'
import { PARTS, PART_BY_ID } from '../data/parts'
import { isPartComplete, type MountMode, useAssembly } from '../store/assembly'

const MODES: Array<{ id: MountMode; label: string }> = [
  { id: 'single', label: '개별 클릭' },
  { id: 'paint', label: '드래그 페인팅' },
  { id: 'all', label: '전부 장착' },
]

function hintFor(): string {
  const s = useAssembly.getState()
  switch (s.phase) {
    case 'complete':
      return '케이블 연결'
    case 'plugging':
    case 'still':
      return ''
    case 'booting':
      return ''
    case 'on':
      return '키캡 타건'
    default: {
      if (s.selectedPartId) return PART_BY_ID[s.selectedPartId].hint
      const next = PARTS.find((p) => !isPartComplete(s.mounted, p))
      return next ? `${next.nameKo} 선택` : ''
    }
  }
}

export function Hud() {
  const mounted = useAssembly((s) => s.mounted)
  const phase = useAssembly((s) => s.phase)
  const mode = useAssembly((s) => s.mode)
  const setMode = useAssembly((s) => s.setMode)
  const undo = useAssembly((s) => s.undo)
  const reset = useAssembly((s) => s.reset)
  const history = useAssembly((s) => s.history)
  const selectedPartId = useAssembly((s) => s.selectedPartId)
  const mountAll = useAssembly((s) => s.mountAll)
  const sequencing = useAssembly((s) => s.sequencing)

  const doneCount = PARTS.filter((p) => isPartComplete(mounted, p)).length
  const canUndo = history.length > 0 && (phase === 'assembly' || phase === 'complete')
  const selected = selectedPartId ? PART_BY_ID[selectedPartId] : null
  const showMountAll = selected && selected.count > 1 && mode === 'all'

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
        <div className="hud-title">SPM PEBBLE 75</div>
        <div className="hud-sub">조약돌75 조립 · 프로토타입 v0</div>
        <div className="hud-step">
          {String(doneCount).padStart(2, '0')} / {String(PARTS.length).padStart(2, '0')}
        </div>
      </div>

      <div className="hud hud-tr">
        <div className="segmented">
          {MODES.map((m) => (
            <button key={m.id} className={mode === m.id ? 'is-on' : ''} onClick={() => setMode(m.id)}>
              {m.label}
            </button>
          ))}
        </div>
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
        <span className="hint-text">{hintFor()}</span>
        {showMountAll ? (
          <button className="btn btn-primary" disabled={sequencing} onClick={() => mountAll(selected.id)}>
            {selected.nameKo} 전부 장착
          </button>
        ) : null}
      </div>
    </>
  )
}
