import { describe, expect, it } from 'vitest'
import type { Mounted, MountRecord, PartDef } from '../../engine/types'
import { onlyKeyLeft } from './onlyKeyLeft'
import { PARTS } from './parts'

const rec = (instanceId: string): MountRecord => ({ instanceId, at: 0 })

/** 주어진 부품들의 인스턴스를 전부 장착한 표 */
function mountAll(parts: PartDef[]): Mounted {
  const m: Mounted = {}
  for (const p of parts) for (const i of p.instances) m[i.id] = rec(i.id)
  return m
}

const part = (id: string, count = 1): PartDef => ({
  id,
  nameKo: id,
  nameEn: id,
  geometry: { type: 'box', size: [10, 10, 10] },
  material: 'm',
  restPosition: [0, 0, 0],
  mountPosition: [0, 0, 0],
  mountRotation: [0, 0, 0],
  requires: [],
  count,
  instances: Array.from({ length: count }, (_, i) => ({
    id: count === 1 ? id : `${id}:${i}`,
    mountPosition: [0, 0, 0],
    mountRotation: [0, 0, 0],
    geometry: { type: 'box', size: [10, 10, 10] },
    order: 0,
  })),
  cameraView: { azimuth: 0, polar: 60, distance: 1000 },
  hint: id,
})

const TOY = [part('frame'), part('bolt', 3), part('ignition_key')]

describe('onlyKeyLeft', () => {
  it('키만 남았을 때 true', () => {
    expect(onlyKeyLeft(mountAll([TOY[0], TOY[1]]), TOY)).toBe(true)
  })

  it('다른 부품이 하나라도 덜 장착됐으면 false', () => {
    const m = mountAll([TOY[0], TOY[1]])
    delete m['bolt:2']
    expect(onlyKeyLeft(m, TOY)).toBe(false)
  })

  it('키가 이미 꽂혔으면 false (조립이 끝난 상태다)', () => {
    expect(onlyKeyLeft(mountAll(TOY), TOY)).toBe(false)
  })

  it('아무것도 없으면 false', () => {
    expect(onlyKeyLeft({}, TOY)).toBe(false)
  })

  it('키 id를 바꿔 쓸 수 있다', () => {
    const parts = [part('frame'), part('plug')]
    expect(onlyKeyLeft(mountAll([parts[0]]), parts, 'plug')).toBe(true)
  })

  it('실제 닌자 부품표에서도 키 하나만 남으면 true', () => {
    const rest = PARTS.filter((p) => p.id !== 'ignition_key')
    const m = mountAll(rest)
    expect(onlyKeyLeft(m, PARTS)).toBe(true)
    m['ignition_key'] = rec('ignition_key')
    expect(onlyKeyLeft(m, PARTS)).toBe(false)
  })
})
