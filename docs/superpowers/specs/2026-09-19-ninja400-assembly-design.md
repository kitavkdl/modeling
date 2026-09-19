# 닌자 400 조립 + 공통 조립 엔진 설계

작성일 2026-09-19. 상태: 설계 승인 완료(엔진 세분화 반영), 구현 계획 작성 전.

## 1. 목적과 범위

키보드(SPM 조약돌75)로 검증한 "분해된 기계를 드래그로 하나씩 조립하는" 인터랙션을
2018 풀체인지 Kawasaki Ninja 400 3세대(399cc, EX400G)로 확장한다. 실제 오토바이 생산
라인과 최대한 비슷하게: 프레임만 있는 상태에서 시작하고, 엔진·바퀴는 별도 작업대에서
조립한 뒤 프레임에 결합하며, 도색은 마지막이다.

이를 위해 키보드 코드를 제품 무관한 **조립 엔진**과 **제품 정의** 둘로 나눈다.
키보드의 동작은 바뀌지 않아야 한다.

### 하지 않는 것
- 3D 모델 파일 임포트, 물리 엔진, 백엔드, 모바일 대응, 실제 오디오 샘플 (기존 규칙 유지)
- 주행 연출, 서스펜션 동작, 조향
- 부품 선택지(도색 색상 선택은 예외이며 "변형" 메커니즘으로 처리)
- 서브도메인 분리 (나중에 할 예정이므로 제품 모듈 간 의존만 없게 둔다)

### 성공 기준
- 키보드가 리팩터링 전과 동일하게 동작한다 (기존 테스트 통과 + 브라우저 확인).
- 닌자 400을 프레임부터 도색까지 드래그로 조립하고, 키 → 시동 → 스로틀까지 동작한다.
- 부품 치수·순서는 `src/products/ninja400/parts.ts` 하나만 고쳐서 바꿀 수 있다.

## 2. 폴더 구조

```
src/
  engine/                     제품을 모르는 공통 코드
    types.ts                  ProductDef, PartDef, PartInstance, Geometry, StationDef, Variant
    store.ts                  createAssemblyStore(product) — 상태·장착·되돌리기·작업대·변형
    geometry/PartGeometry.tsx 프리미티브 렌더러 (box, roundedBox, cylinder, sphere, cone, torus, frustum, composite)
    scene/                    Scene, Lights/Floor, CameraRig, Ghosts, MountedParts, DraggablePart, Stations
    ui/                       Tray, Hud, VariantPicker
    audio/synth.ts            노이즈 버퍼·컨텍스트 등 공용 Web Audio 도우미
    ProductApp.tsx            제품 하나를 렌더하는 진입 컴포넌트
  products/
    keyboard/                 parts.ts, geometry.ts(통·프레임·스위치 등 composite 생성), materials.ts,
                              finale/(Cable, PowerSequence, PlateGlow, Keycap 상호작용), audio/switchSound.ts, index.ts
    ninja400/                 parts.ts, geometry.ts(트렐리스·휠·엔진 블록 생성), materials.ts,
                              finale/(Key, Starter, Throttle, Dash), audio/engineSound.ts, index.ts
  entry/ModelSelect.tsx       진입 화면
  App.tsx                     경로 → 제품 매핑 (history API, 라우터 라이브러리 없음)
  main.tsx
vercel.json                   SPA 리라이트 (모든 경로 → index.html)
```

제품 폴더는 `engine/`만 import한다. 제품끼리는 import하지 않는다.

## 3. 공통 타입

