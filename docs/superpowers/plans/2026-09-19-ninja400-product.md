# 닌자 400 제품 구현 계획 (계획 B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 공통 조립 엔진 위에 2018 Kawasaki Ninja 400(EX400G)을 두 번째 제품으로 올린다. 프레임만 놓인 상태에서 시작해 엔진·앞뒤 바퀴를 작업대에서 조립해 결합하고, 외장을 프라이머로 장착한 뒤 순정 3색 중 하나로 도색하며, 키 → 시동 → 스로틀까지 동작한다.

**Architecture:** 제품 폴더 `src/products/ninja400/`만 추가한다. 엔진은 계획 A에서 남긴 세 가지 결함(작업대 소품 재질 fallback, 그림자 near/far 스케일, 테스트 파일명)만 고친다. 부품 80개는 `parts.ts` 한 파일에 `part()` 도우미로 선언하고, 배열 순서가 곧 조립 순서다(`requires`는 기본으로 바로 앞 항목). 형상은 `geometry.ts`의 프리미티브 조합 함수로 만든다. 도색·계기판·헤드라이트·엔진 진동은 `renderInstance`로, 키·시동·스로틀은 `Finale`로 구현한다.

**Tech Stack:** 계획 A와 동일 (Vite 6, React 18, TS 5, R3F 8, drei 9, three 0.172, zustand 5, vitest 3). 새 의존성 없음.

**Spec:** `docs/superpowers/specs/2026-09-19-ninja400-assembly-design.md` (7·8·9·11·12·13절)

## Global Constraints

- 외부 3D 모델·오디오 파일 금지. 물리 엔진·라우터 라이브러리 금지. 새 npm 의존성 금지.
- 1 unit = 10mm (`MM`). 모든 치수·좌표는 mm 상수. 좌표계: **+x 앞, +y 위, +z 라이더의 오른쪽**, 원점은 앞뒤 접지점 중간의 지면.
- 이모지 금지(UI·주석·커밋). 슬로건 금지. 그라데이션·글로우·파티클 금지. 산세리프 한 종류.
- 부품명은 정확한 업계 용어(스윙암, 트리플 클램프, 캘리퍼, 스로틀 바디, 캠체인 텐셔너). 안내 문구는 동사 하나로 끝난다("엔진 마운트 볼트 체결", "도색").
- 제품 폴더는 `src/engine/`과 자기 폴더만 import한다. 엔진은 제품을 import하지 않는다.
- 조명은 키라이트 1 + 림라이트 1 + 약한 환경광 + 절차적 환경맵. 추가 광원 금지(램프 점등은 emissive).
- 커밋마다 `npx tsc --noEmit && npx vitest run && npx vite build` 통과. 커밋 메시지 끝에 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. 푸시는 컨트롤러가 마지막에 한 번.
- 개발 서버는 실행하지 않는다. 브라우저 확인은 컨트롤러가 `http://localhost:5173/ninja400`에서 한다.
- 제원 상수 옆에 `// TODO: 실물 확인` 주석: 프레임 노드 좌표, 엔진 마운트 위치, 카울 치수.

---

## 파일 구조

```
src/engine/scene/Environment.tsx   (수정) shadow near / ContactShadows far를 r에 비례
src/engine/scene/Stations.tsx      (수정) prop 재질 fallback: 레지스트리에 없으면 엔진 기본 회색
src/engine/scene/dragMath.test.ts  (rename) stationMath.test.ts → dragMath.test.ts
src/products/ninja400/
  spec.ts          제원 상수와 좌표 도우미 (WHEELBASE, 타이어 반지름, 크랭크 중심, tilt(), fork 축)
  geometry.ts      trellis(), wheel(), disc(), sprocket(), forkLeg(), cowlShell(), tank(), cable 없음
  materials.ts     NINJA_MATERIALS + PAINT_VARIANTS + paintMaterialName(variantId)
  parts.ts         part() 도우미, STATIONS, PROPS, PARTS (80개), PART_BY_ID
  parts.test.ts    데이터 불변식
  product.tsx      ninja400Product: ProductDef (renderInstance, Finale, hints, camera, drag)
  product.test.ts  재질 참조·변형·단계 검사
  index.ts         export { ninja400Product } from './product'
  render/Paintable.tsx     프라이머 → 도색 전환 (x 내림차순 0.15초 간격)
  render/Lamps.tsx         헤드라이트·테일라이트·계기판 emissive
  render/EngineShake.tsx   시동 후 엔진 부품 미세 진동
  finale/Finale.tsx        Key + Starter + Throttle + 카메라
  finale/Key.tsx           키 드래그 → keyed
  finale/Starter.tsx       시동 버튼 클릭 → running
  finale/Throttle.tsx      그립 드래그 → 스로틀 0~1 (모듈 상태 throttleState)
  finale/throttleState.ts  { value, target } 공유 상태 (사운드·계기판·그립이 읽는다)
  audio/engineSound.ts     start() / setThrottle(t) / stop()
src/products/index.ts              (수정) PRODUCTS에 ninja400Product 추가
```

---

### Task 1: 엔진 손질 (소품 재질 fallback, 그림자 스케일, 테스트 파일명)

**Files:**
- Modify: `src/engine/scene/Stations.tsx`, `src/engine/scene/Environment.tsx`, `src/engine/materials.ts`
- Rename: `src/engine/scene/stationMath.test.ts` → `src/engine/scene/dragMath.test.ts`
- Test: `src/engine/materials.test.ts` (추가 케이스)

**Interfaces:**
- Produces: `materials.ts`에 `export const fallbackMaterial: THREE.MeshStandardMaterial` (색 #6b6d70, roughness 0.8) 와 `MaterialRegistry.getOr(name: string | undefined, fallback: THREE.Material): THREE.Material`

- [ ] **Step 1: 실패하는 테스트 추가**

```ts
// src/engine/materials.test.ts 에 추가
import { createMaterialRegistry, fallbackMaterial } from './materials'

it('getOr returns the fallback when the name is missing', () => {
  const reg = createMaterialRegistry({ alu: { color: '#888' } })
  expect(reg.getOr('alu', fallbackMaterial)).toBe(reg.get('alu'))
  expect(reg.getOr('nope', fallbackMaterial)).toBe(fallbackMaterial)
  expect(reg.getOr(undefined, fallbackMaterial)).toBe(fallbackMaterial)
})
```

- [ ] **Step 2: 실패 확인** — `npx vitest run src/engine/materials.test.ts` → FAIL (`getOr` 없음)

- [ ] **Step 3: 구현**

`materials.ts`:
```ts
export interface MaterialRegistry {
  get(name: string): THREE.Material
  has(name: string): boolean
  /** 이름이 없거나 등록되지 않았으면 fallback */
  getOr(name: string | undefined, fallback: THREE.Material): THREE.Material
}
// createMaterialRegistry 안:
getOr: (name, fallback) => (name && name in specs ? reg.get(name) : fallback),
// (get/has/getOr를 담은 객체를 const reg로 먼저 만든 뒤 반환한다)
export const fallbackMaterial = new THREE.MeshStandardMaterial({ color: '#6b6d70', metalness: 0.2, roughness: 0.8 })
```

`Stations.tsx` Props: `materials.get(s.propMaterial ?? 'steel')` → `materials.getOr(s.propMaterial, fallbackMaterial)`; 제품 고정 소품도 `materials.getOr(p.material, fallbackMaterial)`.

`Environment.tsx`: `shadow-camera-near={5}` → `shadow-camera-near={Math.max(0.5, r * 0.15)}`; `ContactShadows far={12}` → `far={r * 0.4}`; `Environment resolution` 그대로. (키보드 r=30: near 4.5, far 12 — 기존과 사실상 같다.)

`git mv src/engine/scene/stationMath.test.ts src/engine/scene/dragMath.test.ts`.

- [ ] **Step 4: 검사** — `npx tsc --noEmit && npx vitest run && npx vite build`
- [ ] **Step 5: 커밋** — "엔진: 소품 재질 fallback, 그림자 범위 스케일, 드래그 테스트 파일명 정리"

---

### Task 2: 닌자 400 골격 — 제원, 형상 함수, 재질, 프레임·서브프레임·작업대, 제품 등록

**Files:**
- Create: `src/products/ninja400/spec.ts`, `geometry.ts`, `materials.ts`, `parts.ts`, `product.tsx`, `index.ts`, `parts.test.ts`, `product.test.ts`
- Modify: `src/products/index.ts`

**Interfaces:**
- `spec.ts` exports (mm): `WHEELBASE=1370`, `FRONT_AXLE: Vec3 = [685, 293, 0]`, `REAR_AXLE: Vec3 = [-685, 306, 0]`, `RIM_R=215.9`, `FRONT_TIRE_R=293`, `REAR_TIRE_R=306`, `FRONT_TIRE_W=110`, `REAR_TIRE_W=150`, `HEAD: Vec3 = [420, 880, 0]`(스티어링 헤드 중심), `RAKE_DEG=24.7`, `RAKE=RAKE_DEG*Math.PI/180`, `FORK_SPACING=200`(포크 좌우 간격), `FORK_LEN=644`, `CRANK: Vec3 = [-120, 430, 0]`, `CYL_TILT_DEG=20`, `CYL_PITCH=84`, `BORE=70`, `CASE_W=380`, `SEAT_H=785`, `tilt(u, h, z): Vec3` = `[CRANK[0] + u*cos(t) + h*sin(t), CRANK[1] - u*sin(t) + h*cos(t), z]` (t=20°; u 앞(+)뒤, h 크랭크 위 높이), `TILT_ROT: Vec3 = [0, 0, -CYL_TILT_DEG*Math.PI/180]`, `forkPoint(h): [number, number]` = 스티어링 축 위 높이 h의 (x, y) = `[FRONT_AXLE[0] - (h - FRONT_AXLE[1]) * Math.tan(RAKE), h]`, `FORK_ROT: Vec3 = [0, 0, RAKE]`.
- `geometry.ts` exports: `trellis(nodes: Vec3[], edges: [number, number][], r: number): Geometry` (각 edge를 cylinder로: 길이 = 두 노드 거리, 위치 = 노드 a, 회전 = a→b 방향으로 y축 정렬 — 아래 구현 참조), `wheel(tireR, tireW, rimR, spokes=5): Geometry` (torus 타이어 + cylinder 림 + 스포크 box 5개, 축 = z, 원점 = 휠 중심이 아니라 **밑면**이 아닌 **중심**: 이 제품에서는 wheel/disc/sprocket/fork/crank처럼 축이 z인 부품은 `mountPosition`이 중심이다 — 형상 함수가 중심 기준으로 만든다), `disc(r, t): Geometry` (cylinder 축 z, 중심 기준), `sprocket(r, t, teeth): Geometry`, `forkLeg(len, upperR, lowerR, lowerLen): Geometry` (밑면 기준, +y), `cowl(size: Vec3, taper: number): Geometry` (frustum + box 조합, 밑면 기준), `tank(): Geometry` (frustum 2단, 밑면 기준), `cylZ(r, len): Geometry` (z축 원통, 중심 기준 — rotation [π/2,0,0], position z -len/2 로 보정한 composite).
- `materials.ts`: `NINJA_MATERIALS`(표 7.5의 키 전부 + `paint_krt`, `paint_blue`, `paint_black`, `lamp_off`, `lamp_on`, `glass`, `steel`, `rubber`, `primer`, `frame_paint`, `cast_alu`, `polished_alu`, `stainless`, `plastic_black`, `chain`, `bench`), `PAINT_VARIANTS: Variant[] = [{id:'krt', label:'Lime Green / Ebony', swatch:'#69be28'}, {id:'blue', label:'Candy Plasma Blue', swatch:'#1d3f9e'}, {id:'black', label:'Metallic Spark Black', swatch:'#1a1b1e'}]`, `paintMaterialName(id) = 'paint_' + id`.
- `parts.ts`: `part(def: PartInput): PartDef` 도우미. `PartInput`은 `{ id, ko, en, geometry, mount: Vec3, rot?: Vec3, rest?: Vec3, material, station?, marries?, count?, instances?: Array<{ suffix, mount, rot?, geometry?, tag? }>, requires?: string[], paintable?, hidden?, variants?, camera?: Partial<CameraView>, hint?: string, preplaced? }`. `requires` 생략 시 배열의 바로 앞 부품. `hint` 생략 시 `${ko} 장착`. `camera` 생략 시 작업대별 기본 뷰(아래). 인스턴스 id는 `${id}:${suffix}`, `order`는 인스턴스 인덱스/(n-1). `rest` 생략 시 작업대별 기본 대기 위치. 이 태스크에서는 `PARTS = [mainFrame, subframe]`까지만 넣고 다음 태스크들이 이어 붙인다(`// --- B3 엔진 작업대 ---` 같은 구분 주석을 미리 둔다).
- `product.tsx`: `ninja400Product: ProductDef` — `id:'ninja400', nameKo:'닌자 400', nameEn:'Kawasaki Ninja 400', subtitle:'2018 · EX400G · 399cc 병렬 2기통'`, `stations: STATIONS`, `props: PROPS`, `materials: NINJA_MATERIALS`, `camera: { initial:{azimuth:30, polar:64, distance:4200}, target:[0,500,0], minDistanceMm:1200, maxDistanceMm:7000, minPolarDeg:20, maxPolarDeg:85 }`, `drag:{ snapMm:150, paintMm:60, hoverMm:150, grabMinMm:200 }`, `environment:{ contactShadowSizeMm:[4200, 3200], shadowBoundsMm:2400 }`, `Finale: () => null`(B7에서 교체), `hints:{ complete:'키 삽입', keyed:'시동', running:'스로틀' }`, `phasesAfterComplete:['keyed','running']`.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// src/products/ninja400/parts.test.ts
import { describe, expect, it } from 'vitest'
import { validateGeometry } from '../../engine/types'
import { PARTS, PART_BY_ID, PROPS, STATIONS } from './parts'
import { NINJA_MATERIALS } from './materials'

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
})
```

```ts
// src/products/ninja400/product.test.ts
import { describe, expect, it } from 'vitest'
import { ninja400Product } from './index'

