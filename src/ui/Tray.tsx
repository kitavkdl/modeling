import { PARTS } from '../products/keyboard/parts'
import { isPartAvailable, isPartComplete, mountedCount, useAssembly } from '../store/assembly'

/** 화면 하단 부품 트레이. 장착 가능한 부품만 활성. */
export function Tray() {
  const mounted = useAssembly((s) => s.mounted)
  const selectedPartId = useAssembly((s) => s.selectedPartId)
  const selectPart = useAssembly((s) => s.selectPart)
  const phase = useAssembly((s) => s.phase)
  const locked = phase !== 'assembly'

  return (
    <div className="tray">
      {PARTS.map((p, i) => {
        const done = isPartComplete(mounted, p)
        const available = !locked && isPartAvailable(mounted, p)
        const selected = selectedPartId === p.id
        const n = mountedCount(mounted, p)
        const cls = ['tray-item', done && 'is-done', available && 'is-available', selected && 'is-selected']
          .filter(Boolean)
          .join(' ')
        return (
          <button
            key={p.id}
            className={cls}
            disabled={!available}
            onClick={() => selectPart(selected ? null : p.id)}
          >
            <span className="tray-index">{String(i + 1).padStart(2, '0')}</span>
            <span className="tray-en">{p.nameEn}</span>
            <span className="tray-ko">{p.nameKo}</span>
            {p.count > 1 ? (
              <span className="tray-count">
                {n} / {p.count}
              </span>
            ) : (
              <span className="tray-count">{done ? '장착' : '—'}</span>
            )}
            {p.count > 1 ? (
              <span className="tray-bar">
                <span style={{ width: `${(n / p.count) * 100}%` }} />
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
