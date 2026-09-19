import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'

// 페인팅 드래그가 카메라 회전으로 새지 않도록, 고스트를 누르는 순간 컨트롤을 동기적으로 끈다.
// React 상태(enabled prop)는 다음 렌더에야 반영되므로 여기서 직접 만진다.
export const controlsRef: { current: OrbitControlsImpl | null } = { current: null }

export function setControlsEnabled(enabled: boolean) {
  if (controlsRef.current) controlsRef.current.enabled = enabled
}

/** 진행 중인 카메라 이동을 끊는다. CameraRig가 등록한다. */
export const cameraTween: { cancel: (() => void) | null } = { cancel: null }

export function cancelCameraTween() {
  cameraTween.cancel?.()
}