describe('ninja400Product', () => {
  it('declares phases, hints and drag config', () => {
    expect(ninja400Product.phasesAfterComplete).toEqual(['keyed', 'running'])
    expect(ninja400Product.hints.complete).toBe('키 삽입')
    expect(ninja400Product.drag).toEqual({ snapMm: 150, paintMm: 60, hoverMm: 150, grabMinMm: 200 })
  })
  it('lists three stations with props', () => {
    expect(ninja400Product.stations.map((s) => s.id)).toEqual(['engine', 'front_wheel', 'rear_wheel'])
    for (const s of ninja400Product.stations) expect(s.prop).toBeDefined()
  })
})
```

`src/products/registry.test.ts`에 `expect(productForPath('/ninja400')?.id).toBe('ninja400')` 추가.

- [ ] **Step 2: 실패 확인** — `npx vitest run src/products` → FAIL

- [ ] **Step 3: spec.ts / geometry.ts / materials.ts 작성**

`geometry.ts` 핵심 구현:
```ts
import type { Geometry, Vec3 } from '../../engine/types'

/** 두 점을 잇는 원통. 엔진의 cylinder는 +y 기둥(밑면 원점)이므로 a에 두고 a→b로 회전한다. */
function strut(a: Vec3, b: Vec3, r: number): { geometry: Geometry; position: Vec3; rotation: Vec3 } {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2]
  const len = Math.hypot(dx, dy, dz)
  // y축을 (dx,dy,dz)로 보내는 오일러: 먼저 x축 회전으로 z성분, 다음 z축 회전으로 x성분
  const rx = Math.atan2(dz, dy)          // y→z 기울기
  const rz = -Math.atan2(dx, Math.hypot(dy, dz))
  return { geometry: { type: 'cylinder', radiusTop: r, radiusBottom: r, height: len, segments: 10 }, position: a, rotation: [rx, 0, rz] }
}
export function trellis(nodes: Vec3[], edges: Array<[number, number]>, r: number): Geometry {
  return { type: 'composite', children: edges.map(([i, j]) => strut(nodes[i], nodes[j], r)) }
}
/** z축 원통, 중심 기준 */
export function cylZ(r: number, len: number, segments = 32): Geometry {
  return { type: 'composite', children: [{ geometry: { type: 'cylinder', radiusTop: r, radiusBottom: r, height: len, segments }, position: [0, 0, -len / 2], rotation: [Math.PI / 2, 0, 0] }] }
}
export function wheel(tireR: number, tireW: number, rimR: number, spokes = 5): Geometry {
  const tube = (tireR - rimR) / 2
  const children: Geometry extends never ? never : Array<{ geometry: Geometry; position?: Vec3; rotation?: Vec3; material?: string }> = []
  // 타이어: torus는 엔진에서 y축 도넛(밑면 기준)이라, z축으로 돌리고 중심으로 내린다
  children.push({ geometry: { type: 'torus', radius: rimR + tube, tube }, position: [0, -tube, 0], rotation: [Math.PI / 2, 0, 0], material: 'rubber' })
  children.push({ geometry: cylZ(rimR, tireW * 0.7), material: 'polished_alu' })
  children.push({ geometry: cylZ(rimR * 0.98, tireW * 0.74, 32), material: 'plastic_black' }) // 림 안쪽 그늘
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2
    children.push({ geometry: { type: 'box', size: [22, rimR * 0.9, 18] }, position: [0, 0, 0], rotation: [0, 0, a], material: 'polished_alu' })
  }
  children.push({ geometry: cylZ(28, tireW * 0.8), material: 'cast_alu' }) // 허브
  return { type: 'composite', children }
}
export function disc(r: number, t: number): Geometry { return cylZ(r, t, 48) }
export function sprocket(r: number, t: number, teeth: number): Geometry {
  const children = [{ geometry: cylZ(r, t, 40) }]
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * Math.PI * 2
    children.push({ geometry: { type: 'box', size: [8, 10, t] } as Geometry, position: [Math.cos(a) * r, Math.sin(a) * r, 0] as Vec3, rotation: [0, 0, a] as Vec3 } as never)
  }
  return { type: 'composite', children }
}
/** 포크 다리: 아래 슬라이더(굵음) + 위 이너튜브. 밑면(액슬) 기준 +y */
export function forkLeg(len: number, upperR: number, lowerR: number, lowerLen: number): Geometry {
  return { type: 'composite', children: [
    { geometry: { type: 'cylinder', radiusTop: lowerR, radiusBottom: lowerR, height: lowerLen, segments: 20 }, material: 'cast_alu' },
    { geometry: { type: 'cylinder', radiusTop: upperR, radiusBottom: upperR, height: len - lowerLen, segments: 20 }, position: [0, lowerLen, 0], material: 'polished_alu' },
  ] }
}
/** 카울: 밑면 기준. 아래가 넓고 위가 좁은 frustum 껍데기 */
export function cowl(size: Vec3, taper: number): Geometry {
  const [w, h, d] = size
  return { type: 'frustum', bottom: [w, d], top: [w * taper, d * taper], h }
}
/** 연료탱크: 2단 frustum */
export function tank(): Geometry {
  return { type: 'composite', children: [
    { geometry: { type: 'frustum', bottom: [420, 300], top: [380, 260], h: 90 } },
    { geometry: { type: 'frustum', bottom: [380, 260], top: [220, 150], h: 110 }, position: [0, 90, 0] },
  ] }
}
```
(위의 `children` 타입 주석은 `Array<CompositeChild>`로 쓴다 — `CompositeChild`를 `engine/types`에서 import. sprocket의 `as never` 캐스트도 쓰지 말고 `CompositeChild[]`로 선언한다.)

`spec.ts`는 Interfaces에 적힌 상수·함수 그대로. `FRONT_AXLE`/`HEAD`/`CRANK` 옆에 `// TODO: 실물 확인` 주석.

`materials.ts`:
```ts
export const NINJA_MATERIALS: Record<string, MaterialSpec> = {
  frame_paint: { color: '#141517', metalness: 0.4, roughness: 0.45 },
  cast_alu: { color: '#8b8f94', metalness: 0.7, roughness: 0.5 },
  polished_alu: { color: '#a8abb0', metalness: 0.9, roughness: 0.3 },
  steel: { color: '#a9adb3', metalness: 0.85, roughness: 0.4 },
  stainless: { color: '#c5c8cc', metalness: 0.9, roughness: 0.35 },
  rubber: { color: '#151617', metalness: 0, roughness: 0.95 },
  plastic_black: { color: '#1e1f22', metalness: 0, roughness: 0.6 },
  primer: { color: '#7a7b7d', metalness: 0, roughness: 0.9 },
  glass: { color: '#1a1b1e', metalness: 0.6, roughness: 0.1, transparent: true, opacity: 0.35 },
  lamp_off: { color: '#3a3b3e', metalness: 0.1, roughness: 0.3 },
  lamp_on: { color: '#fff4dc', emissive: '#ffe9b8', emissiveIntensity: 2.5, metalness: 0, roughness: 0.4 },
  chain: { color: '#5c5e62', metalness: 0.8, roughness: 0.5 },
  bench: { color: '#2a2b2e', metalness: 0.2, roughness: 0.8 },
  paint_krt: { physical: true, color: '#69be28', metalness: 0.6, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.1 },
  paint_blue: { physical: true, color: '#1d3f9e', metalness: 0.6, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.1 },
  paint_black: { physical: true, color: '#1a1b1e', metalness: 0.6, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.1 },
}
```

