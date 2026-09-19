# 닌자 400 실물감·조작·진행 개선 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 닌자 400을 곡면 형상으로 실물에 가깝게 다시 만들고, 각도와 무관하게 커서를 따라오는 드래그, 모든 단계 건너뛰기, 정규 부품이 된 키, 방향키 주행 조작(스로틀·브레이크·클러치·기어·시동 꺼짐), 합성 엔진음 v2를 넣는다.

**Architecture:** 공통 조립 엔진(`src/engine/`)에 곡면 프리미티브 4종(lathe/tube/extrude/loft), 화면 공간 드래그 판정, `skipCurrent`·`phaseOnMount`·`hudExtra`를 추가한다. 닌자 400 제품(`src/products/ninja400/`)은 부품 id·순서·작업대를 유지한 채 형상만 교체하고, 키를 마지막 부품으로 옮기며, 주행 모델(`rideModel.ts`)이 rpm·기어·클러치·브레이크·시동 꺼짐을 계산해 사운드·계기·3D 연출이 같은 상태를 본다.

**Tech Stack:** Vite 6, React 18, TypeScript 5, @react-three/fiber 8, drei 9, three 0.172, zustand 5, vitest 3, Web Audio API.

**Spec:** `docs/superpowers/specs/2026-09-19-ninja400-realism-and-controls-design.md`

## Global Constraints

- 형상은 코드로 생성한 것만 쓴다(기존 프리미티브 + lathe/tube/extrude/loft). 외부 모델 파일 금지.
- 모든 치수는 mm, `1 unit = 10mm`(`MM = 0.1`). 부품 원점은 밑면(또는 시작점).
- 부품 id·조립 순서·작업대·`requires`·도색 대상은 유지한다. 키(`ignition_key`) 추가로 닌자 부품 수는 80 → 81.
- 엔진(`src/engine/`)은 제품을 import하지 않는다(`boundary.test.ts`가 강제). 제품 폴더끼리도 import하지 않는다.
- 어두운 화면 규칙: 이모지·슬로건·그라데이션 금지, 힌트는 한국어 동사 명사형("~ 장착", "~ 체결")으로 끝낸다.
- 조작 키: `↑` 스로틀, `↓` 앞 브레이크, `Shift` 클러치, `←` 기어 다운, `→` 기어 업, `Enter` 건너뛰기, `Ctrl+Z` 되돌리기.
- 시프트 패턴 1-N-2-3-4-5-6. 기어비: 1차 3.087, 1~6단 2.929/1.947/1.545/1.333/1.185/1.095, 2차 3.071. 아이들 1300 rpm, 최대 10000.
- 검증 명령: `npx tsc --noEmit`, `npx vitest run`, `npm run build`. 셋 다 통과해야 커밋한다. `npm run dev`는 실행하지 않는다(브라우저 확인은 `http://192.168.1.177:5174/…`의 검증 서버).
- 커밋은 파일을 지정해 스테이징한다(`git add <paths>`). `git add -A`/`-a` 금지. 커밋 메시지 끝에 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

## 파일 구조

| 파일 | 역할 | 태스크 |
|---|---|---|
| `src/engine/types.ts` | `Primitive`에 lathe/tube/extrude/loft, `PartDef.phaseOnMount`, `DragConfig`에서 `hoverMm` 제거, `ProductDef.hudExtra` | 1, 2, 4, 6 |
| `src/engine/geometry/curved.ts` (신규) | 네 프리미티브 → `BufferGeometry` 빌더 + WeakMap 캐시 | 1 |
| `src/engine/geometry/curved.test.ts` (신규) | 빌더 bbox·정점 수 검사 | 1 |
| `src/engine/geometry/PartGeometry.tsx` | 새 타입 렌더 | 1 |
| `src/engine/store.ts` | `skipCurrent`, `canSkip`, `phaseOnMount` 전이, undo 허용 조건 | 2 |
| `src/engine/store.test.ts` | 위 동작 테스트 | 2 |
| `src/engine/ui/Hud.tsx` | 건너뛰기 버튼(전부 장착 대체), Enter, `hudExtra` 렌더 | 3 |
| `src/engine/scene/dragMath.ts` + `.test.ts` | 화면 공간 판정 순수 함수 | 4 |
| `src/engine/scene/DraggablePart.tsx` | 카메라 정면 평면 드래그, Box3 잡기 영역 | 4 |
| `src/products/keyboard/product.tsx`, `product.test.ts` | `hoverMm` 제거 | 4 |
| `src/products/ninja400/parts.ts`, `parts.test.ts` | 키 부품, 형상 교체 | 5, 8, 9, 10 |
| `src/products/ninja400/geometry.ts` | 곡면 생성 함수들 | 8, 9, 10 |
| `src/products/ninja400/finale/rideState.ts` (throttleState 대체) | 주행 상태 싱글턴 | 6 |
| `src/products/ninja400/finale/rideModel.ts` + `.test.ts` (신규) | 순수 주행 모델 | 6 |
| `src/products/ninja400/finale/RideControls.tsx` (신규) | 키 입력 → rideState | 6 |
| `src/products/ninja400/finale/RideGauge.tsx` (신규) | HUD 계기(DOM) | 6 |
| `src/products/ninja400/finale/Finale.tsx`, `Starter.tsx`, `Throttle.tsx` | keyed부터 시작, phase 효과로 시동, 레버·바퀴 연출 | 5, 6 |
| `src/products/ninja400/finale/Key.tsx` | 삭제 | 5 |
| `src/products/ninja400/audio/engineSound.ts` + `.test.ts` | v2 신호 경로, `setRpm/setLoad/blip` | 7 |
| `src/products/ninja400/product.tsx`, `product.test.ts` | drag 설정, hints, hudExtra | 4, 5, 6 |

---

### Task 1: 곡면 프리미티브 (lathe · tube · extrude · loft)

**Files:**
- Modify: `src/engine/types.ts` (`Primitive` 유니온, `validateGeometry`)
- Create: `src/engine/geometry/curved.ts`
- Create: `src/engine/geometry/curved.test.ts`
- Modify: `src/engine/geometry/PartGeometry.tsx`

**Interfaces:**
- Produces: `Primitive` 네 타입(스펙 §3 그대로); `curvedGeometry(g: CurvedPrimitive): THREE.BufferGeometry` (단위 변환 완료, 캐시됨); `isCurved(g: Geometry): g is CurvedPrimitive`.

- [ ] **Step 1: 타입 추가**

`src/engine/types.ts`의 `Primitive` 유니온 끝(`frustum` 뒤)에 추가:

```ts
  /** [반지름, 높이] 점열을 y축 둘레로 회전. 원점은 프로필의 y=0 */
  | { type: 'lathe'; profile: [number, number][]; segments?: number; angle?: number }
  /** Catmull-Rom 경로를 따라가는 관. 원점은 경로 좌표계 원점 */
  | { type: 'tube'; path: Vec3[]; radius: number; segments?: number; radial?: number; closed?: boolean }
  /** xy 다각형을 z로 밀어낸다. z는 -depth/2..+depth/2 */
  | { type: 'extrude'; shape: [number, number][]; depth: number; bevel?: number; holes?: [number, number][][] }
  /** 같은 점 수의 단면들을 차례로 이은 면. closed면 각 단면을 고리로 닫는다 */
  | { type: 'loft'; sections: Vec3[][]; closed?: boolean; smooth?: boolean }
```

그 아래에:

```ts
export type CurvedPrimitive = Extract<Primitive, { type: 'lathe' | 'tube' | 'extrude' | 'loft' }>
export const isCurved = (g: Geometry): g is CurvedPrimitive =>
  g.type === 'lathe' || g.type === 'tube' || g.type === 'extrude' || g.type === 'loft'
```

`validateGeometry`의 `switch`에 case 추가(`frustum` 뒤, `composite` 앞):

```ts
    case 'lathe':
      if (g.profile.length < 2) out.push(`${prefix}lathe.profile needs >= 2 points`)
      g.profile.forEach(([r], i) => { if (r < 0) out.push(`${prefix}lathe.profile[${i}] radius < 0`) })
      if (!g.profile.some(([r]) => r > 0)) out.push(`${prefix}lathe.profile has no positive radius`)
      break
    case 'tube':
      if (g.path.length < 2) out.push(`${prefix}tube.path needs >= 2 points`)
      positive(g.radius, `${prefix}tube.radius`, out)
      break
    case 'extrude':
      if (g.shape.length < 3) out.push(`${prefix}extrude.shape needs >= 3 points`)
      positive(g.depth, `${prefix}extrude.depth`, out)
      g.holes?.forEach((h, i) => { if (h.length < 3) out.push(`${prefix}extrude.holes[${i}] needs >= 3 points`) })
      break
    case 'loft': {
      if (g.sections.length < 2) out.push(`${prefix}loft needs >= 2 sections`)
      const n = g.sections[0]?.length ?? 0
      if (n < 3) out.push(`${prefix}loft sections need >= 3 points`)
      g.sections.forEach((s, i) => { if (s.length !== n) out.push(`${prefix}loft.sections[${i}] has ${s.length} points, expected ${n}`) })
      break
    }
```

- [ ] **Step 2: 실패하는 테스트**

