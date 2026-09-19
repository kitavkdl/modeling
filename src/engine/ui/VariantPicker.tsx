import { useAssemblyStore } from '../context'
import type { PartDef } from '../types'

export function VariantPicker({ part }: { part: PartDef }) {
  const store = useAssemblyStore()
  if (!part.variants) return null
  return (
    <div className="variants">
      {part.variants.map((v) => (
        <button key={v.id} className="variant" onClick={() => store.getState().mount(part.instances[0].id, undefined, v.id)}>
          <span className="variant-swatch" style={{ background: v.swatch }} />
          <span className="variant-label">{v.label}</span>
        </button>
      ))}
    </div>
  )
}
