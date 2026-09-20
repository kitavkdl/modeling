import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useAssemblyStore, useMaterials, useProduct } from '../../../engine/context'
import { MM, type Vec3 } from '../../../engine/types'
import { onlyKeyLeft } from '../onlyKeyLeft'
import { PARTS } from '../parts'

// '전문가의 손길' — 거친 절차 조립체가 실물 모델로 바뀌는 순간을 6초에 걸쳐 보여 준다.
// 즉시 교체 대신 수직 칼날(클리핑 평면) 하나가 앞(코)에서 뒤(꼬리)로 지나가고,
// 지나간 쪽은 실물 모델, 아직 안 지나간 쪽은 절차 조립체가 남는다.
//
// 구현은 three의 **로컬 클리핑**이다: gl.localClippingEnabled를 켜고 재질마다 평면을 물린다.
// 닌자 400은 절차 조립체 재질을 전부 제품 재질표(materials.ts → 엔진 재질 레지스트리)에서
// 받으므로(Paintable도 registry.get을 쓴다) 재질표 키를 전부 훑으면 빠지는 것이 없다.
// 실물 모델 쪽 재질은 RideScene이 clone한 것이라 이쪽에서 알 수 없다 — RideScene이
// registerRealModel로 넘겨준다. 그래서 이 모듈은 RideModel을 import하지 않는다(순환 방지).

/** 칼날이 출발하는 앞끝 (mm). 실물 모델 앞끝(+974)보다 조금 앞에서 시작한다 */
export const SWEEP_FRONT_MM = 1100
/** 칼날이 멈추는 뒤끝 (mm). 실물 모델 뒤끝(−982)보다 조금 뒤 */
export const SWEEP_REAR_MM = -1100
/** 스윕에 걸리는 시간 (초) */
export const REFINE_S = 6
/** 탭 전환 등으로 프레임이 밀렸을 때 칼날이 순간이동하지 않게 (초) */
const MAX_DT = 0.1

/** 칼날 두께 (mm) */
const BLADE_MM = 2
/** 칼날 높이 (mm) — 차 전고(1071)를 넘긴다 */
const BLADE_H_MM = 1300
/** 칼날 폭 (mm) — 차 전폭(±421)을 넘긴다 */
const BLADE_W_MM = 1000

/**
 * t초에서 칼날의 x (mm). 0초에 앞끝, REFINE_S에 뒤끝. 구간 밖은 끝값으로 물린다.
 */
export function sweepXMm(t: number): number {
  const k = Math.min(1, Math.max(0, t / REFINE_S))
  return SWEEP_FRONT_MM + (SWEEP_REAR_MM - SWEEP_FRONT_MM) * k
}

/** 씬 단위로 잰 칼날 위치 */
export const sweepXUnits = (t: number): number => sweepXMm(t) * MM

/**
 * 절차 조립체 쪽 평면의 법선. three는 `n·p + constant > 0`인 곳을 남긴다.
 * 절차 조립체는 칼날이 **아직 지나가지 않은** 뒤쪽(x < sweepX)만 남긴다 → 법선 (−1,0,0).
 */
export const PROC_NORMAL: Vec3 = [-1, 0, 0]
/** 실물 모델은 칼날이 **지나간** 앞쪽(x > sweepX)에만 나타난다 → 법선 (+1,0,0) */
export const REAL_NORMAL: Vec3 = [1, 0, 0]

/** n=(−1,0,0)에서 x < sweepX를 남기는 상수 */
export const procPlaneConstant = (sweepXu: number): number => sweepXu
/** n=(+1,0,0)에서 x > sweepX를 남기는 상수 */
export const realPlaneConstant = (sweepXu: number): number => -sweepXu

export interface RefineState {
  /** 스윕이 도는 중인가 */
  active: boolean
  /** 스윕 경과 시간 (초) */
  t: number
  /** 스윕이 끝났는가. 이 값이 켜져야 제품이 절차 조립체를 완전히 감춘다 */
  done: boolean
}

export const refine: RefineState = { active: false, t: 0, done: false }

