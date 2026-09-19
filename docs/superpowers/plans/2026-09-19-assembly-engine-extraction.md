# 공통 조립 엔진 추출 + 키보드 이관 + 진입 화면 구현 계획 (계획 A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 키보드 조립 앱을 제품 무관한 조립 엔진(`src/engine/`)과 키보드 제품 정의(`src/products/keyboard/`)로 분리하고, 모델 선택 진입 화면을 붙인다. 키보드 동작은 변하지 않는다.

**Architecture:** `ProductDef` 하나가 제품을 기술한다(부품·작업대·재질·카메라·드래그 수치·마무리 컴포넌트). 엔진은 `createAssemblyStore(product)`로 스토어를 만들고 React 컨텍스트로 내려보낸다. 지오메트리는 프리미티브 + composite로 통일하고 키보드 고유 형상은 제품 폴더의 함수가 composite로 만든다. 키보드의 "공중 샌드위치 → 안착"은 작업대(station) + 결합 부품(marries)으로 일반화한다.

**Tech Stack:** Vite 6, React 18, TypeScript 5, @react-three/fiber 8, @react-three/drei 9, three 0.172, zustand 5 (vanilla `createStore` + `useStore`), vitest 3.

**Spec:** `docs/superpowers/specs/2026-09-19-ninja400-assembly-design.md` (2~6절, 10절, 12절이 이 계획의 범위)

## Global Constraints

- 외부 3D 모델·오디오 파일 임포트 금지. GLTF/OBJ 로더 금지. 물리 엔진·백엔드·라우터 라이브러리 금지.
- 1 unit = 10mm (`MM = 0.1`). 모든 치수는 mm 상수.
- 이모지 금지(UI·주석·커밋 메시지). 슬로건 금지. 그라데이션·글로우·파티클 금지. 산세리프 한 종류.
- 부품명은 정확한 업계 용어. 안내 문구는 동사 하나로 끝난다("플레이트 장착").
- 제품 폴더는 `src/engine/`만 import한다. 제품끼리 import 금지. 엔진은 제품을 import하지 않는다.
- 데스크톱 1280px 이상만 고려.
- 커밋 메시지 끝에 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- main은 Vercel 프로덕션에 배포되므로 **각 태스크 커밋 전에 `npx tsc --noEmit && npx vitest run && npx vite build`가 통과**해야 한다. 푸시는 계획 완료 후 한 번만.
- 개발 서버(`npm run dev`)는 실행하지 않는다. 브라우저 확인이 필요한 태스크는 사용자가 띄워 둔 `http://localhost:5173`을 Chrome MCP로 연다. 그 탭은 백그라운드라 rAF가 멈추므로, 스크린샷을 두 번 찍어(첫 장은 검게 나옴) 프레임을 진행시킨 뒤 판단한다.

---

## 파일 구조

```
src/
  engine/
    types.ts                  공통 타입 + MM 상수 + validateGeometry
    materials.ts              MaterialSpec → three 재질 레지스트리, 고스트 재질
    store.ts                  createAssemblyStore(product), 순수 도우미 함수
    context.tsx               AssemblyProvider, useAssemblyStore, useAssembly, useProduct, useMaterials
    geometry/frustum.ts       사다리꼴 BufferGeometry 생성 (순수 함수)
    geometry/PartGeometry.tsx 프리미티브·composite 렌더러
    scene/controlsRef.ts      (이동) OrbitControls 동기 제어 + 카메라 트윈 취소
    scene/Environment.tsx     (이동, 설정 주입) 조명·환경맵·바닥
    scene/CameraRig.tsx       (이동, 제품 카메라 설정)
    scene/Stations.tsx        작업대 그룹(오프셋 애니메이션) + 소품
    scene/MountedParts.tsx    (이동) 장착 인스턴스 + renderInstance 훅
    scene/Ghosts.tsx          (이동)
    scene/DraggablePart.tsx   (이동, product.drag)
    scene/Assembly.tsx        Keyboard.tsx의 일반화: 작업대별로 장착 부품·고스트 배치
    scene/Scene.tsx           (이동) Canvas + Finale 슬롯
    ui/Tray.tsx, ui/Hud.tsx, ui/VariantPicker.tsx
    ProductApp.tsx            Provider + Scene + Hud + Tray
  products/
    keyboard/
      parts.ts                (이동) 부품 정의, station/marries 사용
      geometry.ts             tub/frame/stabilizer/switch/gasketSet composite 생성 함수
      materials.ts            키보드 재질표 + RGB 색
      audio/switchSound.ts    (이동)
      finale/Cable.tsx, finale/PlateGlow.tsx, finale/rgb.ts, finale/Keycap.tsx, finale/Finale.tsx
      index.ts                keyboardProduct: ProductDef
    index.ts                  PRODUCTS 레지스트리
  entry/ModelSelect.tsx
  App.tsx                     경로 → 제품
  styles.css                  (수정) 진입 화면·변형 선택기 스타일 추가
vercel.json
```

삭제(마지막 태스크): `src/data/`, `src/store/`, `src/scene/`, `src/ui/`, `src/audio/`, `src/utils/easing.ts`는 `src/engine/easing.ts`로 이동.

---

### Task 1: 공통 타입과 지오메트리 검증

**Files:**
- Create: `src/engine/types.ts`
- Create: `src/engine/easing.ts` (기존 `src/utils/easing.ts` 내용 그대로 복사)
- Test: `src/engine/types.test.ts`

**Interfaces:**
- Produces: `MM`, `Vec3`, `Primitive`, `Geometry`, `CompositeChild`, `Variant`, `PartInstance`, `PartDef`, `StationDef`, `CameraView`, `MaterialSpec`, `DragConfig`, `CameraConfig`, `EnvironmentConfig`, `ProductDef`, `Phase`, `MountRecord`, `RenderInstanceCtx`, `validateGeometry(g): string[]`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// src/engine/types.test.ts
import { describe, expect, it } from 'vitest'
import { validateGeometry, type Geometry } from './types'