```ts
type Vec3 = [number, number, number]

type Primitive =
  | { type: 'box'; size: Vec3 }
  | { type: 'roundedBox'; size: Vec3; radius: number }
  | { type: 'cylinder'; radiusTop: number; radiusBottom: number; height: number; segments?: number }
  | { type: 'sphere'; radius: number }
  | { type: 'cone'; radius: number; height: number }
  | { type: 'torus'; radius: number; tube: number }
  | { type: 'frustum'; bottom: [number, number]; top: [number, number]; h: number }   // 키캡, 연료탱크

type Geometry =
  | Primitive
  | { type: 'composite'; children: Array<{ geometry: Geometry; position?: Vec3; rotation?: Vec3; scale?: Vec3; material?: string }> }

interface Variant { id: string; label: string; swatch: string }   // 도색 색상 등

interface PartInstance {
  id: string; mountPosition: Vec3; mountRotation: Vec3; geometry: Geometry
  tag?: string          // 키 id, 좌/우 등 제품이 쓰는 식별자
  order: number         // 순차 장착·웨이브 순서 0~1
}

interface PartDef {
  id: string; nameKo: string; nameEn: string
  geometry: Geometry; material: string
  restPosition: Vec3; mountPosition: Vec3; mountRotation: Vec3
  requires: string[]; count: number; instances: PartInstance[]
  station?: string      // 이 작업대에서 조립된다 (오프셋 위치)
  marries?: string      // 장착 시 이 작업대를 최종 위치로 이동시킨다
  preplaced?: boolean   // 시작부터 장착돼 있다 (닌자 400의 메인 프레임)
  paintable?: boolean   // 도색 변형의 대상
  variants?: Variant[]  // 있으면 트레이 선택 시 변형 선택기가 뜨고, 고르면 장착된다
  hidden?: boolean      // 씬에 렌더하지 않는 절차용 부품 (도색). 고스트·대기 실물도 없다
  cameraView: { azimuth: number; polar: number; distance: number; target?: Vec3 }
  hint: string
}

interface StationDef {
  id: string; nameKo: string
  offset: Vec3          // 조립 중 최종 위치에서 얼마나 떨어져 있는가 (mm)
  prop?: Geometry       // 작업대 자체(엔진 스탠드 등). 장착 대상이 아닌 고정 소품
  propMaterial?: string
}

interface ProductDef {
  id: 'keyboard' | 'ninja400'; nameKo: string; nameEn: string; subtitle: string
  parts: PartDef[]; stations: StationDef[]
  props?: Array<{ geometry: Geometry; position: Vec3; material: string }>   // 지그 등 고정 소품
  materials: Record<string, MaterialSpec>                                    // 제품별 재질표
  camera: { initial: CameraView; target: Vec3; minDistanceMm: number; maxDistanceMm: number; minPolarDeg: number; maxPolarDeg: number }
  drag: { snapMm: number; paintMm: number; hoverMm: number; grabMinMm: number }
  environment: { floorShadowSizeMm: [number, number]; shadowBoundsMm: number }
  Finale: React.ComponentType          // 조립 완료 후의 연출과 상호작용 전부
  renderInstance?: (part, inst, record) => ReactNode | null   // 기본 렌더 대신 쓸 인스턴스 (키캡 발광 등). null이면 기본
  hints: Partial<Record<Phase, string>>
  phasesAfterComplete: string[]       // 제품별 후속 단계 이름. 엔진은 순서만 관리하고 의미는 Finale가 정한다
}
```

`MaterialSpec`은 `MeshStandardMaterialParameters` 또는 `{ physical: true, ...MeshPhysicalMaterialParameters }`.
도색 재질은 변형별로 제품이 만든다.

## 4. 스토어

`createAssemblyStore(product)`가 zustand 스토어를 만든다. 상태와 규칙은 지금과 같고
아래가 추가·변경된다.

- `mounted`는 `preplaced` 부품으로 초기화된다. `reset()`도 같다.
- 가용 판정은 지금처럼 `requires` 전부 완료 && 자신 미완료.
- **작업대**: `stationSeated(stationId)` = `marries === stationId`인 부품이 장착됐는가.
  렌더는 작업대 소속 부품과 고스트를 `<group position=offset>` 아래에 두고, 결합 부품 장착 시
  오프셋을 0으로 0.35초 easeOutBack로 이동한다. 되돌리면 다시 오프셋으로 이동한다.
  키보드는 `sandwich` 작업대(offset [0,45,0])와 `gasket`(marries 'sandwich')로 표현한다.
- **변형**: `mount(instanceId, from?, variantId?)`. `variants`가 있는 부품은 variantId 없이 장착할 수
  없다. `MountRecord.variant`에 기록. 되돌리기는 변형도 함께 지운다.
- **단계(phase)**: `'assembly' | 'complete' | string`. 조립이 끝나면 `'complete'`. 그 뒤 단계는
  `product.phasesAfterComplete` 순서대로 `advancePhase()`로만 전진한다. 되돌리기와 장착은
  `'assembly' | 'complete'`에서만 허용(기존 규칙).
- 드래그 상태(`dragging`, `dragTarget`), 순차 장착(`mountAll`), 자동 선택은 그대로.

## 5. 드래그와 카메라

지금의 DraggablePart를 그대로 쓰되 숫자를 `product.drag`에서 읽는다. 작업대 소속 부품의
호버 높이와 판정 좌표는 작업대 오프셋을 더한 위치를 기준으로 한다(현재 lift 로직의 일반화).
카메라 범위와 초기 뷰는 `product.camera`. 부품별 `cameraView.target`이 있으면 그 점을,
없으면 부품 장착 위치(작업대 오프셋 포함)를 바라본다. 단일 부품은 장착 시, 다수 부품은
선택 시에만 카메라가 움직이는 규칙 유지.

