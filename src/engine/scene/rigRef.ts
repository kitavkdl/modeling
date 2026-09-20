import type * as THREE from 'three'

// 차체에 붙은 것 전부(절차 조립체 · 드래그 중인 부품 · 제품 연출)를 한 덩어리로 묶은 그룹.
// 바닥·타일·조명·카메라는 이 밖에 있다.
//
// 왜 필요한가: 닌자 400의 주행 연출은 실물 모델 그룹만 기울였다. 그래서 차가 눕는데
// 시동 스위치 히트 영역·스로틀 그립·꽂힌 키(엔진이 그리는 alwaysVisibleParts)는 제자리에
// 남아 공중에 떠 보였다. 기울일 것은 "실물 모델"이 아니라 "차에 붙은 전부"다.
//
// 엔진은 제품 코드를 모른다 — 여기서 제공하는 것은 그룹 참조 하나뿐이고, 무엇을 얼마나
// 돌릴지는 제품이 정한다. React 상태로 올리면 장면이 통째로 다시 그려지므로
// controlsRef와 같은 가변 참조로 둔다.
export const rigRef: { current: THREE.Group | null } = { current: null }

/** Scene이 ref 콜백으로 등록한다. 언마운트에는 null이 들어온다. */
export function setRig(group: THREE.Group | null): void {
  rigRef.current = group
}

/** 제품 연출이 매 프레임 집어가는 통로. 아직 마운트 전이면 null이다. */
export function getRig(): THREE.Group | null {
  return rigRef.current
}

/** 제자리로 돌려놓는다 — 주행을 벗어날 때 기울기·피치가 남아 있으면 조립 화면이 기울어 보인다. */
export function resetRig(): void {
  const g = rigRef.current
  if (!g) return
  g.rotation.set(0, 0, 0)
  g.position.set(0, 0, 0)
}