- [ ] **Step 4: parts.ts 골격**

```ts
import type { CameraView, Geometry, PartDef, PartInstance, StationDef, Vec3 } from '../../engine/types'
import { cowl, cylZ, disc, forkLeg, sprocket, tank, trellis, wheel } from './geometry'
import { CRANK, FORK_LEN, FORK_ROT, FORK_SPACING, FRONT_AXLE, FRONT_TIRE_R, FRONT_TIRE_W, HEAD, REAR_AXLE, REAR_TIRE_R, REAR_TIRE_W, RIM_R, TILT_ROT, forkPoint, tilt } from './spec'

// 작업대 --------------------------------------------------------------------
export const STATIONS: StationDef[] = [
  { id: 'engine', nameKo: '엔진 스탠드', offset: [0, 0, 1100], propMaterial: 'bench',
    prop: { type: 'composite', children: [
      { geometry: { type: 'box', size: [60, 270, 60] }, position: [-300, 0, -160] }, { geometry: { type: 'box', size: [60, 270, 60] }, position: [60, 0, -160] },
      { geometry: { type: 'box', size: [60, 270, 60] }, position: [-300, 0, 160] }, { geometry: { type: 'box', size: [60, 270, 60] }, position: [60, 0, 160] },
      { geometry: { type: 'box', size: [460, 10, 420] }, position: [-120, 270, 0] } ] } },
  { id: 'front_wheel', nameKo: '앞바퀴 벤치', offset: [900, 20, 600], propMaterial: 'bench',
    prop: { type: 'box', size: [500, 20, 300] } },
  { id: 'rear_wheel', nameKo: '뒷바퀴 벤치', offset: [-900, 20, 600], propMaterial: 'bench',
    prop: { type: 'box', size: [500, 20, 300] } },
]
// 엔진 스탠드 상판은 y=270..280 이고 크랭크케이스 하부 밑면은 y=280 이라 딱 얹힌다.
// 벤치 prop 원점은 (offset.x, 0, offset.z) 이므로 엔진 스탠드 children의 x는 크랭크 중심(-120) 기준으로 잡았다.

/** 프레임 지그: 프레임 아래 받침 2개 */
export const PROPS: NonNullable<import('../../engine/types').ProductDef['props']> = [
  { geometry: { type: 'box', size: [80, 300, 240] }, position: [250, 0, 0], material: 'bench' },
  { geometry: { type: 'box', size: [80, 300, 240] }, position: [-350, 0, 0], material: 'bench' },
]

// 대기 위치 · 카메라 기본값 -------------------------------------------------------
const REST: Record<string, Vec3> = {
  main: [-300, 0, -1000],            // 차체 뒤쪽 (큰 부품)
  small: [0, 0, 1500],               // 카메라 쪽 (볼트·밸브·지시등)
  engine: [420, 300, 1100],          // 엔진 스탠드 옆
  front_wheel: [1585, 20, 1000],
  rear_wheel: [-1585, 20, 1000],
}
const VIEW: Record<string, CameraView> = {
  main: { azimuth: 30, polar: 64, distance: 4200, target: [0, 500, 0] },
  engine: { azimuth: 20, polar: 60, distance: 2000, target: [-120, 480, 1100] },
  front_wheel: { azimuth: 40, polar: 65, distance: 1800, target: [1585, 320, 600] },
  rear_wheel: { azimuth: -40, polar: 65, distance: 1800, target: [-1585, 320, 600] },
}

interface InstanceInput { suffix: string; mount: Vec3; rot?: Vec3; geometry?: Geometry; tag?: string }
interface PartInput {
  id: string; ko: string; en: string; geometry: Geometry; mount: Vec3; rot?: Vec3; rest?: Vec3; material: string
  station?: string; marries?: string; instances?: InstanceInput[]; requires?: string[]
  paintable?: boolean; hidden?: boolean; variants?: PartDef['variants']; camera?: Partial<CameraView>; hint?: string; preplaced?: boolean
  /** 작은 부품이면 대기 위치를 카메라 쪽으로 */
  small?: boolean
}

const defs: PartInput[] = []
const add = (d: PartInput) => { defs.push(d); return d.id }

// --- A. 프레임 ---------------------------------------------------------------
// TODO: 실물 확인 — 트렐리스 노드 좌표는 사진 기준 추정
const FRAME_NODES: Vec3[] = [
  HEAD,                       // 0 스티어링 헤드
  [300, 780, 120], [300, 780, -120],     // 1,2 상부 메인 튜브 시작
  [-150, 700, 150], [-150, 700, -150],   // 3,4 탱크 아래
  [-420, 560, 150], [-420, 560, -150],   // 5,6 스윙암 피벗 위
  [-420, 420, 150], [-420, 420, -150],   // 7,8 스윙암 피벗
  [80, 560, 140], [80, 560, -140],       // 9,10 엔진 앞 마운트 다운튜브
  [200, 300, 130], [200, 300, -130],     // 11,12 엔진 앞 하단 마운트
  [-250, 720, 0],                        // 13 백본 뒤끝
]
const FRAME_EDGES: Array<[number, number]> = [
  [0, 1], [0, 2], [1, 3], [2, 4], [3, 5], [4, 6], [5, 7], [6, 8], [7, 8],
  [0, 9], [0, 10], [9, 11], [10, 12], [9, 3], [10, 4], [1, 13], [2, 13], [13, 5], [13, 6], [11, 7], [12, 8], [1, 2], [3, 4], [5, 6],
]
add({ id: 'main_frame', ko: '메인 프레임', en: 'Main Frame', geometry: trellis(FRAME_NODES, FRAME_EDGES, 14), mount: [0, 0, 0], material: 'frame_paint', preplaced: true, hint: '프레임' })
const SUB_NODES: Vec3[] = [[-150, 700, 150], [-150, 700, -150], [-820, 760, 120], [-820, 760, -120], [-420, 560, 150], [-420, 560, -150], [-780, 640, 110], [-780, 640, -110]]
const SUB_EDGES: Array<[number, number]> = [[0, 2], [1, 3], [4, 6], [5, 7], [2, 3], [6, 7], [2, 6], [3, 7]]
add({ id: 'subframe', ko: '서브프레임', en: 'Subframe', geometry: trellis(SUB_NODES, SUB_EDGES, 11), mount: [0, 0, 0], material: 'frame_paint', rest: REST.main })

// --- B. 엔진 작업대 (Task B3) --------------------------------------------------
// --- C~F. 서스펜션·프런트엔드·바퀴 (Task B4) ---------------------------------
// --- G~K. 냉각·전장·흡기·배기·조작계 (Task B5) --------------------------------
// --- L~M. 외장·도색 (Task B6) --------------------------------------------------

// 빌드 ---------------------------------------------------------------------
function build(): PartDef[] {
  return defs.map((d, i) => {
    const prev = i > 0 ? defs[i - 1].id : null
    const requires = d.requires ?? (prev && !d.preplaced ? [prev] : [])
    const group = d.station ?? 'main'
    const rest = d.rest ?? (d.small ? REST.small : REST[group])
    const cameraView: CameraView = { ...VIEW[group], ...d.camera }
    const rot = d.rot ?? [0, 0, 0]
    const instances: PartInstance[] = d.instances
      ? d.instances.map((inst, k, arr) => ({ id: `${d.id}:${inst.suffix}`, mountPosition: inst.mount, mountRotation: inst.rot ?? rot, geometry: inst.geometry ?? d.geometry, tag: inst.tag ?? inst.suffix, order: arr.length > 1 ? k / (arr.length - 1) : 0 }))
      : [{ id: d.id, mountPosition: d.mount, mountRotation: rot, geometry: d.geometry, order: 0 }]
    return {
      id: d.id, nameKo: d.ko, nameEn: d.en, geometry: d.geometry, material: d.material,
      restPosition: rest, mountPosition: d.mount, mountRotation: rot, requires, count: instances.length, instances,
      station: d.station, marries: d.marries, preplaced: d.preplaced, paintable: d.paintable, variants: d.variants, hidden: d.hidden,
      cameraView, hint: d.hint ?? `${d.ko} 장착`,
    }
  })
}
export const PARTS: PartDef[] = build()
export const PART_BY_ID: Record<string, PartDef> = Object.fromEntries(PARTS.map((p) => [p.id, p]))
```

주의: `build()`는 파일 끝에서 한 번 호출되므로 B3~B6 태스크는 `add({...})` 호출을 해당 구분 주석 아래에 **순서대로** 끼워 넣기만 하면 된다. `requires`가 "바로 앞 항목"이므로 순서가 곧 조립 순서다.

- [ ] **Step 5: product.tsx / index.ts / 레지스트리**

```tsx
// src/products/ninja400/product.tsx
import type { ProductDef } from '../../engine/types'
import { NINJA_MATERIALS } from './materials'
import { PARTS, PROPS, STATIONS } from './parts'

export const ninja400Product: ProductDef = {
  id: 'ninja400', nameKo: '닌자 400', nameEn: 'Kawasaki Ninja 400', subtitle: '2018 · EX400G · 399cc 병렬 2기통',
  parts: PARTS, stations: STATIONS, props: PROPS, materials: NINJA_MATERIALS,
  camera: { initial: { azimuth: 30, polar: 64, distance: 4200 }, target: [0, 500, 0], minDistanceMm: 1200, maxDistanceMm: 7000, minPolarDeg: 20, maxPolarDeg: 85 },
  drag: { snapMm: 150, paintMm: 60, hoverMm: 150, grabMinMm: 200 },
  environment: { contactShadowSizeMm: [4200, 3200], shadowBoundsMm: 2400 },
  Finale: () => null,
  hints: { complete: '키 삽입', keyed: '시동', running: '스로틀' },
  phasesAfterComplete: ['keyed', 'running'],
}
```
`index.ts`: `export { ninja400Product } from './product'`. `src/products/index.ts`의 `PRODUCTS`에 추가.

