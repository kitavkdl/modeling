// 닌자 400 (2018 EX400G) 제원 — 이 파일 하나가 치수의 단일 출처다.
// 단위는 전부 mm, 각도는 이름에 _DEG가 붙은 것만 도(°)이고 나머지는 라디안.
// 좌표계: x 앞뒤(+x 진행 방향 앞), y 상하(+y 위), z 좌우(+z 오른쪽). 지면이 y=0.

import type { Vec3 } from '../../engine/types'

/** 축간거리 */
export const WHEELBASE = 1370

// TODO: 실물 확인 — 앞 액슬 높이는 타이어 반지름과 같다고 두었다
export const FRONT_AXLE: Vec3 = [685, 293, 0]
export const REAR_AXLE: Vec3 = [-685, 306, 0]

/** 휠 림 반지름 (17인치) */
export const RIM_R = 215.9
export const FRONT_TIRE_R = 293
export const REAR_TIRE_R = 306
/** 앞 110/70-17 */
export const FRONT_TIRE_W = 110
/** 뒤 150/60-17 */
export const REAR_TIRE_W = 150

// TODO: 실물 확인 — 스티어링 헤드 중심
export const HEAD: Vec3 = [420, 880, 0]

/** 캐스터각 */
export const RAKE_DEG = 24.7
export const RAKE = (RAKE_DEG * Math.PI) / 180

/** 포크 좌우 간격 (다리 중심 사이) */
export const FORK_SPACING = 200
/** 포크 다리 전체 길이 */
export const FORK_LEN = 644

// TODO: 실물 확인 — 크랭크축 중심
export const CRANK: Vec3 = [-120, 430, 0]

/** 실린더 전경각 */
export const CYL_TILT_DEG = 20
/** 보어 피치 (실린더 중심 간격) */
export const CYL_PITCH = 84
export const BORE = 70
/** 크랭크케이스 폭 */
export const CASE_W = 380
/** 시트고 */
export const SEAT_H = 785

const CYL_TILT = (CYL_TILT_DEG * Math.PI) / 180

/**
 * 실린더 좌표계 → 차체 좌표계.
 * u는 크랭크 기준 앞(+)뒤, h는 크랭크 위로 잰 실린더 축 방향 높이, z는 좌우 그대로.
 */
export function tilt(u: number, h: number, z: number): Vec3 {
  return [
    CRANK[0] + u * Math.cos(CYL_TILT) + h * Math.sin(CYL_TILT),
    CRANK[1] - u * Math.sin(CYL_TILT) + h * Math.cos(CYL_TILT),
    z,
  ]
}

/** 실린더 방향으로 눕히는 회전 */
export const TILT_ROT: Vec3 = [0, 0, -CYL_TILT]

/** 스티어링 축 위, 높이 h인 점의 (x, y) */
export function forkPoint(h: number): [number, number] {
  return [FRONT_AXLE[0] - (h - FRONT_AXLE[1]) * Math.tan(RAKE), h]
}

/** 포크·스티어링 축 방향으로 뒤로 눕히는 회전 */
export const FORK_ROT: Vec3 = [0, 0, RAKE]
