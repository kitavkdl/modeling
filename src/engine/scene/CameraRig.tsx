import { useCallback, useEffect, useRef } from 'react'
import { OrbitControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { useAssembly, useAssemblyStore, useProduct } from '../context'
import { easeInOutCubic } from '../easing'
import { stationOffset, type Mounted } from '../store'
import { MM, type CameraConfig, type CameraView, type Vec3 } from '../types'
import { cameraRequest, cameraTween, controlsRef } from './controlsRef'

const MOVE_MS = 900
const DEG = Math.PI / 180

interface Tween {
  fromPos: THREE.Vector3
  fromTarget: THREE.Vector3
  toPos: THREE.Vector3
  toTarget: THREE.Vector3
  start: number
}

/** 주시점(씬 단위)과 뷰 각도로 카메라 위치를 구한다. 극각·거리는 제품 설정으로 클램프한다. */
export function viewToPosition(view: CameraView, target: THREE.Vector3, cfg: CameraConfig): THREE.Vector3 {
  const az = view.azimuth * DEG
  const polar = THREE.MathUtils.clamp(view.polar * DEG, cfg.minPolarDeg * DEG, cfg.maxPolarDeg * DEG)
  const r = THREE.MathUtils.clamp(view.distance * MM, cfg.minDistanceMm * MM, cfg.maxDistanceMm * MM)
  return new THREE.Vector3(
    target.x + r * Math.sin(polar) * Math.sin(az),
    target.y + r * Math.cos(polar),
    target.z + r * Math.sin(polar) * Math.cos(az),
  )
}

const toUnits = (mm: Vec3) => new THREE.Vector3(mm[0] * MM, mm[1] * MM, mm[2] * MM)

export function CameraRig() {
  const controls = useRef<OrbitControlsImpl>(null)
  const camera = useThree((s) => s.camera)
  if (import.meta.env.DEV) (window as unknown as { __camera?: unknown }).__camera = camera
  const tween = useRef<Tween | null>(null)
  const product = useProduct()
  const cfg = product.camera
  const store = useAssemblyStore()
  const dragging = useAssembly((s) => s.dragging)

  const startTween = useCallback(
    (view: CameraView, target: THREE.Vector3) => {
      const c = controls.current
      if (!c) return
      tween.current = {
        fromPos: camera.position.clone(),
        fromTarget: c.target.clone(),
        toPos: viewToPosition(view, target, cfg),
        toTarget: target,
        start: performance.now(),
      }
    },
    [camera, cfg],
  )

  // 단일 부품: 장착 시 그 부품이 잘 보이는 각도로.
  // 다수 부품(스위치·키캡): 선택될 때 한 번만. 장착 중에 카메라가 움직이면 페인팅을 방해한다.
  // 사용자가 직접 조작하면 중단. 완료 이후 연출 카메라는 제품(Finale)이 requestCameraView로 움직인다.
  useEffect(() => {
    const partById = (id: string) => product.parts.find((p) => p.id === id) ?? null
    const viewFor = (partId: string, mounted: Mounted) => {
      const part = partById(partId)
      if (!part) return
      const off = stationOffset(product, part, mounted)
      const m = part.mountPosition
      const target = part.cameraView.target ?? ([m[0] + off[0], m[1] + off[1], m[2] + off[2]] as Vec3)
      startTween(part.cameraView, toUnits(target))
    }
    return store.subscribe((s, prev) => {
      if (s.phase !== 'assembly') return
      if (s.lastMount && s.lastMount !== prev.lastMount) {
        if (partById(s.lastMount.partId)?.count === 1) viewFor(s.lastMount.partId, s.mounted)
      }
      if (s.selectedPartId && s.selectedPartId !== prev.selectedPartId) {
        const part = partById(s.selectedPartId)
        if (part && part.count > 1) viewFor(s.selectedPartId, s.mounted)
      }
    })
  }, [product, store, startTween])

  useEffect(() => {
    const c = controls.current
    if (!c) return
    controlsRef.current = c
    const cancel = () => {
      tween.current = null
    }
    const request = (view: CameraView, targetMm: Vec3) => startTween(view, toUnits(targetMm))
    cameraTween.cancel = cancel
    cameraRequest.fn = request
    c.addEventListener('start', cancel)
    return () => {
      c.removeEventListener('start', cancel)
      if (controlsRef.current === c) controlsRef.current = null
      if (cameraTween.cancel === cancel) cameraTween.cancel = null
      if (cameraRequest.fn === request) cameraRequest.fn = null
    }
  }, [startTween])

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
      minPolarAngle={cfg.minPolarDeg * DEG}
      maxPolarAngle={cfg.maxPolarDeg * DEG}
      minDistance={cfg.minDistanceMm * MM}
      maxDistance={cfg.maxDistanceMm * MM}
      target={[cfg.target[0] * MM, cfg.target[1] * MM, cfg.target[2] * MM]}
    />
  )
}
