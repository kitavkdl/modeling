// glTF의 메시를 연결된 조각(loose parts) 단위로 나눠 통계를 낸다. 사용: node scripts/gltf-components.mjs <scene.gltf> [meshIndex]
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const file = process.argv[2]
const meshIdx = Number(process.argv[3] ?? 2)
const g = JSON.parse(readFileSync(file, 'utf8'))
const bin = readFileSync(join(dirname(file), g.buffers[0].uri))

function accessor(i) {
  const a = g.accessors[i]
  const bv = g.bufferViews[a.bufferView]
  const off = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0)
  const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type]
  const Ctor = { 5126: Float32Array, 5123: Uint16Array, 5125: Uint32Array, 5121: Uint8Array }[a.componentType]
  const stride = bv.byteStride
  if (stride && stride !== comps * Ctor.BYTES_PER_ELEMENT) throw new Error('interleaved buffer not supported')
  return { data: new Ctor(bin.buffer, bin.byteOffset + off, a.count * comps), comps, count: a.count }
}

const mesh = g.meshes[meshIdx]
const prim = mesh.primitives[0]
const pos = accessor(prim.attributes.POSITION)
const idx = accessor(prim.indices)
const n = pos.count
// 위치가 같은 정점(UV 이음새로 복제된 것)을 하나로 본다
const key = new Map()
const canon = new Int32Array(n)
for (let i = 0; i < n; i++) {
  const k = `${Math.round(pos.data[i * 3] * 1e4)},${Math.round(pos.data[i * 3 + 1] * 1e4)},${Math.round(pos.data[i * 3 + 2] * 1e4)}`
  const c = key.get(k)
  if (c === undefined) { key.set(k, i); canon[i] = i } else canon[i] = c
}
const parent = new Int32Array(n).map((_, i) => i)
const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x] } return x }
const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[a] = b }
const tri = idx.count / 3
for (let t = 0; t < tri; t++) {
  const a = canon[idx.data[t * 3]], b = canon[idx.data[t * 3 + 1]], c = canon[idx.data[t * 3 + 2]]
  union(a, b); union(a, c)
}
const comps = new Map()
for (let t = 0; t < tri; t++) {
  const r = find(canon[idx.data[t * 3]])
  let c = comps.get(r)
  if (!c) { c = { tris: 0, min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }; comps.set(r, c) }
  c.tris++
  for (let k = 0; k < 3; k++) {
    const v = idx.data[t * 3 + k]
    for (let d = 0; d < 3; d++) { const p = pos.data[v * 3 + d]; if (p < c.min[d]) c.min[d] = p; if (p > c.max[d]) c.max[d] = p }
  }
}
const list = [...comps.values()].sort((a, b) => b.tris - a.tris)
console.log(`mesh ${mesh.name}: ${n} verts, ${tri} tris, ${key.size} unique positions, ${list.length} components`)
const f = (v) => v.map((x) => x.toFixed(2)).join(',')
list.slice(0, 60).forEach((c, i) => console.log(`${String(i).padStart(3)} tris=${String(c.tris).padStart(5)} min=[${f(c.min)}] max=[${f(c.max)}] size=[${f(c.max.map((m, d) => m - c.min[d]))}]`))
const small = list.filter((c) => c.tris < 20).length
console.log(`components with <20 tris: ${small}`)
