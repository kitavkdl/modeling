import { useEffect, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { useAssembly, useMaterials } from '../../../engine/context'
import { PartGeometry } from '../../../engine/geometry/PartGeometry'
import type { RenderInstanceCtx } from '../../../engine/types'
import { paintMaterialName } from '../materials'
import { paintRank } from '../parts'

export const PAINT_STEP_MS = 150

/** 프라이머로 장착됐다가 도색 기록이 생기면 앞에서 뒤로 순서대로 색이 입혀진다 */
export function Paintable({ part, inst }: RenderInstanceCtx) {
  const materials = useMaterials()
  const paint = useAssembly((s) => s.mounted.paint)
  const [painted, setPainted] = useState(false)
  const delay = paintRank(inst.id) * PAINT_STEP_MS
  useEffect(() => { if (!paint) setPainted(false) }, [paint])
  useFrame(() => {
    if (!paint || painted) return
    if (performance.now() - paint.at >= delay) setPainted(true)
  })
  const name = painted && paint?.variant ? paintMaterialName(paint.variant) : part.material
  return <PartGeometry geometry={inst.geometry} material={materials.get(name)} materials={materials} />
}