`src/engine/geometry/curved.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { curvedGeometry } from './curved'
import { validateGeometry, type Geometry } from '../types'

const bbox = (g: THREE.BufferGeometry) => { g.computeBoundingBox(); const b = g.boundingBox!; return { min: b.min.toArray(), max: b.max.toArray() } }
const close = (a: number[], b: number[], tol = 0.02) => a.every((v, i) => Math.abs(v - b[i]) <= tol)

describe('curved primitives', () => {
  it('lathe: 반지름 100·높이 200 원통 프로필의 bbox는 ±10 x/z, 0..20 y (units)', () => {
    const g = curvedGeometry({ type: 'lathe', profile: [[100, 0], [100, 200], [0, 200]], segments: 32 })
    const b = bbox(g)
    expect(close(b.min, [-10, 0, -10])).toBe(true)
    expect(close(b.max, [10, 20, 10])).toBe(true)
  })
  it('tube: 직선 경로 x 0..1000, 반지름 20 → bbox x ≈ 0..100, y/z ±2', () => {
    const g = curvedGeometry({ type: 'tube', path: [[0, 0, 0], [500, 0, 0], [1000, 0, 0]], radius: 20, segments: 16 })
    const b = bbox(g)
    expect(close(b.min, [0, -2, -2], 0.3)).toBe(true)
    expect(close(b.max, [100, 2, 2], 0.3)).toBe(true)
  })
  it('extrude: 100x50 사각형, depth 30 → x ±5, y ±2.5, z ±1.5', () => {
    const g = curvedGeometry({ type: 'extrude', shape: [[-50, -25], [50, -25], [50, 25], [-50, 25]], depth: 30 })
    const b = bbox(g)
    expect(close(b.min, [-5, -2.5, -1.5])).toBe(true)
    expect(close(b.max, [5, 2.5, 1.5])).toBe(true)
  })
  it('extrude with hole: 구멍이 있으면 정점 수가 늘고 여전히 유효', () => {
    const solid = curvedGeometry({ type: 'extrude', shape: [[-50, -25], [50, -25], [50, 25], [-50, 25]], depth: 10 })
    const holed = curvedGeometry({ type: 'extrude', shape: [[-50, -25], [50, -25], [50, 25], [-50, 25]], depth: 10, holes: [[[-10, -5], [10, -5], [10, 5], [-10, 5]]] })
    expect(holed.attributes.position.count).toBeGreaterThan(solid.attributes.position.count)
  })
  it('loft: 두 사각 단면(y 0, y 100) → 옆면만, bbox 맞음, 법선 있음', () => {
    const sq = (y: number, s: number): [number, number, number][] => [[-s, y, -s], [s, y, -s], [s, y, s], [-s, y, s]]
    const g = curvedGeometry({ type: 'loft', sections: [sq(0, 50), sq(100, 30)], closed: true })
    const b = bbox(g)
    expect(close(b.min, [-5, 0, -5])).toBe(true)
    expect(close(b.max, [5, 10, 5])).toBe(true)
    expect(g.attributes.normal).toBeDefined()
    expect(g.index!.count).toBe(4 * 2 * 3) // 4변 × 삼각형 2 × 정점 3
  })
  it('같은 입력 객체는 같은 BufferGeometry를 돌려준다 (캐시)', () => {
    const def: Geometry = { type: 'lathe', profile: [[10, 0], [10, 10]] }
    expect(curvedGeometry(def as never)).toBe(curvedGeometry(def as never))
  })
  it('validateGeometry가 잘못된 곡면 입력을 잡는다', () => {
    expect(validateGeometry({ type: 'lathe', profile: [[0, 0]] })).not.toEqual([])
    expect(validateGeometry({ type: 'tube', path: [[0, 0, 0]], radius: 5 })).not.toEqual([])
    expect(validateGeometry({ type: 'extrude', shape: [[0, 0], [1, 0]], depth: 5 })).not.toEqual([])
    expect(validateGeometry({ type: 'loft', sections: [[[0, 0, 0], [1, 0, 0], [0, 0, 1]], [[0, 1, 0], [1, 1, 0]]] })).not.toEqual([])
    expect(validateGeometry({ type: 'loft', sections: [[[0, 0, 0], [1, 0, 0], [0, 0, 1]], [[0, 1, 0], [1, 1, 0], [0, 1, 1]]] })).toEqual([])
  })
})
```

- [ ] **Step 3: 실패 확인** — `npx vitest run src/engine/geometry/curved.test.ts` → `curved` 모듈 없음으로 FAIL.

- [ ] **Step 4: 구현** `src/engine/geometry/curved.ts`:

```ts
import * as THREE from 'three'
import { MM, type CurvedPrimitive } from '../types'

// 곡면 프리미티브 → BufferGeometry. 입력 객체를 키로 캐시하므로 부품 정의를 새 객체로 만들지 않는 한 한 번만 만든다.
// 단위 변환(mm → units)은 여기서 끝낸다.

const cache = new WeakMap<CurvedPrimitive, THREE.BufferGeometry>()

export function curvedGeometry(g: CurvedPrimitive): THREE.BufferGeometry {
  const hit = cache.get(g)
  if (hit) return hit
  const geo = build(g)
  cache.set(g, geo)
  return geo
}

function build(g: CurvedPrimitive): THREE.BufferGeometry {
  switch (g.type) {
    case 'lathe': {
      const pts = g.profile.map(([r, y]) => new THREE.Vector2(r * MM, y * MM))
      return new THREE.LatheGeometry(pts, g.segments ?? 32, 0, g.angle ?? Math.PI * 2)
    }
    case 'tube': {
      const curve = new THREE.CatmullRomCurve3(g.path.map(([x, y, z]) => new THREE.Vector3(x * MM, y * MM, z * MM)), g.closed ?? false, 'centripetal')
      return new THREE.TubeGeometry(curve, g.segments ?? Math.max(8, g.path.length * 8), g.radius * MM, g.radial ?? 12, g.closed ?? false)
    }
    case 'extrude': {
      const shape = new THREE.Shape(g.shape.map(([x, y]) => new THREE.Vector2(x * MM, y * MM)))
      for (const h of g.holes ?? []) shape.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x * MM, y * MM))))
      const depth = g.depth * MM
      const bevel = (g.bevel ?? 0) * MM
      const geo = new THREE.ExtrudeGeometry(shape, {
        depth: Math.max(0.001, depth - bevel * 2),
        bevelEnabled: bevel > 0,
        bevelThickness: bevel,
        bevelSize: bevel,
        bevelSegments: bevel > 0 ? 3 : 0,
        curveSegments: 12,
      })
      geo.translate(0, 0, -depth / 2 + (bevel > 0 ? bevel : 0))
      return geo
    }
    case 'loft':
      return loft(g.sections, g.closed ?? false, g.smooth ?? true)
  }
}

function loft(sections: [number, number, number][][], closed: boolean, smooth: boolean): THREE.BufferGeometry {
  const n = sections[0].length
  const m = sections.length
  const pos: number[] = []
  for (const s of sections) for (const [x, y, z] of s) pos.push(x * MM, y * MM, z * MM)
  const idx: number[] = []
  const cols = closed ? n : n - 1
  for (let i = 0; i < m - 1; i++) {
    for (let j = 0; j < cols; j++) {
      const a = i * n + j, b = i * n + ((j + 1) % n), c = (i + 1) * n + j, d = (i + 1) * n + ((j + 1) % n)
      idx.push(a, c, b, b, c, d)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setIndex(idx)
  if (smooth) geo.computeVertexNormals()
  else {
    const flat = geo.toNonIndexed()
    flat.computeVertexNormals()
    return flat
  }
  return geo
}
```

`PartGeometry.tsx`: `switch (geometry.type)` 안 `composite` 앞에 추가하고, 파일 상단에 `import { curvedGeometry } from './curved'`와 `isCurved` import:

```tsx
    case 'lathe':
    case 'tube':
    case 'extrude':
    case 'loft':
      return <mesh geometry={curvedGeometry(geometry)} material={material} castShadow={cast} receiveShadow={cast} />
```

(loft·lathe는 뒷면이 보일 수 있으므로 제품 재질에서 `side: THREE.DoubleSide`를 쓴다. 엔진의 재질 레지스트리는 `MaterialSpec`을 그대로 넘기므로 제품이 `side`를 지정하면 된다. `types.ts`의 `MaterialSpec`이 `side`를 막고 있으면 허용하도록 넓힌다.)

- [ ] **Step 5: 통과 확인** — `npx vitest run src/engine/geometry/curved.test.ts` PASS, `npx tsc --noEmit` 통과. `store.test.ts`의 `validateGeometry` 관련 기존 테스트도 통과해야 한다.

- [ ] **Step 6: 커밋**

```bash
git add src/engine/types.ts src/engine/geometry/curved.ts src/engine/geometry/curved.test.ts src/engine/geometry/PartGeometry.tsx
git commit -m "엔진 곡면 프리미티브 추가: lathe·tube·extrude·loft"
```

---

### Task 2: 스토어 — `skipCurrent`, `phaseOnMount`, `canSkip`

**Files:**
- Modify: `src/engine/types.ts` (`PartDef.phaseOnMount?: string`)
- Modify: `src/engine/store.ts`
- Modify: `src/engine/store.test.ts`

**Interfaces:**
- Consumes: 기존 `mount`, `mountAll`, `undo`, `advancePhase`.
- Produces: `skipCurrent(): void` (선택 부품의 남은 인스턴스를 20ms 간격 순차 장착; `from`은 `part.restPosition`), `canSkip(state): boolean` 순수 셀렉터(export), `PartDef.phaseOnMount`.

- [ ] **Step 1: 실패하는 테스트** — `src/engine/store.test.ts`에 추가(기존 테스트 파일의 제품 픽스처 헬퍼를 재사용한다; 픽스처가 없다면 아래처럼 최소 제품을 만든다):

