import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import type { CompositeChild, Vec3 } from '../../engine/types'
import { validateGeometry } from '../../engine/types'
import { PARTS, PART_BY_ID, PROPS, STATIONS } from './parts'
import { NINJA_MATERIALS } from './materials'
import { assemblyBounds, instanceBounds, partTubeSamples, tubeSamples } from './test-utils'

const vec = (p: [number, number, number]) => new THREE.Vector3(...p)

/** 프레임·서브프레임 튜브 중심선 샘플 (월드 mm) */
const frameSamples = () => partTubeSamples([PART_BY_ID.main_frame, PART_BY_ID.subframe], 200)

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
  it('배기 헤더 tube 경로가 크랭크케이스를 비껴가고 두 본이 집합부 첫 점에서 만난다', () => {
    const header = PART_BY_ID.exhaust_header
    const l = header.instances.find((i) => i.id === 'exhaust_header:l')
    const r = header.instances.find((i) => i.id === 'exhaust_header:r')
    if (!l || !r) throw new Error('exhaust_header l/r instances missing')
    // 좌우가 서로 다른 경로를 타므로 인스턴스마다 geometry가 따로 있어야 한다
    expect(l.geometry).not.toBe(r.geometry)
    expect(l.mountRotation).toEqual([0, 0, 0])
    expect(r.mountRotation).toEqual([0, 0, 0])

    const lPts = tubeSamples(l, 200)
    const rPts = tubeSamples(r, 200)
    expect(lPts.length).toBeGreaterThan(100)

    // 크랭크케이스 박스 (x -330..90, y 280..550, |z|<=190)를 관 반지름만큼 넓힌 범위 밖
    for (const { point: [x, y, z], radius } of [...lPts, ...rPts]) {
      const inside = x >= -330 - radius && x <= 90 + radius && y >= 280 - radius && y <= 550 + radius && Math.abs(z) <= 190 + radius
      expect(inside, `(${x.toFixed(0)}, ${y.toFixed(0)}, ${z.toFixed(0)})`).toBe(false)
    }

    // 마지막 점이 집합부 경로 첫 점에서 40mm 이내
    const collectorStart = vec(PART_BY_ID.exhaust_collector.instances[0].mountPosition)
    for (const pts of [lPts, rPts]) {
      expect(vec(pts[pts.length - 1].point).distanceTo(collectorStart)).toBeLessThanOrEqual(40)
    }

    // 합류 전(y >= 280)에는 두 본이 떨어져 있다
    let minDist = Infinity
    for (const a of lPts) {
      if (a.point[1] < 280) continue
      for (const b of rPts) {
        if (b.point[1] < 280) continue
        minDist = Math.min(minDist, vec(a.point).distanceTo(vec(b.point)))
      }
    }
    expect(minDist).toBeGreaterThanOrEqual(38)
  })
  it('배기가 프레임 튜브를 피하고 라디에이터 호스가 엔진을 파고들지 않는다', () => {
    const frame = frameSamples()
    const exhaust = partTubeSamples([PART_BY_ID.exhaust_header, PART_BY_ID.exhaust_collector], 200)
    let worst = Infinity
    let where = ''
    for (const e of exhaust) {
      for (const f of frame) {
        const gap = vec(e.point).distanceTo(vec(f.point)) - e.radius - f.radius
        if (gap < worst) {
          worst = gap
          where = `(${e.point.map((v) => v.toFixed(0)).join(', ')})`
        }
      }
    }
    expect(worst, `배기가 프레임 튜브에 ${worst.toFixed(1)}mm ${where}`).toBeGreaterThan(0)

    // 라디에이터 호스도 크랭크케이스를 파고들지 않는다
    for (const { point: [x, y, z], radius } of partTubeSamples([PART_BY_ID.radiator_hose], 200)) {
      const inside = x >= -330 - radius && x <= 90 + radius && y >= 280 - radius && y <= 550 + radius && Math.abs(z) <= 190 + radius
      expect(inside, `hose (${x.toFixed(0)}, ${y.toFixed(0)}, ${z.toFixed(0)})`).toBe(false)
    }
  })
  it('배기 관이 지그 기둥을 통과하지 않는다', () => {
    // 지그 기둥은 소품이라 mount가 없다 — 박스를 관 반지름만큼 부풀려 중심선 샘플을 검사한다.
    const boxes = PROPS.map((pr) => {
      if (pr.geometry.type !== 'box') throw new Error('지그 기둥은 box여야 한다')
      const [w, h, d] = pr.geometry.size
      const [px, py, pz] = pr.position
      return { min: [px - w / 2, py, pz - d / 2] as Vec3, max: [px + w / 2, py + h, pz + d / 2] as Vec3, at: px }
    })
    for (const { point: [x, y, z], radius } of partTubeSamples([PART_BY_ID.exhaust_header, PART_BY_ID.exhaust_collector], 400)) {
      for (const b of boxes) {
        const inside =
          x > b.min[0] - radius && x < b.max[0] + radius &&
          y > b.min[1] - radius && y < b.max[1] + radius &&
          z > b.min[2] - radius && z < b.max[2] + radius
        expect(inside, `배기 (${x.toFixed(0)}, ${y.toFixed(0)}, ${z.toFixed(0)}) r${radius} 가 기둥 x=${b.at} 안`).toBe(false)
      }
    }
  })
  it('리어 쇼크가 리어 허거를 뚫지 않는다', async () => {
    const { REAR_AXLE, REAR_TIRE_R } = await import('./spec')
    // 허거 앞쪽 스윕을 줄여 쇼크 로드(끝 x -570, y 653)가 지나는 자리를 비웠다.
    const shock = instanceBounds(PART_BY_ID.rear_shock.instances[0])
    const hugger = instanceBounds(PART_BY_ID.rear_hugger.instances[0])
    const overlaps = (i: number) => shock.min[i] < hugger.max[i] && shock.max[i] > hugger.min[i]
    expect([0, 1, 2].every(overlaps), `shock ${JSON.stringify(shock)} hugger ${JSON.stringify(hugger)}`).toBe(false)
    // 허거는 여전히 타이어를 덮는다
    expect(hugger.max[1] - REAR_AXLE[1]).toBeGreaterThan(REAR_TIRE_R + 15)
  })
  it('대기 위치의 부품이 바닥에 묻히거나 조립된 차체와 겹치지 않는다', () => {
    const asm = assemblyBounds(PARTS)
    for (const p of PARTS) {
      if (p.hidden || p.preplaced) continue
      for (const inst of p.instances) {
        const b = instanceBounds({ ...inst, mountPosition: p.restPosition })
        expect(b.min[1], `${inst.id} 대기 bbox가 바닥 아래`).toBeGreaterThanOrEqual(0)
        const hits = [0, 1, 2].every((i) => b.min[i] < asm.max[i] && b.max[i] > asm.min[i])
        expect(hits, `${inst.id} 대기 bbox가 조립 차체와 겹친다`).toBe(false)
      }
    }
  })
  it('탱크가 캠 커버보다 넓고 캠 커버는 실린더 헤드보다 좁다', () => {
    const tank = instanceBounds(PART_BY_ID.fuel_tank.instances[0])
    const cam = instanceBounds(PART_BY_ID.cam_cover.instances[0])
    const head = instanceBounds(PART_BY_ID.cylinder_head.instances[0])
    expect(cam.max[2]).toBeLessThan(head.max[2])
    expect(tank.max[2]).toBeGreaterThanOrEqual(cam.max[2])
    // 탱크 뒤쪽 밑면은 엔진 윗면(캠 커버 뒤끝 y 789)보다 위라 그 자리에서는 아예 겹치지 않는다
    expect(tank.min[1]).toBeLessThanOrEqual(760)
  })
  it('라디에이터가 프레임 튜브 안쪽에 들어간다', () => {
    // Task 8에서 대각 브레이스([120,780,175]→[225,640,152]→[330,500,128])가 라디에이터를 스쳤다.
    const b = instanceBounds(PART_BY_ID.radiator.instances[0])
    for (const { point: [x, y, z], radius } of frameSamples()) {
      const inside =
        x >= b.min[0] - radius && x <= b.max[0] + radius &&
        y >= b.min[1] - radius && y <= b.max[1] + radius &&
        z >= b.min[2] - radius && z <= b.max[2] + radius
      expect(inside, `frame (${x.toFixed(0)}, ${y.toFixed(0)}, ${z.toFixed(0)}) in radiator`).toBe(false)
    }
    // 코어가 엔진 앞이고 크랭크케이스(x <= 90)와 떨어져 있다
    expect(b.min[0]).toBeGreaterThan(90)
  })
  it('주요 부품의 형상이 곡면 프리미티브를 쓴다', () => {
    const uses = (id: string, type: string) => JSON.stringify(PART_BY_ID[id].geometry).includes(`"type":"${type}"`)
    expect(uses('main_frame', 'tube')).toBe(true)
    expect(uses('subframe', 'tube')).toBe(true)
    expect(uses('swingarm', 'loft')).toBe(true)
    expect(uses('front_wheel', 'lathe')).toBe(true)
    expect(uses('front_wheel', 'extrude')).toBe(true)
    expect(uses('rear_wheel', 'extrude')).toBe(true)
    expect(uses('rear_sprocket', 'extrude')).toBe(true)
    expect(uses('drive_sprocket', 'extrude')).toBe(true)
    expect(uses('front_disc', 'extrude')).toBe(true)
    expect(uses('rear_disc', 'extrude')).toBe(true)
    expect(uses('fork', 'lathe')).toBe(true)
    // Task 9 — 엔진 외관·배기·냉각
    expect(uses('crankcase_lower', 'extrude')).toBe(true)
    expect(uses('crankcase_upper', 'extrude')).toBe(true)
    expect(uses('crankshaft', 'extrude')).toBe(true)
    expect(uses('piston', 'lathe')).toBe(true)
    expect(uses('cylinder_block', 'lathe')).toBe(true)
    expect(uses('cylinder_block', 'extrude')).toBe(true)
    expect(uses('cylinder_head', 'extrude')).toBe(true)
    expect(uses('cam_cover', 'loft')).toBe(true)
    expect(uses('clutch_cover', 'lathe')).toBe(true)
    expect(uses('generator_cover', 'lathe')).toBe(true)
    expect(uses('exhaust_header', 'tube')).toBe(true)
    expect(uses('exhaust_collector', 'tube')).toBe(true)
    expect(uses('muffler', 'lathe')).toBe(true)
    expect(uses('radiator', 'extrude')).toBe(true)
    expect(uses('radiator_hose', 'tube')).toBe(true)
    expect(uses('cooling_fan', 'extrude')).toBe(true)
    // Task 10 — 외장·램프·조작계
    expect(uses('fuel_tank', 'loft')).toBe(true)
    expect(uses('fuel_tank', 'lathe')).toBe(true)
    expect(uses('rider_seat', 'loft')).toBe(true)
    expect(uses('passenger_seat', 'loft')).toBe(true)
    expect(uses('upper_cowl', 'loft')).toBe(true)
    expect(uses('side_cowl', 'loft')).toBe(true)
    expect(uses('lower_cowl', 'loft')).toBe(true)
    expect(uses('tail_cowl', 'loft')).toBe(true)
    expect(uses('windscreen', 'loft')).toBe(true)
    expect(uses('front_fender', 'loft')).toBe(true)
    expect(uses('rear_hugger', 'loft')).toBe(true)
    expect(uses('headlight', 'lathe')).toBe(true)
    expect(uses('taillight', 'lathe')).toBe(true)
    expect(uses('turn_signal', 'lathe')).toBe(true)
    expect(uses('mirror', 'loft')).toBe(true)
    expect(uses('mirror', 'tube')).toBe(true)
    expect(uses('clip_on', 'lathe')).toBe(true)
    expect(uses('lever', 'tube')).toBe(true)
    expect(uses('instrument_cluster', 'extrude')).toBe(true)
    // 크랭크케이스가 프레임 여유 테스트의 기준 봉투(x -330..90, y 280..550, |z| <= 190) 안에 든다.
    // 둔각 모서리에서 베벨 마이터가 bevelSize를 아주 조금 넘어서 x만 1mm 여유를 둔다.
    const lower = instanceBounds(PART_BY_ID.crankcase_lower.instances[0])
    const upper = instanceBounds(PART_BY_ID.crankcase_upper.instances[0])
    expect(lower.min[0]).toBeGreaterThanOrEqual(-331)
    expect(upper.max[0]).toBeLessThanOrEqual(91)
    expect(lower.min[1]).toBeCloseTo(280, 1)
    expect(upper.max[1]).toBeCloseTo(550, 1)
    for (const b of [lower, upper]) expect(Math.max(-b.min[2], b.max[2])).toBeLessThanOrEqual(190.01)
  })
  it('좌우 외장은 인스턴스마다 뒤집힌 geometry를 쓰고 z로 대칭이다', () => {
    for (const id of ['side_cowl', 'lower_cowl', 'mirror', 'lever']) {
      const [l, r] = PART_BY_ID[id].instances
      expect(l.geometry, id).not.toBe(r.geometry)
      const lb = instanceBounds(l)
      const rb = instanceBounds(r)
      expect(lb.min[2], `${id} z`).toBeCloseTo(-rb.max[2], 3)
      expect(lb.max[2], `${id} z`).toBeCloseTo(-rb.min[2], 3)
      expect(lb.min[1], `${id} y`).toBeCloseTo(rb.min[1], 3)
      expect(lb.min[0], `${id} x`).toBeCloseTo(rb.min[0], 3)
    }
  })
  it('탱크가 프레임 메인 스파 안쪽에 얹히고 시트는 서브프레임 레일 위에 앉는다', () => {
    const tank = instanceBounds(PART_BY_ID.fuel_tank.instances[0])
    const rider = instanceBounds(PART_BY_ID.rider_seat.instances[0])
    const pillion = instanceBounds(PART_BY_ID.passenger_seat.instances[0])

    // 탱크는 프레임 상부 튜브대(메인 스파 y 780~925, 백본 y 805~908) 위에 얹힌다
    expect(tank.min[1]).toBeGreaterThanOrEqual(740)
    expect(tank.max[1]).toBeLessThanOrEqual(1000)
    // 메인 스파(|z| >= 140)는 탱크 옆구리 바깥을 지난다. 중앙 백본과 그 브레이스(|z| < 140)는
    // 실물처럼 탱크 껍데기 안을 지나므로 뺀다.
    for (const { point: [x, y, z], radius } of frameSamples()) {
      if (Math.abs(z) < 140) continue
      if (x < tank.min[0] || x > tank.max[0] || y < tank.min[1] || y > tank.max[1]) continue
      expect(Math.abs(z) - radius, `spar (${x.toFixed(0)}, ${y.toFixed(0)}, ${z.toFixed(0)})`).toBeGreaterThan(tank.max[2])
    }
    // 탱크 → 라이더 시트 → 동승자 시트가 앞뒤로 겹치지 않는다
    expect(tank.min[0]).toBeGreaterThanOrEqual(rider.max[0])
    expect(rider.min[0]).toBeGreaterThanOrEqual(pillion.max[0])
    // 시트 두 장 다 서브프레임 레일보다 위에 있다
    for (const seat of [rider, pillion]) {
      for (const { point: [x, y, z], radius } of partTubeSamples([PART_BY_ID.subframe], 200)) {
        const inside =
          x >= seat.min[0] && x <= seat.max[0] &&
          y >= seat.min[1] - radius && y <= seat.max[1] + radius &&
          z >= seat.min[2] - radius && z <= seat.max[2] + radius
        expect(inside, `rail (${x.toFixed(0)}, ${y.toFixed(0)}, ${z.toFixed(0)})`).toBe(false)
      }
    }
  })
  it('펜더가 타이어를 감싸고 카울이 라디에이터를 덮는다', async () => {
    const { FRONT_AXLE, FRONT_TIRE_R } = await import('./spec')
    const fender = instanceBounds(PART_BY_ID.front_fender.instances[0])
    // 타이어 위를 덮되 20~45mm 안쪽에서 돈다
    expect(fender.max[1] - FRONT_AXLE[1]).toBeGreaterThan(FRONT_TIRE_R + 15)
    expect(fender.max[1] - FRONT_AXLE[1]).toBeLessThan(FRONT_TIRE_R + 45)
    // 액슬보다 한참 위에서 끝난다 (포크 다리를 물지 않는다)
    expect(fender.min[1]).toBeGreaterThan(FRONT_AXLE[1] + 80)

    // 사이드 카울이 라디에이터(x 223..257, y 385..665, |z| <= 125)를 옆에서 덮는다
    const radiator = instanceBounds(PART_BY_ID.radiator.instances[0])
    const cowl = instanceBounds(PART_BY_ID.side_cowl.instances[1])
    expect(cowl.min[0]).toBeLessThan(radiator.min[0])
    expect(cowl.max[0]).toBeGreaterThan(radiator.max[0])
    expect(cowl.max[2]).toBeGreaterThan(radiator.max[2])
    expect(cowl.min[1]).toBeLessThan(radiator.min[1])
    expect(cowl.max[1]).toBeGreaterThan(radiator.max[1])
  })
  it('계기판 키 실린더가 점화 키 마운트에 수직으로 맞는다', () => {
    const cluster = PART_BY_ID.instrument_cluster
    const g = cluster.geometry
    if (g.type !== 'composite') throw new Error('cluster geometry must be composite')
    const bore = g.children.find((c) => c.geometry.type === 'cylinder')
    if (!bore?.position || !bore.rotation) throw new Error('cluster key cylinder missing')
    const root = new THREE.Object3D()
    root.position.fromArray(cluster.mountPosition)
    root.rotation.fromArray(cluster.mountRotation)
    const child = new THREE.Object3D()
    child.position.fromArray(bore.position)
    child.rotation.fromArray(bore.rotation)
    root.add(child)
    root.updateMatrixWorld(true)
    expect(child.getWorldPosition(new THREE.Vector3()).distanceTo(vec(PART_BY_ID.ignition_key.mountPosition))).toBeLessThan(1)
    // 보어가 수직이라 키를 위에서 꽂는다
    const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(child.getWorldQuaternion(new THREE.Quaternion()))
    expect(axis.angleTo(new THREE.Vector3(0, 1, 0))).toBeLessThan(1e-6)
  })
  it('전체 장착 bbox가 실물 외곽(1990×710×1120, ±10%) 안이다', () => {
    // 미러는 기본으로 빠진다(assemblyBounds의 exclude 기본값).
    const b = assemblyBounds(PARTS)
    expect(b.max[0] - b.min[0]).toBeGreaterThan(1990 * 0.9)
    expect(b.max[0] - b.min[0]).toBeLessThan(1990 * 1.1)
    expect(b.max[2] - b.min[2]).toBeLessThan(760)
    expect(b.max[1]).toBeLessThan(1120 * 1.1)
    expect(b.min[1]).toBeGreaterThan(-5)
  })
  it('프레임·서브프레임 튜브가 크랭크케이스를 관통하지 않는다', () => {
    // 크랭크케이스 x -330..90, y 280..550, |z| <= 190 을 튜브 반지름만큼 넓힌 상자
    for (const id of ['main_frame', 'subframe']) {
      const part = PART_BY_ID[id]
      const root = new THREE.Object3D()
      root.position.fromArray(part.mountPosition)
      root.rotation.fromArray(part.mountRotation)
      root.updateMatrixWorld(true)
      const g = part.geometry
      if (g.type !== 'composite') throw new Error(`${id} geometry must be composite`)
      for (const child of g.children as CompositeChild[]) {
        if (child.geometry.type !== 'tube') continue
        const r = child.geometry.radius
        const obj = new THREE.Object3D()
        if (child.position) obj.position.fromArray(child.position)
        if (child.rotation) obj.rotation.fromArray(child.rotation)
        root.add(obj)
        root.updateMatrixWorld(true)
        const curve = new THREE.CatmullRomCurve3(
          child.geometry.path.map((p) => new THREE.Vector3(p[0], p[1], p[2])),
          false,
          'centripetal',
        )
        for (const p of curve.getPoints(160)) {
          const w = obj.localToWorld(p.clone())
          const inside =
            w.x >= -330 - r && w.x <= 90 + r && w.y >= 280 - r && w.y <= 550 + r && Math.abs(w.z) <= 190 + r
          expect(inside, `${id} (${w.x.toFixed(0)}, ${w.y.toFixed(0)}, ${w.z.toFixed(0)})`).toBe(false)
        }
      }
    }
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
