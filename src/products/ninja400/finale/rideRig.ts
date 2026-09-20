import type * as THREE from 'three'
import { MM } from '../../../engine/types'
import { RIDE_MODEL } from '../render/rideLayout.generated'

// 차체 자세 — 기울기(롤)와 가감속 피치를 엔진의 리그 그룹(engine/scene/rigRef) 하나에 건다.
// 여기서 계산만 하고 three 객체를 만지는 것은 applyRigPose 한 곳뿐이라, 부호와 축은 테스트로 못을 박는다.

/** 뒷바퀴 접지점의 x (mm). 피치는 이 점을 축으로 돈다 — 가속하면 뒤가 주저앉고 앞이 들린다 */
export const REAR_CONTACT_X_MM = RIDE_MODEL.rear.x
/**
 * 최대 피치 각 (rad = 1.5°). 서스펜션이 먹는 각이라 크지 않다 — 이보다 키우면 차가
 * 시소처럼 보인다. 실차의 풀 브레이킹 노즈다이브가 전륜 스트로크 120 mm·축거 1,370 mm로
 * 약 5°지만, 화면의 차는 원점에 고정되어 있어 그만큼 돌리면 바퀴가 바닥을 파고든다.
 */
export const PITCH_MAX = (1.5 * Math.PI) / 180
/**
 * 피치가 최대에 닿는 종가속도 (m/s²). 앞브레이크 풀 제동이 0.88 g(8.6 m/s²)이므로
 * 8이면 급제동에서 캡에 닿고, 1단 클러치 덤프(3.2 m/s²)는 0.6° 정도로 살짝 끄덕인다.
 */
export const PITCH_FULL_ACCEL = 8

/**
 * 종가속도 → 피치 각 (rad).
 *
 * 부호: 저장소 좌표계는 +x가 앞 · +y가 위다. 오른손 법칙으로 +z 둘레 **양의** 회전은
 * (1,0,0)을 (cosθ, sinθ, 0)으로 보낸다 — 즉 앞쪽이 위로 올라간다(노즈업).
 * 가속(lurch > 0)에 앞이 들리고 제동(lurch < 0)에 앞이 내려가야 하므로 **부호를 그대로** 쓴다.
 */
export function pitchFor(lurch: number): number {
  // NaN만 걸러 낸다. ±Infinity는 아래 클램프가 ±PITCH_MAX로 받아 주므로 0으로 떨어뜨릴 이유가 없다 —
  // 0으로 떨어뜨리면 값이 깨진 프레임에 차체가 홱 펴진다.
  if (Number.isNaN(lurch)) return 0
  const k = lurch / PITCH_FULL_ACCEL
  return PITCH_MAX * (k > 1 ? 1 : k < -1 ? -1 : k)
}

/**
 * 리그 그룹 하나에 롤과 피치를 같이 건다.
 *
 * 축을 옮기는 방법: 오브젝트의 월드 변환은 T(position)·R이므로, 점 P를 축으로 돌리려면
 * T(P)·R·T(−P) = T(P − R·P)·R 이 되도록 position에 (P − R·P)를 넣는다.
 * P는 뒷바퀴 접지점 (REAR_CONTACT_X_MM, 0, 0)이다. 롤은 x축 둘레 회전이고 P의 y·z가 0이라
 * "원점을 지나는 x축"과 "P를 지나는 x축"이 같은 직선이다 — 롤은 이 옮김에 영향을 받지 않는다.
 *
 * 오일러 순서는 three 기본값 'XYZ'(= R = Rx·Ry·Rz)라 로컬 벡터에는 Rz(피치)가 먼저,
 * Rx(롤)가 나중에 걸린다. 차체 좌우축으로 끄덕인 뒤 접지선을 축으로 눕는 순서가 맞다.
 */
export function applyRigPose(g: THREE.Group | null, lean: number, lurch: number): void {
  if (!g) return
  const roll = Number.isFinite(lean) ? lean : 0
  g.rotation.set(roll, 0, pitchFor(lurch))
  const px = REAR_CONTACT_X_MM * MM
  // P = (px, 0, 0)에 회전을 먹인 R·P. Rx·Ry(0)·Rz를 (px,0,0)에 적용하면
  // Rz가 (px·cosθ, px·sinθ, 0), 이어서 Rx가 y를 (cosφ, sinφ)로 흩는다.
  const cp = Math.cos(g.rotation.z)
  const sp = Math.sin(g.rotation.z)
  const cr = Math.cos(roll)
  const sr = Math.sin(roll)
  g.position.set(px - px * cp, -px * sp * cr, -px * sp * sr)
}
