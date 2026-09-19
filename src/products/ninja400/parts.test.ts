import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import type { CompositeChild, PartInstance } from '../../engine/types'
import { validateGeometry } from '../../engine/types'
import { PARTS, PART_BY_ID, PROPS, STATIONS } from './parts'
import { NINJA_MATERIALS } from './materials'

/** 헤더 인스턴스의 composite children을 root(mountPosition/mountRotation) 아래 Object3D로 붙이고,
 *  각 원통 축을 10mm 간격으로 샘플링해 월드 좌표 배열을 돌려준다. */
function sampleHeaderAxis(inst: PartInstance): THREE.Vector3[] {
  const root = new THREE.Object3D()
  root.position.fromArray(inst.mountPosition)
  root.rotation.fromArray(inst.mountRotation)
  root.updateMatrixWorld(true)

  const geometry = inst.geometry
  if (geometry.type !== 'composite') throw new Error('exhaust_header geometry must be composite')
  const points: THREE.Vector3[] = []
  for (const child of geometry.children as CompositeChild[]) {
    if (child.geometry.type !== 'cylinder') continue
    const obj = new THREE.Object3D()
    if (child.position) obj.position.fromArray(child.position)
    if (child.rotation) obj.rotation.fromArray(child.rotation)
    root.add(obj)
    root.updateMatrixWorld(true)
    const height = child.geometry.height
    for (let y = 0; y <= height; y += 10) {
      points.push(obj.localToWorld(new THREE.Vector3(0, y, 0)))
    }
  }
  return points
}

