// Sketchfab에서 내려받은 완성차 glTF를 이 저장소 좌표계(+x 앞, +y 위, +z 오른쪽, 지면 y=0,
// 1 unit = 10 mm)로 굽고 바퀴를 회전 가능한 노드로 묶어 ride.glb 하나로 내보낸다. 사용:
//   node scripts/prepare-ride-model.mjs ninja400/zx6r/scene.gltf --out public/models/ninja400 [--flip] [--tex 2048]
// 검출(액슬·반지름·앞뒤)은 전부 정점에서 자동으로 하고, 이름 있는 노드(Front Wheel 등)와
// 교차검증해 5%를 넘게 어긋나면 멈춘다. 결과는 ride.json과 rideLayout.generated.ts로 같이 쓴다.
import { mkdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { dedup, flatten, meshopt, prune, textureCompress, weld } from '@gltf-transform/functions'
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer'
import sharp from 'sharp'

/** 1 unit = 10 mm (engine/types.ts의 MM과 같은 값) */
const MM = 0.1
/** 목표 축간거리 (mm) — 닌자 400 spec.ts의 WHEELBASE */
const WHEELBASE = 1370
/** glb 크기 상한 (bytes) */
const SIZE_LIMIT = 12 * 1024 * 1024
/** 바퀴 원기둥 판정 여유 (mm) */
const WHEEL_PAD = 20
/** 액슬과 같이 도는 부품으로 볼 bbox 중심 허용 편차 (회전면 안에서, 타이어 반지름 대비) */
const CONCENTRIC = 0.25
/** 바퀴 옆에 붙어 도는 것(디스크·스프로킷)까지 인정할 좌우 여유 (mm) */
const WHEEL_SIDE_PAD = 40
/** 그립 오른쪽 끝으로 볼 구간 (mm) */
const GRIP_END = 120
/** 교차검증 허용 오차 (비율) */
const TOLERANCE = 0.05

const SOURCE = {
  name: 'Kawasaki ninja ZX-6R',
  author: 'valvetin',
  url: 'https://sketchfab.com/3d-models/kawasaki-ninja-zx-6r-4af2b6840b8045a5af5e8df8a85f04fa',
  license: 'CC-BY-4.0',
}

// --- 인자 -------------------------------------------------------------------

const argv = process.argv.slice(2)
const src = argv.find((a) => !a.startsWith('--'))
const flag = (name) => argv.includes(`--${name}`)
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}
if (!src) {
  console.error('사용: node scripts/prepare-ride-model.mjs <scene.gltf> --out <dir> [--flip] [--tex 2048]')
  process.exit(1)
}
const outDir = opt('out', 'public/models/ninja400')
const forceFlip = flag('flip')

// --- 4x4 열 우선 행렬 --------------------------------------------------------

const applyPoint = (m, x, y, z) => [
  m[0] * x + m[4] * y + m[8] * z + m[12],
  m[1] * x + m[5] * y + m[9] * z + m[13],
  m[2] * x + m[6] * y + m[10] * z + m[14],
]
/** 지면 정렬용 루트 행렬: y축 yaw → 균등 스케일 → 평행이동 */
const alignMatrix = (yaw, scale, tx, ty, tz) => {
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  // R_y(yaw): (x,y,z) → (x·cos + z·sin, y, −x·sin + z·cos)
  return [c * scale, 0, -s * scale, 0, 0, scale, 0, 0, s * scale, 0, c * scale, 0, tx, ty, tz, 1]
}
const det3 = (m) =>
  m[0] * (m[5] * m[10] - m[6] * m[9]) - m[4] * (m[1] * m[10] - m[2] * m[9]) + m[8] * (m[1] * m[6] - m[2] * m[5])

// --- 기하 도우미 -------------------------------------------------------------

const emptyBox = () => ({ min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] })
const growBox = (b, p) => {
  for (let i = 0; i < 3; i++) {
    if (p[i] < b.min[i]) b.min[i] = p[i]
    if (p[i] > b.max[i]) b.max[i] = p[i]
  }
  return b
}
const boxCenter = (b) => [0, 1, 2].map((i) => (b.min[i] + b.max[i]) / 2)
const isEmptyBox = (b) => !Number.isFinite(b.min[0])