- [ ] **Step 6: 검사 + 컨트롤러 브라우저 확인 포인트** — `/ninja400`에서 지그 위 트렐리스 프레임과 세 작업대 소품이 보이고 서브프레임이 첫 부품으로 선택돼 있어야 한다.
- [ ] **Step 7: 커밋** — "닌자 400 골격: 제원, 형상 함수, 재질, 프레임·작업대, 제품 등록"

---

### Task 3: 엔진 작업대 부품 27개 + 엔진 마운트 볼트

**Files:** Modify `src/products/ninja400/parts.ts` (B 구획), `parts.test.ts`

**Interfaces:** 부품 id (순서대로): `crankcase_lower, crankshaft, balancer, input_shaft, output_shaft, shift_drum, crankcase_upper, conrod(×2), piston(×2), cylinder_block, cylinder_head, valve(×8), camshaft(×2), cam_chain, cam_tensioner, cam_cover, spark_plug(×2), clutch_pack, clutch_cover, generator_rotor, generator_cover, oil_pump, oil_pan, oil_filter, starter_motor, water_pump, drive_sprocket, engine_mount_bolt(×4, marries 'engine', requires ['drive_sprocket','subframe'])`. 전부 `station: 'engine'` (마운트 볼트 제외).

- [ ] **Step 1: 테스트 추가**
```ts
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
```
- [ ] **Step 2: 실패 확인**
- [ ] **Step 3: 데이터 추가** (좌표 mm. `E = 'engine'`, `EG = { station: E }`로 반복을 줄여도 된다.)

```ts
const E = 'engine'
const cx = CRANK[0], cy = CRANK[1]
add({ id: 'crankcase_lower', ko: '크랭크케이스 하부', en: 'Lower Crankcase', geometry: { type: 'box', size: [420, 150, 380] }, mount: [cx, cy - 150, 0], material: 'cast_alu', station: E, requires: ['subframe'] })
add({ id: 'crankshaft', ko: '크랭크축', en: 'Crankshaft', geometry: { type: 'composite', children: [
  { geometry: cylZ(22, 360) }, { geometry: cylZ(60, 40), position: [0, 0, -60] }, { geometry: cylZ(60, 40), position: [0, 0, 60] },
  { geometry: { type: 'box', size: [30, 26, 50] }, position: [0, 26, -42] }, { geometry: { type: 'box', size: [30, 26, 50] }, position: [0, -26, 42] } ] },
  mount: [cx, cy, 0], material: 'steel', station: E, small: true })
add({ id: 'balancer', ko: '밸런서 샤프트', en: 'Balancer Shaft', geometry: cylZ(16, 340), mount: [cx + 110, cy + 20, 0], material: 'steel', station: E, small: true })
add({ id: 'input_shaft', ko: '변속기 입력축', en: 'Transmission Input Shaft', geometry: { type: 'composite', children: [{ geometry: cylZ(14, 330) }, { geometry: cylZ(34, 24), position: [0, 0, -100] }, { geometry: cylZ(40, 24), position: [0, 0, -40] }, { geometry: cylZ(30, 24), position: [0, 0, 30] }, { geometry: cylZ(36, 24), position: [0, 0, 100] }] }, mount: [cx - 120, cy - 10, 0], material: 'steel', station: E, small: true })
add({ id: 'output_shaft', ko: '변속기 출력축', en: 'Transmission Output Shaft', geometry: { type: 'composite', children: [{ geometry: cylZ(14, 360) }, { geometry: cylZ(38, 24), position: [0, 0, -100] }, { geometry: cylZ(32, 24), position: [0, 0, -40] }, { geometry: cylZ(42, 24), position: [0, 0, 30] }, { geometry: cylZ(36, 24), position: [0, 0, 100] }] }, mount: [cx - 190, cy - 60, 0], material: 'steel', station: E, small: true })
add({ id: 'shift_drum', ko: '시프트 드럼', en: 'Shift Drum', geometry: cylZ(20, 200), mount: [cx - 160, cy + 40, 0], material: 'steel', station: E, small: true })
add({ id: 'crankcase_upper', ko: '크랭크케이스 상부', en: 'Upper Crankcase', geometry: { type: 'box', size: [420, 120, 380] }, mount: [cx, cy, 0], material: 'cast_alu', station: E })
add({ id: 'conrod', ko: '커넥팅로드', en: 'Connecting Rod', geometry: { type: 'box', size: [22, 110, 14] }, mount: tilt(0, 26, 0), rot: TILT_ROT, material: 'steel', station: E, small: true,
  instances: [{ suffix: 'l', mount: tilt(0, 26, -42) }, { suffix: 'r', mount: tilt(0, 26, 42) }] })
add({ id: 'piston', ko: '피스톤', en: 'Piston', geometry: { type: 'cylinder', radiusTop: 35, radiusBottom: 35, height: 44, segments: 24 }, mount: tilt(0, 136, 0), rot: TILT_ROT, material: 'polished_alu', station: E, small: true,
  instances: [{ suffix: 'l', mount: tilt(0, 136, -42) }, { suffix: 'r', mount: tilt(0, 136, 42) }] })
add({ id: 'cylinder_block', ko: '실린더 블록', en: 'Cylinder Block', geometry: { type: 'box', size: [200, 130, 240] }, mount: tilt(0, 120, 0), rot: TILT_ROT, material: 'cast_alu', station: E })
add({ id: 'cylinder_head', ko: '실린더 헤드', en: 'Cylinder Head', geometry: { type: 'box', size: [230, 90, 250] }, mount: tilt(0, 250, 0), rot: TILT_ROT, material: 'cast_alu', station: E })
add({ id: 'valve', ko: '밸브', en: 'Valve', geometry: { type: 'composite', children: [{ geometry: { type: 'cylinder', radiusTop: 3, radiusBottom: 3, height: 70, segments: 8 } }, { geometry: { type: 'cylinder', radiusTop: 13, radiusBottom: 13, height: 3, segments: 16 } }] },
  mount: tilt(0, 270, 0), rot: TILT_ROT, material: 'stainless', station: E, small: true,
  instances: [-56, -28, 28, 56].flatMap((z) => [{ suffix: `in${z}`, mount: tilt(-15, 270, z) }, { suffix: `ex${z}`, mount: tilt(15, 270, z) }]) })
add({ id: 'camshaft', ko: '캠샤프트', en: 'Camshaft', geometry: { type: 'composite', children: [{ geometry: cylZ(11, 260) }, ...[-70, -14, 14, 70].map((z) => ({ geometry: cylZ(18, 12), position: [0, 0, z] as Vec3 }))] },
  mount: tilt(0, 330, 0), rot: TILT_ROT, material: 'steel', station: E, small: true,
  instances: [{ suffix: 'intake', mount: tilt(-28, 330, 0) }, { suffix: 'exhaust', mount: tilt(28, 330, 0) }] })
add({ id: 'cam_chain', ko: '캠체인', en: 'Cam Chain', geometry: { type: 'box', size: [14, 330, 6] }, mount: tilt(0, 0, 128), rot: TILT_ROT, material: 'chain', station: E, small: true })
add({ id: 'cam_tensioner', ko: '캠체인 텐셔너', en: 'Cam Chain Tensioner', geometry: { type: 'box', size: [30, 60, 40] }, mount: tilt(-60, 200, 128), rot: TILT_ROT, material: 'cast_alu', station: E, small: true })
add({ id: 'cam_cover', ko: '캠 커버', en: 'Cam Cover', geometry: { type: 'roundedBox', size: [230, 50, 250], radius: 8 }, mount: tilt(0, 340, 0), rot: TILT_ROT, material: 'cast_alu', station: E })
add({ id: 'spark_plug', ko: '점화플러그', en: 'Spark Plug', geometry: { type: 'composite', children: [{ geometry: { type: 'cylinder', radiusTop: 8, radiusBottom: 8, height: 40, segments: 10 } }, { geometry: { type: 'cylinder', radiusTop: 6, radiusBottom: 6, height: 30, segments: 10 }, position: [0, 40, 0], material: 'plastic_black' }] },
  mount: tilt(0, 390, 0), rot: TILT_ROT, material: 'stainless', station: E, small: true,
  instances: [{ suffix: 'l', mount: tilt(0, 390, -42) }, { suffix: 'r', mount: tilt(0, 390, 42) }] })
add({ id: 'clutch_pack', ko: '클러치 팩', en: 'Clutch Pack', geometry: cylZ(75, 60), mount: [cx - 120, cy - 10, 200], material: 'steel', station: E, small: true })
add({ id: 'clutch_cover', ko: '클러치 커버', en: 'Clutch Cover', geometry: { type: 'composite', children: [{ geometry: cylZ(105, 30) }, { geometry: cylZ(60, 20), position: [0, 0, 25] }] }, mount: [cx - 120, cy - 10, 205], material: 'polished_alu', station: E })
add({ id: 'generator_rotor', ko: '제너레이터 로터', en: 'Generator Rotor', geometry: cylZ(60, 40), mount: [cx, cy, -200], material: 'steel', station: E, small: true })
add({ id: 'generator_cover', ko: '제너레이터 커버', en: 'Generator Cover', geometry: { type: 'composite', children: [{ geometry: cylZ(95, 30) }, { geometry: cylZ(50, 18), position: [0, 0, -24] }] }, mount: [cx, cy, -205], material: 'polished_alu', station: E })
add({ id: 'oil_pump', ko: '오일펌프', en: 'Oil Pump', geometry: { type: 'box', size: [60, 50, 50] }, mount: [cx + 60, cy - 130, 120], material: 'cast_alu', station: E, small: true })
add({ id: 'oil_pan', ko: '오일팬', en: 'Oil Pan', geometry: { type: 'box', size: [360, 50, 320] }, mount: [cx, cy - 200, 0], material: 'cast_alu', station: E })
add({ id: 'oil_filter', ko: '오일필터', en: 'Oil Filter', geometry: { type: 'composite', children: [{ geometry: { type: 'cylinder', radiusTop: 34, radiusBottom: 34, height: 80, segments: 20 }, rotation: [0, 0, -Math.PI / 2] }] }, mount: [cx + 210, cy - 90, 60], material: 'plastic_black', station: E, small: true })
add({ id: 'starter_motor', ko: '스타터 모터', en: 'Starter Motor', geometry: cylZ(30, 120), mount: [cx - 40, cy + 100, -70], material: 'plastic_black', station: E, small: true })
add({ id: 'water_pump', ko: '워터펌프', en: 'Water Pump', geometry: { type: 'composite', children: [{ geometry: cylZ(40, 40) }, { geometry: { type: 'box', size: [30, 30, 40] }, position: [0, 40, 0] }] }, mount: [cx + 40, cy - 60, -215], material: 'cast_alu', station: E, small: true })
add({ id: 'drive_sprocket', ko: '드라이브 스프로킷', en: 'Drive Sprocket', geometry: sprocket(40, 8, 14), mount: [cx - 190, cy - 60, -205], material: 'steel', station: E, small: true })
add({ id: 'engine_mount_bolt', ko: '엔진 마운트 볼트', en: 'Engine Mount Bolt', geometry: { type: 'composite', children: [{ geometry: cylZ(6, 60) }, { geometry: cylZ(11, 8), position: [0, 0, 30] }] },
  mount: [0, 0, 0], material: 'steel', marries: E, requires: ['drive_sprocket', 'subframe'], small: true, hint: '엔진 마운트 볼트 체결',
  camera: { azimuth: 30, polar: 62, distance: 3200, target: [-120, 480, 0] },
  instances: [ { suffix: 'fl', mount: [80, 560, -170] }, { suffix: 'fr', mount: [80, 560, 170] }, { suffix: 'rl', mount: [-420, 420, -180] }, { suffix: 'rr', mount: [-420, 420, 180] } ] })
```

