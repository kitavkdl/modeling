// 한 덩어리로 내보내진 glTF 메시를 인덱스 연결성으로 나눠(=원본 모델링 툴의 오브젝트 단위) 조각마다 노드를 가진
// 새 glTF를 만든다. 정점은 월드(Y-up, m) 좌표로 굽는다. 사용:
//   node scripts/split-gltf.mjs <src/scene.gltf> <out-dir> [minTris=1]
// 출력: <out-dir>/parts.gltf, parts.bin, manifest.json (조각별 삼각형 수·bbox·중심, mm)
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs'
import { dirname, join, basename } from 'node:path'

const [src, outDir, minTrisArg] = process.argv.slice(2)
const minTris = Number(minTrisArg ?? 1)
const g = JSON.parse(readFileSync(src, 'utf8'))
const bin = readFileSync(join(dirname(src), g.buffers[0].uri))

function accessor(i) {
  const a = g.accessors[i]
  const bv = g.bufferViews[a.bufferView]
  const off = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0)
  const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type]
  const Ctor = { 5126: Float32Array, 5123: Uint16Array, 5125: Uint32Array, 5121: Uint8Array }[a.componentType]
  if (bv.byteStride && bv.byteStride !== comps * Ctor.BYTES_PER_ELEMENT) throw new Error('interleaved')
  return { data: new Ctor(bin.buffer.slice(bin.byteOffset + off, bin.byteOffset + off + a.count * comps * Ctor.BYTES_PER_ELEMENT)), comps, count: a.count }
}

// --- 4x4 column-major ---
const I = () => [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]
const mul = (a, b) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c*4+r] += a[k*4+r] * b[c*4+k]; return o }
const local = (n) => {
  if (n.matrix) return n.matrix
  const t = n.translation ?? [0,0,0], q = n.rotation ?? [0,0,0,1], s = n.scale ?? [1,1,1]
  const [x,y,z,w] = q
  const m = [1-2*(y*y+z*z), 2*(x*y+z*w), 2*(x*z-y*w), 0, 2*(x*y-z*w), 1-2*(x*x+z*z), 2*(y*z+x*w), 0, 2*(x*z+y*w), 2*(y*z-x*w), 1-2*(x*x+y*y), 0, t[0], t[1], t[2], 1]
  for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) m[c*4+r] *= s[c]
  return m
}
const worldOf = {}
const walk = (i, parent) => { const w = mul(parent, local(g.nodes[i])); worldOf[i] = w; for (const c of g.nodes[i].children ?? []) walk(c, w) }
g.scenes[0].nodes.forEach((n) => walk(n, I()))
const xformP = (m, p) => [m[0]*p[0]+m[4]*p[1]+m[8]*p[2]+m[12], m[1]*p[0]+m[5]*p[1]+m[9]*p[2]+m[13], m[2]*p[0]+m[6]*p[1]+m[10]*p[2]+m[14]]
const xformN = (m, n) => { const v = [m[0]*n[0]+m[4]*n[1]+m[8]*n[2], m[1]*n[0]+m[5]*n[1]+m[9]*n[2], m[2]*n[0]+m[6]*n[1]+m[10]*n[2]]; const l = Math.hypot(...v) || 1; return v.map((x) => x / l) }