/** 노드마다 월드 좌표 정점을 뽑는다. flatten 뒤라 노드 행렬이 곧 월드 행렬이다. */
function worldVertices(doc) {
  const out = []
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh()
    if (!mesh) continue
    const m = node.getWorldMatrix()
    const pts = []
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION')
      if (!pos) continue
      const el = [0, 0, 0]
      for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, el)
        pts.push(applyPoint(m, el[0], el[1], el[2]))
      }
    }
    if (pts.length) out.push({ node, name: node.getName(), pts })
  }
  return out
}

/** Sketchfab이 붙인 재질 접미사(_Mesh_0 등)를 뗀 소문자 이름 */
const baseName = (name) => name.replace(/_(mesh|engine|panels|decal)_\d+$/i, '').toLowerCase()

/** 이름이 정확히 일치하는 노드들의 정점 상자. mapPoint로 좌표를, filter로 정점을 거른다 */
function boxOfNames(items, names, { mapPoint, filter } = {}) {
  const set = new Set(names)
  const b = emptyBox()
  for (const it of items) {
    if (!set.has(baseName(it.name))) continue
    for (const raw of it.pts) {
      const p = mapPoint ? mapPoint(raw) : raw
      if (filter && !filter(p)) continue
      growBox(b, p)
    }
  }
  return b
}

/** 홀수/짝수 모두 다루는 중앙값 */
const median = (arr) => {
  const a = [...arr].sort((x, y) => x - y)
  const m = a.length >> 1
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2
}

/**
 * 지면에 접한 원의 반지름. 바닥 접점에서 t만큼 떨어진 실루엣 높이 y 하나면
 * r = (t² + y²) / 2y 로 정해진다. 칸마다 구한 값의 중앙값을 쓴다 —
 * 얕은 호에 원을 대수적으로 맞추면(Kåsa) 반지름이 10% 넘게 작게 나온다(실측).
 */
function radiusFromSilhouette(bins, minY) {
  const rs = []
  for (const [d, y] of bins) if (y >= minY) rs.push((d * d + y * y) / (2 * y))
  return rs.length ? { r: median(rs), samples: rs.length } : null
}

// --- 검출 -------------------------------------------------------------------

/**
 * 접지 정점(가장 낮은 2% 띠)을 진행축으로 2군집 → 앞뒤 액슬과 타이어 반지름.
 * 진행축은 수평면 PCA 최장축, 반지름은 군집 정점에 맞춘 원의 반지름이다.
 */
