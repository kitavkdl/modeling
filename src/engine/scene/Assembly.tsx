import { useAssembly, useProduct } from '../context'
import type { PartDef } from '../types'
import { GhostSet } from './Ghosts'
import { MountedInstanceView } from './MountedParts'
import { Props, StationGroup } from './Stations'

/** 장착된 부품 전부 + 선택 부품의 고스트. 작업대 부품은 결합 전까지 작업대 오프셋에 떠 있다. */
export function Assembly() {
  const product = useProduct()
  const selectedPartId = useAssembly((s) => s.selectedPartId)
  const selected = selectedPartId ? product.parts.find((p) => p.id === selectedPartId) ?? null : null
  const free = product.parts.filter((p) => !p.station && !p.hidden)
  return (
    <group>
      <Props />
      <group>
        {free.map((p) => (
          <MountedPart key={p.id} part={p} />
        ))}
        {selected && !selected.station && !selected.hidden ? <GhostSet part={selected} /> : null}
      </group>
      {product.stations.map((st) => (
        <StationGroup key={st.id} station={st}>
          {product.parts
            .filter((p) => p.station === st.id && !p.hidden)
            .map((p) => (
              <MountedPart key={p.id} part={p} />
            ))}
          {selected && selected.station === st.id && !selected.hidden ? <GhostSet part={selected} /> : null}
        </StationGroup>
      ))}
    </group>
  )
}

function MountedPart({ part }: { part: PartDef }) {
  const mounted = useAssembly((s) => s.mounted)
  return (
    <>
      {part.instances.map((inst) => {
        const rec = mounted[inst.id]
        return rec ? <MountedInstanceView key={inst.id} part={part} inst={inst} record={rec} /> : null
      })}
    </>
  )
}