type Listener = () => void
const listeners = new Set<Listener>()

export function subscribeRefine(fn: Listener): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function notifyRefine(): void {
  for (const fn of [...listeners]) fn()
}

/** 스윕이 실물 모델을 이미 드러냈는가 — RideScene이 0.5초 페이드를 건너뛸 조건 */
export const refineRevealed = (): boolean => refine.active || refine.done

/** 절차 조립체를 감춰도 되는가 — 제품의 assemblyHidden이 본다 */
export const refineDone = (): boolean => refine.done

/** RideScene이 넘겨주는 실물 모델 쪽 손잡이 */
interface RealHandle {
  materials: THREE.Material[]
}

let real: RealHandle | null = null

/**
 * 실물 모델이 자기 재질을 등록한다. **등록됐다는 것 자체가 디코드가 끝났다는 뜻**이다 —
 * RideScene은 Suspense가 풀려야 렌더되고, 못 받으면 경계가 잘라내 등록 자체가 없다.
 * 그래서 스윕 시작 조건에 따로 준비 플래그를 보지 않는다.
 */
export function registerRealModel(handle: RealHandle): () => void {
  real = handle
  notifyRefine()
  return () => {
    if (real !== handle) return
    // 실물 모델이 사라지는 순간 그쪽 재질에 물린 평면을 떼어 낸다 — clear()는 real을 통해서만
    // 닿을 수 있어서, real을 비운 뒤에는 영영 못 떼어 낸다. (setPlanes는 함수 선언이라 호이스팅된다)
    setPlanes(handle.materials, null)
    real = null
    // 알리지 않으면 RefineSweep의 check()가 돌지 않아 절차 조립체 쪽 평면이 그대로 남는다 —
    // 스윕 도중에 RideScene이 내려가면 반쯤 잘린 차가 화면에 남았다.
    notifyRefine()
  }
}

function setPlanes(mats: THREE.Material[], planes: THREE.Plane[] | null): void {
  for (const m of mats) {
    if (m.clippingPlanes === planes) continue
    m.clippingPlanes = planes
    // 잘린 자리로 그림자가 남지 않게. 평면 개수가 바뀌면 셰이더를 다시 엮어야 한다
    m.clipShadows = planes !== null
    m.needsUpdate = true
  }
}

/**
 * 스윕을 돌리는 본체. NinjaFinale이 마운트한다 (조립 중에도 떠 있어야 한다 —
 * 시작 조건이 assembly 단계 안에서 걸린다).
 */