## 6. 진입 화면과 경로

- `/` : 모델 선택. 카드 두 장(영문 대문자 이름 + 트래킹, 아래 한글명과 부품 수). 슬로건 없음.
- `/keyboard`, `/ninja400` : 해당 제품. 알 수 없는 경로는 `/`.
- `history.pushState`로 이동, `popstate`로 복귀. 라우터 라이브러리 없음.
- `vercel.json`: `{"rewrites":[{"source":"/(.*)","destination":"/index.html"}]}`.
- 제품 화면 좌상단 타이틀 아래에 "모델 선택" 텍스트 버튼 하나.

## 7. 닌자 400 제품 정의

### 7.1 좌표계와 제원 (mm, 전부 상수)
- 원점: 앞뒤 바퀴 접지점의 중간, 지면. **+x 앞, +y 위, +z 라이더의 오른쪽.**
- 휠베이스 1,370 → 앞바퀴 중심 x=+685, 뒷바퀴 중심 x=−685.
- 타이어: 앞 110/70-17 (외경 반지름 293), 뒤 150/60-17 (306). 림 반지름 215.9(17인치).
- 앞 브레이크 디스크 310 싱글(좌측, z<0), 뒤 220.
- 포크 41 텔레스코픽, 레이크 24.7°, 트레일 92. 스티어링 헤드 중심 ≈ (600, 900, 0).
- 엔진: 병렬 2기통 DOHC 8밸브, 보어 70.0 × 스트로크 51.8, 실린더 피치 84, 크랭크 중심 ≈ (−120, 430, 0),
  실린더 축 앞쪽으로 20° 기울임. 크랭크케이스 폭(z) 380.
- 시트고 785, 전장 1,990, 전폭 710, 전고 1,120, 연료탱크 14L.
- 프레임: 스틸 트렐리스. 노드 좌표 배열 + 연결 쌍으로 정의하고 지름 28 원통으로 그린다.
- 드라이브: 체인, 스프로킷 14/41. 체인·스프로킷·시프트 레버·사이드스탠드·제너레이터 커버는 좌측(z<0),
  클러치 커버·브레이크 페달·머플러는 우측(z>0).

TODO 주석으로 남길 것: 프레임 노드 좌표, 엔진 마운트 위치, 카울 치수는 실물 확인 전 추정치.

### 7.2 작업대와 소품
| id | 위치(오프셋) | 소품 |
|---|---|---|
| engine | [0, 0, +1100] (카메라 쪽 우측 앞) | 엔진 스탠드: 박스 기둥 2 + 상판 |
| front_wheel | [+900, 0, +600] | 낮은 벤치 박스 |
| rear_wheel | [−900, 0, +600] | 낮은 벤치 박스 |

고정 소품: 프레임 지그(프레임 아래 박스 2개). 메인 프레임은 `preplaced`.

### 7.3 부품 목록과 순서 (requires는 바로 앞 항목; 표시된 곳만 예외)

**A. 프레임**
1. 메인 프레임 (preplaced) — 트렐리스 composite
2. 서브프레임

**B. 엔진 작업대 (station: engine)** — 3부터 29까지 순서대로
3. 크랭크케이스 하부 · 4. 크랭크축 · 5. 밸런서 샤프트 · 6. 변속기 입력축 · 7. 변속기 출력축 ·
8. 시프트 드럼 · 9. 크랭크케이스 상부 · 10. 커넥팅로드 ×2 · 11. 피스톤 ×2 · 12. 실린더 블록 ·
13. 실린더 헤드 · 14. 밸브 ×8 · 15. 캠샤프트 ×2(흡기·배기) · 16. 캠체인 · 17. 캠체인 텐셔너 ·
18. 캠 커버 · 19. 점화플러그 ×2 · 20. 클러치 팩 · 21. 클러치 커버(우) · 22. 제너레이터 로터(좌) ·
23. 제너레이터 커버(좌) · 24. 오일펌프 · 25. 오일팬 · 26. 오일필터 · 27. 스타터 모터 ·
28. 워터펌프 · 29. 드라이브 스프로킷(좌)
30. **엔진 마운트 볼트** ×4 (marries: engine; requires 29와 2) — 장착 완료 시 엔진이 프레임으로 이동

**C. 리어 서스펜션**
31. 스윙암 · 32. 리어 쇼크 · 33. 링크

**D. 프런트 엔드**
34. 스티어링 스템 + 하부 트리플 클램프 · 35. 포크 ×2 · 36. 상부 트리플 클램프 · 37. 클립온 핸들 ×2