describe('ninja400 parts', () => {
  it('has unique part and instance ids', () => {
    const ids = PARTS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    const inst = PARTS.flatMap((p) => p.instances.map((i) => i.id))
    expect(new Set(inst).size).toBe(inst.length)
  })
  it('count matches instances and every geometry validates', () => {
    for (const p of PARTS) {
      expect(p.instances, p.id).toHaveLength(p.count)
      expect(validateGeometry(p.geometry), p.id).toEqual([])
      for (const i of p.instances) expect(validateGeometry(i.geometry), i.id).toEqual([])
    }
    for (const s of STATIONS) if (s.prop) expect(validateGeometry(s.prop), s.id).toEqual([])
    for (const pr of PROPS) expect(validateGeometry(pr.geometry)).toEqual([])
  })
  it('requires reference only earlier parts; first part is preplaced', () => {
    expect(PARTS[0].preplaced).toBe(true)
    const seen = new Set<string>()
    for (const p of PARTS) {
      for (const r of p.requires) expect(seen.has(r), `${p.id} requires ${r}`).toBe(true)
      seen.add(p.id)
    }
  })
  it('stations exist and marrying parts come after their station parts', () => {
    const stationIds = new Set(STATIONS.map((s) => s.id))
    for (const p of PARTS) if (p.station) expect(stationIds.has(p.station), p.id).toBe(true)
    for (const s of STATIONS) {
      const memberIdx = PARTS.map((p, i) => (p.station === s.id ? i : -1)).filter((i) => i >= 0)
      const marryIdx = PARTS.findIndex((p) => p.marries === s.id)
      if (memberIdx.length > 0) {
        expect(marryIdx, s.id).toBeGreaterThan(Math.max(...memberIdx))
      }
    }
  })
  it('materials referenced exist; paintable parts start in primer', () => {
    for (const p of PARTS) {
      expect(NINJA_MATERIALS[p.material], `${p.id} material ${p.material}`).toBeDefined()
      if (p.paintable) expect(p.material).toBe('primer')
    }
  })
  it('the frame sits on the ground plane and the axles match the wheelbase', async () => {
    const { FRONT_AXLE, REAR_AXLE, WHEELBASE } = await import('./spec')
    expect(FRONT_AXLE[0] - REAR_AXLE[0]).toBe(WHEELBASE)
    expect(PART_BY_ID.main_frame.mountPosition[1]).toBeGreaterThan(0)
  })
  it('engine station has 27 parts and the mount bolts marry it after all of them', () => {
    const engine = PARTS.filter((p) => p.station === 'engine')
    expect(engine).toHaveLength(27)
    expect(engine[0].id).toBe('crankcase_lower')
    const bolts = PART_BY_ID.engine_mount_bolt
    expect(bolts.marries).toBe('engine')
    expect(bolts.count).toBe(4)
    expect(bolts.requires).toEqual(['drive_sprocket', 'subframe'])
    expect(PART_BY_ID.valve.count).toBe(8)
    expect(PART_BY_ID.piston.count).toBe(2)
  })
  it('wheel stations marry with axles that also require the fork / swingarm', () => {
    expect(PART_BY_ID.front_axle.marries).toBe('front_wheel')
    expect(PART_BY_ID.front_axle.requires).toEqual(['front_disc', 'fork'])
    expect(PART_BY_ID.rear_axle.marries).toBe('rear_wheel')
    expect(PART_BY_ID.rear_axle.requires).toEqual(['rear_sprocket', 'swingarm'])
    expect(PART_BY_ID.chain.requires).toEqual(['rear_axle', 'drive_sprocket'])
    expect(PART_BY_ID.fork.count).toBe(2)
    expect(PART_BY_ID.front_wheel.mountPosition).toEqual([685, 293, 0])
  })
  it('lamps use lamp_off and the tank is paintable', () => {
    for (const id of ['headlight', 'taillight', 'turn_signal']) expect(PART_BY_ID[id].material).toBe('lamp_off')
    expect(PART_BY_ID.fuel_tank.paintable).toBe(true)
    expect(PART_BY_ID.turn_signal.count).toBe(4)
    expect(PART_BY_ID.radiator.requires).toEqual(['chain'])
  })
  it('bodywork is paintable primer and paint is a hidden variant part right before the ignition key', () => {
    const paintIdx = PARTS.findIndex((p) => p.id === 'paint')
    const paint = PARTS[paintIdx]
    expect(paint.hidden).toBe(true)
    expect(paint.variants?.map((v) => v.id)).toEqual(['krt', 'blue', 'black'])
    expect(PARTS[paintIdx + 1]?.id).toBe('ignition_key')
    const paintable = PARTS.filter((p) => p.paintable).map((p) => p.id)
    expect(paintable).toEqual(['front_fender', 'fuel_tank', 'upper_cowl', 'side_cowl', 'lower_cowl', 'tail_cowl'])
    expect(PARTS).toHaveLength(81)
  })
  it('the ignition key is the last part and its mount advances the phase to keyed', () => {
    const last = PARTS[PARTS.length - 1]
    expect(last.id).toBe('ignition_key')
    expect(last.phaseOnMount).toBe('keyed')
    expect(last.requires).toContain('paint')
    expect(last.hidden).toBeFalsy()
    expect(last.variants).toBeUndefined()
  })
  it('대기 위치가 바닥 위에 있고 지그 기둥 윗면이 프레임 노드에 닿는다', () => {
    for (const p of PARTS) {
      // 어떤 부품도 바닥 아래에서 대기하지 않는다
      expect(p.restPosition[1], `${p.id} rest y`).toBeGreaterThanOrEqual(0)
      // 작업대가 없는 부품은 지면에 파묻히지 않도록 띄워 둔다
      if (!p.station && !p.preplaced && !p.hidden) {
        expect(p.restPosition[1], `${p.id} rest y`).toBeGreaterThanOrEqual(100)
      }
    }
    // 앞 지그는 엔진 앞 하단 마운트(y=300), 뒤 지그는 스윙암 피벗(y=420)에 닿는다
    const tops = PROPS.map((pr) => {
      expect(pr.geometry.type).toBe('box')
      return pr.geometry.type === 'box' ? pr.position[1] + pr.geometry.size[1] : Number.NaN
    })
    expect(tops).toEqual([300, 420])
  })
  it('paintRank orders paintable instances front to back', async () => {
    const { paintRank } = await import('./parts')
    expect(paintRank('front_fender')).toBe(0)
    expect(paintRank('tail_cowl')).toBeGreaterThan(paintRank('fuel_tank'))
  })
  it('exhaust header clears the crankcase and both branches converge on the collector', () => {
    const header = PART_BY_ID.exhaust_header
    const l = header.instances.find((i) => i.id === 'exhaust_header:l')
    const r = header.instances.find((i) => i.id === 'exhaust_header:r')
    if (!l || !r) throw new Error('exhaust_header l/r instances missing')

    const lPts = sampleHeaderAxis(l)
    const rPts = sampleHeaderAxis(r)

    // 크랭크케이스 박스 (x -330..90, y 280..550, |z|<=190)를 반지름 19만큼 확장한 범위
    const inCrankcase = (p: THREE.Vector3) => p.x >= -349 && p.x <= 109 && p.y >= 261 && p.y <= 569 && Math.abs(p.z) <= 209
    for (const p of [...lPts, ...rPts]) expect(inCrankcase(p), `(${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)})`).toBe(false)

    // 둘째 원통(파이프) 끝점이 집합부 축 위 점에서 35mm 이내
    const collector = PART_BY_ID.exhaust_collector
    const lEnd = lPts[lPts.length - 1]
    const rEnd = rPts[rPts.length - 1]
    const collectorAxisPoint = (endX: number) => new THREE.Vector3(endX, collector.mountPosition[1], collector.mountPosition[2])
    expect(lEnd.distanceTo(collectorAxisPoint(lEnd.x))).toBeLessThanOrEqual(35)
    expect(rEnd.distanceTo(collectorAxisPoint(rEnd.x))).toBeLessThanOrEqual(35)

    // l·r 샘플 간 최소 거리
    let minDist = Infinity
    for (const a of lPts) for (const b of rPts) minDist = Math.min(minDist, a.distanceTo(b))
    expect(minDist).toBeGreaterThanOrEqual(38)
  })
  it('the chain wraps the drive and rear sprockets on the same z plane with correct tangents', () => {
    const driveSprocket = PART_BY_ID.drive_sprocket
    const rearSprocket = PART_BY_ID.rear_sprocket
    const chain = PART_BY_ID.chain

    expect(Math.abs(driveSprocket.mountPosition[2] - rearSprocket.mountPosition[2])).toBeLessThanOrEqual(1)

    const geometry = chain.geometry
    if (geometry.type !== 'composite') throw new Error('chain geometry must be composite')
    const rearTorus = geometry.children.find((c) => c.geometry.type === 'torus' && c.geometry.radius === 118)
    if (!rearTorus || !rearTorus.position) throw new Error('chain rear torus missing')

    // rear_sprocket.mount - chain.mount 가 (x, y)에서 체인 리어 토러스 position과 같다
    const rel: [number, number, number] = [
      rearSprocket.mountPosition[0] - chain.mountPosition[0],
      rearSprocket.mountPosition[1] - chain.mountPosition[1],
      rearSprocket.mountPosition[2] - chain.mountPosition[2],
    ]
    expect(rel[0]).toBeCloseTo(rearTorus.position[0], 1)
    expect(rel[1]).toBeCloseTo(rearTorus.position[1], 1)
    expect(Math.abs(rel[2])).toBeLessThanOrEqual(10)

    // 두 박스 run의 양 끝점이 각각 가까운 원(중심 (0,0) r40 / (-375,-64) r118)에서 반지름 ±4 안
    const drive: [number, number] = [0, 0]
    const rDrive = 40
    const rear: [number, number] = [-375, -64]
    const rRear = 118
    const boxRuns = geometry.children.filter((c): c is CompositeChild & { geometry: { type: 'box'; size: [number, number, number] }; position: [number, number, number]; rotation: [number, number, number] } => c.geometry.type === 'box')
    expect(boxRuns).toHaveLength(2)
    for (const run of boxRuns) {
      const [sx] = run.geometry.size
      const rz = run.rotation[2]
      const [px, py] = run.position
      const half = sx / 2
      const ends: Array<[number, number]> = [
        [px - half * Math.cos(rz), py - half * Math.sin(rz)],
        [px + half * Math.cos(rz), py + half * Math.sin(rz)],
      ]
      for (const [ex, ey] of ends) {
        const dDrive = Math.abs(Math.hypot(ex - drive[0], ey - drive[1]) - rDrive)
        const dRear = Math.abs(Math.hypot(ex - rear[0], ey - rear[1]) - rRear)
        expect(Math.min(dDrive, dRear), `endpoint (${ex.toFixed(1)}, ${ey.toFixed(1)})`).toBeLessThanOrEqual(4)
      }
    }
  })
})