export function RefineSweep() {
  const gl = useThree((s) => s.gl)
  const store = useAssemblyStore()
  const product = useProduct()
  const materials = useMaterials()
  const blade = useRef<THREE.Mesh>(null)
  const lamp = useRef<THREE.PointLight>(null)
  const active = useSyncExternalStore(subscribeRefine, () => refine.active, () => false)

  // 절차 조립체 쪽 재질 = 제품 재질표 전부. 레지스트리는 이름당 한 인스턴스를 돌려주므로
  // 화면에 떠 있는 모든 절차 부품이 이 목록 안의 재질을 쓴다.
  const procMaterials = useMemo(
    () => Object.keys(product.materials).map((name) => materials.get(name)),
    [product, materials],
  )

  const planes = useMemo(
    () => ({
      proc: new THREE.Plane(new THREE.Vector3(...PROC_NORMAL), procPlaneConstant(sweepXUnits(0))),
      real: new THREE.Plane(new THREE.Vector3(...REAL_NORMAL), realPlaneConstant(sweepXUnits(0))),
    }),
    [],
  )

  // 로컬 클리핑은 렌더러 전역 스위치이고, 켜 두는 것만으로 모든 재질의 셰이더가 클리핑 분기를
  // 달고 돈다. 스윕이 도는 동안에만 켜고 끝나거나 언마운트되면 원래 값으로 되돌린다.
  useEffect(() => {
    if (!active) return
    const prev = gl.localClippingEnabled
    gl.localClippingEnabled = true
    return () => {
      gl.localClippingEnabled = prev
    }
  }, [gl, active])

  const clear = useCallback(() => {
    setPlanes(procMaterials, null)
    setPlanes(real?.materials ?? [], null)
  }, [procMaterials])

  /** 스토어를 깨운다 — refine은 스토어 값이 아니라서 셀렉터가 다시 돌 이유가 없다 */
  const wake = useCallback(() => {
    notifyRefine()
    store.setState({})
  }, [store])

  const check = useCallback(() => {
    const s = store.getState()
    if (s.phase !== 'assembly') {
      // 키를 꽂았거나 단계를 건너뛰었다 — 스윕은 여기서 끝난 것으로 본다 (반쯤 잘린 차를 남기지 않는다)
      if (refine.active) {
        refine.active = false
        refine.t = REFINE_S
        refine.done = true
        clear()
        wake()
      }
      return
    }
    const should = onlyKeyLeft(s.mounted, PARTS) && real !== null
    if (!should) {
      // 되돌리기·초기화로 조건이 풀렸다
      if (refine.active || refine.done) {
        refine.active = false
        refine.t = 0
        refine.done = false
        clear()
        wake()
      }
      return
    }
    if (refine.active || refine.done) return
    refine.active = true
    refine.t = 0
    refine.done = false
    planes.proc.constant = procPlaneConstant(sweepXUnits(0))
    planes.real.constant = realPlaneConstant(sweepXUnits(0))
    setPlanes(procMaterials, [planes.proc])
    setPlanes(real?.materials ?? [], [planes.real])
    wake()
  }, [clear, planes, procMaterials, store, wake])

  useEffect(() => {
    check()
    // 장착 상태·단계는 스토어가, 실물 모델 등록은 refine 알림이 알려 준다
    const offStore = store.subscribe(check)
    const offRefine = subscribeRefine(check)
    return () => {
      offStore()
      offRefine()
    }
  }, [check, store])

  // 언마운트(제품 이탈)에는 평면을 떼어 내고 스윕도 내린다. 재질 인스턴스는 레지스트리에,
  // refine 싱글턴은 모듈에 남는다 — active를 켠 채 두면 다시 마운트됐을 때 평면 없이 칼날만
  // 차를 가로질러 지나간다(클리핑이 안 걸린 채 6초).
  useEffect(
    () => () => {
      refine.active = false
      clear()
      notifyRefine()
    },
    [clear],
  )

  useFrame((_, raw) => {
    if (!refine.active) return
    refine.t = Math.min(REFINE_S, refine.t + Math.min(raw, MAX_DT))
    const x = sweepXUnits(refine.t)
    planes.proc.constant = procPlaneConstant(x)
    planes.real.constant = realPlaneConstant(x)
    if (blade.current) blade.current.position.x = x
    if (lamp.current) lamp.current.position.x = x
    if (refine.t >= REFINE_S) {
      refine.active = false
      refine.done = true
      clear()
      wake()
    }
  })

  if (!active) return null

  const x0 = sweepXUnits(refine.t)
  return (
    <group>
      {/* 칼날 자리에 서는 얇고 밝은 판. 조명을 받지 않는 basic 재질이라 톤매핑도 끈다 */}
      <mesh ref={blade} position={[x0, (BLADE_H_MM / 2) * MM, 0]}>
        <boxGeometry args={[BLADE_MM * MM, BLADE_H_MM * MM, BLADE_W_MM * MM]} />
        <meshBasicMaterial color="#dfe6f2" toneMapped={false} />
      </mesh>
      {/* 칼날을 따라다니는 약한 점광 — 지나가는 자리만 살짝 들어 올린다 */}
      <pointLight ref={lamp} position={[x0, (BLADE_H_MM / 2) * MM, 0]} intensity={24} distance={60} decay={2} color="#cfdcf0" />
    </group>
  )
}

/** HUD 문구 (product.hudExtra). 스윕 동안에만 뜬다 */
export function RefineNote() {
  const active = useSyncExternalStore(subscribeRefine, () => refine.active, () => false)
  if (!active) return null
  return <div className="refine-note">전문가의 손길 — 마무리 중</div>
}
