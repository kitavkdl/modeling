import { useEffect, useRef } from 'react'
import { OrbitControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import type { CameraView } from '../engine/types'
import { ASSEMBLY_LIFT, MM, PART_BY_ID } from '../products/keyboard/parts'
import { useAssembly } from '../store/assembly'
import { easeInOutCubic } from '../utils/easing'
import { cameraTween, controlsRef } from './controlsRef'

const MOVE_MS = 900
const DEG = Math.PI / 180

const MIN_POLAR = 20 * DEG
const MAX_POLAR = 80 * DEG
const MIN_DIST = 30
const MAX_DIST = 90

/** 조립 완료 후 케이블이 보이는 뷰 */
const COMPLETE_VIEW: CameraView = { azimuth: -32, polar: 52, distance: 640 }
/** 점등 뷰 */
const HERO_VIEW: CameraView = { azimuth: 8, polar: 46, distance: 540 }

interface Tween {
  fromPos: THREE.Vector3
  fromTarget: THREE.Vector3
  toPos: THREE.Vector3
  toTarget: THREE.Vector3
  start: number
}

function viewToPosition(view: CameraView, target: THREE.Vector3): THREE.Vector3 {
  const az = view.azimuth * DEG
  const polar = THREE.MathUtils.clamp(view.polar * DEG, MIN_POLAR, MAX_POLAR)
  const r = THREE.MathUtils.clamp(view.distance * MM, MIN_DIST, MAX_DIST)
  return new THREE.Vector3(
    target.x + r * Math.sin(polar) * Math.sin(az),
    target.y + r * Math.cos(polar),
    target.z + r * Math.sin(polar) * Math.cos(az),
  )
}

export function CameraRig() {
  const controls = useRef<OrbitControlsImpl>(null)
  const camera = useThree((s) => s.camera)
  const tween = useRef<Tween | null>(null)
  const dragging = useAssembly((s) => s.dragging)

  const startTween = (view: CameraView, target: THREE.Vector3) => {
    const c = controls.current
    if (!c) return
    tween.current = {
      fromPos: camera.position.clone(),
      fromTarget: c.target.clone(),
      toPos: viewToPosition(view, target),
      toTarget: target,
      start: performance.now(),
    }
  }

  // 단일 부품: 장착 시 그 부품이 잘 보이는 각도로.
  // 다수 부품(스위치·키캡): 선택될 때 한 번만. 장착 중에 카메라가 움직이면 페인팅을 방해한다.
  // 사용자가 직접 조작하면 중단.
  useEffect(() => {
    const viewFor = (partId: string, mounted: Record<string, unknown>) => {
      const part = PART_BY_ID[partId]
      const seated = Boolean(mounted.gasket)
      const lift = Boolean(part.station) && !seated ? ASSEMBLY_LIFT : 0
      const y = (part.mountPosition[1] + lift) * MM
      startTween(part.cameraView, new THREE.Vector3(0, y * 0.6, 0))
    }
    return useAssembly.subscribe((s, prev) => {
      if (s.phase === 'assembly' && s.lastMount && s.lastMount !== prev.lastMount) {
        if (PART_BY_ID[s.lastMount.partId].count === 1) viewFor(s.lastMount.partId, s.mounted)
      }
      if (s.phase === 'assembly' && s.selectedPartId && s.selectedPartId !== prev.selectedPartId) {
        if (PART_BY_ID[s.selectedPartId].count > 1) viewFor(s.selectedPartId, s.mounted)
      }
      if (s.phase !== prev.phase) {
        if (s.phase === 'complete') startTween(COMPLETE_VIEW, new THREE.Vector3(0, 1.5, 0))
        if (s.phase === 'booting') startTween(HERO_VIEW, new THREE.Vector3(0, 1.5, 0))
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const c = controls.current
    if (!c) return
    controlsRef.current = c
    const cancel = () => {
      tween.current = null
    }
    cameraTween.cancel = cancel
    c.addEventListener('start', cancel)
    return () => {
      c.removeEventListener('start', cancel)
      if (controlsRef.current === c) controlsRef.current = null
      if (cameraTween.cancel === cancel) cameraTween.cancel = null
    }
  }, [])

  useFrame(() => {
    const tw = tween.current
    const c = controls.current
    if (!tw || !c) return
    const t = (performance.now() - tw.start) / MOVE_MS
    const k = easeInOutCubic(t)
    camera.position.lerpVectors(tw.fromPos, tw.toPos, k)
    c.target.lerpVectors(tw.fromTarget, tw.toTarget, k)
    c.update()
    if (t >= 1) tween.current = null
  })

  return (
    <OrbitControls
      ref={controls}
      enabled={!dragging}
      enablePan={false}
      enableDamping
      dampingFactor={0.08}
      minPolarAngle={MIN_POLAR}
      maxPolarAngle={MAX_POLAR}
      minDistance={MIN_DIST}
      maxDistance={MAX_DIST}
      target={[0, 1.5, 0]}
    />
  )
}