// --- 조각 나누기 ---
const parts = []
for (let ni = 0; ni < g.nodes.length; ni++) {
  const node = g.nodes[ni]
  if (node.mesh == null) continue
  const mesh = g.meshes[node.mesh]
  for (const prim of mesh.primitives) {
    const mat = g.materials[prim.material]
    if (!mat.pbrMetallicRoughness?.baseColorTexture) continue // 텍스처 없는 반투명 상자(환경 잔재)는 버린다
    const pos = accessor(prim.attributes.POSITION), nor = accessor(prim.attributes.NORMAL), uv = accessor(prim.attributes.TEXCOORD_0), idx = accessor(prim.indices)
    const n = pos.count
    // 삼각형마다 정점을 복제해 둔 프리미티브(정점 수 == 인덱스 수)는 인덱스 연결성이 없으니 위치로 잇는다
    const byPosition = pos.count === idx.count
    const canon = new Int32Array(n)
    if (byPosition) { const seen = new Map(); for (let i = 0; i < n; i++) { const k = `${Math.round(pos.data[i*3]*1e5)},${Math.round(pos.data[i*3+1]*1e5)},${Math.round(pos.data[i*3+2]*1e5)}`; const c = seen.get(k); if (c === undefined) { seen.set(k, i); canon[i] = i } else canon[i] = c } } else for (let i = 0; i < n; i++) canon[i] = i
    const parent = new Int32Array(n).map((_, i) => i)
    const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x] } return x }
    const tri = idx.count / 3
    for (let t = 0; t < tri; t++) { const a = canon[idx.data[t*3]], b = canon[idx.data[t*3+1]], c = canon[idx.data[t*3+2]]; const ra = find(a), rb = find(b), rc = find(c); if (ra !== rb) parent[ra] = rb; if (find(a) !== rc) parent[find(a)] = rc }
    const groups = new Map()
    for (let t = 0; t < tri; t++) { const r = find(canon[idx.data[t*3]]); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(t) }
    const M = worldOf[ni]
    for (const tris of groups.values()) {
      if (tris.length < minTris) continue
      const remap = new Map(); const P = [], N = [], U = [], IDX = []
      for (const t of tris) for (let k = 0; k < 3; k++) {
        const v = idx.data[t*3+k]
        let j = remap.get(v)
        if (j === undefined) { j = remap.size; remap.set(v, j); P.push(...xformP(M, [pos.data[v*3], pos.data[v*3+1], pos.data[v*3+2]])); N.push(...xformN(M, [nor.data[v*3], nor.data[v*3+1], nor.data[v*3+2]])); U.push(uv.data[v*2], uv.data[v*2+1]) }
        IDX.push(j)
      }
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
      for (let i = 0; i < P.length; i += 3) for (let d = 0; d < 3; d++) { min[d] = Math.min(min[d], P[i+d]); max[d] = Math.max(max[d], P[i+d]) }
      parts.push({ srcMesh: mesh.name, tris: tris.length, P, N, U, IDX, min, max })
    }
  }
}
parts.sort((a, b) => b.tris - a.tris)

// --- 정렬·정규화: 수평면 주성분(차체 길이 방향)을 +x로 돌리고, 바닥 y=0, 좌우 중심 z=0, 전장 LENGTH_MM ---
const LENGTH_MM = Number(process.env.LENGTH_MM ?? 1990)
{
  let sx = 0, sz = 0, cnt = 0
  for (const p of parts) for (let i = 0; i < p.P.length; i += 3) { sx += p.P[i]; sz += p.P[i+2]; cnt++ }
  const mx = sx / cnt, mz = sz / cnt
  let cxx = 0, cxz = 0, czz = 0
  for (const p of parts) for (let i = 0; i < p.P.length; i += 3) { const dx = p.P[i] - mx, dz = p.P[i+2] - mz; cxx += dx*dx; cxz += dx*dz; czz += dz*dz }
  const theta = 0.5 * Math.atan2(2 * cxz, cxx - czz) // 주성분 방향 각 (xz 평면)
  const c = Math.cos(-theta), s = Math.sin(-theta)
  const rot = (v) => { const x = v[0] - mx, z = v[2] - mz; return [x * c + z * s, v[1], -x * s + z * c] }
  const rotN = (v) => [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c]
  for (const p of parts) { for (let i = 0; i < p.P.length; i += 3) { const r = rot([p.P[i], p.P[i+1], p.P[i+2]]); p.P[i] = r[0]; p.P[i+1] = r[1]; p.P[i+2] = r[2]; const q = rotN([p.N[i], p.N[i+1], p.N[i+2]]); p.N[i] = q[0]; p.N[i+1] = q[1]; p.N[i+2] = q[2] } }
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
  for (const p of parts) for (let i = 0; i < p.P.length; i += 3) for (let d = 0; d < 3; d++) { min[d] = Math.min(min[d], p.P[i+d]); max[d] = Math.max(max[d], p.P[i+d]) }
  const scale = (LENGTH_MM / 1000) / (max[0] - min[0])
  const off = [(min[0] + max[0]) / 2, min[1], (min[2] + max[2]) / 2]
  console.log(`yaw ${(theta * 180 / Math.PI).toFixed(1)} deg, raw size ${max.map((v, d) => (v - min[d]).toFixed(2))}, scale ${scale.toFixed(4)}`)
  for (const p of parts) {
    for (let i = 0; i < p.P.length; i += 3) for (let d = 0; d < 3; d++) p.P[i+d] = (p.P[i+d] - off[d]) * scale
    p.min = [Infinity, Infinity, Infinity]; p.max = [-Infinity, -Infinity, -Infinity]
    for (let i = 0; i < p.P.length; i += 3) for (let d = 0; d < 3; d++) { p.min[d] = Math.min(p.min[d], p.P[i+d]); p.max[d] = Math.max(p.max[d], p.P[i+d]) }
  }
}