```ts
import { canSkip } from './store'

function tinyProduct(withPhaseOnMount = false): ProductDef {
  // 부품 3개: a(preplaced) → b(count 2) → c(마지막, phaseOnMount)
  const mk = (id: string, count: number, requires: string[], extra: Partial<PartDef> = {}): PartDef => ({
    id, nameKo: id, nameEn: id, geometry: { type: 'box', size: [10, 10, 10] }, material: 'm',
    restPosition: [0, 0, 500], mountPosition: [0, 0, 0], mountRotation: [0, 0, 0], requires, count,
    instances: Array.from({ length: count }, (_, i) => ({ id: count === 1 ? id : `${id}_${i}`, mountPosition: [i * 20, 0, 0], mountRotation: [0, 0, 0], geometry: { type: 'box', size: [10, 10, 10] }, order: i / Math.max(1, count - 1) })),
    cameraView: { azimuth: 0, polar: 60, distance: 1000 }, hint: `${id} 장착`, ...extra,
  })
  return {
    ...baseProductFields, // 기존 픽스처의 나머지 필드(stations: [], props: [], materials, camera, drag, environment, Finale, hints, phasesAfterComplete: ['keyed', 'running'])
    parts: [mk('a', 1, [], { preplaced: true }), mk('b', 2, ['a']), mk('c', 1, ['b'], withPhaseOnMount ? { phaseOnMount: 'keyed' } : {})],
  }
}

describe('skipCurrent / phaseOnMount', () => {
  it('skipCurrent는 선택 부품의 남은 인스턴스를 전부 장착하고 대기 위치를 from으로 남긴다', async () => {
    vi.useFakeTimers()
    const store = createAssemblyStore(tinyProduct())
    expect(store.getState().selectedPartId).toBe('b')
    expect(canSkip(store.getState())).toBe(true)
    store.getState().skipCurrent()
    expect(canSkip(store.getState())).toBe(false) // sequencing 중
    await vi.runAllTimersAsync()
    expect(store.getState().mounted.b_0.from).toEqual([0, 0, 500])
    expect(store.getState().mounted.b_1).toBeDefined()
    expect(store.getState().selectedPartId).toBe('c')
    vi.useRealTimers()
  })
  it('마지막 부품에 phaseOnMount가 있으면 complete 대신 그 phase로 간다', () => {
    const store = createAssemblyStore(tinyProduct(true))
    store.getState().mount('b_0'); store.getState().mount('b_1')
    store.getState().mount('c')
    expect(store.getState().phase).toBe('keyed')
  })
  it('phaseOnMount로 간 phase에서는 되돌리기가 허용되고 assembly로 돌아온다', () => {
    const store = createAssemblyStore(tinyProduct(true))
    store.getState().mount('b_0'); store.getState().mount('b_1'); store.getState().mount('c')
    store.getState().undo()
    expect(store.getState().phase).toBe('assembly')
    expect(store.getState().mounted.c).toBeUndefined()
    expect(store.getState().selectedPartId).toBe('c')
  })
  it('phaseOnMount 뒤로 advancePhase하면 되돌리기가 막힌다', () => {
    const store = createAssemblyStore(tinyProduct(true))
    store.getState().mount('b_0'); store.getState().mount('b_1'); store.getState().mount('c')
    store.getState().advancePhase() // keyed → running
    expect(store.getState().phase).toBe('running')
    store.getState().undo()
    expect(store.getState().phase).toBe('running')
  })
  it('canSkip은 선택 부품이 없거나 sequencing 중이면 false', () => {
    const store = createAssemblyStore(tinyProduct())
    store.getState().selectPart(null)
    expect(canSkip(store.getState())).toBe(false)
  })
})
```

- [ ] **Step 2: 실패 확인** — `npx vitest run src/engine/store.test.ts` FAIL (`skipCurrent`/`canSkip` 없음).

- [ ] **Step 3: 구현**

`types.ts` `PartDef`에 `/** 이 부품이 다 장착되면 넘어갈 phase (마지막 부품에만 의미 있음) */ phaseOnMount?: string`.

`store.ts`:
- `AssemblyState`에 `skipCurrent: () => void` 추가.
- `mount`의 phase 계산을 바꾼다:
  ```ts
  phase: allDone ? (part.phaseOnMount ?? 'complete') : 'assembly',
  ```
- `mountAll` 내부 step의 종료 조건 `get().phase !== 'assembly'`는 유지(마지막 인스턴스가 phase를 바꾸면 자연히 끝난다). `mount(remaining[idx].id, from)`에 `from`을 넘길 수 있도록 `mountAll(partId, intervalMs = 20, from?: Vec3)` 시그니처로 확장.
- `skipCurrent`:
  ```ts
  skipCurrent: () => {
    const { selectedPartId, sequencing, phase } = get()
    if (!selectedPartId || sequencing || phase !== 'assembly') return
    const part = product.parts.find((p) => p.id === selectedPartId)
    if (!part || part.variants) return
    get().mountAll(part.id, 20, part.restPosition)
  },
  ```
  (변형 부품(도색)은 HUD 선택기로만 장착한다. 건너뛰기 버튼은 변형 부품에서 첫 변형을 고르는 대신 비활성화한다 — Task 3.)
- `undo` 허용 조건:
  ```ts
  const last = state.history[state.history.length - 1]
  const lastPart = last ? partOf(product, last) : null
  const allowed = state.phase === 'assembly' || state.phase === 'complete' || (lastPart?.phaseOnMount !== undefined && state.phase === lastPart.phaseOnMount)
  if (!allowed || !last) return
  ```
- `export const canSkip = (s: Pick<AssemblyState, 'selectedPartId' | 'sequencing' | 'phase' | 'product'>) => s.phase === 'assembly' && !s.sequencing && !!s.selectedPartId && !s.product.parts.find((p) => p.id === s.selectedPartId)?.variants`

- [ ] **Step 4: 통과 확인** — `npx vitest run src/engine/store.test.ts` PASS. 기존 `mountAll` 테스트가 있다면 시그니처 확장으로 깨지지 않는지 확인.

- [ ] **Step 5: 커밋**

```bash
git add src/engine/types.ts src/engine/store.ts src/engine/store.test.ts
git commit -m "스토어: 건너뛰기(skipCurrent), phaseOnMount 전이, canSkip"
```

---

### Task 3: HUD — 건너뛰기 버튼, Enter, `hudExtra`

**Files:**
- Modify: `src/engine/types.ts` (`ProductDef.hudExtra?: ComponentType`)
- Modify: `src/engine/ui/Hud.tsx`
- Modify: `src/styles.css` (`.hud-gauge` 자리)

**Interfaces:**
- Consumes: `skipCurrent`, `canSkip`, `advancePhase`, `phasesAfterComplete`.
- Produces: 버튼 "건너뛰기"; `Enter` 키; `product.hudExtra`가 있으면 우하단(`.hud-extra`)에 렌더.

- [ ] **Step 1: 구현** (`Hud.tsx`)

기존 `전부 장착` 버튼 블록을 다음으로 교체한다. `canSkip`을 `../store`에서 import.

```tsx
const phase = useAssembly((s) => s.phase)
const skipCurrent = useAssembly((s) => s.skipCurrent)
const advancePhase = useAssembly((s) => s.advancePhase)
const skippable = useAssembly((s) => canSkip(s))
const seq = product.phasesAfterComplete
const lastPhase = seq[seq.length - 1]
// assembly에서는 부품 건너뛰기, complete 및 그 뒤 단계(마지막 단계 제외)에서는 단계 건너뛰기
const phaseSkippable = phase !== 'assembly' && phase !== lastPhase
const onSkip = () => (phase === 'assembly' ? skipCurrent() : advancePhase())
const showSkip = phase === 'assembly' ? skippable : phaseSkippable
```

힌트 영역(`.hud-hint`) 안:

```tsx
{showSkip ? (
  <button className="btn" onClick={onSkip} title="Enter">건너뛰기</button>
) : null}
```

키 처리: 기존 `Ctrl+Z` 리스너와 같은 `useEffect`에 `Enter` → `onSkip()` (조건 `showSkip`), 입력 요소에 포커스가 있으면 무시(`(e.target as HTMLElement).tagName in {INPUT, TEXTAREA, SELECT}`).

`hudExtra`:

```tsx
{product.hudExtra ? <div className="hud hud-extra"><product.hudExtra /></div> : null}
```

`styles.css`:

```css
.hud-extra { right: 32px; bottom: 196px; display: flex; flex-direction: column; align-items: flex-end; gap: 8px; }
```

`types.ts` `ProductDef`에 `/** HUD 우하단에 제품이 그리는 DOM(계기 등) */ hudExtra?: ComponentType`.

- [ ] **Step 2: 검증** — `npx tsc --noEmit`, `npx vitest run` 통과. 브라우저(`/keyboard`): 트레이 어느 부품에서나 "건너뛰기"가 보이고 누르면 순차 장착, `Enter`도 같음, 키캡(변형 없음 다수 부품)도 건너뛰기됨, 도색 같은 변형 부품에서는 버튼이 없음.

- [ ] **Step 3: 커밋**

```bash
git add src/engine/types.ts src/engine/ui/Hud.tsx src/styles.css
git commit -m "HUD: 건너뛰기 버튼(Enter)로 전부 장착 대체, 제품 계기 슬롯"
```

---

### Task 4: 드래그 재설계 — 카메라 정면 평면 + 화면 공간 판정

**Files:**
- Modify: `src/engine/scene/dragMath.ts`, `src/engine/scene/dragMath.test.ts`
- Modify: `src/engine/scene/DraggablePart.tsx`
- Modify: `src/engine/types.ts` (`DragConfig`에서 `hoverMm` 제거)
- Modify: `src/products/keyboard/product.tsx`, `src/products/keyboard/product.test.ts`, `src/products/ninja400/product.tsx`, `src/products/ninja400/product.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface ScreenPt { x: number; y: number }               // px
  export interface GhostPx { id: string; px: ScreenPt; radiusPx: number }
  export function thresholdPx(mm: number, distUnits: number, viewportHeightPx: number, fovDeg: number): number
  export function resolveDragTargets(part: PartDef, partPx: ScreenPt, ghosts: GhostPx[], mounted: Mounted): DragTargets
  ```

- [ ] **Step 1: 테스트 교체** — `dragMath.test.ts` 전체를 화면 공간 버전으로:

```ts
import { describe, expect, it } from 'vitest'
import { resolveDragTargets, thresholdPx } from './dragMath'
import type { PartDef } from '../types'

const part = (count: number): PartDef => ({
  id: 'p', nameKo: 'p', nameEn: 'p', geometry: { type: 'box', size: [1, 1, 1] }, material: 'm', restPosition: [0, 0, 0],
  mountPosition: [0, 0, 0], mountRotation: [0, 0, 0], requires: [], count,
  instances: Array.from({ length: count }, (_, i) => ({ id: count === 1 ? 'p' : `p_${i}`, mountPosition: [0, 0, 0], mountRotation: [0, 0, 0], geometry: { type: 'box', size: [1, 1, 1] }, order: 0 })),
  cameraView: { azimuth: 0, polar: 60, distance: 1000 }, hint: 'p 장착',
})

describe('thresholdPx', () => {
  it('거리 100 units, 높이 1000px, fov 40에서 150mm는 약 20.6px', () => {
    // 15 units × (1000 / (2 × 100 × tan20°)) = 15 × 13.74 = 206 → 클램프 120
    expect(thresholdPx(150, 100, 1000, 40)).toBe(120)
    // 거리 1000 units → 20.6px
    expect(thresholdPx(150, 1000, 1000, 40)).toBeCloseTo(20.6, 0)
  })
  it('18px 아래로는 내려가지 않는다', () => {
    expect(thresholdPx(10, 5000, 600, 40)).toBe(18)
  })
})

describe('resolveDragTargets (screen space)', () => {
  it('단일 부품: 반경 안이면 snap, 밖이면 null', () => {
    const p = part(1)
    expect(resolveDragTargets(p, { x: 100, y: 100 }, [{ id: 'p', px: { x: 110, y: 105 }, radiusPx: 20 }], {}).snap).toBe('p')
    expect(resolveDragTargets(p, { x: 100, y: 100 }, [{ id: 'p', px: { x: 130, y: 100 }, radiusPx: 20 }], {}).snap).toBeNull()
  })
  it('단일 부품이 이미 장착돼 있으면 null', () => {
    const p = part(1)
    expect(resolveDragTargets(p, { x: 0, y: 0 }, [{ id: 'p', px: { x: 0, y: 0 }, radiusPx: 20 }], { p: { instanceId: 'p', at: 0 } }).snap).toBeNull()
  })
  it('다수 부품: 반경 안의 미장착 슬롯만 paint', () => {
    const p = part(3)
    const ghosts = [
      { id: 'p_0', px: { x: 0, y: 0 }, radiusPx: 10 },
      { id: 'p_1', px: { x: 5, y: 5 }, radiusPx: 10 },
      { id: 'p_2', px: { x: 50, y: 0 }, radiusPx: 10 },
    ]
    expect(resolveDragTargets(p, { x: 0, y: 0 }, ghosts, { p_0: { instanceId: 'p_0', at: 0 } }).paint).toEqual(['p_1'])
  })
})
```

- [ ] **Step 2: 실패 확인** — `npx vitest run src/engine/scene/dragMath.test.ts` FAIL.

- [ ] **Step 3: dragMath 구현**

```ts
import type { Mounted } from '../store'
import { MM, type PartDef } from '../types'

export interface ScreenPt { x: number; y: number }
export interface GhostPx { id: string; px: ScreenPt; radiusPx: number }
export interface DragTargets { snap: string | null; paint: string[] }

export const THRESHOLD_MIN_PX = 18
export const THRESHOLD_MAX_PX = 120

/** mm 반경을 고스트의 카메라 거리(units)에서 화면 픽셀로 환산한다 */
export function thresholdPx(mm: number, distUnits: number, viewportHeightPx: number, fovDeg: number): number {
  const pxPerUnit = viewportHeightPx / (2 * distUnits * Math.tan((fovDeg * Math.PI) / 360))
  const px = mm * MM * pxPerUnit
  return Math.min(THRESHOLD_MAX_PX, Math.max(THRESHOLD_MIN_PX, px))
}

/** 부품 화면 좌표와 고스트 화면 좌표로 판정한다. 겹쳐 보이면 장착. */
export function resolveDragTargets(part: PartDef, partPx: ScreenPt, ghosts: GhostPx[], mounted: Mounted): DragTargets {
  const within = (g: GhostPx) => Math.hypot(partPx.x - g.px.x, partPx.y - g.px.y) <= g.radiusPx
  if (part.count === 1) {
    const g = ghosts.find((x) => x.id === part.instances[0].id)
    if (!g || mounted[g.id]) return { snap: null, paint: [] }
    return { snap: within(g) ? g.id : null, paint: [] }
  }
  return { snap: null, paint: ghosts.filter((g) => !mounted[g.id] && within(g)).map((g) => g.id) }
}
```

- [ ] **Step 4: DraggablePart 재작성** — 상태와 핸들러를 아래로 바꾼다(파일 전체 구조는 유지: `DraggablePart` 셀렉터 컴포넌트 + `Draggable`).

```ts
interface DragState {
  /** 잡은 지점을 지나는, 카메라를 향한 평면 */
  plane: THREE.Plane
  /** 커서 교점 → 부품 원점 오프셋 (units) */
  offset: THREE.Vector3
  /** 커서가 가리키는 부품 위치 (units). 판정·렌더·장착 출발점 모두 이 값 */
  target: THREE.Vector3
}
```

`onPointerDown`:

```ts
const normal = camera.getWorldDirection(new THREE.Vector3()).negate() // 카메라를 향하는 법선
const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, e.point)
const offset = g.position.clone().sub(e.point)
drag.current = { plane, offset, target: g.position.clone() }
```

`move` 핸들러:

```ts
if (raycaster.ray.intersectPlane(d.plane, tmp)) {
  d.target.copy(tmp).add(d.offset)
  resolveTargets(...)   // 아래
}
```

판정(매 이동, `resolveTargets` 교체):

```ts
function projectPx(v: THREE.Vector3, camera: THREE.Camera, rect: DOMRect, out: THREE.Vector3): ScreenPt {
  out.copy(v).project(camera)
  return { x: ((out.x + 1) / 2) * rect.width, y: ((1 - out.y) / 2) * rect.height }
}

// Draggable 안, useEffect의 move에서:
const rect = gl.domElement.getBoundingClientRect()
const fov = (camera as THREE.PerspectiveCamera).fov ?? 40
const radiusMm = part.count === 1 ? cfg.snapMm : cfg.paintMm
const ghosts: GhostPx[] = part.instances
  .filter((inst) => !store.getState().mounted[inst.id])
  .map((inst) => {
    anchor.set((inst.mountPosition[0] + ox) * MM, (inst.mountPosition[1] + oy) * MM, (inst.mountPosition[2] + oz) * MM)
    const dist = camera.position.distanceTo(anchor)
    return { id: inst.id, px: projectPx(anchor, camera, rect, proj), radiusPx: thresholdPx(radiusMm, dist, rect.height, fov) }
  })
const partPx = projectPx(d.target, camera, rect, proj)
const { snap, paint } = resolveDragTargets(part, partPx, ghosts, store.getState().mounted)
const s = store.getState()
if (part.count === 1) s.setDragTarget(snap)
else for (const id of paint) s.mount(id, [d.target.x / MM - ox, d.target.y / MM - oy, d.target.z / MM - oz])
```

(`anchor`, `proj`는 `useRef(new THREE.Vector3()).current`로 재사용. `ox/oy/oz`·`rest`·`seated` memo는 기존 그대로.)

`endDrag`의 `here`도 `d.target` 기준(기존과 같은 식). `useFrame`: `g.position.lerp(d.target, 0.5)`. 들어 올림(`lift`)·`hoverY`·`baseY` 코드는 제거.

잡기 영역: 렌더 그룹 ref(`visual`)와 잡기 메시 ref(`grabMesh`)를 두고 `useLayoutEffect`에서 한 번 계산:

```ts
useLayoutEffect(() => {
  const v = visual.current, m = grabMesh.current
  if (!v || !m) return
  const box = new THREE.Box3().setFromObject(v) // 그룹은 회전 없이 rest에 놓여 있다
  const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3())
  const minSide = cfg.grabMinMm * MM
  m.position.copy(center).sub(v.getWorldPosition(new THREE.Vector3()))
  m.scale.set(Math.max(size.x, minSide), Math.max(size.y, minSide), Math.max(size.z, minSide))
}, [part, cfg.grabMinMm])
```

JSX:

```tsx
<group ref={group} position={rest} onPointerDown={onPointerDown} onPointerOver={…} onPointerOut={…}>
  <group ref={visual}>
    <PartGeometry geometry={part.geometry} material={materials.get(part.material)} materials={materials} />
  </group>
  <mesh ref={grabMesh}>
    <boxGeometry args={[1, 1, 1]} />
    <meshBasicMaterial transparent opacity={0} depthWrite={false} />
  </mesh>
</group>
```

`DragConfig`에서 `hoverMm` 삭제; 키보드 `drag: { snapMm: 60, paintMm: 12, grabMinMm: 50 }`, 닌자 `drag: { snapMm: 150, paintMm: 25, grabMinMm: 200 }`; 두 `product.test.ts`의 기대값 갱신.

- [ ] **Step 5: 검증** — `npx tsc --noEmit`, `npx vitest run`, `npm run build`. 브라우저(검증 서버 `/ninja400`, `/keyboard`): 카메라를 낮게(앙각 10°)·높게(70°) 돌려 놓고도 잡은 부품이 커서 아래에 붙어 다니고, 고스트 위에 겹쳐 놓으면 장착된다. 키캡을 누른 채 지나가면 연속 장착된다. 합성 포인터로도 확인: 프로젝트 메모리의 "브라우저 검증 요령"대로 `scene.updateMatrixWorld(true)` 후 R3F 연결 DIV에 pointerdown(줌 배율 반영), window에 pointermove/up.

- [ ] **Step 6: 커밋**

```bash
git add src/engine/scene/dragMath.ts src/engine/scene/dragMath.test.ts src/engine/scene/DraggablePart.tsx src/engine/types.ts src/products/keyboard/product.tsx src/products/keyboard/product.test.ts src/products/ninja400/product.tsx src/products/ninja400/product.test.ts
git commit -m "드래그: 카메라 정면 평면 이동, 화면 공간 판정, Box3 잡기 영역"
```

---

