import { useFrame } from '@react-three/fiber'
import { useAssembly } from '../context'
import { ghostHoverMaterial, ghostMaterial } from '../materials'
import { PartGeometry } from '../geometry/PartGeometry'
import { MM, type PartDef, type PartInstance } from '../types'

// 선택한 부품의 아직 장착되지 않은 인스턴스를 장착 위치에 반투명으로 보여준다.
// 장착은 DraggablePart가 한다. 여기서는 놓으면 장착될 자리만 밝힌다.
// 고스트 재질은 깊이 검사를 끄고 천천히 맥동하므로 다른 부품 안쪽이나 뒤에 있어도 보인다.

export function GhostSet({ part }: { part: PartDef }) {
  const mounted = useAssembly((s) => s.mounted)
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime()
    const pulse = 0.5 + 0.5 * Math.sin(t * 4)
    ghostMaterial.opacity = 0.3 + 0.3 * pulse
  })
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