**E. 앞바퀴 작업대 (station: front_wheel)**
38. 앞 휠·타이어 · 39. 앞 브레이크 디스크
40. **앞 액슬** (marries: front_wheel; requires 39와 35)
41. 프런트 캘리퍼 · 42. 프런트 펜더 (paintable)

**F. 뒷바퀴 작업대 (station: rear_wheel)**
43. 뒤 휠·타이어 · 44. 리어 디스크 · 45. 리어 스프로킷
46. **뒤 액슬** (marries: rear_wheel; requires 45와 31)
47. 리어 캘리퍼 · 48. 체인 (requires 46과 29)

**G. 냉각**
49. 라디에이터 · 50. 냉각 팬 · 51. 라디에이터 호스 ×2 · 52. 리저브 탱크

**H. 전장**
53. 배터리 · 54. ECU · 55. 계기판 · 56. 헤드라이트 유닛 · 57. 테일라이트 · 58. 방향지시등 ×4

**I. 흡기·연료**
59. 에어박스 · 60. 스로틀 바디 · 61. 연료탱크 (paintable)

**J. 배기**
62. 배기 헤더 ×2 · 63. 집합부 · 64. 머플러(우)

**K. 조작계**
65. 브레이크 페달(우) · 66. 시프트 레버(좌) · 67. 라이더 스텝 ×2 · 68. 동승자 스텝 ×2 ·
69. 사이드스탠드(좌) · 70. 브레이크·클러치 레버 ×2

**L. 외장 (전부 프라이머 회색, paintable 표시된 것만 도색 대상)**
71. 어퍼 카울 (paintable) · 72. 사이드 카울 ×2 (paintable) · 73. 로어 카울 ×2 (paintable) ·
74. 윈드스크린 (반투명) · 75. 테일 카울 (paintable) · 76. 리어 허거 · 77. 라이더 시트 ·
78. 동승자 시트 · 79. 미러 ×2

