import type { Vec3 } from '../../../engine/types'
import { RIDE_MODEL } from './rideLayout.generated'

// 실물 모델(ZX-6R) 위에서 손이 닿는 지점들. 좌표는 전부 mm이고 스크립트가 모델에서 잰 값이다
// (rideLayout.generated.ts). 절차 조립체가 사라진 뒤로는 이 세 점이 상호작용의 기준이 된다.

/** 키 구멍 — ignition_key 부품이 꽂히는 자리 */
export const IGNITION: Vec3 = [...RIDE_MODEL.landmarksMm.keyHole] as Vec3
/** 오른쪽 스위치 하우징 — 시동 버튼이 붙는 자리 */
export const STARTER_HOUSING: Vec3 = [...RIDE_MODEL.landmarksMm.buttonRight] as Vec3
/** 오른쪽 그립 — 스로틀을 잡는 자리 */
export const GRIP: Vec3 = [...RIDE_MODEL.landmarksMm.gripRight] as Vec3
/** 계기판 중심 — 카메라가 바라보는 점 */
export const DASHBOARD: Vec3 = [...RIDE_MODEL.landmarksMm.dashboard] as Vec3