function detectWheels(items) {
  const all = emptyBox()
  for (const it of items) for (const p of it.pts) growBox(all, p)
  const ground = all.min[1]
  const height = all.max[1] - all.min[1]
  const band = ground + 0.02 * height

  const low = []
  for (const it of items) for (const p of it.pts) if (p[1] < band) low.push(p)
  if (low.length < 100) throw new Error(`접지 정점이 너무 적다 (${low.length})`)

  // 수평면 PCA 최장축
  let cx = 0, cz = 0
  for (const p of low) { cx += p[0]; cz += p[2] }
  cx /= low.length; cz /= low.length
  let sxx = 0, sxz = 0, szz = 0
  for (const p of low) {
    const dx = p[0] - cx
    const dz = p[2] - cz
    sxx += dx * dx; sxz += dx * dz; szz += dz * dz
  }
  const tr = sxx + szz
  const dt = sxx * szz - sxz * sxz
  const lambda = tr / 2 + Math.sqrt(Math.max(0, (tr / 2) * (tr / 2) - dt))
  let ax = sxz
  let az = lambda - sxx
  if (Math.hypot(ax, az) < 1e-9) { ax = 1; az = 0 }
  const len = Math.hypot(ax, az)
  ax /= len; az /= len
  const proj = (p) => (p[0] - cx) * ax + (p[2] - cz) * az

  // 2-means (양 끝에서 시작)
  const ts = low.map(proj)
  let c0 = Infinity
  let c1 = -Infinity
  for (const t of ts) { if (t < c0) c0 = t; if (t > c1) c1 = t }
  for (let iter = 0; iter < 50; iter++) {
    let s0 = 0, n0 = 0, s1 = 0, n1 = 0
    for (const t of ts) {
      if (Math.abs(t - c0) <= Math.abs(t - c1)) { s0 += t; n0++ } else { s1 += t; n1++ }
    }
    const next0 = n0 ? s0 / n0 : c0
    const next1 = n1 ? s1 / n1 : c1
    if (Math.abs(next0 - c0) < 1e-9 && Math.abs(next1 - c1) < 1e-9) { c0 = next0; c1 = next1; break }
    c0 = next0; c1 = next1
  }

  // 군집 → 접지 현(弦)으로 반지름 1차 추정 → 바닥 실루엣(구간별 최저점)으로 정밀화.
  // 접지 띠만으로는 호가 너무 얕아 반지름을 믿을 수 없다.
  const bandH = band - ground
  const silhouette = (t0, r) => {
    const BINS = 64
    const span = 0.9 * r
    const bins = new Array(BINS).fill(Infinity)
    for (const it of items) {
      for (const p of it.pts) {
        const d = proj(p) - t0
        if (Math.abs(d) >= span) continue
        const y = p[1] - ground
        if (y > 1.5 * r) continue
        const k = Math.min(BINS - 1, Math.floor(((d + span) / (2 * span)) * BINS))
        if (y < bins[k]) bins[k] = y
      }
    }
    const out = []
    for (let k = 0; k < BINS; k++) {
      if (!Number.isFinite(bins[k])) continue
      out.push([-span + ((k + 0.5) / BINS) * 2 * span, bins[k]])
    }
    return out
  }
  const group = (center, other) => {
    let lo = Infinity, hi = -Infinity, n = 0
    for (let i = 0; i < ts.length; i++) {
      if (Math.abs(ts[i] - center) > Math.abs(ts[i] - other)) continue
      if (ts[i] < lo) lo = ts[i]
      if (ts[i] > hi) hi = ts[i]
      n++
    }
    const t0 = (lo + hi) / 2
    const w = (hi - lo) / 2
    // 높이 h에서 잘린 현의 반폭 w → r = (w² + h²) / 2h
    const rChord = (w * w + bandH * bandH) / (2 * bandH)
    let r = rChord
    let samples = 0
    for (let pass = 0; pass < 2; pass++) {
      const got = radiusFromSilhouette(silhouette(t0, r), 0.15 * r)
      if (!got) break
      r = got.r
      samples = got.samples
    }
    return { t: t0, r, rChord, count: n, samples }
  }
  const endA = group(c0, c1)
  const endB = group(c1, c0)

  // 앞 판별: 액슬 둘레 0.35·축간거리 안에서 가장 높은 점이 있는 쪽(윈드스크린)이 앞
  const wheelbase = Math.abs(endB.t - endA.t)
  const topNear = (t0) => {
    let top = -Infinity
    for (const it of items) for (const p of it.pts) if (Math.abs(proj(p) - t0) < 0.35 * wheelbase && p[1] > top) top = p[1]
    return top
  }
  const topA = topNear(endA.t)
  const topB = topNear(endB.t)

  return { ground, all, proj, axis: [ax, az], origin: [cx, cz], endA, endB, wheelbase, topA, topB, lowCount: low.length }
}

// --- 본 작업 ----------------------------------------------------------------

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder })

