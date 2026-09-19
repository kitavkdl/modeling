// 스로틀 값 하나를 사운드·계기판·그립이 같이 본다.
// R3F 훅 밖(오디오 스케줄러)에서도 읽으므로 스토어가 아니라 가변 싱글턴으로 둔다.
// target은 Throttle의 포인터 드래그가 쓰고, value는 Throttle의 useFrame이 0.25초 시정수로 따라가게 한다.
export const throttle = { value: 0, target: 0 }

/** 시동이 꺼지거나 조립으로 돌아갈 때 */
export function resetThrottle(): void {
  throttle.value = 0
  throttle.target = 0
}
