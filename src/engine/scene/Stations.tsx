import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useAssembly, useMaterials, useProduct } from '../context'
import { easeOutBack, lerp } from '../easing'
import { PartGeometry } from '../geometry/PartGeometry'
import { fallbackMaterial } from '../materials'
import { isStationSeated } from '../store'
import { MM, type StationDef } from '../types'

export const SEAT_MS = 350

/** 작업대 그룹. 결합 전에는 offset, 결합되면 0으로 0.35초에 내려앉는다. 되돌리면 다시 떠오른다. */
export function StationGroup({ station, children }: { station: StationDef; children: ReactNode }) {
  const group = useRef<THREE.Group>(null)
  const product = useProduct()
  const seated = useAssembly((s) => isStationSeated(product, s.mounted, station.id))
  // position으로 넘기는 벡터는 반드시 같은 객체여야 한다. 새 객체를 넘기면 R3F가 커밋마다
  // group.position을 off로 되돌려, 안착 애니메이션 도중의 리렌더나 되돌리기에서 순간이동한다.
  const off = useMemo(
    () => new THREE.Vector3(station.offset[0] * MM, station.offset[1] * MM, station.offset[2] * MM),
    [station],
  )
  const anim = useRef({ from: off.clone(), to: off.clone(), start: 0 })

  useEffect(() => {
    const cur = group.current ? group.current.position.clone() : anim.current.to.clone()
    anim.current = { from: cur, to: seated ? new THREE.Vector3() : off.clone(), start: performance.now() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seated])

  useFrame(() => {
    const g = group.current
    if (!g) return
    const a = anim.current
    const t = (performance.now() - a.start) / SEAT_MS
    if (t >= 1) g.position.copy(a.to)
    else {
      const k = easeOutBack(t, 1.4)
      g.position.set(lerp(a.from.x, a.to.x, k), lerp(a.from.y, a.to.y, k), lerp(a.from.z, a.to.z, k))
    }
  })

  return (
    <group ref={group} position={off}>
      {children}
    </group>
  )
}

/**
 * 작업대 소품(작업대 벤치)과 제품 고정 소품(지그 기둥). 장착 대상이 아니다.
 * 조립이 끝나면 전부 치운다 — 지그 기둥이 완성된 차체의 휠·카울을 뚫고, 벤치도 더는 쓸 데가 없다.
 * (StationDef.prop도 여기서 그리므로 벤치와 지그가 같이 사라진다.)
 */
export function Props() {
  const product = useProduct()
  const materials = useMaterials()
  const phase = useAssembly((s) => s.phase)
  if (phase !== 'assembly') return null
  return (
    <group>
      {product.stations.map((s) =>
        s.prop ? (
          <group key={s.id} position={[s.offset[0] * MM, 0, s.offset[2] * MM]}>
            <PartGeometry geometry={s.prop} material={materials.getOr(s.propMaterial, fallbackMaterial)} materials={materials} />
          </group>
        ) : null,
      )}
      {(product.props ?? []).map((p, i) => (
        <group key={i} position={[p.position[0] * MM, p.position[1] * MM, p.position[2] * MM]}>
          <PartGeometry geometry={p.geometry} material={materials.getOr(p.material, fallbackMaterial)} materials={materials} />
        </group>
      ))}
    </group>
  )
}
