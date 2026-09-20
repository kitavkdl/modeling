import type { Mounted, PartDef } from '../../engine/types'

/**
 * 키를 뺀 모든 부품이 다 장착됐고 키는 아직 안 꽂혔는가.
 * 이 순간부터 절차 조립체를 감추고 실물 모델을 띄운다 — 키는 실물 모델에 꽂는다.
 */
export const onlyKeyLeft = (mounted: Mounted, parts: PartDef[], keyId = 'ignition_key'): boolean => {
  let sawKey = false
  for (const part of parts) {
    if (part.id === keyId) {
      sawKey = true
      if (part.instances.some((i) => mounted[i.id])) return false
      continue
    }
    if (part.instances.some((i) => !mounted[i.id])) return false
  }
  return sawKey
}
