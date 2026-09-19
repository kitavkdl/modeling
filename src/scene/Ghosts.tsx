import { MM, type PartDef, type PartInstance } from '../data/parts'
import { useAssembly } from '../store/assembly'
import { PartGeometry } from './PartGeometry'
import { ghostHoverMaterial, ghostMaterial } from './materials'

// 선택한 부품의 아직 장착되지 않은 인스턴스를 장착 위치에 반투명으로 보여준다.
// 장착은 DraggablePart가 한다. 여기서는 놓으면 장착될 자리만 밝힌다.

export function GhostSet({ part }: { part: PartDef }) {
  const mounted = useAssembly((s) => s.mounted)
  return (
    <group>
      {part.instances.map((inst) => (mounted[inst.id] ? null : <Ghost key={inst.id} inst={inst} />))}
    </group>
  )
}

function Ghost({ inst }: { inst: PartInstance }) {
  const targeted = useAssembly((s) => s.dragTarget === inst.id)
  const p = inst.mountPosition
  const r = inst.mountRotation
  return (
    <group position={[p[0] * MM, p[1] * MM, p[2] * MM]} rotation={[r[0], r[1], r[2]]}>
      <PartGeometry geometry={inst.geometry} material={targeted ? ghostHoverMaterial : ghostMaterial} simple />
    </group>
  )
}