- [ ] **Step 4: 검사, 브라우저 포인트** — 엔진 스탠드 위에 크랭크케이스가 얹히고 내부 부품이 순서대로 들어가며, 마운트 볼트 4개를 다 꽂으면 엔진이 프레임 안(z=0)으로 이동한다.
- [ ] **Step 5: 커밋** — "닌자 400 엔진 작업대 부품 27개와 엔진 마운트 볼트"

---

### Task 4: 리어 서스펜션, 프런트 엔드, 앞뒤 바퀴 작업대, 체인

**Interfaces:** id 순서: `swingarm, rear_shock, shock_linkage, steering_stem, fork(×2), top_clamp, clip_on(×2), front_wheel, front_disc, front_axle(marries front_wheel, requires ['front_disc','fork']), front_caliper, front_fender(paintable), rear_wheel, rear_disc, rear_sprocket, rear_axle(marries rear_wheel, requires ['rear_sprocket','swingarm']), rear_caliper, chain(requires ['rear_axle','drive_sprocket'])`.

- [ ] **Step 1: 테스트 추가**
```ts
it('wheel stations marry with axles that also require the fork / swingarm', () => {
  expect(PART_BY_ID.front_axle.marries).toBe('front_wheel')
  expect(PART_BY_ID.front_axle.requires).toEqual(['front_disc', 'fork'])
  expect(PART_BY_ID.rear_axle.marries).toBe('rear_wheel')
  expect(PART_BY_ID.rear_axle.requires).toEqual(['rear_sprocket', 'swingarm'])
  expect(PART_BY_ID.chain.requires).toEqual(['rear_axle', 'drive_sprocket'])
  expect(PART_BY_ID.fork.count).toBe(2)
  expect(PART_BY_ID.front_wheel.mountPosition).toEqual([685, 293, 0])
})
```
- [ ] **Step 2: 실패 확인**
- [ ] **Step 3: 데이터**

```ts
const FW = 'front_wheel', RW = 'rear_wheel'
add({ id: 'swingarm', ko: '스윙암', en: 'Swingarm', geometry: { type: 'composite', children: [
  { geometry: { type: 'box', size: [300, 60, 40] }, position: [-150, 0, -130], rotation: [0, 0, 0.12] }, { geometry: { type: 'box', size: [300, 60, 40] }, position: [-150, 0, 130], rotation: [0, 0, 0.12] },
  { geometry: { type: 'box', size: [60, 60, 300] }, position: [-30, 0, -150] }, { geometry: cylZ(20, 320), position: [0, 30, 0] } ] },
  mount: [-420, 400, 0], material: 'cast_alu', requires: ['engine_mount_bolt'] })
add({ id: 'rear_shock', ko: '리어 쇼크', en: 'Rear Shock', geometry: { type: 'composite', children: [{ geometry: { type: 'cylinder', radiusTop: 22, radiusBottom: 22, height: 180, segments: 16 } }, { geometry: { type: 'cylinder', radiusTop: 8, radiusBottom: 8, height: 110, segments: 10 }, position: [0, 180, 0] }, ...[0, 1, 2, 3, 4, 5].map((i) => ({ geometry: { type: 'torus', radius: 34, tube: 5 } as Geometry, position: [0, 20 + i * 28, 0] as Vec3 }))] },
  mount: [-470, 380, 0], rot: [0, 0, 0.35], material: 'steel', small: true })
add({ id: 'shock_linkage', ko: '쇼크 링크', en: 'Shock Linkage', geometry: { type: 'composite', children: [{ geometry: { type: 'box', size: [120, 24, 20] }, position: [0, 0, -30] }, { geometry: { type: 'box', size: [120, 24, 20] }, position: [0, 0, 30] }, { geometry: { type: 'box', size: [60, 20, 80] }, position: [-60, 0, 0] }] }, mount: [-500, 330, 0], material: 'cast_alu', small: true })
const [stemX, stemY] = forkPoint(760)
add({ id: 'steering_stem', ko: '스티어링 스템 · 하부 트리플 클램프', en: 'Steering Stem / Lower Triple Clamp', geometry: { type: 'composite', children: [{ geometry: { type: 'box', size: [80, 40, 240] } }, { geometry: { type: 'cylinder', radiusTop: 16, radiusBottom: 16, height: 150, segments: 12 }, position: [0, 40, 0] }] },
  mount: [stemX, stemY, 0], rot: FORK_ROT, material: 'cast_alu', small: true, camera: { azimuth: 40, polar: 60, distance: 2600, target: [500, 700, 0] } })
add({ id: 'fork', ko: '프런트 포크', en: 'Front Fork', geometry: forkLeg(FORK_LEN, 20.5, 27, 300), mount: FRONT_AXLE, rot: FORK_ROT, material: 'polished_alu',
  instances: [{ suffix: 'l', mount: [FRONT_AXLE[0], FRONT_AXLE[1], -FORK_SPACING / 2] }, { suffix: 'r', mount: [FRONT_AXLE[0], FRONT_AXLE[1], FORK_SPACING / 2] }],
  camera: { azimuth: 40, polar: 60, distance: 2600, target: [560, 600, 0] } })
const [topX, topY] = forkPoint(880)
add({ id: 'top_clamp', ko: '상부 트리플 클램프', en: 'Upper Triple Clamp', geometry: { type: 'box', size: [70, 30, 260] }, mount: [topX, topY, 0], rot: FORK_ROT, material: 'cast_alu', small: true, camera: { azimuth: 40, polar: 55, distance: 2200, target: [430, 850, 0] } })
add({ id: 'clip_on', ko: '클립온 핸들', en: 'Clip-on Handlebar', geometry: { type: 'composite', children: [{ geometry: { type: 'cylinder', radiusTop: 11, radiusBottom: 11, height: 230, segments: 12 }, rotation: [Math.PI / 2, 0, 0], position: [0, 0, 0] }, { geometry: { type: 'cylinder', radiusTop: 16, radiusBottom: 16, height: 120, segments: 12 }, rotation: [Math.PI / 2, 0, 0], position: [0, 0, 110], material: 'rubber' }] },
  mount: [topX - 20, topY + 20, 0], material: 'polished_alu', small: true, camera: { azimuth: 20, polar: 50, distance: 2200, target: [430, 900, 0] },
  instances: [{ suffix: 'l', mount: [topX - 20, topY + 20, -110], rot: [0, Math.PI, 0] }, { suffix: 'r', mount: [topX - 20, topY + 20, 110], rot: [0, 0, 0] }] })
// (오른쪽 클립온의 원통은 +z로 뻗고 왼쪽은 y축 180도 회전으로 -z로 뻗는다. 그립은 원통 끝 110~230 구간.)
add({ id: 'front_wheel', ko: '앞 휠 · 타이어', en: 'Front Wheel', geometry: wheel(FRONT_TIRE_R, FRONT_TIRE_W, RIM_R), mount: FRONT_AXLE, material: 'polished_alu', station: FW, requires: ['clip_on'] })
add({ id: 'front_disc', ko: '앞 브레이크 디스크', en: 'Front Brake Disc', geometry: disc(155, 5), mount: [FRONT_AXLE[0], FRONT_AXLE[1], -62], material: 'stainless', station: FW })
add({ id: 'front_axle', ko: '앞 액슬', en: 'Front Axle', geometry: { type: 'composite', children: [{ geometry: cylZ(9, 240) }, { geometry: cylZ(16, 10), position: [0, 0, 120] }] }, mount: FRONT_AXLE, material: 'steel', marries: FW, requires: ['front_disc', 'fork'], small: true, hint: '앞 액슬 체결', camera: { azimuth: 40, polar: 62, distance: 2400, target: [685, 400, 0] } })
add({ id: 'front_caliper', ko: '프런트 캘리퍼', en: 'Front Brake Caliper', geometry: { type: 'box', size: [90, 60, 40] }, mount: [FRONT_AXLE[0] + 40, FRONT_AXLE[1] + 120, -78], material: 'cast_alu', small: true })
add({ id: 'front_fender', ko: '프런트 펜더', en: 'Front Fender', geometry: { type: 'composite', children: [{ geometry: { type: 'frustum', bottom: [420, 130], top: [300, 120], h: 40 } }] }, mount: [FRONT_AXLE[0], FRONT_AXLE[1] + 300, 0], material: 'primer', paintable: true })
add({ id: 'rear_wheel', ko: '뒤 휠 · 타이어', en: 'Rear Wheel', geometry: wheel(REAR_TIRE_R, REAR_TIRE_W, RIM_R), mount: REAR_AXLE, material: 'polished_alu', station: RW })
add({ id: 'rear_disc', ko: '리어 브레이크 디스크', en: 'Rear Brake Disc', geometry: disc(110, 5), mount: [REAR_AXLE[0], REAR_AXLE[1], 80], material: 'stainless', station: RW })
add({ id: 'rear_sprocket', ko: '리어 스프로킷', en: 'Rear Sprocket', geometry: sprocket(118, 7, 41), mount: [REAR_AXLE[0], REAR_AXLE[1], -84], material: 'steel', station: RW })
add({ id: 'rear_axle', ko: '뒤 액슬', en: 'Rear Axle', geometry: { type: 'composite', children: [{ geometry: cylZ(10, 300) }, { geometry: cylZ(17, 10), position: [0, 0, 150] }] }, mount: REAR_AXLE, material: 'steel', marries: RW, requires: ['rear_sprocket', 'swingarm'], small: true, hint: '뒤 액슬 체결', camera: { azimuth: -40, polar: 62, distance: 2400, target: [-685, 400, 0] } })
add({ id: 'rear_caliper', ko: '리어 캘리퍼', en: 'Rear Brake Caliper', geometry: { type: 'box', size: [70, 50, 36] }, mount: [REAR_AXLE[0] - 20, REAR_AXLE[1] + 80, 100], material: 'cast_alu', small: true })
add({ id: 'chain', ko: '체인', en: 'Drive Chain', geometry: { type: 'composite', children: [
  { geometry: { type: 'box', size: [500, 10, 8] }, position: [-250, 100, 0], rotation: [0, 0, 0.08] }, { geometry: { type: 'box', size: [500, 10, 8] }, position: [-250, -100, 0], rotation: [0, 0, -0.08] },
  { geometry: { type: 'torus', radius: 118, tube: 5 }, position: [-500, -5, 0], rotation: [Math.PI / 2, 0, 0] }, { geometry: { type: 'torus', radius: 40, tube: 5 }, position: [0, -5, 0], rotation: [Math.PI / 2, 0, 0] } ] },
  mount: [cx - 190, cy - 60, -205], material: 'chain', requires: ['rear_axle', 'drive_sprocket'], small: true, camera: { azimuth: -60, polar: 62, distance: 2600, target: [-400, 400, 0] } })
```