async function run(tex) {
  const doc = await io.read(src)
  await doc.transform(dedup(), prune(), weld(), flatten())

  const raw = worldVertices(doc)
  const nodeCount = raw.length
  const det = detectWheels(raw)

  // 자동 검출 앞/뒤
  let front = det.topA >= det.topB ? det.endA : det.endB
  let rear = front === det.endA ? det.endB : det.endA
  let flippedByHeuristic = false
  if (forceFlip) {
    ;[front, rear] = [rear, front]
    flippedByHeuristic = true
  }

  // 이름 있는 노드와 교차검증 (원본 프레임에서 진행축 좌표로 비교)
  const frontNamed = boxOfNames(raw, ['front wheel', 'front rim'])
  const rearNamed = boxOfNames(raw, ['rear wheel', 'rear rim'])
  const namedStat = (b) => {
    if (isEmptyBox(b)) return null
    const cLo = det.proj([b.min[0], 0, b.min[2]])
    const cHi = det.proj([b.max[0], 0, b.max[2]])
    return { t: (cLo + cHi) / 2, r: (b.max[1] - b.min[1]) / 2, y: (b.max[1] + b.min[1]) / 2 - det.ground }
  }
  const fN = namedStat(frontNamed)
  const rN = namedStat(rearNamed)

  const scaleMm = (WHEELBASE / det.wheelbase) // 원본 unit → mm
  const report = []
  const failures = []
  const check = (label, autoV, namedV, refMm) => {
    if (namedV === null || namedV === undefined) { report.push(`${label}: 이름 노드 없음 — 교차검증 건너뜀`); return }
    const diff = Math.abs(autoV - namedV) * scaleMm
    const rel = diff / refMm
    report.push(
      `${label}: auto ${(autoV * scaleMm).toFixed(1)} mm / named ${(namedV * scaleMm).toFixed(1)} mm · Δ ${diff.toFixed(1)} mm (${(rel * 100).toFixed(2)}%)`,
    )
    if (rel > TOLERANCE) failures.push(`${label} ${(rel * 100).toFixed(1)}% 어긋남`)
  }
  check('앞 액슬 위치', front.t, fN && fN.t, WHEELBASE)
  check('뒤 액슬 위치', rear.t, rN && rN.t, WHEELBASE)
  check('앞 타이어 반지름', front.r, fN && fN.r, fN ? fN.r * scaleMm : WHEELBASE)
  check('뒤 타이어 반지름', rear.r, rN && rN.r, rN ? rN.r * scaleMm : WHEELBASE)
  report.push(`앞 현 1차 추정 ${(front.rChord * scaleMm).toFixed(1)} mm → 실루엣 ${front.samples}칸 중앙값 ${(front.r * scaleMm).toFixed(1)} mm`)
  report.push(`뒤 현 1차 추정 ${(rear.rChord * scaleMm).toFixed(1)} mm → 실루엣 ${rear.samples}칸 중앙값 ${(rear.r * scaleMm).toFixed(1)} mm`)
  if (fN && rN) {
    const namedFrontIsFront = fN.t > rN.t === front.t > rear.t
    if (!namedFrontIsFront) failures.push('앞뒤 판별이 이름 노드(Front Wheel/Rear Wheel)와 반대다 — --flip을 확인하라')
    else report.push(`앞 판별: 높이 휴리스틱 = 이름 노드 일치 (앞쪽 최고점 ${(Math.max(det.topA, det.topB) - det.ground).toFixed(3)} u)`)
  }
  if (failures.length) {
    console.log('\n교차검증')
    for (const line of report) console.log(`  ${line}`)
    throw new Error(`자동 검출과 이름 노드가 어긋난다 (허용 ${TOLERANCE * 100}%): ${failures.join(' / ')}`)
  }

  // 정렬 행렬: 진행 방향 → +x, 지면 → y=0, 바퀴 중심선 → z=0, 액슬 중점 → x=0
  const [ax, az] = det.axis
  const sign = front.t > rear.t ? 1 : -1
  const fwd = [ax * sign, az * sign]
  // R_y(yaw)가 (fwd.x, 0, fwd.z)를 (1,0,0)으로 보내야 한다: x' = fx·cos + fz·sin = 1
  // R_y(yaw): (x,z) → (x·cos+z·sin, −x·sin+z·cos). 진행축 (fx,fz)가 (1,0)으로 가려면 cos=fx, sin=fz
  const yaw = Math.atan2(fwd[1], fwd[0])
  const cy = Math.cos(yaw)
  const sy = Math.sin(yaw)
  const rotatedX = fwd[0] * cy + fwd[1] * sy
  const rotatedZ = -fwd[0] * sy + fwd[1] * cy
  if (Math.abs(rotatedX - 1) > 1e-6 || Math.abs(rotatedZ) > 1e-6) {
    throw new Error(`yaw 계산 오류: 진행축이 (${rotatedX.toFixed(4)}, ${rotatedZ.toFixed(4)})로 갔다`)
  }
  const scale = scaleMm * MM // 원본 unit → scene unit

  // 회전·스케일만 적용한 임시 행렬로 평행이동을 잰다
  const pre = alignMatrix(yaw, scale, 0, 0, 0)
  const wheelLateral = boxOfNames(raw, ['front wheel', 'front rim', 'rear wheel', 'rear rim'], {
    mapPoint: (p) => applyPoint(pre, p[0], p[1], p[2]),
  })
  const preAll = emptyBox()
  for (const it of raw) for (const p of it.pts) growBox(preAll, applyPoint(pre, p[0], p[1], p[2]))
  const frontXPre = front.t * scale
  const rearXPre = rear.t * scale
  const tx = -(frontXPre + rearXPre) / 2
  const ty = -preAll.min[1]
  const tz = isEmptyBox(wheelLateral) ? -(preAll.min[2] + preAll.max[2]) / 2 : -(wheelLateral.min[2] + wheelLateral.max[2]) / 2
  const align = alignMatrix(yaw, scale, tx, ty, tz)
  if (det3(align) <= 0) throw new Error('정렬 행렬이 좌우를 뒤집는다 (determinant ≤ 0)')

  // 굽기: 새 루트 아래로 모아 다시 flatten
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0]
  const alignNode = doc.createNode('align').setMatrix(align)
  for (const child of [...scene.listChildren()]) {
    scene.removeChild(child)
    alignNode.addChild(child)
  }
  scene.addChild(alignNode)
  await doc.transform(flatten())

  // 최종 프레임에서 다시 잰다 (scene unit → mm)
  const items = worldVertices(doc)
  const toMm = (v) => v / MM
  // 최종 액슬: 이름 노드가 있으면 그 bbox(정확히 액슬 중심·타이어 반지름)를 쓰고,
  // 없으면 자동 검출값을 쓴다. 둘의 차이는 위 교차검증에서 이미 5% 안임을 확인했다.
  const axleSource = fN && rN ? '이름 노드' : '자동 검출'
  const frontAxle = { x: toMm(frontXPre + tx), r: (fN ? fN.r : front.r) * scaleMm }
  const rearAxle = { x: toMm(rearXPre + tx), r: (rN ? rN.r : rear.r) * scaleMm }
  frontAxle.y = frontAxle.r
  rearAxle.y = rearAxle.r
  // 타이어 반폭 (mm) — 옆에 붙어 도는 디스크·스프로킷을 인정하는 기준
  const halfWidthOf = (names, r) => {
    const b = boxOfNames(items, names, { mapPoint: (p) => p.map(toMm) })
    return isEmptyBox(b) ? CONCENTRIC * r : Math.max(Math.abs(b.min[2]), Math.abs(b.max[2]))
  }
  frontAxle.halfWidth = halfWidthOf(['front wheel', 'front rim'], frontAxle.r)
  rearAxle.halfWidth = halfWidthOf(['rear wheel', 'rear rim'], rearAxle.r)

  // 바퀴 묶기 — bbox가 액슬 원기둥 안에 완전히 들어가는 노드만. Holder(액슬 홀더·캘리퍼)는 뺀다
  const groups = { wheel_front: [], wheel_rear: [] }
  const excluded = []
  const boxes = new Map()
  for (const it of items) {
    const b = emptyBox()
    for (const p of it.pts) growBox(b, p)
    boxes.set(it.node, { min: b.min.map(toMm), max: b.max.map(toMm) })
  }
  for (const it of items) {
    const b = boxes.get(it.node)
    const fits = (axle) =>
      Math.abs(b.min[0] - axle.x) <= axle.r + WHEEL_PAD &&
      Math.abs(b.max[0] - axle.x) <= axle.r + WHEEL_PAD &&
      b.max[1] <= 2 * axle.r + WHEEL_PAD
    // 액슬과 같이 도는 부품은 회전면(x·y) 안에서 액슬을 중심으로 대칭이다. 원기둥 안이어도
    // 중심이 어긋나 있으면 도는 물건이 아니다 (배기·리어 허거·캘리퍼·브래킷이 여기서 걸러진다).
    // 좌우(z)는 디스크·스프로킷이 타이어 옆에 붙으므로 타이어 폭 + 여유까지 인정한다.
    const concentric = (axle) =>
      Math.abs((b.min[0] + b.max[0]) / 2 - axle.x) <= CONCENTRIC * axle.r &&
      Math.abs((b.min[1] + b.max[1]) / 2 - axle.y) <= CONCENTRIC * axle.r &&
      Math.abs((b.min[2] + b.max[2]) / 2) <= axle.halfWidth + WHEEL_SIDE_PAD
    const axles = [['wheel_front', frontAxle], ['wheel_rear', rearAxle]]
    const hit = axles.find(([, a]) => fits(a))
    if (!hit) continue
    const [key, axle] = hit
    if (it.name.toLowerCase().includes('holder')) { excluded.push(`${it.name} (이름에 Holder)`); continue }
    if (!concentric(axle)) { excluded.push(`${it.name} (액슬 비중심)`); continue }
    groups[key].push(it)
    it.center = [0, 1, 2].map((i) => Math.round((b.min[i] + b.max[i]) / 2))
  }

  const wheelNodes = {}
  for (const [key, axle] of [['wheel_front', frontAxle], ['wheel_rear', rearAxle]]) {
    const node = doc.createNode(key).setTranslation([axle.x * MM, axle.y * MM, 0])
    for (const it of groups[key]) {
      const w = it.node.getWorldMatrix()
      const local = w.slice()
      local[12] -= axle.x * MM
      local[13] -= axle.y * MM
      scene.removeChild(it.node)
      it.node.setMatrix(local)
      node.addChild(it.node)
    }
    scene.addChild(node)
    wheelNodes[key] = node
  }
  const body = doc.createNode('body')
  for (const child of [...scene.listChildren()]) {
    if (child === wheelNodes.wheel_front || child === wheelNodes.wheel_rear) continue
    scene.removeChild(child)
    body.addChild(child)
  }
  scene.addChild(body)

  // 랜드마크 (mm)
  const bboxOf = (names, filter) => boxOfNames(items, names, { mapPoint: (p) => p.map(toMm), filter })
  const keyHoleBox = bboxOf(['key hole'])
  const buttonBox = bboxOf(['button'], (p) => p[2] > 0)
  const barsAll = bboxOf(['steering wheel'], null)
  const gripBox = isEmptyBox(barsAll) ? barsAll : bboxOf(['steering wheel'], (p) => p[2] > barsAll.max[2] - GRIP_END)
  const dashBox = bboxOf(['dashboard'])
  const round1 = (v) => Math.round(v * 10) / 10
  const landmark = (b, label) => {
    if (isEmptyBox(b)) throw new Error(`랜드마크 ${label}을(를) 찾지 못했다`)
    return boxCenter(b).map(round1)
  }
  const landmarksMm = {
    keyHole: landmark(keyHoleBox, 'Key Hole'),
    buttonRight: landmark(buttonBox, 'Button(오른쪽)'),
    gripRight: landmark(gripBox, 'Steering Wheel(오른쪽 끝)'),
    dashboard: landmark(dashBox, 'Dashboard'),
  }

  const allBox = emptyBox()
  for (const it of items) for (const p of it.pts) growBox(allBox, p.map(toMm))

  // 압축 후 쓰기
  await MeshoptEncoder.ready
  await doc.transform(
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [tex, tex], quality: 80 }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  )
  mkdirSync(outDir, { recursive: true })
  const glbPath = join(outDir, 'ride.glb')
  await io.write(glbPath, doc)
  const bytes = statSync(glbPath).size

  const exhaust = bboxOf(['exhaust'])  // 배기 슬립온 — 차량 오른쪽(+z)에 있어야 한다
  const info = {
    tex,
    bytes,
    glbPath,
    nodeCount,
    report,
    scaleMm,
    yawDeg: (yaw * 180) / Math.PI,
    flippedByHeuristic,
    det,
    frontAxle,
    rearAxle,
    axleSource,
    groups: {
      wheel_front: groups.wheel_front.map((i) => `${i.name} @${i.center.join(',')}`),
      wheel_rear: groups.wheel_rear.map((i) => `${i.name} @${i.center.join(',')}`),
    },
    excluded,
    landmarksMm,
    boundsMm: { min: allBox.min.map(round1), max: allBox.max.map(round1) },
    exhaustZ: isEmptyBox(exhaust) ? null : round1(boxCenter(exhaust)[2]),
  }
  return info
}