**M. 도색**
80. 도색 — count 1, hidden(트레이 전용, geometry는 형식상 작은 박스), variants 3개:
   `krt` Lime Green / Ebony (KRT Edition, #69be28), `blue` Candy Plasma Blue (#1d3f9e),
   `black` Metallic Spark Black (#1a1b1e).
   장착 시 paintable 인스턴스가 x 좌표 큰 순(앞→뒤)으로 0.15초 간격으로 프라이머 → 도색 재질로 바뀐다.

부품 항목 80개, 인스턴스 약 100개. 수량 부품은 모두 드래그 연속 장착 대상.

### 7.4 대기 위치
- 프레임 관련·서스펜션·외장 등 큰 부품: 차체 뒤쪽 [−200, 0, −900] 근처
- 엔진 내부 부품: 엔진 스탠드 옆 [+400, 300, +1100] (작업대 오른쪽)
- 바퀴 부품: 각 벤치 옆
- 작은 부품(볼트·밸브·플러그·지시등): 카메라 쪽 [0, 0, +1500]

### 7.5 재질표
| 이름 | 사양 |
|---|---|
| frame_paint | 검정 반광 (metalness 0.4 / roughness 0.45) |
| cast_alu | 주조 알루미늄 (0.7 / 0.5, #8b8f94) |
| polished_alu | 광택 알루미늄 (0.9 / 0.3) |
| steel | 스틸 (0.85 / 0.4, #a9adb3) |
| stainless | 디스크·헤더 (0.9 / 0.35, #c5c8cc) |
| rubber | 타이어 (0 / 0.95, #151617) |
| plastic_black | 검정 플라스틱 (0 / 0.6, #1e1f22) |
| primer | 프라이머 회색 (0 / 0.9, #7a7b7d) |
| paint_<variant> | MeshPhysicalMaterial, 색상별, metalness 0.6 / roughness 0.3 / clearcoat 1 |
| glass | 윈드스크린 (투명, opacity 0.35) |
| lamp_off / lamp_on | 램프: 꺼짐 회색 / 켜짐 emissive |

## 8. 마무리 연출 (Finale, phasesAfterComplete = ['keyed', 'running'])

1. **complete**: 이그니션 키(원통 + 납작 박스)가 계기판 앞 공중에 나타난다. 힌트 "키 삽입".
2. **키 드래그** → 계기판 옆 키실린더 스냅 영역(150mm)에 놓으면 `advancePhase()` → `keyed`.
   0.3초 뒤 계기판 바(emissive)와 헤드라이트가 켜진다. 힌트 "시동".
3. **시동 버튼**: 우측 클립온 스위치 하우징의 작은 박스. 클릭하면 `advancePhase()` → `running`.
   엔진 그룹이 미세 진동(±0.6mm, 30Hz 근사)하고 `engineSound.start()`. 헤드라이트 유지. 힌트 "스로틀".
4. **스로틀**: 우측 그립을 누른 채 뒤로(−x 화면 방향) 드래그하면 0~1 스로틀. 그립이 최대 60° 회전,
   계기판 바 길이가 rpm에 비례, `engineSound.setThrottle(t)`. 놓으면 0.6초에 걸쳐 공회전으로 복귀.
5. 되돌리기·장착은 `assembly`/`complete`에서만. 키를 꽂은 뒤에는 잠긴다.

## 9. 사운드 플레이스홀더 `engineSound.ts`

인터페이스: `start()`, `setThrottle(t: 0~1)`, `stop()`.
- 공회전 1,300rpm, 최대 10,000rpm. rpm → 초당 점화 = rpm/60 (2기통 4행정, 회전당 1회 점화).
- 180° 크랭크의 불균등 간격: 한 회전 안에서 점화가 180°/540° 간격으로 온다.
  각 점화 = 사인 저역 펄스(60~110Hz, 8ms) + 노이즈 버스트(로우패스 1.2kHz, 12ms).
- 스로틀이 오르면 rpm이 0.25초 시정수로 따라가고, 노이즈 비율과 로우패스 컷오프가 올라간다.
- 마스터: 키보드와 같은 2탭 딜레이. 오디오 파일 없음.
- 스케줄링: `setInterval` 대신 Web Audio 시계로 100ms 앞서 큐잉(백그라운드 탭 스로틀 회피).

## 10. 키보드 이관

- `src/data/parts.ts` → `src/products/keyboard/parts.ts`. 통·프레임·스태빌라이저·스위치·가스켓은
  `geometry.ts`의 함수가 composite로 생성. 키캡은 frustum 프리미티브.
- `subassembly: true` → `station: 'sandwich'`, `seatsAssembly` → `marries: 'sandwich'`.
- 키캡 발광·타건은 `renderInstance`로, 케이블·전원·플레이트 글로우는 `Finale`로.
- 스위치 사운드는 `products/keyboard/audio/switchSound.ts`로 이동, 인터페이스 그대로.
- 기존 테스트는 경로만 바뀌고 전부 통과해야 한다.

## 11. 비주얼

키보드 규칙 그대로(배경 #0A0A0B, 키라이트 1 + 림라이트 1 + 약한 환경광 + 절차적 환경맵,
무한 평면 + ContactShadows, 후처리 없음, 그라데이션·글로우·파티클 금지, 이모지 금지, 한 종류 산세리프,
영문 대문자 + 0.1em 트래킹, 안내 문구는 동사 하나로 끝).
닌자 400은 그림자 카메라 범위와 접촉 그림자 크기를 `environment`에서 키운다.

## 12. 테스트

- `engine/store.test.ts`: 키보드 제품으로 기존 테스트 유지 + 작업대 결합·해제, 변형 장착 거부/허용,
  preplaced 초기화, advancePhase 순서, 변형 되돌리기.
- `products/*/parts.test.ts`: 두 제품 각각 — 고유 id, requires가 앞선 부품만 참조, station이 정의된
  작업대인지, marries 부품이 그 작업대 소속 부품보다 뒤인지, count와 instances 일치, paintable이면
  primer 재질인지, variants 부품은 1개뿐인지.
- `engine/geometry.test.ts`: composite 재귀 깊이와 프리미티브 유효성(양수 치수).
- 브라우저: 두 제품 모두 드래그 장착, 작업대 결합, (닌자) 도색·키·시동·스로틀을 직접 확인.

## 13. 위험과 대응

- **성능**: 인스턴스 100개 × composite 자식 5~30 → 메시 1,000개 안팎. 키보드(400개)의 2.5배.
  문제 시 밸브·볼트처럼 작은 수량 부품부터 InstancedMesh로 전환한다.
- **프리미티브 외장의 조악함**: 프로젝트 전제상 허용. 카울은 박스 2~3개를 회전·스케일해 실루엣만 잡는다.
- **드래그 판정 거리**: 차체가 크므로 `drag` 수치는 브라우저에서 조정한다. 초기값 snap 150 / paint 60 /
  hover 150 / grab 200.
- **백그라운드 탭에서 타이머 스로틀**: 순차 장착·도색 애니메이션은 `performance.now()` 기반으로 렌더
  프레임에서 진행시키고, 사운드는 Web Audio 시계로 큐잉한다.