- [ ] **Step 4: 검사, 브라우저 포인트** — 포크가 24.7° 기울어 스티어링 헤드에서 앞 액슬로 내려오고, 앞바퀴 벤치에서 조립한 바퀴가 액슬 체결 시 포크 사이로 이동한다. 뒤도 같다.
- [ ] **Step 5: 커밋** — "닌자 400 서스펜션·프런트 엔드·바퀴 작업대·체인"

---

### Task 5: 냉각, 전장, 흡기·연료, 배기, 조작계

**Interfaces:** id 순서: `radiator, cooling_fan, radiator_hose(×2), coolant_reservoir, battery, ecu, instrument_cluster, headlight, taillight, turn_signal(×4), airbox, throttle_body, fuel_tank(paintable), exhaust_header(×2), exhaust_collector, muffler, brake_pedal, shift_lever, rider_peg(×2), passenger_peg(×2), sidestand, lever(×2)`. 램프 부품 재질은 `lamp_off`(점등은 renderInstance). 이 태스크의 첫 부품 `radiator`는 `requires: ['chain']`.

- [ ] **Step 1: 테스트 추가**
```ts
it('lamps use lamp_off and the tank is paintable', () => {
  for (const id of ['headlight', 'taillight', 'turn_signal']) expect(PART_BY_ID[id].material).toBe('lamp_off')
  expect(PART_BY_ID.fuel_tank.paintable).toBe(true)
  expect(PART_BY_ID.turn_signal.count).toBe(4)
  expect(PART_BY_ID.radiator.requires).toEqual(['chain'])
})
```
- [ ] **Step 2: 실패 확인**
- [ ] **Step 3: 데이터**

```ts
add({ id: 'radiator', ko: '라디에이터', en: 'Radiator', geometry: { type: 'box', size: [30, 280, 380] }, mount: [230, 420, 0], material: 'cast_alu', requires: ['chain'], camera: { azimuth: 60, polar: 62, distance: 2600, target: [250, 500, 0] } })
add({ id: 'cooling_fan', ko: '냉각 팬', en: 'Cooling Fan', geometry: { type: 'composite', children: [{ geometry: { type: 'cylinder', radiusTop: 110, radiusBottom: 110, height: 40, segments: 24 }, rotation: [0, 0, -Math.PI / 2] }] }, mount: [215, 540, 40], material: 'plastic_black', small: true })
add({ id: 'radiator_hose', ko: '라디에이터 호스', en: 'Radiator Hose', geometry: { type: 'composite', children: [{ geometry: { type: 'cylinder', radiusTop: 13, radiusBottom: 13, height: 260, segments: 12 }, rotation: [0, 0, -Math.PI / 2] }] }, mount: [0, 0, 0], material: 'rubber', small: true,
  instances: [{ suffix: 'upper', mount: [10, 690, -150] }, { suffix: 'lower', mount: [-20, 300, -190] }] })
add({ id: 'coolant_reservoir', ko: '리저브 탱크', en: 'Coolant Reservoir', geometry: { type: 'box', size: [90, 140, 60] }, mount: [-200, 260, 190], material: 'plastic_black', small: true })
add({ id: 'battery', ko: '배터리', en: 'Battery', geometry: { type: 'box', size: [140, 100, 90] }, mount: [-560, 620, 0], material: 'plastic_black', small: true, camera: { azimuth: -30, polar: 55, distance: 2600, target: [-500, 700, 0] } })
add({ id: 'ecu', ko: 'ECU', en: 'ECU', geometry: { type: 'box', size: [120, 30, 100] }, mount: [-650, 720, 0], material: 'plastic_black', small: true })
add({ id: 'instrument_cluster', ko: '계기판', en: 'Instrument Cluster', geometry: { type: 'box', size: [40, 90, 200] }, mount: [520, 1000, 0], rot: [0, 0, -0.5], material: 'plastic_black', small: true, camera: { azimuth: 10, polar: 50, distance: 2200, target: [500, 950, 0] } })
add({ id: 'headlight', ko: '헤드라이트 유닛', en: 'Headlight Unit', geometry: { type: 'composite', children: [{ geometry: { type: 'box', size: [60, 120, 110] }, position: [0, 0, -95] }, { geometry: { type: 'box', size: [60, 120, 110] }, position: [0, 0, 95] }] }, mount: [780, 900, 0], rot: [0, 0, 0.2], material: 'lamp_off', small: true, camera: { azimuth: 0, polar: 60, distance: 2400, target: [700, 850, 0] } })
add({ id: 'taillight', ko: '테일라이트', en: 'Tail Light', geometry: { type: 'box', size: [40, 60, 160] }, mount: [-900, 780, 0], material: 'lamp_off', small: true, camera: { azimuth: 180, polar: 60, distance: 2400, target: [-800, 750, 0] } })
add({ id: 'turn_signal', ko: '방향지시등', en: 'Turn Signal', geometry: { type: 'composite', children: [{ geometry: { type: 'cylinder', radiusTop: 6, radiusBottom: 6, height: 60, segments: 8 }, rotation: [Math.PI / 2, 0, 0] }, { geometry: { type: 'box', size: [50, 30, 30] }, position: [0, 0, 70] }] }, mount: [0, 0, 0], material: 'lamp_off', small: true,
  instances: [{ suffix: 'fl', mount: [700, 820, -150], rot: [0, Math.PI, 0] }, { suffix: 'fr', mount: [700, 820, 150] }, { suffix: 'rl', mount: [-880, 700, -110], rot: [0, Math.PI, 0] }, { suffix: 'rr', mount: [-880, 700, 110] }] })
add({ id: 'airbox', ko: '에어박스', en: 'Airbox', geometry: { type: 'roundedBox', size: [260, 170, 300], radius: 20 }, mount: [-120, 730, 0], material: 'plastic_black', camera: { azimuth: 30, polar: 50, distance: 2800, target: [-100, 800, 0] } })
add({ id: 'throttle_body', ko: '스로틀 바디', en: 'Throttle Body', geometry: { type: 'composite', children: [{ geometry: cylZ(28, 200) }, { geometry: { type: 'box', size: [60, 40, 200] }, position: [0, 30, 0] }] }, mount: tilt(-70, 400, 0), rot: TILT_ROT, material: 'cast_alu', small: true })
add({ id: 'fuel_tank', ko: '연료탱크', en: 'Fuel Tank', geometry: tank(), mount: [40, 840, 0], material: 'primer', paintable: true, camera: { azimuth: 30, polar: 55, distance: 3000, target: [0, 900, 0] } })
add({ id: 'exhaust_header', ko: '배기 헤더', en: 'Exhaust Header', geometry: { type: 'composite', children: [{ geometry: { type: 'cylinder', radiusTop: 19, radiusBottom: 19, height: 320, segments: 12 } }, { geometry: { type: 'cylinder', radiusTop: 19, radiusBottom: 19, height: 360, segments: 12 }, position: [0, 320, 0], rotation: [0, 0, -1.2] }] },
  mount: [0, 0, 0], rot: [0, 0, Math.PI - 0.35], material: 'stainless', small: true,
  instances: [{ suffix: 'l', mount: tilt(120, 260, -42) }, { suffix: 'r', mount: tilt(120, 260, 42) }],
  camera: { azimuth: 70, polar: 65, distance: 2800, target: [100, 350, 0] } })
add({ id: 'exhaust_collector', ko: '배기 집합부', en: 'Exhaust Collector', geometry: { type: 'composite', children: [{ geometry: { type: 'cylinder', radiusTop: 26, radiusBottom: 26, height: 600, segments: 14 }, rotation: [0, 0, Math.PI / 2 + 0.05] }] }, mount: [180, 210, 120], material: 'stainless' })
add({ id: 'muffler', ko: '머플러', en: 'Muffler', geometry: { type: 'composite', children: [{ geometry: { type: 'cylinder', radiusTop: 55, radiusBottom: 45, height: 420, segments: 20 }, rotation: [0, 0, Math.PI / 2 + 0.35] }] }, mount: [-450, 240, 190], material: 'stainless', camera: { azimuth: 90, polar: 62, distance: 2800, target: [-500, 350, 0] } })
add({ id: 'brake_pedal', ko: '브레이크 페달', en: 'Brake Pedal', geometry: { type: 'composite', children: [{ geometry: { type: 'box', size: [180, 14, 14] } }, { geometry: { type: 'box', size: [40, 14, 40] }, position: [90, 0, 20] }] }, mount: [-300, 330, 200], material: 'steel', small: true })
add({ id: 'shift_lever', ko: '시프트 레버', en: 'Shift Lever', geometry: { type: 'composite', children: [{ geometry: { type: 'box', size: [180, 14, 14] } }, { geometry: { type: 'box', size: [40, 14, 40] }, position: [90, 0, -20] }] }, mount: [-300, 330, -200], material: 'steel', small: true })
add({ id: 'rider_peg', ko: '라이더 스텝', en: 'Rider Footpeg', geometry: { type: 'composite', children: [{ geometry: { type: 'cylinder', radiusTop: 12, radiusBottom: 12, height: 90, segments: 10 }, rotation: [Math.PI / 2, 0, 0] }] }, mount: [0, 0, 0], material: 'steel', small: true,
  instances: [{ suffix: 'l', mount: [-330, 360, -180], rot: [0, Math.PI, 0] }, { suffix: 'r', mount: [-330, 360, 180] }] })
add({ id: 'passenger_peg', ko: '동승자 스텝', en: 'Passenger Footpeg', geometry: { type: 'composite', children: [{ geometry: { type: 'cylinder', radiusTop: 11, radiusBottom: 11, height: 80, segments: 10 }, rotation: [Math.PI / 2, 0, 0] }] }, mount: [0, 0, 0], material: 'steel', small: true,
  instances: [{ suffix: 'l', mount: [-620, 500, -170], rot: [0, Math.PI, 0] }, { suffix: 'r', mount: [-620, 500, 170] }] })
add({ id: 'sidestand', ko: '사이드스탠드', en: 'Sidestand', geometry: { type: 'composite', children: [{ geometry: { type: 'cylinder', radiusTop: 10, radiusBottom: 10, height: 300, segments: 10 }, rotation: [0.5, 0, 0.35] }] }, mount: [-380, 40, -200], material: 'steel', small: true })
add({ id: 'lever', ko: '브레이크 · 클러치 레버', en: 'Brake / Clutch Lever', geometry: { type: 'box', size: [150, 12, 16] }, mount: [0, 0, 0], material: 'polished_alu', small: true,
  instances: [{ suffix: 'clutch', mount: [topX + 40, topY + 30, -230] }, { suffix: 'brake', mount: [topX + 40, topY + 30, 230] }] })
```