describe('validateGeometry', () => {
  it('accepts positive primitives', () => {
    expect(validateGeometry({ type: 'box', size: [1, 2, 3] })).toEqual([])
    expect(validateGeometry({ type: 'cylinder', radiusTop: 1, radiusBottom: 1, height: 2 })).toEqual([])
    expect(validateGeometry({ type: 'frustum', bottom: [10, 10], top: [6, 6], h: 4 })).toEqual([])
  })

  it('rejects non-positive dimensions with a path', () => {
    expect(validateGeometry({ type: 'box', size: [1, 0, 3] })).toEqual(['box.size[1] must be > 0'])
    expect(validateGeometry({ type: 'torus', radius: 5, tube: -1 })).toEqual(['torus.tube must be > 0'])
  })

  it('recurses into composites and reports nested paths', () => {
    const g: Geometry = {
      type: 'composite',
      children: [
        { geometry: { type: 'box', size: [1, 1, 1] } },
        { geometry: { type: 'sphere', radius: 0 }, position: [0, 1, 0] },
      ],
    }
    expect(validateGeometry(g)).toEqual(['children[1].sphere.radius must be > 0'])
  })

  it('rejects composites deeper than 4 levels', () => {
    let g: Geometry = { type: 'box', size: [1, 1, 1] }
    for (let i = 0; i < 5; i++) g = { type: 'composite', children: [{ geometry: g }] }
    expect(validateGeometry(g)[0]).toMatch(/depth/)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/engine/types.test.ts`
Expected: FAIL — `./types` 모듈 없음

- [ ] **Step 3: 타입과 검증 함수 구현**

```ts
// src/engine/types.ts
import type { ComponentType, ReactNode } from 'react'
import type { MeshPhysicalMaterialParameters, MeshStandardMaterialParameters } from 'three'

/** 1 unit = 10mm */
export const MM = 0.1

export type Vec3 = [number, number, number]

export type Primitive =
  | { type: 'box'; size: Vec3 }
  | { type: 'roundedBox'; size: Vec3; radius: number }
  | { type: 'cylinder'; radiusTop: number; radiusBottom: number; height: number; segments?: number }
  | { type: 'sphere'; radius: number }
  | { type: 'cone'; radius: number; height: number }
  | { type: 'torus'; radius: number; tube: number }
  /** 사다리꼴 기둥. 밑면 [w, d], 윗면 [w, d], 높이 h. 원점은 밑면 중심 */
  | { type: 'frustum'; bottom: [number, number]; top: [number, number]; h: number }

export interface CompositeChild {
  geometry: Geometry
  position?: Vec3
  rotation?: Vec3
  scale?: Vec3
  /** 재질 이름 덮어쓰기 (제품 재질표의 키) */
  material?: string
}

export type Geometry = Primitive | { type: 'composite'; children: CompositeChild[] }

export interface Variant {
  id: string
  label: string
  /** CSS 색 (선택 버튼 색견본) */
  swatch: string
}

export interface PartInstance {
  id: string
  mountPosition: Vec3
  mountRotation: Vec3
  geometry: Geometry
  /** 제품이 쓰는 식별자 (키 id, 좌/우 등) */
  tag?: string
  /** 순차 장착·웨이브 순서 0~1 */
  order: number
}

export interface CameraView {
  /** 방위각(도). 0 = +z(정면), 양수 = +x 쪽으로 */
  azimuth: number
  /** 극각(도). 0 = 수직 위 */
  polar: number
  /** 거리 (mm) */
  distance: number
  /** 바라볼 점 (mm). 없으면 부품 장착 위치 */
  target?: Vec3
}

export interface PartDef {
  id: string
  nameKo: string
  nameEn: string
  geometry: Geometry
  /** 제품 재질표의 키 */
  material: string
  restPosition: Vec3
  mountPosition: Vec3
  mountRotation: Vec3
  requires: string[]
  count: number
  instances: PartInstance[]
  station?: string
  marries?: string
  preplaced?: boolean
  paintable?: boolean
  variants?: Variant[]
  hidden?: boolean
  cameraView: CameraView
  hint: string
}

export interface StationDef {
  id: string
  nameKo: string
  /** 조립 중 최종 위치에서의 변위 (mm) */
  offset: Vec3
  prop?: Geometry
  propMaterial?: string
}

export type MaterialSpec =
  | ({ physical?: false } & MeshStandardMaterialParameters)
  | ({ physical: true } & MeshPhysicalMaterialParameters)

export interface DragConfig {
  snapMm: number
  paintMm: number
  hoverMm: number
  grabMinMm: number
}

export interface CameraConfig {
  initial: CameraView
  /** 초기 주시점 (mm) */
  target: Vec3
  minDistanceMm: number
  maxDistanceMm: number
  minPolarDeg: number
  maxPolarDeg: number
}

export interface EnvironmentConfig {
  /** 접촉 그림자 평면 크기 (mm) */
  contactShadowSizeMm: [number, number]
  /** 그림자 카메라 반경 (mm) */
  shadowBoundsMm: number
}

export type Phase = 'assembly' | 'complete' | string

export interface MountRecord {
  instanceId: string
  /** performance.now() 기준 장착 시각 */
  at: number
  /** 장착 애니메이션 출발점 (월드 mm) */
  from?: Vec3
  /** 선택한 변형 id */
  variant?: string
}

export interface RenderInstanceCtx {
  part: PartDef
  inst: PartInstance
  record: MountRecord
}

export interface ProductDef {
  id: string
  nameKo: string
  nameEn: string
  subtitle: string
  parts: PartDef[]
  stations: StationDef[]
  props?: Array<{ geometry: Geometry; position: Vec3; material: string }>
  materials: Record<string, MaterialSpec>
  camera: CameraConfig
  drag: DragConfig
  environment: EnvironmentConfig
  /** 조립 완료 후 연출과 상호작용. Canvas 안에서 렌더된다 */
  Finale: ComponentType
  /** 기본 지오메트리 대신 렌더할 인스턴스. null이면 기본 */
  renderInstance?: (ctx: RenderInstanceCtx) => ReactNode | null
  /** 단계별 안내 문구. assembly는 선택 부품의 hint를 쓴다 */
  hints: Partial<Record<string, string>>
  /** complete 이후 단계 이름, 순서대로 */
  phasesAfterComplete: string[]
}

const MAX_DEPTH = 4

function positive(v: number, path: string, out: string[]) {
  if (!(v > 0)) out.push(`${path} must be > 0`)
}

/** 치수가 전부 양수이고 composite 깊이가 MAX_DEPTH 이하인지 검사. 문제를 경로 문자열로 돌려준다. */
export function validateGeometry(g: Geometry, prefix = '', depth = 0): string[] {
  const out: string[] = []
  if (depth > MAX_DEPTH) return [`${prefix}composite depth exceeds ${MAX_DEPTH}`]
  switch (g.type) {
    case 'box':
    case 'roundedBox':
      g.size.forEach((v, i) => positive(v, `${prefix}${g.type}.size[${i}]`, out))
      if (g.type === 'roundedBox') positive(g.radius, `${prefix}roundedBox.radius`, out)
      break
    case 'cylinder':
      positive(g.height, `${prefix}cylinder.height`, out)
      if (g.radiusTop < 0 || g.radiusBottom < 0 || g.radiusTop + g.radiusBottom === 0)
        out.push(`${prefix}cylinder radii must be >= 0 and not both 0`)
      break
    case 'sphere':
      positive(g.radius, `${prefix}sphere.radius`, out)
      break
    case 'cone':
      positive(g.radius, `${prefix}cone.radius`, out)
      positive(g.height, `${prefix}cone.height`, out)
      break
    case 'torus':
      positive(g.radius, `${prefix}torus.radius`, out)
      positive(g.tube, `${prefix}torus.tube`, out)
      break
    case 'frustum':
      g.bottom.forEach((v, i) => positive(v, `${prefix}frustum.bottom[${i}]`, out))
      g.top.forEach((v, i) => positive(v, `${prefix}frustum.top[${i}]`, out))
      positive(g.h, `${prefix}frustum.h`, out)
      break
    case 'composite':
      g.children.forEach((c, i) => out.push(...validateGeometry(c.geometry, `${prefix}children[${i}].`, depth + 1)))
      break
  }
  return out
}
```

`src/engine/easing.ts`는 `src/utils/easing.ts`를 그대로 복사한다(`cp src/utils/easing.ts src/engine/easing.ts`).

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/engine/types.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/engine/types.ts src/engine/types.test.ts src/engine/easing.ts
git commit -m "엔진 공통 타입과 지오메트리 검증 추가

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: 재질 레지스트리와 프리미티브 렌더러

**Files:**
- Create: `src/engine/materials.ts`
- Create: `src/engine/geometry/frustum.ts`
- Create: `src/engine/geometry/PartGeometry.tsx`
- Test: `src/engine/geometry/frustum.test.ts`, `src/engine/materials.test.ts`

**Interfaces:**
- Consumes: `Geometry`, `MaterialSpec`, `MM` (Task 1)
- Produces:
  - `createMaterialRegistry(specs: Record<string, MaterialSpec>): MaterialRegistry` with `get(name: string): THREE.Material` (없는 이름이면 throw), `has(name)`
  - `ghostMaterial`, `ghostHoverMaterial` (공유)
  - `frustumGeometry(bottom, top, h): THREE.BufferGeometry` (mm 입력, unit 출력, 캐시)
  - `<PartGeometry geometry material simple? materials? />` — `material: THREE.Material` 기본 재질, `materials?: MaterialRegistry` composite 자식의 `material` 이름 해석용, `simple`이면 그림자 없음 + roundedBox를 box로

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// src/engine/geometry/frustum.test.ts
import { describe, expect, it } from 'vitest'
import { frustumGeometry } from './frustum'

describe('frustumGeometry', () => {
  it('scales the top face and keeps the bottom on y=0', () => {
    const g = frustumGeometry([20, 10], [10, 6], 8)
    const pos = g.attributes.position
    let minY = Infinity, maxY = -Infinity, topMaxX = 0, bottomMaxX = 0
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i), x = Math.abs(pos.getX(i))
      minY = Math.min(minY, y); maxY = Math.max(maxY, y)
      if (y > 0.4) topMaxX = Math.max(topMaxX, x)
      else bottomMaxX = Math.max(bottomMaxX, x)
    }
    expect(minY).toBeCloseTo(0, 5)
    expect(maxY).toBeCloseTo(0.8, 5)
    expect(bottomMaxX).toBeCloseTo(1.0, 5)
    expect(topMaxX).toBeCloseTo(0.5, 5)
  })

  it('caches by dimensions', () => {
    expect(frustumGeometry([20, 10], [10, 6], 8)).toBe(frustumGeometry([20, 10], [10, 6], 8))
  })
})
```

```ts
// src/engine/materials.test.ts
import { describe, expect, it } from 'vitest'
import { createMaterialRegistry } from './materials'

describe('createMaterialRegistry', () => {
  it('builds standard and physical materials and caches them', () => {
    const reg = createMaterialRegistry({
      alu: { color: '#8a8d93', metalness: 0.9, roughness: 0.35 },
      paint: { physical: true, color: '#69be28', clearcoat: 1 },
    })
    expect(reg.get('alu').type).toBe('MeshStandardMaterial')
    expect(reg.get('paint').type).toBe('MeshPhysicalMaterial')
    expect(reg.get('alu')).toBe(reg.get('alu'))
    expect(reg.has('nope')).toBe(false)
    expect(() => reg.get('nope')).toThrow(/unknown material/)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/engine`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

```ts
// src/engine/materials.ts
import * as THREE from 'three'
import type { MaterialSpec } from './types'

export interface MaterialRegistry {
  get(name: string): THREE.Material
  has(name: string): boolean
}

/** 제품 재질표를 three 재질로 만든다. 같은 이름은 같은 인스턴스를 돌려준다. */
export function createMaterialRegistry(specs: Record<string, MaterialSpec>): MaterialRegistry {
  const cache = new Map<string, THREE.Material>()
  return {
    has: (name) => name in specs,
    get(name) {
      let m = cache.get(name)
      if (m) return m
      const spec = specs[name]
      if (!spec) throw new Error(`unknown material: ${name}`)
      if (spec.physical) {
        const { physical: _p, ...params } = spec
        m = new THREE.MeshPhysicalMaterial(params)
      } else {
        const { physical: _p, ...params } = spec
        m = new THREE.MeshStandardMaterial(params)
      }
      cache.set(name, m)
      return m
    },
  }
}

export const ghostMaterial = new THREE.MeshBasicMaterial({
  color: '#ffffff',
  transparent: true,
  opacity: 0.3,
  depthWrite: false,
})

export const ghostHoverMaterial = new THREE.MeshBasicMaterial({
  color: '#ffffff',
  transparent: true,
  opacity: 0.55,
  depthWrite: false,
})
```

```ts
// src/engine/geometry/frustum.ts
import * as THREE from 'three'
import { MM } from '../types'

const cache = new Map<string, THREE.BufferGeometry>()

/** 사다리꼴 기둥. 입력 mm, 출력 unit. 밑면이 y=0, 윗면 꼭짓점을 안쪽으로 당긴다. */
export function frustumGeometry(bottom: [number, number], top: [number, number], h: number): THREE.BufferGeometry {
  const key = `${bottom[0]},${bottom[1]},${top[0]},${top[1]},${h}`
  let g = cache.get(key)
  if (g) return g
  g = new THREE.BoxGeometry(bottom[0] * MM, h * MM, bottom[1] * MM)
  const pos = g.attributes.position as THREE.BufferAttribute
  const sx = top[0] / bottom[0]
  const sz = top[1] / bottom[1]
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) > 0) {
      pos.setX(i, pos.getX(i) * sx)
      pos.setZ(i, pos.getZ(i) * sz)
    }
  }
  pos.needsUpdate = true
  g.computeVertexNormals()
  g.translate(0, (h * MM) / 2, 0)
  cache.set(key, g)
  return g
}
```

```tsx
// src/engine/geometry/PartGeometry.tsx
import { RoundedBox } from '@react-three/drei'
import type * as THREE from 'three'
import type { MaterialRegistry } from '../materials'
import { MM, type Geometry, type Vec3 } from '../types'
import { frustumGeometry } from './frustum'

// 프리미티브와 composite를 그린다. 그룹 원점은 부품 밑면 중심(제품 데이터가 그렇게 정의한다).
// 입력은 mm, 여기서 MM을 곱한다. 제품을 모른다.

const u = (mm: number) => mm * MM
const v3 = (p?: Vec3): [number, number, number] => (p ? [u(p[0]), u(p[1]), u(p[2])] : [0, 0, 0])

interface Props {
  geometry: Geometry
  material: THREE.Material
  /** composite 자식이 재질 이름을 덮어쓸 때 해석에 쓴다 */
  materials?: MaterialRegistry
  /** 고스트: 그림자 없음, roundedBox 대신 box */
  simple?: boolean
}

export function PartGeometry({ geometry, material, materials, simple = false }: Props) {
  const cast = !simple
  switch (geometry.type) {
    case 'box':
      return (
        <mesh material={material} position={[0, u(geometry.size[1]) / 2, 0]} castShadow={cast} receiveShadow={cast}>
          <boxGeometry args={v3(geometry.size)} />
        </mesh>
      )
    case 'roundedBox':
      if (simple) {
        return (
          <mesh material={material} position={[0, u(geometry.size[1]) / 2, 0]}>
            <boxGeometry args={v3(geometry.size)} />
          </mesh>
        )
      }
      return (
        <RoundedBox
          args={v3(geometry.size)}
          radius={u(Math.min(geometry.radius, Math.min(...geometry.size) / 2 - 0.01))}
          smoothness={3}
          material={material}
          position={[0, u(geometry.size[1]) / 2, 0]}
          castShadow
          receiveShadow
        />
      )
    case 'cylinder':
      return (
        <mesh material={material} position={[0, u(geometry.height) / 2, 0]} castShadow={cast} receiveShadow={cast}>
          <cylinderGeometry args={[u(geometry.radiusTop), u(geometry.radiusBottom), u(geometry.height), geometry.segments ?? 24]} />
        </mesh>
      )
    case 'sphere':
      return (
        <mesh material={material} position={[0, u(geometry.radius), 0]} castShadow={cast} receiveShadow={cast}>
          <sphereGeometry args={[u(geometry.radius), 24, 16]} />
        </mesh>
      )
    case 'cone':
      return (
        <mesh material={material} position={[0, u(geometry.height) / 2, 0]} castShadow={cast} receiveShadow={cast}>
          <coneGeometry args={[u(geometry.radius), u(geometry.height), 24]} />
        </mesh>
      )
    case 'torus':
      // 도넛 축이 y가 되도록 눕힌다. 밑면이 y=0
      return (
        <mesh material={material} position={[0, u(geometry.tube), 0]} rotation={[Math.PI / 2, 0, 0]} castShadow={cast} receiveShadow={cast}>
          <torusGeometry args={[u(geometry.radius), u(geometry.tube), 16, 48]} />
        </mesh>
      )
    case 'frustum':
      return (
        <mesh
          geometry={frustumGeometry(geometry.bottom, geometry.top, geometry.h)}
          material={material}
          castShadow={cast}
          receiveShadow={cast}
        />
      )
    case 'composite':
      return (
        <group>
          {geometry.children.map((c, i) => (
            <group key={i} position={v3(c.position)} rotation={c.rotation ?? [0, 0, 0]} scale={c.scale ?? [1, 1, 1]}>
              <PartGeometry
                geometry={c.geometry}
                material={c.material && materials ? materials.get(c.material) : material}
                materials={materials}
                simple={simple}
              />
            </group>
          ))}
        </group>
      )
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/engine && npx tsc --noEmit`
Expected: PASS (types 4, frustum 2, materials 1)

- [ ] **Step 5: 커밋**

```bash
git add src/engine/materials.ts src/engine/materials.test.ts src/engine/geometry
git commit -m "재질 레지스트리와 프리미티브 렌더러 추가

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: 키보드 제품 데이터 이관 (geometry.ts, parts.ts, materials.ts)

**Files:**
- Create: `src/products/keyboard/geometry.ts`
- Create: `src/products/keyboard/parts.ts` (기존 `src/data/parts.ts`를 옮기며 수정)
- Create: `src/products/keyboard/materials.ts`
- Test: `src/products/keyboard/parts.test.ts` (기존 `src/data/parts.test.ts`를 옮기며 확장)

**Interfaces:**
- Consumes: `Geometry`, `PartDef`, `PartInstance`, `Vec3`, `validateGeometry` (Task 1)
- Produces:
  - `geometry.ts`: `tub(size, wall, floor, radius)`, `frame(size, wall)`, `stabilizer(span, housing, wireR)`, `switchBody(body, stemR, stemH)`, `keycap(bottom, top, h)`, `gasketSet(strips)` → 전부 `Geometry`
  - `parts.ts`: 기존 export 전부(`U`, `KEY_LAYOUT`, `KEY_COUNT`, `STABILIZED_KEYS`, `isStabilizedKey`, `keyCenter`, `keyWaveOrder`, 치수 상수, `PARTS`, `PART_BY_ID`, `partOfInstance`, `findInstance`, `CABLE`, `USB_PORT`, `ASSEMBLY_LIFT`) + `STATIONS: StationDef[]`. `Vec3`/`MM`은 `engine/types`에서 re-export.
  - `materials.ts`: `KEYBOARD_MATERIALS: Record<string, MaterialSpec>` (키: aluminum, foam, pcb, plastic, keycap, rubber, glass, cable, plug), `RGB_COLOR`, `RGB_WAVE_COLOR`

- [ ] **Step 1: 테스트 이동 및 확장**

`git mv src/data/parts.test.ts src/products/keyboard/parts.test.ts` 후 import를 `'./parts'`로 유지하고 아래 테스트를 추가한다.

```ts
// src/products/keyboard/parts.test.ts 에 추가
import { validateGeometry } from '../../engine/types'
import { STATIONS } from './parts'

it('every geometry validates', () => {
  for (const p of PARTS) {
    expect(validateGeometry(p.geometry), p.id).toEqual([])
    for (const inst of p.instances) expect(validateGeometry(inst.geometry), inst.id).toEqual([])
  }
})

it('uses the sandwich station and gasket marries it after all station parts', () => {
  expect(STATIONS.map((s) => s.id)).toEqual(['sandwich'])
  const stationIdx = PARTS.map((p, i) => (p.station === 'sandwich' ? i : -1)).filter((i) => i >= 0)
  const marryIdx = PARTS.findIndex((p) => p.marries === 'sandwich')
  expect(stationIdx.length).toBe(5)
  expect(Math.max(...stationIdx)).toBeLessThan(marryIdx)
  expect(PARTS[marryIdx].id).toBe('gasket')
})

it('keycap instances use frustum geometry and switches are composites', () => {
  expect(PART_BY_ID.keycap.instances[0].geometry.type).toBe('frustum')
  expect(PART_BY_ID.switch.geometry.type).toBe('composite')
})
```

기존 테스트 `exactly one part seats the subassembly ...`는 `subassembly`/`seatsAssembly`가 사라지므로 삭제한다(위 테스트가 대체).

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/products/keyboard/parts.test.ts`
Expected: FAIL — `./parts` 없음

- [ ] **Step 3: geometry.ts 작성**

```ts
// src/products/keyboard/geometry.ts
import type { Geometry, Vec3 } from '../../engine/types'

// 키보드 고유 형상을 프리미티브 composite로 만든다. 입력 전부 mm. 원점은 부품 밑면 중심.

function walls(w: number, d: number, h: number, wall: number, y: number): Geometry['type'] extends never ? never : Array<{ geometry: Geometry; position: Vec3 }> {
  return [
    { geometry: { type: 'box', size: [w, h, wall] }, position: [0, y, -(d / 2 - wall / 2)] },
    { geometry: { type: 'box', size: [w, h, wall] }, position: [0, y, d / 2 - wall / 2] },
    { geometry: { type: 'box', size: [wall, h, d - wall * 2] }, position: [-(w / 2 - wall / 2), y, 0] },
    { geometry: { type: 'box', size: [wall, h, d - wall * 2] }, position: [w / 2 - wall / 2, y, 0] },
  ]
}

/** 바닥판 + 벽 4개 (하부 케이스) */
export function tub(size: Vec3, wall: number, floor: number, radius: number): Geometry {
  const [w, h, d] = size
  return {
    type: 'composite',
    children: [
      { geometry: { type: 'roundedBox', size: [w, floor, d], radius } },
      ...walls(w, d, h - floor, wall, floor),
    ],
  }
}

/** 벽 4개 (상부 케이스) */
export function frame(size: Vec3, wall: number): Geometry {
  const [w, h, d] = size
  return { type: 'composite', children: walls(w, d, h, wall, 0) }
}

/** 하우징 2개 + 와이어 (와이어는 PCB 아래로 내려간다) */
export function stabilizer(span: number, housing: Vec3, wireR: number): Geometry {
  const [hw, hh, hd] = housing
  const half = span / 2
  return {
    type: 'composite',
    children: [
      { geometry: { type: 'box', size: housing }, position: [-half, 0, 0] },
      { geometry: { type: 'box', size: housing }, position: [half, 0, 0] },
      {
        geometry: { type: 'cylinder', radiusTop: wireR, radiusBottom: wireR, height: span + hw, segments: 8 },
        position: [-(span + hw) / 2, -2.5 - wireR, hd / 2 - 1],
        rotation: [0, 0, -Math.PI / 2],
      },
    ],
  }
}

/** 몸통 + 스템 */
export function switchBody(body: Vec3, stemR: number, stemH: number): Geometry {
  return {
    type: 'composite',
    children: [
      { geometry: { type: 'box', size: body } },
      { geometry: { type: 'cylinder', radiusTop: stemR, radiusBottom: stemR, height: stemH, segments: 12 }, position: [0, body[1], 0] },
    ],
  }
}

/** 사다리꼴 키캡 */
export function keycap(bottom: [number, number], top: [number, number], h: number): Geometry {
  return { type: 'frustum', bottom, top, h }
}

/** 얇은 스트립들 */
export function gasketSet(strips: Array<{ pos: Vec3; size: Vec3 }>): Geometry {
  return {
    type: 'composite',
    children: strips.map((s) => ({ geometry: { type: 'box', size: s.size } as Geometry, position: s.pos })),
  }
}
```

주의: `walls`의 반환 타입 선언은 단순히 `Array<{ geometry: Geometry; position: Vec3 }>`로 쓴다(위의 조건부 타입 표현은 쓰지 않는다).

원통 회전 규칙: 엔진의 cylinder는 y축 기둥이고 원점이 밑면이다. x축을 따라 눕히려면 `rotation: [0, 0, -Math.PI/2]`로 돌리면 기둥이 +x 방향으로 뻗는다. 그래서 위치를 `-(length)/2`에서 시작시킨다.

- [ ] **Step 4: parts.ts 이동 및 수정**

`git mv src/data/parts.ts src/products/keyboard/parts.ts` 후 아래를 적용한다.

1. 파일 머리:
```ts
import { MM, type Geometry, type PartDef, type PartInstance, type StationDef, type Vec3 } from '../../engine/types'
import { frame, gasketSet, keycap as keycapGeom, stabilizer as stabilizerGeom, switchBody, tub } from './geometry'
export { MM }
export type { Vec3 }
```
기존의 `export const MM = 0.1`, `export type Vec3`, `export type Geometry`, `export type MaterialKind`, `export interface PartInstance`, `export interface CameraView`, `export interface PartDef` 선언은 삭제한다.

2. 지오메트리 교체:
- 하부 케이스: `geometry: tub([CASE_W, BOTTOM_H, CASE_D], CASE_WALL, BOTTOM_FLOOR_T, CASE_RADIUS)`
- 상부 케이스: `geometry: frame([CASE_W, TOP_H, CASE_D], (CASE_W - PLATE_W) / 2 - 2)`
- 스태빌라이저: 부품 `geometry: stabilizerGeom(24, stabilizerHousing, 0.8)`, 인스턴스 `geometry: stabilizerGeom(span, stabilizerHousing, 0.8)`
- 스위치: `const switchGeometry: Geometry = switchBody([SWITCH_BODY, SWITCH_H, SWITCH_BODY], STEM_R, STEM_H)`
- 키캡: `keycapGeometry(k)`가 `keycapGeom([w, d], [w - KEYCAP_TOP_INSET * 2, d - KEYCAP_TOP_INSET * 2], KEYCAP_H)`를 반환
- 가스켓: `geometry: gasketSet(gasketStrips)`
- 박스류(폼, PCB, 플레이트)는 `{ type: 'box', size }` 그대로.

3. 필드 이름 변경:
- 모든 `subassembly: true` → `station: 'sandwich'`
- 가스켓의 `seatsAssembly: true` → `marries: 'sandwich'`
- `material: 'aluminum'` 등 문자열은 그대로(재질표 키가 된다). `MaterialKind` 타입 참조는 `string`.
- 키캡·스위치·스태빌라이저 인스턴스의 `keyId: k.id` → `tag: k.id`

4. 작업대 정의 추가(파일 끝, `PARTS` 앞):
```ts
/** 샌드위치(스태빌라이저~스위치)는 케이스 위 ASSEMBLY_LIFT에서 조립되고 가스켓 안착 시 내려앉는다 */
export const STATIONS: StationDef[] = [{ id: 'sandwich', nameKo: '샌드위치', offset: [0, ASSEMBLY_LIFT, 0] }]
```

5. `findInstance`가 돌려주는 `keyId` 참조가 있으면 `tag`로 바꾼다. `partOfInstance`, `findInstance`는 유지.

6. 기존 테스트에서 `findInstance('keycap:esc').keyId` → `.tag`.

- [ ] **Step 5: materials.ts 작성**

```ts
// src/products/keyboard/materials.ts
import * as THREE from 'three'
import type { MaterialSpec } from '../../engine/types'

export const KEYBOARD_MATERIALS: Record<string, MaterialSpec> = {
  aluminum: { color: '#8a8d93', metalness: 0.9, roughness: 0.35 },
  foam: { color: '#5c5c5e', metalness: 0, roughness: 1 },
  pcb: { color: '#111214', metalness: 0.05, roughness: 0.85 },
  plastic: { color: '#2a2b2e', metalness: 0, roughness: 0.6 },
  keycap: { color: '#c9c6bf', metalness: 0, roughness: 0.75 },
  rubber: { color: '#3a3a3c', metalness: 0, roughness: 0.95 },
  glass: { color: '#1a1b1e', metalness: 0.6, roughness: 0.1 },
  cable: { color: '#1c1d20', metalness: 0.1, roughness: 0.7 },
  plug: { color: '#9a9da3', metalness: 0.9, roughness: 0.3 },
}

/** RGB 점등 색. 은은한 단색 */
export const RGB_COLOR = new THREE.Color('#ffd7a3')
/** 부팅 웨이브 피크 색 */
export const RGB_WAVE_COLOR = new THREE.Color('#ffffff')
```

- [ ] **Step 6: 통과 확인**

Run: `npx vitest run src/products/keyboard/parts.test.ts`
Expected: PASS. 이 시점에 `npx tsc --noEmit`은 옛 `src/scene` 등이 `../data/parts`를 못 찾아 실패한다. **이 태스크에서는 옛 코드의 import 경로를 `../products/keyboard/parts`로 고쳐서** tsc·기존 스토어 테스트·빌드가 통과하게 만든다(`grep -rl "data/parts" src | xargs sed -i "s#'\.\./data/parts'#'../products/keyboard/parts'#g"`). 옛 `src/scene/PartGeometry.tsx`는 `tub`/`frame`/`stabilizer`/`switch`/`gasketSet` 케이스가 사라져 타입 오류가 나므로, 옛 파일의 해당 case를 지우고 `composite`/`cylinder` 케이스를 Task 2의 렌더러와 같은 코드로 추가한다. 옛 `MountedParts.tsx`의 `inst.geometry.type === 'keycap'` 분기는 `'frustum'`으로, `part.subassembly` 참조는 `part.station === 'sandwich'`로, `inst.keyId`는 `inst.tag`로 바꾼다. `Keyboard.tsx`의 `p.subassembly`도 `p.station === 'sandwich'`, `p.seatsAssembly`는 `p.marries === 'sandwich'`로.

Run: `npx tsc --noEmit && npx vitest run && npx vite build`
Expected: 전부 통과(스토어 테스트 26 + parts 테스트 + 엔진 테스트).

- [ ] **Step 7: 커밋**

```bash
git add -A src
git commit -m "키보드 부품 데이터를 제품 폴더로 이관하고 composite 지오메트리로 전환

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: 엔진 스토어 (`createAssemblyStore`)

**Files:**
- Create: `src/engine/store.ts`
- Create: `src/engine/context.tsx`
- Test: `src/engine/store.test.ts` (기존 `src/store/assembly.test.ts`를 옮기며 확장)

**Interfaces:**
- Consumes: `ProductDef`, `PartDef`, `MountRecord`, `Phase`, `Vec3` (Task 1)
- Produces:
  - `createAssemblyStore(product: ProductDef): AssemblyStore` (`StoreApi<AssemblyState>`)
  - `AssemblyState` 필드: `product, mounted, history, selectedPartId, phase, phaseAt, lastMount, dragging, dragTarget, sequencing`
  - 액션: `selectPart(id|null)`, `mount(instanceId, from?, variantId?) => boolean`, `mountAll(partId, intervalMs?)`, `undo()`, `setDragging(v)`, `setDragTarget(id|null)`, `advancePhase()`, `reset()`
  - 순수 함수: `mountedCount(mounted, part)`, `isPartComplete(mounted, part)`, `isPartAvailable(product, mounted, part)`, `availableParts(product, mounted)`, `isAssemblyComplete(product, mounted)`, `nextAvailablePartId(product, mounted)`, `isStationSeated(product, mounted, stationId)`, `stationOffset(product, part, mounted): Vec3` (작업대 소속이고 미결합이면 오프셋, 아니면 [0,0,0]), `partOf(product, instanceId): PartDef`, `instanceOf(product, instanceId): PartInstance`
  - context: `<AssemblyProvider product store>`, `useAssemblyStore(): AssemblyStore`, `useAssembly<T>(selector): T`, `useProduct(): ProductDef`, `useMaterials(): MaterialRegistry`

- [ ] **Step 1: 테스트 이동 및 확장**

`git mv src/store/assembly.test.ts src/engine/store.test.ts`. 파일 머리를 아래로 바꾸고 본문의 `useAssembly.getState()`를 `store.getState()`로 전부 치환한다. `availableParts(x)` 호출은 `availableParts(product, x)`, `isAssemblyComplete(x)`는 `isAssemblyComplete(product, x)`.

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PARTS, PART_BY_ID } from '../products/keyboard/parts'
import { keyboardProduct as product } from '../products/keyboard'
import { availableParts, createAssemblyStore, isAssemblyComplete, isStationSeated, stationOffset, type AssemblyStore } from './store'

let store: AssemblyStore

function mountWholePart(partId: string) {
  for (const inst of PART_BY_ID[partId].instances) store.getState().mount(inst.id)
}
function mountUpTo(partId: string) {
  for (const p of PARTS) {
    if (p.id === partId) return
    mountWholePart(p.id)
  }
}

describe('assembly store', () => {
  beforeEach(() => {
    store = createAssemblyStore(product)
    vi.useRealTimers()
  })
  // ... 기존 테스트 본문 (store.getState()로 치환) ...
```

`keyboardProduct`는 Task 7에서 완성되지만 이 태스크에서는 **테스트용 최소 ProductDef**가 필요하다. `src/products/keyboard/index.ts`를 이 태스크에서 먼저 만들되 `Finale`는 `() => null`로 두고 Task 7에서 채운다:

```ts
// src/products/keyboard/index.ts (Task 4 시점의 최소본)
import type { ProductDef } from '../../engine/types'
import { KEYBOARD_MATERIALS } from './materials'
import { PARTS, STATIONS } from './parts'

export const keyboardProduct: ProductDef = {
  id: 'keyboard',
  nameKo: '조약돌75',
  nameEn: 'SPM Pebble 75',
  subtitle: '75% 알루미늄 핫스왑',
  parts: PARTS,
  stations: STATIONS,
  materials: KEYBOARD_MATERIALS,
  camera: {
    initial: { azimuth: 20, polar: 58, distance: 600 },
    target: [0, 15, 0],
    minDistanceMm: 300,
    maxDistanceMm: 900,
    minPolarDeg: 20,
    maxPolarDeg: 80,
  },
  drag: { snapMm: 60, paintMm: 12, hoverMm: 30, grabMinMm: 50 },
  environment: { contactShadowSizeMm: [600, 450], shadowBoundsMm: 300 },
  Finale: () => null,
  hints: { complete: '케이블 연결', on: '키캡 타건' },
  phasesAfterComplete: ['plugging', 'still', 'booting', 'on'],
}
```

추가 테스트:

```ts
  it('station is lifted until the marrying part is mounted, and lifted again after undo', () => {
    mountUpTo('gasket')
    expect(isStationSeated(product, store.getState().mounted, 'sandwich')).toBe(false)
    expect(stationOffset(product, PART_BY_ID.pcb, store.getState().mounted)).toEqual([0, 45, 0])
    store.getState().mount('gasket')
    expect(isStationSeated(product, store.getState().mounted, 'sandwich')).toBe(true)
    expect(stationOffset(product, PART_BY_ID.pcb, store.getState().mounted)).toEqual([0, 0, 0])
    expect(stationOffset(product, PART_BY_ID.bottom_case, store.getState().mounted)).toEqual([0, 0, 0])
    store.getState().undo()
    expect(isStationSeated(product, store.getState().mounted, 'sandwich')).toBe(false)
  })

  it('advancePhase walks phasesAfterComplete in order and stops at the end', () => {
    for (const p of PARTS) mountWholePart(p.id)
    expect(store.getState().phase).toBe('complete')
    store.getState().advancePhase()
    expect(store.getState().phase).toBe('plugging')
    store.getState().advancePhase(); store.getState().advancePhase(); store.getState().advancePhase()
    expect(store.getState().phase).toBe('on')
    store.getState().advancePhase()
    expect(store.getState().phase).toBe('on')
    // 후속 단계에서는 되돌리기와 장착이 막힌다
    store.getState().undo()
    expect(store.getState().phase).toBe('on')
  })

  it('advancePhase is ignored during assembly', () => {
    store.getState().advancePhase()
    expect(store.getState().phase).toBe('assembly')
  })

  it('requires a variant when the part defines variants, and undo clears it', () => {
    const painted = {
      ...product,
      parts: [
        { ...PARTS[0], variants: [{ id: 'a', label: 'A', swatch: '#fff' }, { id: 'b', label: 'B', swatch: '#000' }] },
        ...PARTS.slice(1),
      ],
    }
    const s = createAssemblyStore(painted)
    expect(s.getState().mount('bottom_case')).toBe(false)
    expect(s.getState().mount('bottom_case', undefined, 'zzz')).toBe(false)
    expect(s.getState().mount('bottom_case', undefined, 'b')).toBe(true)
    expect(s.getState().mounted.bottom_case.variant).toBe('b')
    s.getState().undo()
    expect(s.getState().mounted.bottom_case).toBeUndefined()
  })

  it('preplaced parts start mounted and survive reset', () => {
    const pre = { ...product, parts: [{ ...PARTS[0], preplaced: true }, ...PARTS.slice(1)] }
    const s = createAssemblyStore(pre)
    expect(s.getState().mounted.bottom_case).toBeDefined()
    expect(s.getState().history).toEqual([])
    expect(s.getState().selectedPartId).toBe('bottom_foam')
    s.getState().mount('bottom_foam')
    s.getState().reset()
    expect(s.getState().mounted.bottom_case).toBeDefined()
    expect(s.getState().mounted.bottom_foam).toBeUndefined()
  })
```

기존 테스트 중 `plugCable` 관련 두 개는 `advancePhase` 버전으로 바꾼다:
- `'enters complete phase ... then plugs the cable'` → `plugCable()` 대신 `advancePhase()`, 기대 phase `'plugging'`.
- `'plugCable is ignored before completion'` → 위의 `'advancePhase is ignored during assembly'`가 대체하므로 삭제.

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/engine/store.test.ts`
Expected: FAIL — `./store` 없음

- [ ] **Step 3: store.ts 구현**

```ts
// src/engine/store.ts
import { createStore, type StoreApi } from 'zustand/vanilla'
import type { MountRecord, PartDef, PartInstance, Phase, ProductDef, Vec3 } from './types'

export type Mounted = Record<string, MountRecord>

export interface AssemblyState {
  product: ProductDef
  mounted: Mounted
  history: string[]
  selectedPartId: string | null
  phase: Phase
  phaseAt: number
  lastMount: { partId: string; at: number } | null
  dragging: boolean
  dragTarget: string | null
  sequencing: boolean

  selectPart: (partId: string | null) => void
  mount: (instanceId: string, from?: Vec3, variantId?: string) => boolean
  mountAll: (partId: string, intervalMs?: number) => void
  undo: () => void
  setDragging: (v: boolean) => void
  setDragTarget: (id: string | null) => void
  /** complete → phasesAfterComplete[0] → ... 마지막에서 멈춘다 */
  advancePhase: () => void
  reset: () => void
}

export type AssemblyStore = StoreApi<AssemblyState>

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

// --- 순수 도우미 --------------------------------------------------------------

export function partOf(product: ProductDef, instanceId: string): PartDef {
  const partId = instanceId.split(':')[0]
  const part = product.parts.find((p) => p.id === partId)
  if (!part) throw new Error(`unknown instance ${instanceId}`)
  return part
}

export function instanceOf(product: ProductDef, instanceId: string): PartInstance {
  const inst = partOf(product, instanceId).instances.find((i) => i.id === instanceId)
  if (!inst) throw new Error(`unknown instance ${instanceId}`)
  return inst
}

export function mountedCount(mounted: Mounted, part: PartDef): number {
  let n = 0
  for (const inst of part.instances) if (mounted[inst.id]) n++
  return n
}

export function isPartComplete(mounted: Mounted, part: PartDef): boolean {
  return mountedCount(mounted, part) === part.count
}

export function isPartAvailable(product: ProductDef, mounted: Mounted, part: PartDef): boolean {
  if (isPartComplete(mounted, part)) return false
  return part.requires.every((id) => {
    const req = product.parts.find((p) => p.id === id)
    return req ? isPartComplete(mounted, req) : false
  })
}

export function availableParts(product: ProductDef, mounted: Mounted): PartDef[] {
  return product.parts.filter((p) => isPartAvailable(product, mounted, p))
}

export function isAssemblyComplete(product: ProductDef, mounted: Mounted): boolean {
  return product.parts.every((p) => isPartComplete(mounted, p))
}

export function nextAvailablePartId(product: ProductDef, mounted: Mounted): string | null {
  return availableParts(product, mounted)[0]?.id ?? null
}

/** 결합 부품(marries === stationId)이 전부 장착됐는가 */
export function isStationSeated(product: ProductDef, mounted: Mounted, stationId: string): boolean {
  const marry = product.parts.filter((p) => p.marries === stationId)
  if (marry.length === 0) return true
  return marry.every((p) => isPartComplete(mounted, p))
}

/** 부품이 작업대 소속이고 아직 결합 전이면 작업대 오프셋, 아니면 0 */
export function stationOffset(product: ProductDef, part: PartDef, mounted: Mounted): Vec3 {
  if (!part.station) return [0, 0, 0]
  if (isStationSeated(product, mounted, part.station)) return [0, 0, 0]
  const st = product.stations.find((s) => s.id === part.station)
  return st ? st.offset : [0, 0, 0]
}

function initialMounted(product: ProductDef): Mounted {
  const m: Mounted = {}
  const t = now()
  for (const p of product.parts) {
    if (!p.preplaced) continue
    for (const inst of p.instances) m[inst.id] = { instanceId: inst.id, at: t - 10_000 }
  }
  return m
}

// --- 스토어 -----------------------------------------------------------------

export function createAssemblyStore(product: ProductDef): AssemblyStore {
  let sequenceTimer: ReturnType<typeof setTimeout> | null = null
  const clearSequence = () => {
    if (sequenceTimer) clearTimeout(sequenceTimer)
    sequenceTimer = null
  }

  return createStore<AssemblyState>((set, get) => ({
    product,
    mounted: initialMounted(product),
    history: [],
    selectedPartId: nextAvailablePartId(product, initialMounted(product)),
    phase: 'assembly',
    phaseAt: 0,
    lastMount: null,
    dragging: false,
    dragTarget: null,
    sequencing: false,

    selectPart: (partId) => {
      if (partId === null) return set({ selectedPartId: null })
      const part = product.parts.find((p) => p.id === partId)
      if (!part || !isPartAvailable(product, get().mounted, part)) return
      set({ selectedPartId: partId })
    },

    mount: (instanceId, from, variantId) => {
      const state = get()
      if (state.phase !== 'assembly') return false
      if (state.mounted[instanceId]) return false
      const part = partOf(product, instanceId)
      if (!isPartAvailable(product, state.mounted, part)) return false
      if (part.variants) {
        if (!variantId || !part.variants.some((v) => v.id === variantId)) return false
      }
      const record: MountRecord = { instanceId, at: now() }
      if (from) record.from = from
      if (variantId) record.variant = variantId
      const mounted = { ...state.mounted, [instanceId]: record }
      const complete = isPartComplete(mounted, part)
      const allDone = isAssemblyComplete(product, mounted)
      set({
        mounted,
        history: [...state.history, instanceId],
        lastMount: { partId: part.id, at: now() },
        selectedPartId: complete ? nextAvailablePartId(product, mounted) : state.selectedPartId,
        phase: allDone ? 'complete' : 'assembly',
        phaseAt: allDone ? now() : state.phaseAt,
      })
      return true
    },

    mountAll: (partId, intervalMs = 20) => {
      const part = product.parts.find((p) => p.id === partId)
      if (!part || get().sequencing || part.variants) return
      const remaining = part.instances.filter((i) => !get().mounted[i.id]).sort((a, b) => a.order - b.order)
      if (remaining.length === 0) return
      set({ sequencing: true })
      let idx = 0
      const step = () => {
        if (idx >= remaining.length || get().phase !== 'assembly') {
          sequenceTimer = null
          set({ sequencing: false })
          return
        }
        get().mount(remaining[idx].id)
        idx++
        sequenceTimer = setTimeout(step, intervalMs)
      }
      step()
    },

    undo: () => {
      const state = get()
      if (state.phase !== 'assembly' && state.phase !== 'complete') return
      if (state.sequencing) clearSequence()
      const last = state.history[state.history.length - 1]
      if (!last) return
      const mounted = { ...state.mounted }
      delete mounted[last]
      set({
        mounted,
        history: state.history.slice(0, -1),
        selectedPartId: partOf(product, last).id,
        phase: 'assembly',
        sequencing: false,
        lastMount: null,
      })
    },

    setDragging: (dragging) => set({ dragging }),
    setDragTarget: (dragTarget) => {
      if (get().dragTarget !== dragTarget) set({ dragTarget })
    },

    advancePhase: () => {
      const { phase } = get()
      const seq = product.phasesAfterComplete
      if (phase === 'assembly') return
      const next = phase === 'complete' ? seq[0] : seq[seq.indexOf(phase) + 1]
      if (!next) return
      set({ phase: next, phaseAt: now(), selectedPartId: null })
    },

    reset: () => {
      clearSequence()
      const mounted = initialMounted(product)
      set({
        mounted,
        history: [],
        selectedPartId: nextAvailablePartId(product, mounted),
        phase: 'assembly',
        phaseAt: now(),
        lastMount: null,
        dragging: false,
        dragTarget: null,
        sequencing: false,
      })
    },
  }))
}
```

- [ ] **Step 4: context.tsx 구현**

```tsx
// src/engine/context.tsx
import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useStore } from 'zustand'
import { createMaterialRegistry, type MaterialRegistry } from './materials'
import type { AssemblyState, AssemblyStore } from './store'
import type { ProductDef } from './types'

interface Ctx {
  product: ProductDef
  store: AssemblyStore
  materials: MaterialRegistry
}

const AssemblyContext = createContext<Ctx | null>(null)

export function AssemblyProvider({ product, store, children }: { product: ProductDef; store: AssemblyStore; children: ReactNode }) {
  const value = useMemo<Ctx>(() => ({ product, store, materials: createMaterialRegistry(product.materials) }), [product, store])
  return <AssemblyContext.Provider value={value}>{children}</AssemblyContext.Provider>
}

function useCtx(): Ctx {
  const c = useContext(AssemblyContext)
  if (!c) throw new Error('AssemblyProvider missing')
  return c
}

export const useProduct = () => useCtx().product
export const useAssemblyStore = () => useCtx().store
export const useMaterials = () => useCtx().materials
export function useAssembly<T>(selector: (s: AssemblyState) => T): T {
  return useStore(useCtx().store, selector)
}
```

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run src/engine && npx tsc --noEmit`
Expected: 스토어 테스트 전부 PASS(기존 25개 상당 + 신규 5개). tsc 통과(옛 `src/store/assembly.ts`는 아직 남아 있고 옛 UI가 쓴다).

- [ ] **Step 6: 커밋**

```bash
git add src/engine/store.ts src/engine/store.test.ts src/engine/context.tsx src/products/keyboard/index.ts
git commit -m "제품을 인자로 받는 조립 스토어와 컨텍스트 추가

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: 엔진 씬 컴포넌트 (작업대, 장착, 고스트, 드래그, 카메라, 환경)

**Files:**
- Create (기존에서 이동·수정): `src/engine/scene/controlsRef.ts`, `Environment.tsx`, `CameraRig.tsx`, `MountedParts.tsx`, `Ghosts.tsx`, `DraggablePart.tsx`, `Stations.tsx`, `Assembly.tsx`, `Scene.tsx`
- Test: `src/engine/scene/stationMath.test.ts` (드래그 판정 순수 함수)

**Interfaces:**
- Consumes: Task 1~4 전부. 특히 `useAssembly`, `useAssemblyStore`, `useProduct`, `useMaterials`, `stationOffset`, `PartGeometry`, `ghostMaterial`
- Produces:
  - `<Scene>` — Canvas. 내부에 `<Lights/><Floor/><Assembly/><DraggablePart/><product.Finale/><CameraRig/>`
  - `<Assembly>` — 작업대별 그룹: 소품 + 장착 인스턴스 + 선택 부품 고스트
  - `<MountedInstanceView part inst record>` — `product.renderInstance` 결과가 있으면 그것을, 없으면 `<PartGeometry>`
  - `controlsRef.ts`: `setControlsEnabled(bool)`, `cancelCameraTween()` (기존과 동일)
  - `resolveDragTargets(part, posMm: Vec3, drag: DragConfig, mounted): { snap: string | null; paint: string[] }` 순수 함수 (테스트 대상)

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// src/engine/scene/stationMath.test.ts
import { describe, expect, it } from 'vitest'
import { PART_BY_ID } from '../../products/keyboard/parts'
import { resolveDragTargets } from './dragMath'

const drag = { snapMm: 60, paintMm: 12, hoverMm: 30, grabMinMm: 50 }

describe('resolveDragTargets', () => {
  it('snaps a single part when within snapMm horizontally', () => {
    const pcb = PART_BY_ID.pcb
    expect(resolveDragTargets(pcb, [30, 999, 40], drag, {}).snap).toBe('pcb')
    expect(resolveDragTargets(pcb, [61, 0, 0], drag, {}).snap).toBeNull()
    expect(resolveDragTargets(pcb, [0, 0, 0], drag, { pcb: { instanceId: 'pcb', at: 0 } }).snap).toBeNull()
  })

  it('paints every unmounted multi instance within paintMm', () => {
    const sw = PART_BY_ID.switch
    const q = sw.instances.find((i) => i.tag === 'q')!
    const [x, , z] = q.mountPosition
    const r = resolveDragTargets(sw, [x + 5, 0, z - 5], drag, {})
    expect(r.snap).toBeNull()
    expect(r.paint).toEqual(['switch:q'])
    expect(resolveDragTargets(sw, [x + 5, 0, z - 5], drag, { 'switch:q': { instanceId: 'switch:q', at: 0 } }).paint).toEqual([])
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/engine/scene`
Expected: FAIL — `./dragMath` 없음

- [ ] **Step 3: dragMath.ts 작성**

```ts
// src/engine/scene/dragMath.ts
import type { Mounted } from '../store'
import type { DragConfig, PartDef, Vec3 } from '../types'

export interface DragTargets {
  /** 단일 부품: 놓으면 장착될 인스턴스 */
  snap: string | null
  /** 다수 부품: 지금 지나가고 있어 장착할 인스턴스들 */
  paint: string[]
}

/** 커서가 가리키는 위치(mm, 작업대 오프셋 제거된 부품 로컬 좌표)에 대한 장착 판정. 수평 거리만 본다. */
export function resolveDragTargets(part: PartDef, pos: Vec3, drag: DragConfig, mounted: Mounted): DragTargets {
  const dist = (p: Vec3) => Math.hypot(pos[0] - p[0], pos[2] - p[2])
  if (part.count === 1) {
    const inst = part.instances[0]
    if (mounted[inst.id]) return { snap: null, paint: [] }
    return { snap: dist(inst.mountPosition) <= drag.snapMm ? inst.id : null, paint: [] }
  }
  const paint: string[] = []
  for (const inst of part.instances) {
    if (mounted[inst.id]) continue
    if (dist(inst.mountPosition) <= drag.paintMm) paint.push(inst.id)
  }
  return { snap: null, paint }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/engine/scene`
Expected: PASS

- [ ] **Step 5: 씬 파일 이동 및 일반화**

아래 순서로 옮기고 고친다. 모든 파일에서 `../data/parts`·`../products/keyboard/parts`·`../store/assembly` import를 제거하고 `useProduct()`, `useAssembly`, `useAssemblyStore()`, `useMaterials()`를 쓴다. `useAssembly.getState()` 패턴은 `const store = useAssemblyStore()` 후 `store.getState()`로.

**controlsRef.ts**: `git mv src/scene/controlsRef.ts src/engine/scene/controlsRef.ts`. 내용 그대로.

**Environment.tsx**: `git mv src/scene/Environment.tsx src/engine/scene/Environment.tsx`. `Floor`에서 `CASE_W`, `CASE_D` 대신 `useProduct().environment.contactShadowSizeMm`를, `Lights`의 shadow-camera 범위(`±30`)는 `environment.shadowBoundsMm * MM`으로, `shadow-camera-far`는 `shadowBoundsMm * MM * 4`로. 조명 위치도 범위에 비례시킨다: `const r = shadowBoundsMm * MM; 키라이트 position [r*0.93, r*1.33, r*0.73], 림라이트 [-r, r*0.6, -r*0.87]` (키보드 r=30일 때 기존값과 같다). 환경맵 Lightformer 위치도 같은 비율로 곱한다.

**CameraRig.tsx**: `git mv src/scene/CameraRig.tsx src/engine/scene/CameraRig.tsx`.
- 상수 `MIN_POLAR/MAX_POLAR/MIN_DIST/MAX_DIST`와 `COMPLETE_VIEW/HERO_VIEW`를 제거하고 `const { camera: cfg } = useProduct()`에서 읽는다. 완료·후속 단계 카메라는 제품이 `Finale` 안에서 필요하면 직접 움직이므로 엔진은 `lastMount`/`selectedPartId` 규칙만 처리한다.
- `viewToPosition(view, target, cfg)`: 극각은 `[cfg.minPolarDeg, cfg.maxPolarDeg]`, 거리는 `[cfg.minDistanceMm, cfg.maxDistanceMm] * MM`로 클램프.
- 주시점: `view.target`이 있으면 `target * MM`, 없으면 `[0, (part.mountPosition[1] + offset[1]) * 0.6, 0]`가 아니라 **부품 장착 위치 + 작업대 오프셋**을 그대로 쓴다: `const off = stationOffset(product, part, mounted); target = (mountPosition + off) * MM`. (키보드는 각 부품 `cameraView`에 `target`을 넣어 지금 화면과 같은 프레이밍을 유지한다 — Task 7에서 `target: [0, y*0.6, 0]`을 데이터에 넣는다.)
- `OrbitControls` props: `minPolarAngle={cfg.minPolarDeg*DEG}` 등, `target={cfg.target.map(v => v*MM)}`.
- 카메라 초기 위치는 `Scene`에서 `viewToPosition(cfg.initial, cfg.target)`로 계산해 `Canvas camera.position`에 넣는다. 이 함수는 export한다.

**Stations.tsx** (신규):
```tsx
// src/engine/scene/Stations.tsx
import { useEffect, useRef, type ReactNode } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useAssembly, useMaterials, useProduct } from '../context'
import { easeOutBack, lerp } from '../easing'
import { PartGeometry } from '../geometry/PartGeometry'
import { isStationSeated } from '../store'
import { MM, type StationDef } from '../types'

export const SEAT_MS = 350

/** 작업대 그룹. 결합 전에는 offset, 결합되면 0으로 0.35초에 내려앉는다. 되돌리면 다시 떠오른다. */
export function StationGroup({ station, children }: { station: StationDef; children: ReactNode }) {
  const group = useRef<THREE.Group>(null)
  const product = useProduct()
  const seated = useAssembly((s) => isStationSeated(product, s.mounted, station.id))
  const off = new THREE.Vector3(station.offset[0] * MM, station.offset[1] * MM, station.offset[2] * MM)
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

/** 작업대 소품(엔진 스탠드 등)과 제품 고정 소품(지그). 장착 대상이 아니다. */
export function Props() {
  const product = useProduct()
  const materials = useMaterials()
  return (
    <group>
      {product.stations.map((s) =>
        s.prop ? (
          <group key={s.id} position={[s.offset[0] * MM, 0, s.offset[2] * MM]}>
            <PartGeometry geometry={s.prop} material={materials.get(s.propMaterial ?? 'steel')} materials={materials} />
          </group>
        ) : null,
      )}
      {(product.props ?? []).map((p, i) => (
        <group key={i} position={[p.position[0] * MM, p.position[1] * MM, p.position[2] * MM]}>
          <PartGeometry geometry={p.geometry} material={materials.get(p.material)} materials={materials} />
        </group>
      ))}
    </group>
  )
}
```

작업대 소품은 작업대의 x/z 오프셋 위치, 지면(y=0)에 놓인다(오프셋의 y는 부품 리프트용).

**Assembly.tsx** (신규, 기존 `Keyboard.tsx` 대체):
```tsx
// src/engine/scene/Assembly.tsx
import { useAssembly, useProduct } from '../context'
import type { PartDef } from '../types'
import { GhostSet } from './Ghosts'
import { MountedInstanceView } from './MountedParts'
import { Props, StationGroup } from './Stations'

export function Assembly() {
  const product = useProduct()
  const selectedPartId = useAssembly((s) => s.selectedPartId)
  const selected = selectedPartId ? product.parts.find((p) => p.id === selectedPartId) ?? null : null
  const free = product.parts.filter((p) => !p.station && !p.hidden)
  return (
    <group>
      <Props />
      <group>
        {free.map((p) => <MountedPart key={p.id} part={p} />)}
        {selected && !selected.station && !selected.hidden ? <GhostSet part={selected} /> : null}
      </group>
      {product.stations.map((st) => (
        <StationGroup key={st.id} station={st}>
          {product.parts.filter((p) => p.station === st.id && !p.hidden).map((p) => <MountedPart key={p.id} part={p} />)}
          {selected && selected.station === st.id && !selected.hidden ? <GhostSet part={selected} /> : null}
        </StationGroup>
      ))}
    </group>
  )
}

function MountedPart({ part }: { part: PartDef }) {
  const mounted = useAssembly((s) => s.mounted)
  return (
    <>
      {part.instances.map((inst) => {
        const rec = mounted[inst.id]
        return rec ? <MountedInstanceView key={inst.id} part={part} inst={inst} record={rec} /> : null
      })}
    </>
  )
}
```

**MountedParts.tsx**: `git mv src/scene/MountedParts.tsx src/engine/scene/MountedParts.tsx`.
- `Keycap` 컴포넌트와 `playKeyPress`, `rgb` import를 제거한다(Task 7에서 제품으로 간다).
- 시작점 계산의 `lift`는 `part.station ? (product.stations.find(s => s.id === part.station)?.offset ?? [0,0,0]) : [0,0,0]`을 벡터로 빼는 것으로 바꾼다(y만이 아니라 x/z도).
- 본문:
```tsx
const product = useProduct()
const materials = useMaterials()
const custom = product.renderInstance?.({ part, inst, record })
const body = custom ?? <PartGeometry geometry={inst.geometry} material={materials.get(part.material)} materials={materials} />
```
- 애니메이션 상수(`MOUNT_MS`, `DROP_MM`, `ARC_MM`)는 유지. `DROP_MM`은 `product.drag.hoverMm`로 대체한다(잡고 있던 높이에서 내려앉는 것이 자연스럽다).

**Ghosts.tsx**: `git mv src/scene/Ghosts.tsx src/engine/scene/Ghosts.tsx`. import만 엔진으로. `PartGeometry`에 `materials={useMaterials()}`는 넘기지 않는다(고스트는 전부 고스트 재질).

**DraggablePart.tsx**: `git mv src/scene/DraggablePart.tsx src/engine/scene/DraggablePart.tsx`.
- `SNAP_MM/PAINT_MM/HOVER_MM/GRAB_MIN_MM` 상수 제거 → `const { drag } = useProduct()`.
- `lift` 계산을 `const off = stationOffset(product, part, mounted)`로 바꾸고, 호버 높이 `hoverY = (part.mountPosition[1] + off[1] + drag.hoverMm) * MM`.
- `resolveTargets` 함수 본문을 `resolveDragTargets(part, [px - off[0], py, pz - off[2]], drag, s.mounted)`로 바꾼다. 결과의 `snap`은 `setDragTarget`, `paint`는 각각 `s.mount(id, [px - off[0], py - off[1], pz - off[2]])`. 단일 부품 드롭 시 `from`도 같은 방식으로 오프셋을 뺀 값.
- `hidden` 부품이 선택되면 렌더하지 않는다(`if (part.hidden) return null`). 변형 부품(`variants`)도 드래그하지 않는다 — HUD의 선택기로 장착한다.
- 재질은 `useMaterials().get(part.material)`.

**Scene.tsx**: `git mv src/scene/Scene.tsx src/engine/scene/Scene.tsx`.
```tsx
import { Canvas } from '@react-three/fiber'
import { useProduct } from '../context'
import { MM } from '../types'
import { Assembly } from './Assembly'
import { CameraRig, viewToPosition } from './CameraRig'
import { DraggablePart } from './DraggablePart'
import { Floor, Lights } from './Environment'

export function Scene() {
  const product = useProduct()
  const { Finale, camera } = product
  const pos = viewToPosition(camera.initial, [camera.target[0] * MM, camera.target[1] * MM, camera.target[2] * MM], camera)
  return (
    <Canvas shadows dpr={[1, 2]} camera={{ position: [pos.x, pos.y, pos.z], fov: 32, near: 0.5, far: camera.maxDistanceMm * MM * 6 }} gl={{ antialias: true, powerPreference: 'high-performance' }}>
      <color attach="background" args={['#0A0A0B']} />
      <Lights />
      <Floor />
      <Assembly />
      <DraggablePart />
      <Finale />
      <CameraRig />
    </Canvas>
  )
}
```

옛 `src/scene/Keyboard.tsx`, `src/scene/PartGeometry.tsx`, `src/scene/materials.ts`는 이 태스크에서 삭제하지 않는다(옛 App이 아직 쓴다). 옛 App은 Task 8에서 교체한다. 그때까지 새 씬은 컴파일만 되면 된다.

- [ ] **Step 6: 검사**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 통과. (옛 코드와 새 코드가 공존. 옛 코드가 `src/scene/controlsRef.ts` 등 이동한 파일을 import하면 옛 파일의 import 경로를 `../engine/scene/controlsRef`로 고친다.)

- [ ] **Step 7: 커밋**

```bash
git add -A src
git commit -m "엔진 씬 컴포넌트: 작업대 그룹, 제품 설정 기반 카메라·환경·드래그

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: 엔진 UI (Tray, Hud, VariantPicker) + ProductApp

**Files:**
- Create: `src/engine/ui/Tray.tsx`, `src/engine/ui/Hud.tsx`, `src/engine/ui/VariantPicker.tsx`, `src/engine/ProductApp.tsx`
- Modify: `src/styles.css` (변형 선택기·모델 선택 링크 스타일 추가)

**Interfaces:**
- Consumes: `useAssembly`, `useAssemblyStore`, `useProduct`, `isPartComplete`, `isPartAvailable`, `mountedCount`
- Produces:
  - `<ProductApp product onBack>` — `createAssemblyStore(product)`를 `useMemo`로 만들고 `AssemblyProvider`로 감싼 뒤 `<Scene/><Hud onBack/><Tray/>`. 개발 모드에서 `window.__assembly = store`.
  - `<VariantPicker part>` — `part.variants` 버튼 목록. 클릭 시 `store.getState().mount(part.instances[0].id, undefined, variant.id)`.

- [ ] **Step 1: Tray 이동**

`git mv src/ui/Tray.tsx src/engine/ui/Tray.tsx`. `PARTS` → `useProduct().parts`, `isPartAvailable(mounted, p)` → `isPartAvailable(product, mounted, p)`. 그리드 열 수는 부품 수에 맞춘다: `style={{ gridTemplateColumns: \`repeat(${Math.min(parts.length, 10)}, minmax(0, 1fr))\` }}`. 부품이 10개를 넘으면 트레이가 가로 스크롤되도록 `.tray`에 `overflow-x: auto`를 두고, 그 경우 `grid-auto-flow: column; grid-auto-columns: minmax(120px, 1fr)`로 바꾼다:
```tsx
const cols = parts.length <= 10 ? parts.length : 10
<div className="tray" style={parts.length <= 10 ? { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` } : { gridAutoFlow: 'column', gridAutoColumns: 'minmax(120px, 1fr)', overflowX: 'auto' }}>
```
`hidden` 부품(도색)도 트레이에는 보인다.

- [ ] **Step 2: Hud 이동 및 수정**

`git mv src/ui/Hud.tsx src/engine/ui/Hud.tsx`.
- `hintFor()`를 컴포넌트 안으로 옮기고 스토어에서 읽는다:
```tsx
function useHint(): string {
  const product = useProduct()
  const phase = useAssembly((s) => s.phase)
  const selectedPartId = useAssembly((s) => s.selectedPartId)
  const mounted = useAssembly((s) => s.mounted)
  if (phase !== 'assembly') return product.hints[phase] ?? ''
  if (selectedPartId) return product.parts.find((p) => p.id === selectedPartId)?.hint ?? ''
  const next = product.parts.find((p) => !isPartComplete(mounted, p))
  return next ? `${next.nameKo} 선택` : ''
}
```
- 타이틀: `product.nameEn.toUpperCase()`, 부제 `${product.nameKo} · ${product.subtitle}`.
- 좌상단에 `onBack` 링크 버튼 추가: `<button className="btn btn-quiet hud-back" onClick={onBack}>모델 선택</button>`.
- 선택 부품에 `variants`가 있으면 `전부 장착` 대신 `<VariantPicker part={selected} />`.

- [ ] **Step 3: VariantPicker 작성**

```tsx
// src/engine/ui/VariantPicker.tsx
import { useAssemblyStore } from '../context'
import type { PartDef } from '../types'

export function VariantPicker({ part }: { part: PartDef }) {
  const store = useAssemblyStore()
  if (!part.variants) return null
  return (
    <div className="variants">
      {part.variants.map((v) => (
        <button key={v.id} className="variant" onClick={() => store.getState().mount(part.instances[0].id, undefined, v.id)}>
          <span className="variant-swatch" style={{ background: v.swatch }} />
          <span className="variant-label">{v.label}</span>
        </button>
      ))}
    </div>
  )
}
```

CSS 추가(`src/styles.css` 끝):
```css
/* --- Variants ------------------------------------------------------------- */
.variants { display: flex; gap: 8px; pointer-events: auto; }
.variant { display: flex; align-items: center; gap: 8px; font: inherit; font-size: 11px; letter-spacing: 0.06em; color: var(--fg); background: transparent; border: 1px solid var(--line-strong); border-radius: 2px; padding: 6px 10px 6px 6px; cursor: pointer; }
.variant:hover { border-color: var(--fg); }
.variant-swatch { width: 18px; height: 18px; border-radius: 2px; border: 1px solid rgba(255,255,255,0.15); }
.hud-back { margin-top: 10px; padding-left: 0; }
```

- [ ] **Step 4: ProductApp 작성**

```tsx
// src/engine/ProductApp.tsx
import { useEffect, useMemo } from 'react'
import { AssemblyProvider } from './context'
import { Scene } from './scene/Scene'
import { createAssemblyStore } from './store'
import type { ProductDef } from './types'
import { Hud } from './ui/Hud'
import { Tray } from './ui/Tray'

export function ProductApp({ product, onBack }: { product: ProductDef; onBack: () => void }) {
  const store = useMemo(() => createAssemblyStore(product), [product])
  useEffect(() => {
    // 개발 중 콘솔에서 상태를 만지기 위한 훅. 프로덕션 번들에는 들어가지 않는다.
    if (import.meta.env.DEV) (window as unknown as { __assembly?: unknown }).__assembly = store
  }, [store])
  return (
    <AssemblyProvider product={product} store={store}>
      <div className="app">
        <Scene />
        <Hud onBack={onBack} />
        <Tray />
      </div>
    </AssemblyProvider>
  )
}
```

- [ ] **Step 5: 검사**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 통과 (옛 App은 아직 옛 UI를 씀; 옛 `src/ui/*`가 이동돼 사라졌으므로 옛 `src/App.tsx`의 import를 임시로 새 `ProductApp`으로 바꾸지 말고, 옛 App이 깨지면 Task 8까지 `src/App.tsx`를 `export default function App() { return null }`로 두어도 된다 — 단 커밋 전 빌드는 통과해야 한다.)

- [ ] **Step 6: 커밋**

```bash
git add -A src
git commit -m "엔진 UI와 ProductApp 추가, 변형 선택기 도입

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: 키보드 제품 완성 (Finale, 키캡 renderInstance, 사운드, 카메라 타깃)

**Files:**
- Create: `src/products/keyboard/finale/Finale.tsx`, `finale/Cable.tsx`(이동), `finale/PlateGlow.tsx`(이동), `finale/rgb.ts`(이동), `finale/Keycap.tsx`
- Move: `src/audio/switchSound.ts` → `src/products/keyboard/audio/switchSound.ts`
- Modify: `src/products/keyboard/index.ts`, `src/products/keyboard/parts.ts` (cameraView.target)
- Test: `src/products/keyboard/product.test.ts`

**Interfaces:**
- Consumes: `useAssembly`, `useAssemblyStore`, `useMaterials`, `RenderInstanceCtx`, `advancePhase`
- Produces: 완성된 `keyboardProduct: ProductDef` (`Finale`, `renderInstance`, `hints`)

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// src/products/keyboard/product.test.ts
import { describe, expect, it } from 'vitest'
import { keyboardProduct } from './index'

describe('keyboardProduct', () => {
  it('references only materials in its table', () => {
    for (const p of keyboardProduct.parts) expect(keyboardProduct.materials[p.material], p.id).toBeDefined()
  })
  it('has a finale and the power phases', () => {
    expect(typeof keyboardProduct.Finale).toBe('function')
    expect(keyboardProduct.phasesAfterComplete).toEqual(['plugging', 'still', 'booting', 'on'])
    expect(keyboardProduct.hints.complete).toBe('케이블 연결')
  })
  it('gives every part a camera target', () => {
    for (const p of keyboardProduct.parts) expect(p.cameraView.target, p.id).toBeDefined()
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/products/keyboard/product.test.ts`
Expected: FAIL (target 없음)

- [ ] **Step 3: 파일 이동**

```bash
mkdir -p src/products/keyboard/finale src/products/keyboard/audio
git mv src/audio/switchSound.ts src/products/keyboard/audio/switchSound.ts
git mv src/scene/Cable.tsx src/products/keyboard/finale/Cable.tsx
git mv src/scene/PlateGlow.tsx src/products/keyboard/finale/PlateGlow.tsx
git mv src/scene/rgb.ts src/products/keyboard/finale/rgb.ts
```
- `switchSound.ts`의 `isStabilizedKey` import는 `'../parts'`.
- `rgb.ts`: `Phase` import는 `'../../../engine/types'`, `RGB_COLOR/RGB_WAVE_COLOR`는 `'../materials'`.
- `Cable.tsx`: `useAssembly.getState()` → `store.getState()` (`const store = useAssemblyStore()`), `plugCable()` → `if (store.getState().phase === 'complete') store.getState().advancePhase()`, `setPhase('still')` 등은 전부 `advancePhase()`. 재질은 `useMaterials().get('cable')`, `get('plug')`. `CABLE`, `MM` import는 `'../parts'`.
- `PlateGlow.tsx`: `useAssembly.getState()` → `store.getState()`.

- [ ] **Step 4: Keycap.tsx 작성 (기존 MountedParts의 Keycap을 옮긴다)**

```tsx
// src/products/keyboard/finale/Keycap.tsx
import { useCallback, useMemo, useRef } from 'react'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { useAssemblyStore, useMaterials } from '../../../engine/context'
import { easeOutCubic } from '../../../engine/easing'
import { PartGeometry } from '../../../engine/geometry/PartGeometry'
import { MM, type RenderInstanceCtx } from '../../../engine/types'
import { playKeyPress } from '../audio/switchSound'
import { applyGlow, keyGlow, makeGlowMaterial } from './rgb'

const KEYPRESS_DEPTH_MM = 3
const KEYPRESS_DOWN_MS = 55
const KEYPRESS_UP_MS = 85

/** 키캡: 발광 슬랩 + 타건. 조립 완료 뒤에만 눌린다. */
export function Keycap({ part, inst }: RenderInstanceCtx) {
  const store = useAssemblyStore()
  const materials = useMaterials()
  const glowMat = useMemo(() => makeGlowMaterial(), [])
  const pressGroup = useRef<THREE.Group>(null)
  const pressAt = useRef<number | null>(null)
  const geo = inst.geometry
  if (geo.type !== 'frustum') throw new Error('keycap must be a frustum')

  useFrame(() => {
    const s = store.getState()
    applyGlow(glowMat, keyGlow(inst.order, s.phase, s.phaseAt, performance.now()))
    const g = pressGroup.current
    if (!g) return
    if (pressAt.current === null) { g.position.y = 0; return }
    const dt = performance.now() - pressAt.current
    let depth: number
    if (dt < KEYPRESS_DOWN_MS) depth = easeOutCubic(dt / KEYPRESS_DOWN_MS)
    else if (dt < KEYPRESS_DOWN_MS + KEYPRESS_UP_MS) depth = 1 - easeOutCubic((dt - KEYPRESS_DOWN_MS) / KEYPRESS_UP_MS)
    else { depth = 0; pressAt.current = null }
    g.position.y = -depth * KEYPRESS_DEPTH_MM * MM
  })

  const onPointerDown = useCallback((e: ThreeEvent<PointerEvent>) => {
    if (store.getState().phase === 'assembly') return
    e.stopPropagation()
    pressAt.current = performance.now()
    playKeyPress(inst.tag ?? inst.id, 0.6 + Math.random() * 0.4)
  }, [inst, store])

  const [bw, bd] = geo.bottom
  return (
    <group
      ref={pressGroup}
      onPointerDown={onPointerDown}
      onPointerOver={(e) => { if (store.getState().phase === 'assembly') return; e.stopPropagation(); document.body.style.cursor = 'pointer' }}
      onPointerOut={() => { document.body.style.cursor = '' }}
    >
      <PartGeometry geometry={geo} material={materials.get(part.material)} />
      <mesh material={glowMat} position={[0, -0.7 * MM, 0]}>
        <boxGeometry args={[(bw + 1) * MM, 1.2 * MM, (bd + 1) * MM]} />
      </mesh>
    </group>
  )
}
```

- [ ] **Step 5: Finale.tsx와 index.ts 완성**

```tsx
// src/products/keyboard/finale/Finale.tsx
import { useEffect, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useAssemblyStore } from '../../../engine/context'
import { Cable, PowerSequence } from './Cable'
import { PlateGlow } from './PlateGlow'

/** 완료 후: 케이블 + 전원 시퀀스 + 플레이트 글로우. 완료·부팅 시 카메라도 여기서 옮긴다. */
export function KeyboardFinale() {
  return (
    <>
      <PlateGlow />
      <Cable />
      <PowerSequence />
      <FinaleCamera />
    </>
  )
}

/** complete: 케이블이 보이는 뷰, booting: 정면 뷰. 사용자가 조작 중이면 CameraRig의 규칙대로 취소된다. */
function FinaleCamera() {
  const store = useAssemblyStore()
  const camera = useThree((s) => s.camera)
  const target = useRef(new THREE.Vector3())
  useEffect(() => {
    return store.subscribe((s, prev) => {
      if (s.phase === prev.phase) return
      if (s.phase === 'complete') target.current.set(-25, 44, 40)
      else if (s.phase === 'booting') target.current.set(6, 38, 44)
      else return
      camera.position.copy(target.current)
    })
  }, [store, camera])
  return null
}
```

`FinaleCamera`는 즉시 이동한다(부드러운 트윈은 `CameraRig`의 `startTween`을 엔진에서 export하는 `requestCameraView(view, targetMm)` 함수로 제공하고 그것을 호출한다. `controlsRef.ts`에 `cameraRequest: { fn: ((view: CameraView, target: Vec3) => void) | null }`을 추가하고 `CameraRig`가 등록한다. `FinaleCamera`는 `requestCameraView({ azimuth: -32, polar: 52, distance: 640 }, [0, 15, 0])`(complete), `({ azimuth: 8, polar: 46, distance: 540 }, [0, 15, 0])`(booting)를 호출한다. 위 코드의 `camera.position.copy` 대신 이 호출을 쓴다.)

```ts
// src/products/keyboard/index.ts (완성본)
import type { ProductDef } from '../../engine/types'
import { KeyboardFinale } from './finale/Finale'
import { Keycap } from './finale/Keycap'
import { KEYBOARD_MATERIALS } from './materials'
import { PARTS, STATIONS } from './parts'

export const keyboardProduct: ProductDef = {
  id: 'keyboard',
  nameKo: '조약돌75',
  nameEn: 'SPM Pebble 75',
  subtitle: '75% 알루미늄 핫스왑',
  parts: PARTS,
  stations: STATIONS,
  materials: KEYBOARD_MATERIALS,
  camera: { initial: { azimuth: 20, polar: 58, distance: 600 }, target: [0, 15, 0], minDistanceMm: 300, maxDistanceMm: 900, minPolarDeg: 20, maxPolarDeg: 80 },
  drag: { snapMm: 60, paintMm: 12, hoverMm: 30, grabMinMm: 50 },
  environment: { contactShadowSizeMm: [600, 450], shadowBoundsMm: 300 },
  Finale: KeyboardFinale,
  renderInstance: (ctx) => (ctx.part.id === 'keycap' ? <Keycap {...ctx} /> : null),
  hints: { complete: '케이블 연결', on: '키캡 타건' },
  phasesAfterComplete: ['plugging', 'still', 'booting', 'on'],
}
```
(`index.ts`에 JSX가 있으므로 파일명을 `index.tsx`로 한다. Task 4에서 만든 `index.ts`를 `git mv`한다.)

`parts.ts`의 각 부품 `cameraView`에 `target`을 추가한다. 값은 기존 CameraRig가 쓰던 `[0, (mountY + lift) * 0.6, 0]`(mm): 하부 케이스 `[0,0,0]`, 하판 폼 `[0, 2.4, 0]`, 스태빌라이저 `[0, 34.6, 0]`, PCB `[0, 33.6, 0]`, PCB 폼 `[0, 34.6, 0]`, 플레이트 `[0, 36.7, 0]`, 스위치 `[0, 37.6, 0]`, 가스켓 `[0, 8.7, 0]`, 상부 케이스 `[0, 13.2, 0]`, 키캡 `[0, 16.3, 0]`.

- [ ] **Step 6: 검사**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 전부 통과. 옛 `src/scene/MountedParts.tsx`가 `Keycap`을 잃어 깨지면 옛 파일에서 `Keycap` 분기를 제거한다.

- [ ] **Step 7: 커밋**

```bash
git add -A src
git commit -m "키보드 제품 정의 완성: 마무리 연출, 키캡 렌더, 사운드 이관

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: 진입 화면, 경로, 옛 코드 제거, 브라우저 확인

**Files:**
- Create: `src/products/index.ts`, `src/entry/ModelSelect.tsx`, `vercel.json`
- Modify: `src/App.tsx`, `src/styles.css`, `index.html`(title)
- Delete: `src/data/`, `src/store/`, `src/scene/`, `src/ui/`, `src/audio/`, `src/utils/`

**Interfaces:**
- Produces: `PRODUCTS: ProductDef[]`, `productForPath(pathname): ProductDef | null`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// src/products/registry.test.ts
import { describe, expect, it } from 'vitest'
import { PRODUCTS, productForPath } from './index'

describe('product registry', () => {
  it('has unique ids and resolves paths', () => {
    expect(new Set(PRODUCTS.map((p) => p.id)).size).toBe(PRODUCTS.length)
    expect(productForPath('/keyboard')?.id).toBe('keyboard')
    expect(productForPath('/keyboard/')?.id).toBe('keyboard')
    expect(productForPath('/')).toBeNull()
    expect(productForPath('/nope')).toBeNull()
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/products/registry.test.ts`
Expected: FAIL

- [ ] **Step 3: 레지스트리·진입 화면·App**

```ts
// src/products/index.ts
import type { ProductDef } from '../engine/types'
import { keyboardProduct } from './keyboard'

export const PRODUCTS: ProductDef[] = [keyboardProduct]

export function productForPath(pathname: string): ProductDef | null {
  const id = pathname.replace(/^\/+|\/+$/g, '')
  return PRODUCTS.find((p) => p.id === id) ?? null
}
```

```tsx
// src/entry/ModelSelect.tsx
import type { ProductDef } from '../engine/types'

export function ModelSelect({ products, onSelect }: { products: ProductDef[]; onSelect: (p: ProductDef) => void }) {
  return (
    <div className="select">
      <div className="select-head">MODEL</div>
      <div className="select-grid">
        {products.map((p) => (
          <button key={p.id} className="select-card" onClick={() => onSelect(p)}>
            <span className="select-en">{p.nameEn}</span>
            <span className="select-ko">{p.nameKo}</span>
            <span className="select-meta">{p.subtitle} · 부품 {p.parts.length}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
```

```tsx
// src/App.tsx
import { useEffect, useState } from 'react'
import { ProductApp } from './engine/ProductApp'
import { ModelSelect } from './entry/ModelSelect'
import { PRODUCTS, productForPath } from './products'

export default function App() {
  const [path, setPath] = useState(() => window.location.pathname)
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  const go = (to: string) => {
    window.history.pushState(null, '', to)
    setPath(to)
  }
  const product = productForPath(path)
  if (!product) return <ModelSelect products={PRODUCTS} onSelect={(p) => go(`/${p.id}`)} />
  return <ProductApp key={product.id} product={product} onBack={() => go('/')} />
}
```

`vercel.json`:
```json
{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }
```

CSS 추가:
```css
/* --- Model select --------------------------------------------------------- */
.select { min-height: 100%; display: flex; flex-direction: column; justify-content: center; padding: 0 12vw; }
.select-head { font-size: 12px; letter-spacing: 0.1em; color: var(--fg-dim); margin-bottom: 24px; }
.select-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 12px; }
.select-card { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; padding: 28px 24px; font: inherit; text-align: left; color: var(--fg); background: var(--panel); border: 1px solid var(--line-strong); border-radius: 2px; cursor: pointer; transition: border-color 120ms; }
.select-card:hover { border-color: var(--fg); }
.select-en { font-size: 14px; letter-spacing: 0.1em; text-transform: uppercase; }
.select-ko { font-size: 12px; opacity: 0.75; }
.select-meta { margin-top: 10px; font-size: 11px; color: var(--fg-dim); letter-spacing: 0.04em; }
```

`index.html`의 `<title>`은 `Assembly`로.

- [ ] **Step 4: 옛 코드 삭제**

```bash
git rm -r src/data src/store src/scene src/ui src/audio src/utils
```
남은 참조가 있으면 tsc가 알려준다. 전부 엔진/제품 경로로 고친다.

- [ ] **Step 5: 검사**

Run: `npx tsc --noEmit && npx vitest run && npx vite build`
Expected: 전부 통과. 테스트 파일: engine/types, engine/materials, engine/geometry/frustum, engine/store, engine/scene/stationMath, products/keyboard/parts, products/keyboard/product, products/registry.

- [ ] **Step 6: 브라우저 확인 (Chrome MCP, `http://localhost:5173`)**

확인 목록(각각 스크린샷 두 장씩 찍어 프레임을 진행시킨 뒤 판단):
1. `/`에 모델 카드가 뜨고, 클릭하면 `/keyboard`로 이동하며 초기 화면에 하부 케이스 고스트와 대기 실물이 보인다.
2. 대기 실물을 고스트로 드래그하면 장착되고 다음 부품이 선택된다(`window.__assembly.getState().history`로 확인).
3. 콘솔에서 `plate`까지 장착한 뒤 스위치 실물을 잡아 플레이트 위를 지나가면 경로의 슬롯이 장착된다.
4. 가스켓 장착 시 샌드위치가 내려앉고, 실행 취소하면 다시 떠오른다.
5. 전부 장착 후 케이블이 보이고, 클릭하면 `on`까지 진행되며 키캡 아래 발광이 보인다. 키캡 클릭에 콘솔 오류가 없다.
6. "모델 선택" 버튼으로 `/`에 돌아오고 브라우저 뒤로가기도 동작한다.

문제가 있으면 고치고 5번 검사를 다시 돌린다.

- [ ] **Step 7: 커밋**

```bash
git add -A
git commit -m "모델 선택 진입 화면과 경로 추가, 옛 키보드 전용 코드 제거

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 8: 푸시 (사용자 확인 후)**

main은 Vercel 프로덕션이다. 빌드 통과를 확인한 뒤 사용자에게 알리고 `git push`.

---

## 자기 검토 결과

- **스펙 커버리지**: 2절 폴더 구조(Task 1~8), 3절 타입(Task 1), 4절 스토어(Task 4), 5절 드래그·카메라(Task 5), 6절 진입 화면·vercel.json(Task 8), 10절 키보드 이관(Task 3·7), 12절 테스트(각 태스크). 7~9절(닌자 400 데이터·마무리·사운드)과 13절은 계획 B.
- **타입 일관성**: `mount(instanceId, from?, variantId?)`, `stationOffset(product, part, mounted)`, `isStationSeated(product, mounted, stationId)`, `resolveDragTargets(part, pos, drag, mounted)`, `useAssembly(selector)`/`useAssemblyStore()`/`useProduct()`/`useMaterials()`를 모든 태스크에서 같은 이름으로 썼다. `RenderInstanceCtx = { part, inst, record }`.
- **플레이스홀더**: 없음. 이동 태스크는 바꿀 항목을 전부 열거했다.
