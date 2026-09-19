import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { PartDef } from '../engine/types'
import { ASSEMBLY_LIFT, MM, PARTS, PART_BY_ID } from '../products/keyboard/parts'
import { useAssembly } from '../store/assembly'
import { easeOutBack, lerp } from '../utils/easing'
import { GhostSet } from '../engine/scene/Ghosts'
import { MOUNT_MS, MountedInstanceView } from '../engine/scene/MountedParts'

const SEAT_PART_ID = PARTS.find((p) => p.marries === 'sandwich')?.id ?? 'gasket'

/** 장착된 부품 전부 + 선택 부품의 고스트. 샌드위치는 안착 전까지 떠 있다. */
export function Keyboard() {
  const selectedPartId = useAssembly((s) => s.selectedPartId)
  const selected = selectedPartId ? PART_BY_ID[selectedPartId] : null
  const fixedParts = PARTS.filter((p) => p.station !== 'sandwich')
  const liftedParts = PARTS.filter((p) => p.station === 'sandwich')

  return (
    <group>
      <group>
        {fixedParts.map((p) => (
          <MountedPart key={p.id} part={p} />
        ))}
        {selected && selected.station !== 'sandwich' ? <GhostSet part={selected} /> : null}
      </group>
      <LiftedGroup>
        {liftedParts.map((p) => (
          <MountedPart key={p.id} part={p} />
        ))}
        {selected && selected.station === 'sandwich' ? <GhostSet part={selected} /> : null}
      </LiftedGroup>
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

/** 안착 부품이 장착되면 ASSEMBLY_LIFT → 0 으로 내려앉는다. 되돌리면 다시 떠오른다. */
function LiftedGroup({ children }: { children: React.ReactNode }) {
  const group = useRef<THREE.Group>(null)
  const seated = useAssembly((s) => Boolean(s.mounted[SEAT_PART_ID]))
  const anim = useRef({ from: ASSEMBLY_LIFT, to: ASSEMBLY_LIFT, start: 0 })

  useEffect(() => {
    const cur = group.current ? group.current.position.y / MM : anim.current.to
    anim.current = { from: cur, to: seated ? 0 : ASSEMBLY_LIFT, start: performance.now() }
  }, [seated])

  useFrame(() => {
    const g = group.current
    if (!g) return
    const a = anim.current
    const t = (performance.now() - a.start) / MOUNT_MS
    const y = t >= 1 ? a.to : lerp(a.from, a.to, easeOutBack(t, 1.4))
    g.position.y = y * MM
  })

  return (
    <group ref={group} position={[0, ASSEMBLY_LIFT * MM, 0]}>
      {children}
    </group>
  )
}