await MeshoptEncoder.ready
let tex = Number(opt('tex', 2048))
let info = await run(tex)
if (info.bytes > SIZE_LIMIT && tex > 1024) {
  console.log(`\nglb ${(info.bytes / 1e6).toFixed(2)} MB > 12 MB — 텍스처를 1024로 내려 다시 굽는다.`)
  tex = 1024
  info = await run(tex)
}

// --- 출력 -------------------------------------------------------------------

const round1 = (v) => Math.round(v * 10) / 10
const rideJson = {
  wheelbaseMm: round1(info.frontAxle.x - info.rearAxle.x),
  front: { x: round1(info.frontAxle.x), y: round1(info.frontAxle.y), r: round1(info.frontAxle.r) },
  rear: { x: round1(info.rearAxle.x), y: round1(info.rearAxle.y), r: round1(info.rearAxle.r) },
  boundsMm: info.boundsMm,
  landmarksMm: info.landmarksMm,
  source: SOURCE,
}
writeFileSync(join(outDir, 'ride.json'), `${JSON.stringify(rideJson, null, 2)}\n`)

const vec = (v) => `[${v.map((n) => n.toFixed(1)).join(', ')}]`
const ts = `// 생성 파일 — scripts/prepare-ride-model.mjs가 만든다. 손으로 고치지 않는다.
// 실물 모델(${SOURCE.name} · ${SOURCE.author} · ${SOURCE.license})을 저장소 좌표계로 구운 결과. 단위는 mm.
export const RIDE_MODEL = {
  /** 축간거리 (mm) */
  wheelbaseMm: ${rideJson.wheelbaseMm},
  /** 앞 액슬 중심과 타이어 반지름 (mm) */
  front: { x: ${rideJson.front.x}, y: ${rideJson.front.y}, r: ${rideJson.front.r} },
  /** 뒤 액슬 중심과 타이어 반지름 (mm) */
  rear: { x: ${rideJson.rear.x}, y: ${rideJson.rear.y}, r: ${rideJson.rear.r} },
  /** 전체 바운딩박스 (mm) */
  boundsMm: { min: ${vec(rideJson.boundsMm.min)}, max: ${vec(rideJson.boundsMm.max)} },
  /** 상호작용 지점의 bbox 중심 (mm) */
  landmarksMm: {
    keyHole: ${vec(rideJson.landmarksMm.keyHole)},
    buttonRight: ${vec(rideJson.landmarksMm.buttonRight)},
    gripRight: ${vec(rideJson.landmarksMm.gripRight)},
    dashboard: ${vec(rideJson.landmarksMm.dashboard)},
  },
  source: {
    name: '${SOURCE.name}',
    author: '${SOURCE.author}',
    url: '${SOURCE.url}',
    license: '${SOURCE.license}',
  },
} as const
`
writeFileSync('src/products/ninja400/render/rideLayout.generated.ts', ts)

