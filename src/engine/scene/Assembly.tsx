import { useAssembly, useProduct } from '../context'
import { isAssemblyHidden, visibleParts } from '../store'
import type { PartDef } from '../types'
import { GhostSet } from './Ghosts'
import { MountedInstanceView } from './MountedParts'
import { Props, StationGroup } from './Stations'

/**
 * 장착된 부품 전부 + 선택 부품의 고스트. 작업대 부품은 결합 전까지 작업대 오프셋에 떠 있다.
 * 제품이 assemblyHidden으로 숨기라고 하면 장착 부품과 소품을 빼고, 고스트와 alwaysVisibleParts는
 * 그대로 그린다 — 그 자리에 제품이 다른 것(실물 모델)을 그리는 중이고, 남은 부품은 거기에 꽂는다.
 */
export function Assembly() {
  const product = useProduct()
  const selectedPartId = useAssembly((s) => s.selectedPartId)
  const hidden = useAssembly((s) => isAssemblyHidden(product, s))
  const selected = selectedPartId ? product.parts.find((p) => p.id === selectedPartId) ?? null : null
  const free = visibleParts(product, product.parts.filter((p) => !p.station && !p.hidden), hidden)
  return (
    <group>
      {hidden ? null : <Props />}
      <group>
        {free.map((p) => (
          <MountedPart key={p.id} part={p} />
        ))}
        {selected && !selected.station && !selected.hidden ? <GhostSet part={selected} /> : null}
      </group>
      {product.stations.map((st) => (
        <StationGroup key={st.id} station={st}>
          {visibleParts(product, product.parts.filter((p) => p.station === st.id && !p.hidden), hidden).map((p) => (
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
