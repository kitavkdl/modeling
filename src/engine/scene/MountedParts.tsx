import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useMaterials, useProduct } from '../context'
import { easeOutBack, easeOutCubic, lerp } from '../easing'
import { PartGeometry } from '../geometry/PartGeometry'
import { MM, type MountRecord, type PartDef, type PartInstance, type Vec3 } from '../types'

export const MOUNT_MS = 350
/** 단일 부품이 대기 위치에서 날아올 때의 아치 높이 */
const ARC_MM = 18

interface Props {
  part: PartDef
  inst: PartInstance
  record: MountRecord
}

/** 장착된 인스턴스 하나. 장착 시각부터 MOUNT_MS 동안 내려앉는다. */
export function MountedInstanceView({ part, inst, record }: Props) {
  const product = useProduct()
  const materials = useMaterials()
  const group = useRef<THREE.Group>(null)
  const end = inst.mountPosition
  /**
   * 드래그 없이(건너뛰기·순차 장착) 박히는 다수 부품이 내려앉기 시작하는 높이.
   * 제품 스케일에 비례해야 해서 스냅 반경의 절반을 쓴다 (키보드 30mm, 닌자 75mm).
   */
  const dropMm = product.drag.snapMm / 2

  // 시작점: 드래그로 놓았다면 그 자리(record.from). DraggablePart가 이미 작업대 오프셋을
  // 뺀 작업대 로컬 좌표로 넘기므로 여기서 또 빼지 않는다.
  // 드래그가 아니면 단일 부품은 대기 위치(월드)에서, 다수 부품은 바로 위에서 온다.
  const start = useMemo<Vec3>(() => {
    if (record.from) return record.from
    if (part.count === 1) {
      // 작업대 부품은 결합 전에만 장착되므로 작업대의 원래 오프셋을 그대로 뺀다.
      const st = part.station ? product.stations.find((s) => s.id === part.station) : undefined
      const off: Vec3 = st ? st.offset : [0, 0, 0]
      const r = part.restPosition
      return [r[0] - off[0], r[1] - off[1], r[2] - off[2]]
    }
    return [end[0], end[1] + dropMm, end[2]]
  }, [part, end, record.from, product, dropMm])

  // 대기 위치에서 날아올 때만 아치를 그린다. 드래그로 놓은 것은 바로 내려앉는다.
  const arc = part.count === 1 && !record.from ? ARC_MM : 0

  useFrame(() => {
    const g = group.current
    if (!g) return
    const t = (performance.now() - record.at) / MOUNT_MS
    if (t >= 1) {
      g.position.set(end[0] * MM, end[1] * MM, end[2] * MM)
      return
    }
    const k = easeOutCubic(t)
    const ky = easeOutBack(t, 1.4)
    const x = lerp(start[0], end[0], k)
    const z = lerp(start[2], end[2], k)
    const y = lerp(start[1], end[1], ky) + arc * Math.sin(Math.PI * Math.min(1, t))
    g.position.set(x * MM, y * MM, z * MM)
  })

  const r = inst.mountRotation
  const custom = product.renderInstance?.({ part, inst, record })
  const body = custom ?? (
    <PartGeometry geometry={inst.geometry} material={materials.get(part.material)} materials={materials} />
  )

  return (
    <group ref={group} position={[start[0] * MM, start[1] * MM, start[2] * MM]} rotation={[r[0], r[1], r[2]]}>
      {body}
    </group>
  )
}