- [ ] **Step 4: 검사, 브라우저 포인트** — 라디에이터가 프레임 앞 다운튜브 앞에, 탱크가 프레임 백본 위에, 머플러가 우측 하단에 있다.
- [ ] **Step 5: 커밋** — "닌자 400 냉각·전장·흡기·배기·조작계"

---

### Task 6: 외장 + 도색 (변형)

**Files:** Modify `parts.ts` (L·M 구획), `parts.test.ts`; Create `render/Paintable.tsx`; Modify `product.tsx` (`renderInstance`)

**Interfaces:**
- 부품 id 순서: `upper_cowl(paintable), side_cowl(×2, paintable), lower_cowl(×2, paintable), windscreen(glass), tail_cowl(paintable), rear_hugger, rider_seat, passenger_seat, mirror(×2), paint(hidden, variants PAINT_VARIANTS, count 1, geometry 형식상 box [10,10,10], hint '도색', camera main)`.
- `Paintable.tsx`: `export function Paintable({ part, inst, record }: RenderInstanceCtx)` — `useAssembly((s) => s.mounted.paint)`로 도색 기록을 읽고, 없으면 primer 재질, 있으면 `delay = rank(inst) * 150ms` (rank = paintable 인스턴스들을 mountPosition x 내림차순으로 정렬한 순위, `paintRank(instanceId)`를 parts.ts에서 export) 뒤 `paintMaterialName(record.variant)` 재질로 전환. 전환은 `useFrame`에서 `performance.now() - paintRecord.at >= delay`를 보고 `mesh material`을 바꾸는 대신 **두 개의 PartGeometry를 겹치지 않고** 상태 하나(`painted: boolean`)를 `useState`로 바꿔 리렌더한다(80개 중 최대 9개라 비용 없음).
- `product.tsx`: `renderInstance: (ctx) => ctx.part.paintable ? <Paintable {...ctx} /> : null` (B7에서 램프·진동 분기가 추가된다).

- [ ] **Step 1: 테스트 추가**
```ts
it('bodywork is paintable primer and paint is the last, hidden, variant part', () => {
  const last = PARTS[PARTS.length - 1]
  expect(last.id).toBe('paint')
  expect(last.hidden).toBe(true)
  expect(last.variants?.map((v) => v.id)).toEqual(['krt', 'blue', 'black'])
  const paintable = PARTS.filter((p) => p.paintable).map((p) => p.id)
  expect(paintable).toEqual(['front_fender', 'fuel_tank', 'upper_cowl', 'side_cowl', 'lower_cowl', 'tail_cowl'])
  expect(PARTS).toHaveLength(80)
})
it('paintRank orders paintable instances front to back', async () => {
  const { paintRank } = await import('./parts')
  expect(paintRank('front_fender')).toBe(0)
  expect(paintRank('tail_cowl')).toBeGreaterThan(paintRank('fuel_tank'))
})
```
- [ ] **Step 2: 실패 확인**
- [ ] **Step 3: 데이터**

```ts
add({ id: 'upper_cowl', ko: '어퍼 카울', en: 'Upper Cowl', geometry: cowl([260, 260, 520], 0.7), mount: [640, 760, 0], rot: [0, 0, 0.25], material: 'primer', paintable: true, requires: ['lever'], camera: { azimuth: 25, polar: 60, distance: 3200, target: [600, 850, 0] } })
add({ id: 'side_cowl', ko: '사이드 카울', en: 'Side Cowl', geometry: { type: 'box', size: [620, 380, 30] }, mount: [0, 0, 0], material: 'primer', paintable: true,
  instances: [{ suffix: 'l', mount: [120, 500, -265], rot: [0, 0, 0.15] }, { suffix: 'r', mount: [120, 500, 265], rot: [0, 0, 0.15] }] })
add({ id: 'lower_cowl', ko: '로어 카울', en: 'Lower Cowl', geometry: { type: 'box', size: [520, 220, 30] }, mount: [0, 0, 0], material: 'primer', paintable: true,
  instances: [{ suffix: 'l', mount: [60, 250, -270] }, { suffix: 'r', mount: [60, 250, 270] }] })
add({ id: 'windscreen', ko: '윈드스크린', en: 'Windscreen', geometry: { type: 'box', size: [12, 220, 300] }, mount: [560, 1000, 0], rot: [0, 0, 0.55], material: 'glass', small: true })
add({ id: 'tail_cowl', ko: '테일 카울', en: 'Tail Cowl', geometry: cowl([520, 160, 280], 0.6), mount: [-620, 760, 0], material: 'primer', paintable: true, camera: { azimuth: -150, polar: 60, distance: 3200, target: [-600, 800, 0] } })
add({ id: 'rear_hugger', ko: '리어 허거', en: 'Rear Hugger', geometry: { type: 'frustum', bottom: [360, 170], top: [300, 160], h: 30 }, mount: [-685, 640, 0], material: 'plastic_black', small: true })
add({ id: 'rider_seat', ko: '라이더 시트', en: 'Rider Seat', geometry: { type: 'roundedBox', size: [360, 60, 260], radius: 20 }, mount: [-330, 740, 0], material: 'plastic_black' })
add({ id: 'passenger_seat', ko: '동승자 시트', en: 'Passenger Seat', geometry: { type: 'roundedBox', size: [260, 50, 220], radius: 18 }, mount: [-680, 820, 0], material: 'plastic_black' })
add({ id: 'mirror', ko: '미러', en: 'Mirror', geometry: { type: 'composite', children: [{ geometry: { type: 'cylinder', radiusTop: 7, radiusBottom: 7, height: 140, segments: 8 }, rotation: [0.6, 0, 0] }, { geometry: { type: 'box', size: [30, 80, 130] }, position: [0, 120, 80] }] }, mount: [0, 0, 0], material: 'plastic_black', small: true,
  instances: [{ suffix: 'l', mount: [600, 1000, -200], rot: [0, Math.PI, 0] }, { suffix: 'r', mount: [600, 1000, 200] }] })
add({ id: 'paint', ko: '도색', en: 'Paint', geometry: { type: 'box', size: [10, 10, 10] }, mount: [0, 0, 0], material: 'primer', hidden: true, variants: PAINT_VARIANTS, hint: '도색', camera: { azimuth: 30, polar: 62, distance: 4000, target: [0, 600, 0] } })

/** 도색 순서: paintable 인스턴스를 x 내림차순(앞→뒤)으로. 0부터 */
export function paintRank(instanceId: string): number {
  const list = PARTS.filter((p) => p.paintable).flatMap((p) => p.instances).sort((a, b) => b.mountPosition[0] - a.mountPosition[0])
  return Math.max(0, list.findIndex((i) => i.id === instanceId))
}
```
`PAINT_VARIANTS`를 `./materials`에서 import. `PARTS`가 80개가 되도록 항목 수를 맞춘다(테스트가 잡는다).

`render/Paintable.tsx`:
```tsx
import { useEffect, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { useAssembly, useMaterials } from '../../../engine/context'
import { PartGeometry } from '../../../engine/geometry/PartGeometry'
import type { RenderInstanceCtx } from '../../../engine/types'
import { paintMaterialName } from '../materials'
import { paintRank } from '../parts'

export const PAINT_STEP_MS = 150

/** 프라이머로 장착됐다가 도색 기록이 생기면 앞에서 뒤로 순서대로 색이 입혀진다 */
export function Paintable({ part, inst }: RenderInstanceCtx) {
  const materials = useMaterials()
  const paint = useAssembly((s) => s.mounted.paint)
  const [painted, setPainted] = useState(false)
  const delay = paintRank(inst.id) * PAINT_STEP_MS
  useEffect(() => { if (!paint) setPainted(false) }, [paint])
  useFrame(() => {
    if (!paint || painted) return
    if (performance.now() - paint.at >= delay) setPainted(true)
  })
  const name = painted && paint?.variant ? paintMaterialName(paint.variant) : part.material
  return <PartGeometry geometry={inst.geometry} material={materials.get(name)} materials={materials} />
}
```

- [ ] **Step 4: 검사, 브라우저 포인트** — 도색 트레이 항목을 고르면 HUD에 색 3개가 뜨고, 고르면 펜더 → 탱크 → 카울 순으로 색이 입혀진다. 되돌리면 프라이머로 돌아온다.
- [ ] **Step 5: 커밋** — "닌자 400 외장과 도색 변형"

---

### Task 7: 마무리 — 키, 시동, 스로틀, 램프, 엔진 진동, 엔진 사운드

**Files:** Create `finale/throttleState.ts`, `finale/Key.tsx`, `finale/Starter.tsx`, `finale/Throttle.tsx`, `finale/Finale.tsx`, `render/Lamps.tsx`, `render/EngineShake.tsx`, `audio/engineSound.ts`, `audio/engineSound.test.ts`; Modify `product.tsx`

