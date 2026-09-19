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
  /** [반지름, 높이] 점열을 y축 둘레로 회전. 원점은 프로필의 y=0 */
  | { type: 'lathe'; profile: [number, number][]; segments?: number; angle?: number }
  /** Catmull-Rom 경로를 따라가는 관. 원점은 경로 좌표계 원점 */
  | { type: 'tube'; path: Vec3[]; radius: number; segments?: number; radial?: number; closed?: boolean }
  /** xy 다각형을 z로 밀어낸다. z는 -depth/2..+depth/2 */
  | { type: 'extrude'; shape: [number, number][]; depth: number; bevel?: number; holes?: [number, number][][] }
  /** 같은 점 수의 단면들을 차례로 이은 면. closed면 각 단면을 고리로 닫는다 */
  | { type: 'loft'; sections: Vec3[][]; closed?: boolean; smooth?: boolean }

export type CurvedPrimitive = Extract<Primitive, { type: 'lathe' | 'tube' | 'extrude' | 'loft' }>
export const isCurved = (g: Geometry): g is CurvedPrimitive =>
  g.type === 'lathe' || g.type === 'tube' || g.type === 'extrude' || g.type === 'loft'

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
  /** 이 부품이 다 장착되면 넘어갈 phase (마지막 부품에만 의미 있음) */
  phaseOnMount?: string
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
  /** HUD 우하단에 제품이 그리는 DOM(계기 등) */
  hudExtra?: ComponentType
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
      if (g.bevel !== undefined && g.bevel * 2 >= g.depth) out.push(`${prefix}extrude.bevel*2 must be < depth`)
      g.holes?.forEach((h, i) => { if (h.length < 3) out.push(`${prefix}extrude.holes[${i}] needs >= 3 points`) })
      break
    case 'loft': {
      if (g.sections.length < 2) out.push(`${prefix}loft needs >= 2 sections`)
      const n = g.sections[0]?.length ?? 0
      if (n < 3) out.push(`${prefix}loft sections need >= 3 points`)
      g.sections.forEach((s, i) => { if (s.length !== n) out.push(`${prefix}loft.sections[${i}] has ${s.length} points, expected ${n}`) })
      break
    }
    case 'composite':
      g.children.forEach((c, i) => out.push(...validateGeometry(c.geometry, `${prefix}children[${i}].`, depth + 1)))
      break
  }
  return out
}
