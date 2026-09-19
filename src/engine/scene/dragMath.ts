import type { Mounted } from '../store'
import type { DragConfig, PartDef, Vec3 } from '../types'

export interface DragTargets {
  /** 단일 부품: 놓으면 장착될 인스턴스 */
  snap: string | null
  /** 다수 부품: 지금 지나가고 있어 장착할 인스턴스들 */
  paint: string[]
}

/** 커서가 가리키는 위치(mm, 작업대 오프셋 제거된 부품 로컬 좌표)에 대한 장착 판정. 수평 거리만 본다. */
export function resolveDragTargets(part: PartDef, pos: Vec3, drag: DragConfig, mounted: Mounted): DragTargets {
  const dist = (p: Vec3) => Math.hypot(pos[0] - p[0], pos[2] - p[2])
  if (part.count === 1) {
    const inst = part.instances[0]
    if (mounted[inst.id]) return { snap: null, paint: [] }
    return { snap: dist(inst.mountPosition) <= drag.snapMm ? inst.id : null, paint: [] }
  }
  const paint: string[] = []
  for (const inst of part.instances) {
    if (mounted[inst.id]) continue
    if (dist(inst.mountPosition) <= drag.paintMm) paint.push(inst.id)
  }
  return { snap: null, paint }
}