// --- 새 glTF 쓰기 ---
mkdirSync(outDir, { recursive: true })
const chunks = []; let byteLength = 0
const bufferViews = [], accessors = []
const push = (typed, target) => { const pad = (4 - (byteLength % 4)) % 4; if (pad) { chunks.push(Buffer.alloc(pad)); byteLength += pad } const buf = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength); bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: buf.length, target }); chunks.push(buf); byteLength += buf.length; return bufferViews.length - 1 }
const nodes = [], meshes = [], manifest = []
const srcTex = join(dirname(src), g.images[0].uri)
const texName = basename(srcTex)
copyFileSync(srcTex, join(outDir, texName))
parts.forEach((p, i) => {
  const name = `p${String(i).padStart(3, '0')}`
  const P = new Float32Array(p.P), N = new Float32Array(p.N), U = new Float32Array(p.U)
  const IDX = P.length / 3 > 65535 ? new Uint32Array(p.IDX) : new Uint16Array(p.IDX)
  const a0 = accessors.push({ bufferView: push(P, 34962), componentType: 5126, count: P.length / 3, type: 'VEC3', min: p.min, max: p.max }) - 1
  const a1 = accessors.push({ bufferView: push(N, 34962), componentType: 5126, count: N.length / 3, type: 'VEC3' }) - 1
  const a2 = accessors.push({ bufferView: push(U, 34962), componentType: 5126, count: U.length / 2, type: 'VEC2' }) - 1
  const a3 = accessors.push({ bufferView: push(IDX, 34963), componentType: IDX instanceof Uint32Array ? 5125 : 5123, count: IDX.length, type: 'SCALAR' }) - 1
  meshes.push({ name, primitives: [{ attributes: { POSITION: a0, NORMAL: a1, TEXCOORD_0: a2 }, indices: a3, material: 0 }] })
  nodes.push({ name, mesh: i })
  const mm = (v) => v.map((x) => Math.round(x * 1000))
  manifest.push({ name, tris: p.tris, min: mm(p.min), max: mm(p.max), center: mm(p.min.map((m, d) => (m + p.max[d]) / 2)), src: p.srcMesh })
})
const srcMat = g.materials.find((m) => m.pbrMetallicRoughness?.baseColorTexture)
const out = {
  asset: { version: '2.0', generator: 'split-gltf.mjs', extras: g.asset.extras },
  extensionsUsed: srcMat.extensions ? Object.keys(srcMat.extensions) : undefined,
  scene: 0, scenes: [{ nodes: nodes.map((_, i) => i) }], nodes, meshes,
  materials: [{ name: 'body', doubleSided: true, pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: srcMat.pbrMetallicRoughness.metallicFactor, roughnessFactor: srcMat.pbrMetallicRoughness.roughnessFactor }, extensions: srcMat.extensions }],
  textures: [{ source: 0, sampler: 0 }], images: [{ uri: texName }], samplers: g.samplers,
  buffers: [{ uri: 'parts.bin', byteLength }], bufferViews, accessors,
}
writeFileSync(join(outDir, 'parts.bin'), Buffer.concat(chunks))
writeFileSync(join(outDir, 'parts.gltf'), JSON.stringify(out))
writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 1))
const all = manifest.reduce((acc, p) => ({ min: acc.min.map((v, d) => Math.min(v, p.min[d])), max: acc.max.map((v, d) => Math.max(v, p.max[d])) }), { min: [1e9,1e9,1e9], max: [-1e9,-1e9,-1e9] })
console.log(`${parts.length} parts, ${byteLength} bytes, bbox mm min=${all.min} max=${all.max}`)
