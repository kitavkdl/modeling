import { useFrame } from '@react-three/fiber'
import { useAssembly, useProduct } from '../context'
import { ghostHoverMaterial, ghostMaterial, snapRingMaterial } from '../materials'
import { PartGeometry } from '../geometry/PartGeometry'
import { MM, type PartDef, type PartInstance } from '../types'

// 선택한 부품의 아직 장착되지 않은 인스턴스를 장착 위치에 반투명으로 보여준다.
// 장착은 DraggablePart가 한다. 여기서는 놓으면 장착될 자리만 밝힌다.
// 고스트 재질은 깊이 검사를 끄므로 다른 부품 안쪽이나 뒤에 있어도 보인다.
// 인스턴스가 적은 부품(스냅 장착)은 스냅 반경 링을 함께 그려, 액슬처럼 가는 부품도 자리를 찾을 수 있게 한다.

const RING_MAX_INSTANCES = 4

export function GhostSet({ part }: { part: PartDef }) {
  const mounted = useAssembly((s) => s.mounted)
  const showRing = part.instances.length <= RING_MAX_INSTANCES
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime()
    const pulse = 0.5 + 0.5 * Math.sin(t * 4)
    ghostMaterial.opacity = 0.3 + 0.3 * pulse
    snapRingMaterial.opacity = 0.2 + 0.25 * pulse
  })
  return (
    <group>
      {part.instances.map((inst) => (mounted[inst.id] ? null : <Ghost key={inst.id} inst={inst} ring={showRing} />))}
    </group>
  )
}

function Ghost({ inst, ring }: { inst: PartInstance; ring: boolean }) {
  const targeted = useAssembly((s) => s.dragTarget === inst.id)
  const snap = useProduct().drag.snapMm * MM
  const p = inst.mountPosition
  const r = inst.mountRotation
  return (
    <group position={[p[0] * MM, p[1] * MM, p[2] * MM]}>
      <group rotation={[r[0], r[1], r[2]]}>
        <PartGeometry geometry={inst.geometry} material={targeted ? ghostHoverMaterial : ghostMaterial} simple />
      </group>
      {ring ? (
        <mesh rotation={[-Math.PI / 2, 0, 0]} material={targeted ? ghostHoverMaterial : snapRingMaterial} renderOrder={5}>
          <ringGeometry args={[snap * 0.9, snap, 48]} />
        </mesh>
      ) : null}
    </group>
  )
}
