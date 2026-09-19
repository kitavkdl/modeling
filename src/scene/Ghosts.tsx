import { useCallback, useEffect, useState } from 'react'
import type { ThreeEvent } from '@react-three/fiber'
import { MM, type PartDef, type PartInstance } from '../data/parts'
import { useAssembly } from '../store/assembly'
import { PartGeometry } from './PartGeometry'
import { ghostHoverMaterial, ghostMaterial } from './materials'
import { cancelCameraTween, setControlsEnabled } from './controlsRef'

// 선택한 부품의 아직 장착되지 않은 인스턴스를 장착 위치에 반투명으로 보여준다.
// 클릭(또는 페인팅 드래그)으로 장착한다.

export function GhostSet({ part }: { part: PartDef }) {
  const mounted = useAssembly((s) => s.mounted)
  const setPainting = useAssembly((s) => s.setPainting)

  useEffect(() => {
    const up = () => {
      setPainting(false)
      setControlsEnabled(true)
    }
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      setPainting(false)
    }
  }, [setPainting])

  return (
    <group>
      {part.instances.map((inst) =>
        mounted[inst.id] ? null : <Ghost key={inst.id} part={part} inst={inst} />,
      )}
    </group>
  )
}

function Ghost({ part, inst }: { part: PartDef; inst: PartInstance }) {
  const [hover, setHover] = useState(false)

  const onPointerDown = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (e.button !== 0) return
      e.stopPropagation()
      const s = useAssembly.getState()
      if (s.mode === 'all' && part.count > 1) {
        s.mountAll(part.id)
        return
      }
      if (s.mode === 'paint' && part.count > 1) {
        setControlsEnabled(false)
        cancelCameraTween()
        s.setPainting(true)
      }
      s.mount(inst.id)
    },
    [part, inst],
  )

  const onPointerEnter = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation()
      setHover(true)
      const s = useAssembly.getState()
      if (s.painting && s.mode === 'paint') s.mount(inst.id)
    },
    [inst],
  )

  const onPointerLeave = useCallback(() => setHover(false), [])

  useEffect(() => {
    document.body.style.cursor = hover ? 'pointer' : ''
    return () => {
      document.body.style.cursor = ''
    }
  }, [hover])

  const p = inst.mountPosition
  const r = inst.mountRotation
  return (
    <group
      position={[p[0] * MM, p[1] * MM, p[2] * MM]}
      rotation={[r[0], r[1], r[2]]}
      onPointerDown={onPointerDown}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      <PartGeometry geometry={inst.geometry} material={hover ? ghostHoverMaterial : ghostMaterial} simple />
    </group>
  )
}