**Interfaces:**
- `throttleState.ts`: `export const throttle = { value: 0, target: 0 }` (0~1). `Throttle`가 target을 쓰고, `useFrame`에서 value가 0.25초 시정수로 따라간다(사운드·계기판·그립 회전이 value를 읽는다).
- `engineSound.ts`: `start()`, `setThrottle(t: number)`, `stop()`, 내부 `rpmFor(t) = 1300 + t * 8700`. 100ms 룩어헤드 큐잉(`setInterval` 25ms + AudioContext 시계). 점화 간격: 회전당 2회, 180°/540° 불균등 → 한 회전 T=60/rpm 초 안에서 `[0, 0.25T]`... 정확히는 두 점화가 크랭크 각 0°와 180°에 오고 다음 회전은 540°(=180°+360°)에서 다음 사이클 — 4행정 2기통 180° 크랭크는 720° 주기에 0°와 180°에서 점화하므로 720° 주기 P=120/rpm 초 안에 `[0, P/4]`에 점화한다. 각 점화 = 사인 저역 펄스(주파수 60 + t*50 Hz, 8ms, exp 감쇠) + 노이즈 버스트(로우패스 1200 + t*2500 Hz, 12ms). 마스터 2탭 딜레이는 키보드 switchSound와 같은 구조(11ms/23ms). 순수 함수 `firingTimes(rpm, from, to): number[]`를 export 해서 테스트한다.
- `Key.tsx`: `complete` 단계에서 계기판 앞 `[560, 1080, 120]`mm에 키(원통 r 6 × 40 + 납작 박스 [30, 4, 20])가 떠 있다. 잡아서(`setControlsEnabled(false)`, 카메라 높이 평면 y=1080) 키실린더 `[540, 980, 60]` 반경 150mm 안에서 놓으면 `advancePhase()`; 아니면 되돌아온다. 드래그 구현은 `engine/scene/DraggablePart.tsx`와 같은 pointer 이벤트 방식(윈도우 pointermove/pointerup, Plane 교차).
- `Starter.tsx`: 우측 클립온 스위치 하우징 위치 `[topX - 20, topY + 60, 200]`에 박스 [30, 30, 40] + 빨간 버튼(box [12,12,14], color #b3261e). `keyed` 단계에서 클릭하면 `advancePhase()` 후 `engineSound.start()`. `running`에서 언마운트되면 `engineSound.stop()`.
- `Throttle.tsx`: `running` 단계에서 우측 그립(`clip_on:r` 원통의 110~230 구간 위치)에 보이지 않는 잡기 박스. 누른 채 화면 아래/뒤로 끌면 `throttle.target = clamp((startY - clientY) / 200, 0, 1)`; 놓으면 target 0. 매 프레임 `throttle.value += (target - value) * (1 - exp(-dt/0.25))`, `engineSound.setThrottle(value)`, 그립 메시(자체 렌더하는 얇은 rubber 원통) `rotation.z = -value * 60° `.
- `Lamps.tsx`: `renderInstance`에서 `headlight`/`taillight`/`instrument_cluster`에 쓴다. `phase`가 `keyed`/`running`이면 `lamp_on` 재질, 아니면 `lamp_off`. 계기판은 추가로 emissive 바(box [4, 12, 120·(0.15 + 0.85·throttle.value)])를 useFrame으로 스케일.
- `EngineShake.tsx`: `renderInstance`에서 `station === 'engine'`인 부품에 쓴다. `running`이면 그룹 위치에 `sin(now/16)*0.6mm`, `cos(now/13)*0.4mm`의 진동. 아니면 0.
- `product.tsx` `renderInstance`: `paintable → Paintable`, `id in {headlight, taillight, instrument_cluster} → Lamps`, `station === 'engine' → EngineShake`, else null. `Finale: NinjaFinale`. `NinjaFinale`는 `<Key/><Starter/><Throttle/><FinaleCamera/>`; `FinaleCamera`는 `complete`에서 `requestCameraView({azimuth: 15, polar: 55, distance: 2400}, [520, 950, 0])`, `running`에서 `({azimuth: 35, polar: 62, distance: 3800}, [0, 550, 0])`.

- [ ] **Step 1: 테스트**
```ts
// src/products/ninja400/audio/engineSound.test.ts
import { describe, expect, it } from 'vitest'
import { firingTimes, rpmFor } from './engineSound'
describe('engine firing schedule', () => {
  it('maps throttle to rpm', () => { expect(rpmFor(0)).toBe(1300); expect(rpmFor(1)).toBe(10000) })
  it('fires twice per 720-degree cycle at 0 and 180 degrees', () => {
    const P = 120 / 3000 // 3000rpm → 0.04s per cycle
    const t = firingTimes(3000, 0, P * 2)
    expect(t.length).toBe(4)
    expect(t[1] - t[0]).toBeCloseTo(P / 4, 6)
    expect(t[2] - t[1]).toBeCloseTo((3 * P) / 4, 6)
  })
})
```
- [ ] **Step 2: 실패 확인**
- [ ] **Step 3: 구현** — 위 Interfaces대로. `engineSound.ts` 골격:
```ts
export const IDLE_RPM = 1300, MAX_RPM = 10000
export const rpmFor = (t: number) => IDLE_RPM + Math.min(1, Math.max(0, t)) * (MAX_RPM - IDLE_RPM)
/** [from, to) 구간의 점화 시각. 720도 주기 P=120/rpm, 각 주기에 0과 P/4 */
export function firingTimes(rpm: number, from: number, to: number): number[] {
  const P = 120 / rpm
  const out: number[] = []
  for (let k = Math.floor(from / P); k * P < to; k++) for (const f of [0, 0.25]) { const t = (k + f) * P; if (t >= from && t < to) out.push(t) }
  return out
}
// start(): AudioContext 생성(키보드 switchSound와 같은 방식), 마스터+2탭 딜레이, noise buffer,
//   setInterval(25ms): now=ctx.currentTime, 구간 [cursor, now+0.1)에 firingTimes(rpmFor(throttle), ...)로 점화를 큐잉, cursor 갱신.
//   rpm이 바뀌면 다음 구간부터 반영된다(위상 연속은 요구하지 않는다).
// 점화 = OscillatorNode(sine, 60 + t*50 Hz, gain 0.5 exp 감쇠 8ms→40ms) + noise burst(BiquadFilter lowpass 1200 + t*2500, 12ms)
// setThrottle(t): 내부 변수만 갱신. stop(): interval 해제, 마스터 gain 0.15초 램프다운.
```

- [ ] **Step 4: 검사, 브라우저 포인트** — 도색 후 키가 계기판 앞에 뜨고, 키실린더에 놓으면 계기판·헤드라이트·테일라이트가 켜진다. 시동 버튼 클릭 시 엔진이 떨리고(부품 미세 진동) 콘솔 오류 없음. 그립을 누른 채 끌면 계기판 바가 길어진다. 되돌리기 버튼은 비활성.
- [ ] **Step 5: 커밋** — "닌자 400 마무리: 키·시동·스로틀, 램프, 엔진 진동, 엔진 사운드"

---

### Task 8: 통합 확인과 조정

**Files:** 필요 시 `parts.ts` 좌표 미세 조정, `product.tsx` drag/camera 수치, `styles.css`(트레이 80칸 가로 스크롤 확인)

- [ ] **Step 1: 전체 검사** — `npx tsc --noEmit && npx vitest run && npx vite build`
- [ ] **Step 2: 컨트롤러 브라우저 확인 목록** (`/ninja400`)
  1. 진입 화면에 카드 두 장. 닌자 카드 → 프레임·지그·작업대 3곳.
  2. 서브프레임 드래그 장착. 엔진 작업대에서 크랭크케이스 하부 드래그 장착, 밸브 8개를 하나 잡고 헤드 위를 지나가며 연속 장착.
  3. 콘솔로 마운트 볼트까지 장착 → 엔진이 프레임으로 이동. 되돌리면 스탠드로 복귀.
  4. 바퀴 작업대 → 액슬 체결 → 바퀴 이동.
  5. 도색 선택 → 순차 도색. 키 → 시동 → 스로틀.
  6. 트레이가 80칸으로 가로 스크롤되고 선택 항목이 보인다(선택 시 `scrollIntoView({ inline: 'center' })`를 Tray에 추가한다 — 엔진 UI 수정, 키보드에는 영향 없음).
  7. 프레임 시간: `window.__assembly` 없이도 육안으로 끊김이 없고, 렌더 메시 수를 콘솔에서 세어 2,000개 이하.
- [ ] **Step 3: 발견한 좌표·수치 오류를 parts.ts에서 수정** (엔진 코드 변경은 6번의 scrollIntoView뿐)
- [ ] **Step 4: 커밋** — "닌자 400 통합 조정"

---

## 자기 검토 결과

- **스펙 커버리지**: 7.1 제원(B2 spec.ts), 7.2 작업대·소품(B2), 7.3 부품 80개(B2~B6, 항목 수 테스트), 7.4 대기 위치(B2 REST), 7.5 재질(B2), 8 마무리(B7), 9 사운드(B7), 11 비주얼(엔진 그대로 + B1 스케일), 12 테스트(각 태스크), 13 위험(B8 성능 확인, drag 수치 조정).
- **타입 일관성**: `part()`/`add()` 입력 필드(`id, ko, en, geometry, mount, rot, rest, material, station, marries, instances{suffix, mount, rot, geometry, tag}, requires, paintable, hidden, variants, camera, hint, preplaced, small`)를 B3~B6가 동일하게 쓴다. `paintRank`, `paintMaterialName`, `PAINT_VARIANTS`, `throttle`, `firingTimes`, `rpmFor` 이름 고정. `renderInstance` 분기는 B6에서 도색, B7에서 램프·진동을 추가.
- **좌표 일관성**: `topX/topY`는 B4에서 `forkPoint(880)`로 정의하고 B5(레버)·B7(스타터)이 재사용한다 — B5·B7 구현자는 이 이름이 parts.ts 상단이 아니라 B4 구획에 있음을 안다(`const [topX, topY] = forkPoint(880)`). B7의 Starter는 parts.ts에서 `forkPoint`를 직접 계산한다(`import { forkPoint } from '../spec'`).
- **플레이스홀더**: 없음. 좌표는 전부 숫자로 적었고 추정치는 TODO 주석 대상으로 명시했다.
