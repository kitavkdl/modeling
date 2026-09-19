import type { ProductDef } from '../engine/types'

export function ModelSelect({ products, onSelect }: { products: ProductDef[]; onSelect: (p: ProductDef) => void }) {
  return (
    <div className="select">
      <div className="select-head">MODEL</div>
      <div className="select-grid">
        {products.map((p) => (
          <button key={p.id} className="select-card" onClick={() => onSelect(p)}>
            <span className="select-en">{p.nameEn}</span>
            <span className="select-ko">{p.nameKo}</span>
            <span className="select-meta">{p.subtitle} · 부품 {p.parts.length}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
