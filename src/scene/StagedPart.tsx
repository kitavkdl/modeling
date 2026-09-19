import { MM, PART_BY_ID } from '../data/parts'
import { useAssembly } from '../store/assembly'
import { PartGeometry } from './PartGeometry'
import { materialFor } from './materials'

/** 트레이에서 고른 부품의 실물을 대기 위치(restPosition)에 보여준다. 다수 부품은 대표 1개. */
export function StagedPart() {
  const selectedPartId = useAssembly((s) => s.selectedPartId)
  if (!selectedPartId) return null
  const part = PART_BY_ID[selectedPartId]
  const r = part.restPosition
  return (
    <group position={[r[0] * MM, r[1] * MM, r[2] * MM]}>
      <PartGeometry geometry={part.geometry} material={materialFor(part.material)} />
    </group>
  )
}