### Task 5: 닌자 400 — 키를 정규 부품으로, Finale 정리

**Files:**
- Modify: `src/products/ninja400/parts.ts`, `parts.test.ts`, `geometry.ts` (키 형상)
- Delete: `src/products/ninja400/finale/Key.tsx`
- Modify: `src/products/ninja400/finale/Finale.tsx`, `Starter.tsx`, `product.tsx`, `product.test.ts`

**Interfaces:**
- Consumes: `phaseOnMount`(Task 2), 건너뛰기(Task 3).
- Produces: 부품 `ignition_key`(81번째, `requires: ['paint']`, `phaseOnMount: 'keyed'`), `Finale`은 `keyed`/`running`만 처리, 시동은 phase 효과.

- [ ] **Step 1: 테스트 갱신** — `parts.test.ts`:
  - 총 부품 수 80 → 81, 마지막 부품 id `ignition_key`, `phaseOnMount === 'keyed'`, `requires`에 `paint`, `hidden`이 아니고 `variants` 없음.
  - "paint is the last, hidden, variant part" 테스트를 "paint는 hidden variant 부품이고 그 바로 뒤가 ignition_key" 로 바꾼다.
  - `product.test.ts`: `hints`에 `complete` 키가 없어도 되고 `keyed: '시동'`, `running: '스로틀 개방'`.

- [ ] **Step 2: 실패 확인** — `npx vitest run src/products/ninja400`.

- [ ] **Step 3: 구현**
  - `geometry.ts`에 `keyGeometry()`: 손잡이 `extrude`(둥근 사각 윤곽 40×28, depth 6, bevel 2) + 날 `box [4, 32, 8]`을 composite로, 원점은 날 끝(꽂히는 쪽). 날이 −y 방향으로 뻗도록 손잡이 position `[0, 32, 0]`.
  - `parts.ts` 맨 끝(paint 뒤)에:
    ```ts
    add({ id: 'ignition_key', ko: '키', en: 'Ignition Key', geometry: keyGeometry(), mount: [540, 980, 60], rot: [0, 0, 0], material: 'steel',
      requires: ['paint'], small: true, hint: '키 삽입', phaseOnMount: 'keyed',
      camera: { azimuth: 20, polar: 55, distance: 900, target: [520, 950, 40] } })
    ```
    `add()`가 `phaseOnMount`를 `PartDef`로 넘기도록 확장한다. 기존 `Key.tsx`의 `CYLINDER` 좌표 `[540, 980, 60]`을 장착 위치로 쓴다(키 실린더 소품은 계기판 부품에 이미 있거나, 없으면 `instrument_cluster` composite에 반지름 12·높이 20 원통을 추가한다).
  - `Finale.tsx`: `phase === 'keyed'`이면 `<Starter/>`, `running`이면 `<Throttle/>`; `complete` 분기와 `Key` import 삭제. `Key.tsx` 삭제.
  - `Starter.tsx`: 클릭 → `advancePhase()`만. 엔진 시동(`engineSound.start()`, 진동 시작)은 `Finale`의 `useEffect([phase])`에서 `running` 진입 시 수행하고 `running` 이탈 시 `stop()`. 이렇게 해야 건너뛰기(HUD → `advancePhase`)로도 시동이 걸린다.
  - `product.tsx` `hints`: `{ keyed: '시동', running: '스로틀 개방' }`.

- [ ] **Step 4: 검증** — 테스트·tsc·build. 브라우저: 도색 뒤 트레이 마지막에 "키"가 있고, 계기판 클로즈업으로 카메라가 가며, 고스트에 겹치면 꽂히고 phase가 keyed(램프 점등)로 간다. 건너뛰기로도 같다. keyed에서 건너뛰기 → running(엔진음). 되돌리기로 키를 빼면 램프가 꺼진다.

- [ ] **Step 5: 커밋**

```bash
git add src/products/ninja400/parts.ts src/products/ninja400/parts.test.ts src/products/ninja400/geometry.ts src/products/ninja400/finale/Finale.tsx src/products/ninja400/finale/Starter.tsx src/products/ninja400/product.tsx src/products/ninja400/product.test.ts
git rm -q src/products/ninja400/finale/Key.tsx
git commit -m "닌자 400: 키를 정규 부품으로, 시동은 phase 효과로"
```

---

### Task 6: 주행 조작 — rideState · rideModel · 키 입력 · 계기 · 연출

**Files:**
- Create: `src/products/ninja400/finale/rideState.ts` (기존 `throttleState.ts` 삭제·대체, import 갱신)
- Create: `src/products/ninja400/finale/rideModel.ts`, `rideModel.test.ts`
- Create: `src/products/ninja400/finale/RideControls.tsx`, `RideGauge.tsx`
- Modify: `Finale.tsx`, `Throttle.tsx`, `Starter.tsx`, `render/EngineShake.tsx`, `render/Lamps.tsx`, `product.tsx`, `styles.css`

**Interfaces:**
- Produces:
  ```ts
  // rideState.ts
  export interface RideInput { throttleKey: boolean; brakeKey: boolean; clutchKey: boolean }
  export const ride = { throttle: 0, rpm: 0, gear: 0, clutch: 0, brake: 0, stalled: false, wheelRpm: 0, running: false, shiftKick: 0 }
  export const rideInput: RideInput = { throttleKey: false, brakeKey: false, clutchKey: false }
  export function resetRide(): void
  // rideModel.ts (순수)
  export const GEAR_RATIOS = [0, 2.929, 1.947, 1.545, 1.333, 1.185, 1.095]
  export const PRIMARY = 3.087, FINAL = 3.071, IDLE_RPM = 1300, MAX_RPM = 10000
  export function shiftUp(gear: number): number      // 1→0(N)→2→…→6
  export function shiftDown(gear: number): number    // 6→…→2→0(N)→1
  export function stepRide(s: RideSim, input: RideInputs, dt: number): RideSim
  export interface RideSim { rpm: number; throttle: number; clutch: number; brake: number; gear: number; wheelRpm: number; stalled: boolean; running: boolean; lowRpmFor: number }
  export interface RideInputs { throttleKey: boolean; brakeKey: boolean; clutchKey: boolean; throttleMouse: number }
  ```

- [ ] **Step 1: 실패하는 테스트** `rideModel.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { GEAR_RATIOS, IDLE_RPM, shiftDown, shiftUp, stepRide, type RideSim } from './rideModel'

const base = (o: Partial<RideSim> = {}): RideSim => ({ rpm: IDLE_RPM, throttle: 0, clutch: 0, brake: 0, gear: 0, wheelRpm: 0, stalled: false, running: true, lowRpmFor: 0, ...o })
const run = (s: RideSim, input: Parameters<typeof stepRide>[1], seconds: number) => { for (let t = 0; t < seconds; t += 1 / 60) s = stepRide(s, input, 1 / 60); return s }
const idle = { throttleKey: false, brakeKey: false, clutchKey: false, throttleMouse: 0 }

describe('shift pattern 1-N-2-3-4-5-6', () => {
  it('N에서 다운은 1단, 1단에서 업은 N, N에서 업은 2단', () => {
    expect(shiftDown(0)).toBe(1); expect(shiftUp(1)).toBe(0); expect(shiftUp(0)).toBe(2)
    expect(shiftUp(6)).toBe(6); expect(shiftDown(1)).toBe(1); expect(shiftDown(2)).toBe(0)
  })
})

describe('stepRide', () => {
  it('스로틀 키를 누르면 rpm이 올라가고 떼면 아이들로 돌아온다', () => {
    let s = run(base(), { ...idle, throttleKey: true }, 1)
    expect(s.rpm).toBeGreaterThan(8000)
    s = run(s, idle, 2)
    expect(s.rpm).toBeCloseTo(IDLE_RPM, -1)
  })
  it('N에서는 뒷바퀴가 돌지 않고, 2단에 클러치를 풀면 기어비대로 돈다', () => {
    const n = run(base(), { ...idle, throttleKey: true }, 1)
    expect(n.wheelRpm).toBe(0)
    let s = run(base({ gear: 2, clutch: 1 }), { ...idle, throttleKey: true, clutchKey: true }, 1)
    s = run(s, { ...idle, throttleKey: true }, 1) // 클러치 풀림
    const ratio = 3.087 * GEAR_RATIOS[2] * 3.071
    expect(s.wheelRpm).toBeCloseTo(s.rpm / ratio, -1)
  })
  it('브레이크를 잡으면 뒷바퀴가 멈춘다', () => {
    let s = run(base({ gear: 2 }), { ...idle, throttleKey: true }, 1)
    s = run(s, { ...idle, throttleKey: true, brakeKey: true }, 1)
    expect(s.wheelRpm).toBeLessThan(5)
  })
  it('기어가 들어간 채 클러치를 풀고 스로틀이 없으면 0.4초 뒤 시동이 꺼진다', () => {
    let s = base({ gear: 1, clutch: 1 })
    s = run(s, idle, 1)
    expect(s.stalled).toBe(true)
    expect(s.rpm).toBe(0)
  })
  it('클러치를 잡고 있으면 기어가 들어가도 꺼지지 않는다', () => {
    const s = run(base({ gear: 1, clutch: 1 }), { ...idle, clutchKey: true }, 2)
    expect(s.stalled).toBe(false)
  })
  it('running이 아니면 rpm은 0으로 내려간다', () => {
    const s = run(base({ running: false }), idle, 1)
    expect(s.rpm).toBe(0)
  })
})
```

- [ ] **Step 2: 실패 확인** — `npx vitest run src/products/ninja400/finale/rideModel.test.ts`.

- [ ] **Step 3: 구현** `rideModel.ts`:

```ts
export const GEAR_RATIOS = [0, 2.929, 1.947, 1.545, 1.333, 1.185, 1.095]
export const PRIMARY = 3.087
export const FINAL = 3.071
export const IDLE_RPM = 1300
export const MAX_RPM = 10000
const STALL_RPM = 1100
const STALL_AFTER_S = 0.4

export interface RideSim { rpm: number; throttle: number; clutch: number; brake: number; gear: number; wheelRpm: number; stalled: boolean; running: boolean; lowRpmFor: number }
export interface RideInputs { throttleKey: boolean; brakeKey: boolean; clutchKey: boolean; throttleMouse: number }

export const shiftUp = (g: number) => (g === 1 ? 0 : g === 0 ? 2 : Math.min(6, g + 1))
export const shiftDown = (g: number) => (g === 0 ? 1 : g === 2 ? 0 : g === 1 ? 1 : g - 1)

/** 1차 시정수 응답 */
const approach = (v: number, target: number, tau: number, dt: number) => v + (target - v) * (1 - Math.exp(-dt / tau))

export function stepRide(s: RideSim, input: RideInputs, dt: number): RideSim {
  const throttleTarget = Math.max(input.throttleKey ? 1 : 0, input.throttleMouse)
  const throttle = approach(s.throttle, throttleTarget, throttleTarget > s.throttle ? 0.35 : 0.25, dt)
  const clutch = approach(s.clutch, input.clutchKey ? 1 : 0, 0.12, dt)
  const brake = approach(s.brake, input.brakeKey ? 1 : 0, 0.1, dt)
  const inGear = s.gear !== 0
  const clutchOpen = 1 - clutch // 0 잡음 ~ 1 풀림
  const engaged = inGear ? clutchOpen : 0
  const load = engaged * 0.6

  let rpm = s.rpm
  let stalled = s.stalled
  let lowRpmFor = s.lowRpmFor
  if (!s.running || stalled) {
    rpm = approach(rpm, 0, 0.4, dt)
    if (rpm < 30) rpm = 0
  } else {
    const target = IDLE_RPM + throttle * (MAX_RPM - IDLE_RPM) - engaged * (1 - throttle) * 600
    const tau = target > rpm ? 0.25 + 0.35 * load : 0.5
    rpm = approach(rpm, target, tau, dt)
    lowRpmFor = inGear && clutchOpen > 0.7 && rpm < STALL_RPM ? lowRpmFor + dt : 0
    if (lowRpmFor >= STALL_AFTER_S) { stalled = true; lowRpmFor = 0 }
  }
  const ratio = inGear ? PRIMARY * GEAR_RATIOS[s.gear] * FINAL : Infinity
  const wheelTarget = inGear && !stalled ? (rpm / ratio) * engaged : 0
  let wheelRpm = approach(s.wheelRpm, wheelTarget, 0.3, dt)
  if (brake > 0.5) wheelRpm = approach(wheelRpm, 0, 0.2, dt)
  if (wheelRpm < 0.5 && wheelTarget === 0) wheelRpm = 0
  return { ...s, rpm: stalled ? 0 : rpm, throttle, clutch, brake, wheelRpm, stalled, lowRpmFor }
}
```

(테스트 "브레이크를 잡으면 뒷바퀴가 멈춘다"는 기어 2·클러치 풀림·스로틀 1이라 wheelTarget > 0이지만 브레이크 approach가 이긴다. 통과하지 않으면 브레이크 시 `wheelTarget *= 1 - brake`로 보강한다.)

`rideState.ts`: 스펙 §7의 `ride` 싱글턴에 `running: false`, `shiftKick: 0`(시프트 연출 타이머), `rideInput` 키 상태, `resetRide()`. `throttleState.ts`는 삭제하고 `Throttle.tsx`/`engineSound` 호출부는 `ride.throttleMouse`(새 필드 `throttleMouse: 0`)를 쓴다.

`RideControls.tsx`(R3F 안, 렌더 없음): `running` phase일 때 `window` keydown/keyup을 구독. `ArrowUp/Down`, `ShiftLeft/Right`, `ArrowLeft/Right`(keydown 1회: `ride.clutch > 0.6`이면 `ride.gear = shiftUp/Down`, `ride.shiftKick = 1`, `engineSound.blip()`; 아니면 `ride.shiftKick = -1`(걸림 연출) ). 입력 요소 포커스면 무시, `preventDefault`로 스크롤 막기. `useFrame((_, dt))`에서 `stepRide`를 돌려 `ride`에 반영하고 `engineSound.setRpm(ride.rpm)`, `setThrottle(ride.throttle)`, `setLoad(load)`를 호출한다(Task 7 전에는 `setThrottle`만 있고 rpm은 사운드가 자체 계산하므로, Task 6에서는 `setThrottle(ride.throttle)`만 호출하고 `setRpm/setLoad`는 Task 7에서 연결).

시동 꺼짐: `ride.stalled`가 true가 되면 `Finale`이 `engineSound.stop()`·진동 정지, 힌트를 위해 `store.advancePhase`는 쓰지 않고 `Starter`를 다시 보여 준다(`running`인 채 `stalled` 표시). `Starter` 클릭: 기어가 들어가 있고 `ride.clutch < 0.6`이면 거부(짧은 흔들림, 힌트 "클러치 잡고 시동"); 아니면 `ride.stalled = false; ride.running = true; engineSound.start()`.

`RideGauge.tsx`(DOM, `product.hudExtra`): 100ms 간격 `setInterval`로 `ride`를 읽어 상태에 복사. 표시: 기어(`N`/숫자, 48px), rpm 바(가로 220px, 0~12000, 10500 이상은 `--fg` 반전 구간), 표시등 텍스트 `CLUTCH`·`BRAKE`(활성 시 `--fg`, 아니면 `--fg-dim`), `stalled`면 "시동 꺼짐". `styles.css`에 `.gauge`, `.gauge-gear`, `.gauge-bar`, `.gauge-bar > i`, `.gauge-lamps` 추가(테두리 1px `--line`, 배경 없음, 그라데이션 금지). `running` phase가 아니면 렌더하지 않는다.

3D 연출: `Throttle.tsx`의 그립 회전은 `ride.throttle`로; 클러치 레버(`brake_clutch_lever_l`)·브레이크 레버(`_r`) 인스턴스는 `renderInstance`에서 `LeverPivot` 컴포넌트로 감싸 `ride.clutch × 15°`, `ride.brake × 12°` 회전(피벗은 레버 뿌리). 브레이크등: `Lamps.tsx`에서 `tail_light`가 `running && ride.brake > 0.3`이면 emissiveIntensity ×3. 뒷바퀴·리어 스프로킷·체인 링: `renderInstance`에서 `rear_wheel`·`rear_sprocket`을 `Spinner`(`ride.wheelRpm` → 회전 z축, rad/s = rpm·2π/60)로 감싼다. 시프트 레버(`shift_lever`): `ride.shiftKick`이 0이 아니면 0.15초 동안 ±10° 회전 후 0으로.

`EngineShake.tsx`: 진폭을 `ride.rpm`(0이면 정지)에 비례.

- [ ] **Step 4: 검증** — 테스트·tsc·build. 브라우저(`/ninja400` 건너뛰기로 running까지): `↑`로 rpm 바 상승과 엔진음 상승, `Shift`+`←`로 1단(계기 `1`), `Shift` 떼고 `↑` 없이 두면 0.4초 뒤 시동 꺼짐 표시와 음 정지, 시동 버튼은 `Shift` 없이 거부·`Shift` 잡고 성공, 1단에서 `↑`면 뒷바퀴 회전, `↓`로 정지와 브레이크등 밝아짐. 키 이벤트는 `window.dispatchEvent(new KeyboardEvent('keydown', {code:'ArrowUp'}))`로도 확인 가능.

- [ ] **Step 5: 커밋**

```bash
git add src/products/ninja400/finale src/products/ninja400/render src/products/ninja400/product.tsx src/styles.css
git rm -q src/products/ninja400/finale/throttleState.ts
git commit -m "닌자 400 주행 조작: 방향키 스로틀·브레이크·클러치·기어, 시동 꺼짐, 계기"
```

---

### Task 7: 엔진음 v2

**Files:**
- Modify: `src/products/ninja400/audio/engineSound.ts`, `engineSound.test.ts`
- Modify: `src/products/ninja400/finale/RideControls.tsx` (`setRpm`, `setLoad` 연결)

**Interfaces:**
- Produces: `start()`, `stop()`, `setRpm(rpm)`, `setThrottle(t)`, `setLoad(l)`, `blip()`; 순수 함수 `resonanceFor(throttle): { freqs: [number, number, number]; q: number; lowpassHz: number }`, `pulseFor(rpm, load): { decayS: number; gain: number }`, 기존 `firingTimes(rpm, from, to)` 유지. `rpmFor`는 삭제(rpm은 외부에서 온다).

- [ ] **Step 1: 테스트 추가** (`engineSound.test.ts`; 기존 `firingTimes` 테스트 유지, `rpmFor` 테스트 삭제):

```ts
import { pulseFor, resonanceFor } from './engineSound'

describe('engine sound v2 parameters', () => {
  it('공명 주파수는 95/190/285Hz에서 스로틀 1일 때 15% 오르고 저역통과는 1.2k→2.6k', () => {
    expect(resonanceFor(0).freqs.map(Math.round)).toEqual([95, 190, 285])
    expect(resonanceFor(1).freqs.map(Math.round)).toEqual([109, 219, 328])
    expect(resonanceFor(0).lowpassHz).toBe(1200)
    expect(resonanceFor(1).lowpassHz).toBe(2600)
  })
  it('펄스 감쇠는 rpm이 오를수록 짧아지고(20ms→8ms) 부하가 걸리면 세진다', () => {
    expect(pulseFor(1300, 0).decayS).toBeCloseTo(0.02, 3)
    expect(pulseFor(10000, 0).decayS).toBeCloseTo(0.008, 3)
    expect(pulseFor(3000, 1).gain).toBeCloseTo(pulseFor(3000, 0).gain * 1.3, 5)
  })
})
```

- [ ] **Step 2: 실패 확인**, **Step 3: 구현** — 스펙 §8 신호 경로 그대로:

```ts
export function resonanceFor(throttle: number) {
  const k = 1 + 0.15 * clamp01(throttle)
  return { freqs: [95 * k, 190 * k, 285 * k] as [number, number, number], q: 6 + 4 * clamp01(throttle), lowpassHz: 1200 + 1400 * clamp01(throttle) }
}
export function pulseFor(rpm: number, load: number) {
  const t = clamp01((rpm - IDLE_RPM) / (MAX_RPM - IDLE_RPM))
  return { decayS: 0.02 - 0.012 * t, gain: PULSE_GAIN * (1 + 0.3 * clamp01(load)) }
}
```

그래프(컨텍스트 생성 시 한 번): `master → compressor → destination`(기존), 새로 `exhaustIn(Gain) → [bandpass×3 → 각 Gain 0.5] → mufflerLPF → master`, `intakeNoise(BufferSource loop) → intakeBPF → intakeGain(0) → master`, `whine(Oscillator sawtooth) → whineHPF(1500) → whineGain(0.02) → master`. 점화는 `scheduleFiring(at, …)`에서 `pulseFor`로 만든 게인 엔벨로프(사각 0.6ms + 지수 감쇠)를 짧은 노이즈+사인 소스에 걸어 `exhaustIn`으로 보낸다. 지터: `at + (Math.random() - 0.5) * 0.03 * P`, 세기 ±10%. `tick()`은 매 호출마다 `resonanceFor(throttle)`로 필터 파라미터를 `setTargetAtTime(…, 0.05)`으로 갱신하고, `intakeGain = throttle² × 0.25`, `intakeBPF.frequency = 400 + 500 × rpm/MAX`, `whine.frequency = rpm × 6 / 60`. `setRpm`이 준 값으로 `firingTimes(rpm, …)`를 예약한다(아이들 흔들림 ±4%는 `rpm × (1 + 0.04 × sin(now × 7))`을 아이들 근처에서만). `setLoad(l)`은 `pulseFor`에 들어간다. `blip()`은 흡기 게인을 0.35로 40ms 올렸다 내린다. `stop()`·visibilitychange·suspend 로직은 기존 유지.

`RideControls.tsx`의 `useFrame`에서 `engineSound.setRpm(ride.rpm); engineSound.setThrottle(ride.throttle); engineSound.setLoad(load)` 호출.

- [ ] **Step 4: 검증** — 테스트·tsc·build; 브라우저에서 아이들이 "두둥 두둥" 불균등 박자로 들리고 스로틀을 열면 음이 밝아지며 흡기 노이즈가 섞이는지, 1단 클러치 풀림에서 묵직해지는지 귀로 확인(사용자 확인 대상으로 보고).

- [ ] **Step 5: 커밋** — `git add src/products/ninja400/audio src/products/ninja400/finale/RideControls.tsx && git commit -m "엔진음 v2: 배기 공명·흡기 노이즈·기계음·부하"`

---

### Task 8: 재모델링 1 — 프레임·스윙암·휠·디스크·스프로킷·포크

**Files:**
- Modify: `src/products/ninja400/geometry.ts`, `parts.ts`, `parts.test.ts`, `materials.ts`(`side: DoubleSide` 필요 재질)

**Interfaces:**
- Produces(`geometry.ts`): `frameTrellis(): Geometry`, `subframeRails(): Geometry`, `swingarmGeometry(): Geometry`, `rimGeometry(rimR, width): Geometry`, `spokedWheel(tireR, tireW, rimR): Geometry`(기존 `wheel` 대체), `toothedDisc(r, teeth, thickness, holeR, toothDepth): Geometry`(`sprocket` 대체), `brakeDisc(r, thickness): Geometry`(`disc` 대체), `forkCap(): Geometry`.

- [ ] **Step 1: 테스트 추가** (`parts.test.ts`):

```ts
it('주요 부품의 형상이 곡면 프리미티브를 쓴다', () => {
  const uses = (id: string, type: string) => JSON.stringify(PART_BY_ID[id].geometry).includes(`"type":"${type}"`)
  expect(uses('main_frame', 'tube')).toBe(true)
  expect(uses('subframe', 'tube')).toBe(true)
  expect(uses('front_wheel', 'lathe')).toBe(true)
  expect(uses('front_wheel', 'extrude')).toBe(true)
  expect(uses('rear_sprocket', 'extrude')).toBe(true)
  expect(uses('front_disc', 'extrude')).toBe(true)
})
it('전체 장착 bbox가 실물 외곽(1990×710×1120, ±10%) 안이다', () => {
  // 각 인스턴스의 geometry bbox(월드)를 근사: curved는 curvedGeometry로, 프리미티브는 크기 규칙으로. 유틸 `instanceBounds(inst)`를 test-utils에 둔다.
  const b = assemblyBounds(PARTS)   // { min, max } mm
  expect(b.max[0] - b.min[0]).toBeGreaterThan(1990 * 0.9); expect(b.max[0] - b.min[0]).toBeLessThan(1990 * 1.1)
  expect(b.max[2] - b.min[2]).toBeLessThan(760)          // 미러 제외 전폭. 미러는 계산에서 뺀다
  expect(b.max[1]).toBeLessThan(1120 * 1.1); expect(b.min[1]).toBeGreaterThan(-5)
})
```

`assemblyBounds`는 `src/products/ninja400/test-utils.ts`에 만든다: 인스턴스마다 `THREE.Object3D`에 `PartGeometry`와 같은 규칙으로 bbox를 쌓는다(box/roundedBox: 밑면 기준 size; cylinder: 반지름·높이; sphere; torus; frustum; lathe/tube/extrude/loft: `curvedGeometry(g).boundingBox`; composite: 자식 변환 적용). `mirror_*` id는 제외.

- [ ] **Step 2: 실패 확인**.

- [ ] **Step 3: 구현** — 아래 초기 좌표로 만들고 브라우저로 다듬는다(모두 mm, 차체 좌표: +x 앞, +y 위, z 좌우, 헤드 [420,880,0], 스윙암 피벗 [−420,400,0]).

```ts
// 트렐리스 메인 프레임: 헤드튜브 lathe + 좌우 메인 스파 tube + 다운튜브 + 브릿지
export function frameTrellis(): Geometry {
  const R = 16
  const side = (s: 1 | -1): CompositeChild[] => [
    { geometry: { type: 'tube', radius: R, path: [[400, 900, 0], [300, 860, 120 * s], [60, 760, 170 * s], [-200, 640, 150 * s], [-400, 480, 110 * s], [-420, 400, 100 * s]] } },
    { geometry: { type: 'tube', radius: R, path: [[380, 780, 0], [250, 640, 110 * s], [40, 470, 170 * s], [-120, 330, 150 * s], [-330, 300, 120 * s], [-420, 400, 100 * s]] } },
    { geometry: { type: 'tube', radius: 12, path: [[250, 640, 110 * s], [60, 760, 170 * s]] } },
    { geometry: { type: 'tube', radius: 12, path: [[40, 470, 170 * s], [-200, 640, 150 * s]] } },
  ]
  return { type: 'composite', children: [
    { geometry: { type: 'lathe', profile: [[38, 0], [38, 220], [30, 220], [30, 0]] }, position: [420, 780, 0], rotation: [0, 0, -RAKE_RAD] },
    ...side(1), ...side(-1),
    { geometry: { type: 'tube', radius: 12, path: [[-200, 640, 150], [-200, 640, -150]] } },
    { geometry: { type: 'tube', radius: 12, path: [[-330, 300, 120], [-330, 300, -120]] } },
  ] }
}
```

서브프레임: 시트 레일 2본 `[-420, 620, ±110] → [-700, 700, ±110] → [-900, 740, ±90]` 반지름 12 + 지지대 `[-420, 400, ±100] → [-700, 700, ±110]` + 가로대 끝. 스윙암: 좌우 암 `loft`(단면 4점 사각, 피벗 60×60 → 액슬 40×50) + 피벗 tube. 림: `lathe` 프로필 `[[RIM_R-6, -w/2], [RIM_R, -w/2+8], [RIM_R, w/2-8], [RIM_R-6, w/2], [RIM_R-30, w/2-6], [RIM_R-30, -w/2+6]]`를 z축으로 눕힘(composite rotation `[π/2,0,0]`). 스포크: 5개 `extrude`(허브 반지름 40에서 림 안쪽 RIM_R−30까지 폭 30→18의 사다리꼴, depth 24), 각 72°. 허브 `lathe`. 톱니 디스크: `toothedDisc(r, teeth, t, holeR, depth)`는 `extrude` shape에 `teeth × 2`점의 톱니 다각형, holes에 볼트 구멍 5개(반지름 6, 원주 r×0.35) + 중심 구멍. 브레이크 디스크는 `extrude`(외경 r, 내경 r−45 hole, 슬롯 대신 구멍 8개).

`parts.ts`: `main_frame`, `subframe`, `swingarm`, `front_wheel`/`rear_wheel`, `front_disc`(2)/`rear_disc`, `drive_sprocket`/`rear_sprocket`(`toothedDisc`), `fork` 상단 캡 추가. 장착 좌표는 기존 유지.

- [ ] **Step 4: 검증** — 테스트·tsc·build; 브라우저 `/ninja400`에서 프레임만·롤링 섀시(건너뛰기 반복)를 앞·옆·위에서 스크린샷: 트렐리스가 헤드에서 피벗까지 이어지고, 휠에 5-스포크와 림 파임이 보이고, 디스크·스프로킷에 구멍·이빨이 보인다. 프레임 튜브가 엔진 bbox(x −330..90, y 280..550, |z| ≤ 190)를 관통하지 않는지 테스트로도 확인(샘플링).

- [ ] **Step 5: 커밋** — `git add src/products/ninja400/geometry.ts src/products/ninja400/parts.ts src/products/ninja400/parts.test.ts src/products/ninja400/test-utils.ts src/products/ninja400/materials.ts && git commit -m "닌자 400 재모델링 1: 트렐리스 프레임·스윙암·스포크 휠·디스크·스프로킷"`

---

