import { useEffect, useRef } from 'react'
import { useAssembly, useProduct } from '../context'
import { isPartAvailable, isPartComplete, mountedCount } from '../store'

/** 화면 하단 부품 트레이. 장착 가능한 부품만 활성. */
export function Tray() {
  const product = useProduct()
  const parts = product.parts
  const mounted = useAssembly((s) => s.mounted)
  const selectedPartId = useAssembly((s) => s.selectedPartId)
  const selectPart = useAssembly((s) => s.selectPart)
  const phase = useAssembly((s) => s.phase)
  const locked = phase !== 'assembly'
  const selectedRef = useRef<HTMLButtonElement | null>(null)

  const cols = parts.length <= 10 ? parts.length : 10

  useEffect(() => {
    const el = selectedRef.current
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ inline: 'center', block: 'nearest' })
    }
  }, [selectedPartId])

  return (
    <div
      className="tray"
      style={
        parts.length <= 10
          ? { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }
          : { gridTemplateColumns: 'none', gridAutoFlow: 'column', gridAutoColumns: 'minmax(120px, 1fr)', overflowX: 'auto' }
      }
    >
      {parts.map((p, i) => {
        const done = isPartComplete(mounted, p)
        const available = !locked && isPartAvailable(product, mounted, p)
        const selected = selectedPartId === p.id
        const n = mountedCount(mounted, p)
        const cls = ['tray-item', done && 'is-done', available && 'is-available', selected && 'is-selected']
          .filter(Boolean)
          .join(' ')
        return (
          <button
            key={p.id}
            ref={selected ? selectedRef : undefined}
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