console.log(`\n입력 ${src} · 메시 노드 ${info.nodeCount}개 · 접지 정점 ${info.det.lowCount}개`)
console.log(`yaw ${info.yawDeg.toFixed(1)}° · 스케일 ${info.scaleMm.toFixed(2)} mm/unit · 텍스처 ${info.tex}px${info.flippedByHeuristic ? ' · --flip 적용' : ''}`)
console.log('\n교차검증')
for (const line of info.report) console.log(`  ${line}`)
console.log(`\n액슬 (mm, 저장소 좌표) — 값 출처: ${info.axleSource}`)
console.log(`  front x ${rideJson.front.x}  y ${rideJson.front.y}  r ${rideJson.front.r}`)
console.log(`  rear  x ${rideJson.rear.x}  y ${rideJson.rear.y}  r ${rideJson.rear.r}`)
console.log(`  wheelbase ${rideJson.wheelbaseMm} mm (목표 ${WHEELBASE})`)
console.log(`  bounds min ${vec(rideJson.boundsMm.min)}  max ${vec(rideJson.boundsMm.max)}`)
console.log(`  배기(Exhaust) z ${info.exhaustZ} mm — 양수면 차량 오른쪽(+z)으로 옳게 갔다`)
console.log('\n바퀴 묶음')
console.log(`  wheel_front (${info.groups.wheel_front.length}): ${info.groups.wheel_front.join(', ') || '없음'}`)
console.log(`  wheel_rear  (${info.groups.wheel_rear.length}): ${info.groups.wheel_rear.join(', ') || '없음'}`)
console.log(`  제외: ${info.excluded.join(', ') || '없음'}`)
console.log('\n랜드마크 (mm)')
for (const [k, v] of Object.entries(rideJson.landmarksMm)) console.log(`  ${k.padEnd(12)} ${vec(v)}`)
console.log(`\n${info.glbPath} ${(info.bytes / 1e6).toFixed(2)} MB (상한 12 MB)`)
console.log(`${join(outDir, 'ride.json')} · src/products/ninja400/render/rideLayout.generated.ts 갱신`)