### Task 9: 재모델링 2 — 엔진 외관·배기·냉각

**Files:** `geometry.ts`, `parts.ts`, `parts.test.ts`

**Interfaces:** `crankcaseGeometry(part: 'lower' | 'upper')`, `cylinderBlockFinned()`, `cylinderHeadGeometry()`, `camCoverGeometry()`, `roundCover(r, depth)`(클러치·제너레이터), `pistonGeometry()`, `crankWebGeometry()`, `exhaustHeader(side)`, `exhaustCollector()`, `mufflerGeometry()`, `radiatorHose(path)`.

- [ ] **Step 1: 테스트** — `uses('crankcase_lower','extrude')`, `uses('cylinder_block','lathe')`, `uses('exhaust_header','tube')`, `uses('muffler','lathe')`; 기존 헤더 관통·집합부 근접 테스트를 tube 경로 샘플링 버전으로 갱신(경로 점을 직접 검사: 크랭크케이스 박스 밖, 마지막 점이 집합부 첫 점에서 40mm 이내).

- [ ] **Step 2: 구현** —
  - 크랭크케이스 하부/상부: 측면 윤곽 `extrude`(xy 다각형, 하부: `[[-210,0],[210,0],[220,60],[200,150],[-200,150],[-220,60]]`, depth 380, bevel 8; 상부: `[[-200,0],[200,0],[190,120],[-190,120]]` depth 380 bevel 8), 원점 밑면 중심(extrude는 z 중심이므로 y는 shape에서 0 기준).
  - 실린더 블록: 두 실린더 자리를 하나의 `lathe` 핀 스택으로(프로필: 반지름 76 몸통에 6단 핀 반지름 92·두께 6, 높이 120) × 2개 z ±42, 20° 전경(`TILT_ROT`), 위에 헤드 `extrude`(윤곽 `[[-110,0],[110,0],[120,80],[-120,80]]` depth 240 bevel 6), 캠 커버 `loft` 4단면(아래 넓고 위 좁음, 높이 60).
  - 클러치 커버(우) / 제너레이터 커버(좌): `lathe` 프로필 `[[0,0],[120,0],[125,25],[110,45],[60,60],[0,62]]`을 z축으로 눕혀(회전 `[±π/2,0,0]`) 크랭크케이스 옆면에.
  - 피스톤 `lathe` `[[0,0],[35,0],[35,40],[33,40],[33,46],[35,46],[35,60],[0,60]]`; 크랭크 웹 `extrude` 눈물 방울 8점.
  - 배기: `exhaustHeader(side)`는 한 `tube` 경로(반지름 19): `[tilt(120,260,±42), (150,520,±60), (190,380,±80), (190,260,±(60→95))…(185,215,±70→95)]`로 Task B1의 검증 좌표를 경로점으로 옮긴다. 집합부 `tube` 경로 `[180,210,75] → [-100,190,80] → [-419,180,75]`, 머플러 `lathe`(앞 반지름 45 → 55 → 끝 45, 길이 420) 기존 위치.
  - 라디에이터 호스 2본 `tube`(반지름 14): 상부 `[230,560,40] → [120,600,60] → [40,590,70]`, 하부 `[230,300,40] → [100,280,90] → [-40,300,110]`.
  - 냉각 팬은 `lathe` 허브 + 블레이드 7장 `extrude`.

- [ ] **Step 3: 검증** — 테스트·tsc·build; 엔진 작업대에서 27부품 조립 스크린샷(핀·둥근 커버·헤드), 결합 후 옆에서 배기 경로.

- [ ] **Step 4: 커밋** — `… -m "닌자 400 재모델링 2: 엔진 외관·배기·냉각"`

---

### Task 10: 재모델링 3 — 탱크·시트·카울·펜더·램프·핸들·계기

**Files:** `geometry.ts`, `parts.ts`, `parts.test.ts`, `materials.ts`

**Interfaces:** `tankGeometry()`, `seatGeometry(kind: 'rider' | 'pillion')`, `upperCowl()`, `sideCowl(side)`, `tailCowl()`, `fenderArch(tireR, width, sweepDeg)`, `headlightLens()`, `tailLightLens()`, `mirrorGeometry(side)`, `gripGeometry()`, `leverGeometry(side)`, `clusterGeometry()`.

- [ ] **Step 1: 테스트** — `uses('fuel_tank','loft')`, `uses('upper_cowl','loft')`, `uses('side_cowl','loft')`, `uses('front_fender','loft')`, `uses('headlight_unit','lathe')`; 도색 대상 목록이 이전과 같음(`paintable` id 집합 불변); 탱크 bbox가 프레임 상부 튜브(y 640~900, x −200~400) 위에 있고 시트와 x로 겹치지 않음(`assemblyBounds` 개별 인스턴스 버전 `instanceBounds`).

- [ ] **Step 2: 구현** — 단면은 x(앞뒤) 위치마다 yz 폴리라인 10점(좌우 대칭은 `mirrorSections`로 만든다):
  - 탱크 `loft` 단면 8개, x = 300 → −120: 폭 `[120, 190, 230, 240, 220, 190, 150, 110]`, 높이 `[860, 900, 940, 960, 950, 920, 890, 860]`, 밑변 y 760. 각 단면은 아래 폭 0.7배 → 위로 갈수록 둥글게(반원 근사 10점). 위에 `lathe` 주유구 캡(반지름 45) x=80.
  - 시트: 라이더 `loft` x −120 → −520, 폭 200 → 260 → 220, 윗면 y 800 → 790; 동승자 x −540 → −820, 폭 220 → 160, y 830 → 880(테일로 올라감).
  - 어퍼 카울: 좌우 대칭 셸 `loft` 6단면, x 620(코) → 380(탱크 앞), 폭 60 → 380, y 범위 640 → 1000; 앞면에 헤드라이트 구멍 대신 렌즈 `lathe`(얕은 돔 반지름 90, 깊이 30) 2개 z ±110을 `headlight_unit`에 둔다. 윈드스크린은 `loft` 3단면 얇은 판(`glass` 재질, 없으면 추가).
  - 사이드 카울(좌우): `loft` 7단면 x 420 → −120, 위 y 820 → 640, 아래 y 300 → 380, z 최대 240 → 210. 아래로 가며 안쪽으로 접힘(벨리팬 느낌).
  - 테일: `loft` 6단면 x −520 → −900, 폭 260 → 120, 위 y 800 → 900, 아래 y 700 → 820. 후미등 렌즈 `lathe`(타원 근사: lathe 후 scale `[1.6,1,1]`).
  - 펜더: `fenderArch(r, w, sweep)` = 각도 −70°~+70°(앞) / −40°~+60°(뒤) 호를 따라 단면(폭 w, 두께 6, 가운데 볼록)을 놓은 `loft`.
  - 미러: 하우징 `loft` 4단면 + 스템 `tube`; 그립 `lathe`(반지름 16, 길이 120, 끝 플랜지 20); 레버 `tube` 5점 곡선(반지름 6→4); 계기판 `extrude` 8각 판 + 화면 `roundedBox`.
  - `materials.ts`: 카울·탱크·시트·펜더 등 loft 재질에 `side: THREE.DoubleSide`.

- [ ] **Step 3: 검증** — 테스트·tsc·build; 도색까지 건너뛰기 후 앞 3/4·옆·뒤 3/4 스크린샷: 탱크 곡면, 날카로운 앞 카울, 측면 카울이 라디에이터를 감싸고, 테일이 치켜 올라감, 도색 3색이 곡면에 적용됨.

- [ ] **Step 4: 커밋** — `… -m "닌자 400 재모델링 3: 탱크·시트·카울·펜더·램프·핸들·계기"`

---

### Task 11: 통합 조정·최종 검증

**Files:** `parts.ts`, `product.tsx`, `spec.ts`(필요 시), 프로젝트 메모리 아님(레포 밖).

- [ ] **Step 1**: 전체 흐름을 브라우저에서 처음부터 끝까지(건너뛰기 병행) 통과: 프레임 → 엔진 → 롤링 섀시 → 외장 → 도색 → 키 → 시동 → 조작(기어·클러치·브레이크·시동 꺼짐·재시동). 각 부품의 `camera` 뷰가 새 형상에 맞는지 조정(특히 탱크·카울·키).
- [ ] **Step 2**: 대기 위치(`REST`)가 새 형상 크기에서 트레이·다른 부품과 안 겹치는지 확인, 필요 시 조정.
- [ ] **Step 3**: 성능: 메시 수·삼각형 수를 콘솔에서 확인(`renderer.info.render.triangles` < 400k, 드로우콜 < 400). 넘으면 `segments`/`radial`을 낮춘다.
- [ ] **Step 4**: `npx tsc --noEmit && npx vitest run && npm run build` 최종 통과. 커밋 `"닌자 400 통합 조정"`.

---

## 자기 검토

- **스펙 커버리지**: §3 → Task 1; §4 → Task 8/9/10 (+11 조정); §5 → Task 4; §6 → Task 2/3/5; §7 → Task 6; §8 → Task 7; §9 파이프라인 보관 → 이미 커밋(49aa815); §10 → 스펙 문구로 대체; §11 테스트 → 각 태스크; §12 순서 → 태스크 순서.
- **플레이스홀더**: 형상 태스크(8~10)의 상세 좌표는 초기값 + 검증 테스트 + 브라우저 조정으로 두었다. 이는 좌표가 시각 판단 대상이기 때문이며, 함수 이름·시그니처·테스트는 명시했다.
- **타입 일관성**: `skipCurrent`/`canSkip`(Task 2 → 3), `phaseOnMount`(2 → 5), `thresholdPx`/`resolveDragTargets`/`GhostPx`(4), `ride`/`rideInput`/`stepRide`/`shiftUp`/`shiftDown`(6 → 7), `setRpm`/`setLoad`/`blip`(7 ← 6), `curvedGeometry`/`isCurved`(1 → 4·8·9·10 test-utils), `hudExtra`(3 → 6).
