# 닌자 400 주행 실물화 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 키 삽입부터 실물 glTF 모델로 바꾸고, 실녹음 샘플 엔진음·타일 바닥·구동계 물리 v2로 주행을 실제처럼 만든다.

**Architecture:** 주행 물리는 순수 함수 `stepRide`(rideModel.ts)가 매 프레임 상태를 굴리고 싱글턴 `ride`에 옮겨 담는 구조를 유지한다. 엔진음은 합성 대신 `public/audio/ninja400/engine/` 뱅크(오프라인 Python 스크립트가 생성)를 Web Audio로 크로스페이드 재생한다. 실물 모델은 오프라인 gltf-transform 스크립트가 정규화·압축한 `public/models/ninja400/ride.glb`를 제품이 로드하고, 엔진에는 `assemblyHidden` 훅 하나만 추가한다.

**Tech Stack:** Vite 6 / React 18 / TS 5 / @react-three/fiber 8 / drei 9 / three 0.172 / zustand 5 / vitest 3; 오프라인 도구 `@gltf-transform/*` + `sharp`(devDependency), Python 3 + numpy/scipy/soundfile(스크립트 전용, 결과만 커밋).

**Spec:** `docs/superpowers/specs/2026-09-20-ninja400-ride-realism-design.md`

## Global Constraints

- 좌표는 mm, 렌더는 `MM` 배율. +x 앞, +y 위, +z 오른쪽, 지면 y=0. `WHEELBASE = 1370`.
- 엔진(`src/engine/`)은 제품을 import하지 않는다(`boundary.test.ts`).
- 조립 부품 형상은 코드 생성만. **완성차 실물 모델과 오디오 뱅크만 예외**(스펙 §7).
- 어두운 UI 규칙: 이모지·슬로건·그라데이션 금지, 힌트는 "동사-명사" 한국어.
- 커밋 트레일러 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; 파일을 지정해 스테이징(`git add -A` 금지); `npm run dev` 실행 금지(검증은 `npx vite --port 5174 --strictPort --host 0.0.0.0`).
- 기어비: 1차 2.219, 2차 2.929, 1~6단 2.929/2.056/1.619/1.333/1.154/1.037. 아이들 1300, 리미터 12,000.
- 라이선스: 모델 CC-BY 4.0(valvetin) — 크레딧 필수. 오디오 CC0(AlexanderChe 641223, brucehep 724077).
- 모든 새 상수에는 한 줄 한국어 주석(단위 포함).

---

### Task 1: 구동계 물리 v2 (`rideModel.ts`) + 테스트

**Files:**
- Modify: `src/products/ninja400/finale/rideModel.ts` (전면 재작성)
- Modify: `src/products/ninja400/finale/rideState.ts` (필드 추가: `speed`, `distance`; `frontWheelRpm` 파생)
- Modify: `src/products/ninja400/finale/RideControls.tsx` (새 필드 복사)
- Modify: `src/products/ninja400/finale/rideModel.test.ts` (있으면 갱신, 없으면 생성)
- Modify: `src/products/ninja400/product.test.ts` (기어비 상수 확인이 있으면 갱신)

**Interfaces:**
- Produces:
  ```ts
  export const GEAR_RATIOS = [0, 2.929, 2.056, 1.619, 1.333, 1.154, 1.037]
  export const PRIMARY = 2.219
  export const FINAL = 2.929
  export const IDLE_RPM = 1300
  export const MAX_RPM = 12000          // 리미터 = 레드존 시작
  export const REAR_TIRE_R_M = 0.306
  export const FRONT_TIRE_R_M = 0.293
  export const CLUTCH_ENGAGED = 0.6     // 유지 (표시등·clutchHeld 보조)
  export interface RideSim { rpm; throttle; clutch; brake; gear; speed /* m/s */; distance /* m */; stalled; running; lowRpmFor }
  export interface RideInputs { throttleKey; brakeKey; clutchKey; throttleMouse }
  export function stepRide(s: RideSim, input: RideInputs, dt: number): RideSim
  export const gearRatio = (gear) => gear === 0 ? Infinity : PRIMARY * GEAR_RATIOS[gear] * FINAL
  export const wheelRpm = (speed) => speed / (2 * Math.PI * REAR_TIRE_R_M) * 60
  export const frontWheelRpm = (speed) => speed / (2 * Math.PI * FRONT_TIRE_R_M) * 60
  export const speedKmh = (speed) => speed * 3.6
  export const rideLoad = (s: Pick<RideSim,'gear'|'clutch'|'throttle'>) => s.gear === 0 ? 0 : engagement(s.clutch) * s.throttle
  export const engagement = (clutch) => clamp01((0.7 - clutch) / 0.5)
  export function torqueWot(rpm): number   // 선형보간 곡선
  ```
- `shiftUp/shiftDown` 유지. `RideState`는 `RideSim`을 확장하므로 `ride`·`resetRide`에 `speed: 0, distance: 0` 추가. `wheelRpm`은 더 이상 상태가 아니라 파생 — 기존 사용처(`RideParts.tsx` Spinner, `RideGauge`)는 `wheelRpm(ride.speed)`로 바꾼다.

**물리 (스펙 §2 그대로):**

```ts
const MASS = 243            // kg, 차량+라이더
const J_E = 0.03            // kg·m², 엔진 회전 관성
const CD_A = 0.5 * 1.2 * 0.42
const ROLL = 0.015 * MASS * 9.81
const BRAKE_N = 3200
const CLUTCH_CAP = 90       // Nm
const LOCK_EPS = 10         // rad/s
const STALL_HARD = 900
const STALL_SOFT = 1050
const STALL_AFTER_S = 0.4
const TORQUE_CURVE: [number, number][] = [[1000,18],[2000,24],[3000,28],[4000,31],[5000,33],[6000,35],[7000,37],[8000,38],[9000,37.5],[10000,36],[11000,32],[12000,26]]
```

stepRide 순서: 입력 1차 응답(스로틀·클러치·브레이크는 지금 시정수 유지) → `T_e` (리미터·거버너·엔진브레이크 포함) → 저항력 `F_res = CD_A·v² + (v>0 ? ROLL : 0) + brake·BRAKE_N` → 결합 상태 판정(자유/슬립/직결) → 적분(semi-implicit Euler, dt ≤ 0.1은 호출측이 보장) → v ≥ 0 클램프, 정지 시 F_res 중 정적 성분 무시 → distance += v·dt → 스톨 판정 → running=false/stalled면 rpm은 0.2 s 시정수로 0.

- [ ] **Step 1: 실패하는 테스트 작성** — 스펙 §2.7의 9개를 그대로 `rideModel.test.ts`에 쓴다. 보조: `run(s, input, seconds, dt=1/120)`.
- [ ] **Step 2: 실행해 실패 확인** `npx vitest run src/products/ninja400/finale/rideModel.test.ts`
- [ ] **Step 3: rideModel.ts 재작성**, rideState/RideControls/RideParts/RideGauge의 `wheelRpm` 사용처 수정.
- [ ] **Step 4: 전체 테스트·tsc 통과** `npx vitest run && npx tsc --noEmit`
- [ ] **Step 5: 커밋** `주행 물리 v2: 엔진 관성·클러치 슬립·차속으로 rpm 결정`

---

### Task 2: 계기 갱신 + 타일 바닥 + 주행 카메라

**Files:**
- Modify: `src/products/ninja400/finale/RideGauge.tsx` (속도 km/h 큰 숫자, BAR_MAX 13000, REDLINE 12000)
- Create: `src/products/ninja400/render/RoadTiles.tsx`
- Create: `src/products/ninja400/render/tileTexture.ts` (+ `tileTexture.test.ts`)
- Modify: `src/products/ninja400/finale/Finale.tsx` (RoadTiles 마운트, running 카메라 `{azimuth:215, polar:72, distance:3400}`/`[0,600,0]`, running 동안 `fogExp2`)
- Modify: `src/styles.css` (`.gauge-speed`)

**Interfaces:**
- `makeTileCanvas(size = 1024, tiles = 8): HTMLCanvasElement` — 순수 그리기 함수(테스트는 jsdom 없이 `OffscreenCanvas` 유무를 검사하지 않고, `drawTiles(ctx, size, tiles)`를 mock ctx로 호출해 fillRect 호출 수 = tiles² + 1 임을 확인).
- `TILE_MM = 600`, `GROUT_MM = 15`, `TILES_PER_TEX = 8`, `TEX_M = TILE_MM * TILES_PER_TEX / 1000` (= 4.8 m), `ROAD_M = 60`.
- RoadTiles: `phase === 'running'`일 때만; `useMemo`로 CanvasTexture(`wrapS/T = RepeatWrapping`, `repeat = ROAD_M/TEX_M`, `anisotropy = min(8, gl.capabilities.getMaxAnisotropy())`, `colorSpace = SRGBColorSpace`); `useFrame`에서 `map.offset.x = -((ride.distance % TEX_M) / TEX_M)`; 평면은 `rotation=[-π/2, 0, 0]`, y = 0.001 + 0.001, `receiveShadow`. 텍스처 u축이 월드 +x와 일치하도록 평면 회전을 확인(z축 회전 없음).
- fog: `Finale`에서 running일 때만 `<fogExp2 attach="fog" args={['#0A0A0B', 0.045]} />` 렌더(언마운트하면 fog가 null로 돌아가는지 확인 — R3F는 attach 해제 시 원복하지 않으므로 `useThree(s => s.scene)`로 직접 `scene.fog = running ? fog : null`).

- [ ] Step 1: `tileTexture.test.ts` 작성(그리기 호출 수, 색 상수) → 실패 확인
- [ ] Step 2: `tileTexture.ts` 구현 → 통과
- [ ] Step 3: `RoadTiles.tsx`, Finale 카메라·fog, RideGauge 속도 표시, CSS
- [ ] Step 4: `npx vitest run && npx tsc --noEmit`
- [ ] Step 5: 커밋 `주행 타일 바닥·안개·속도계, 뒤 3/4 주행 시점`

---

### Task 3: 엔진음 뱅크 생성 스크립트 + 생성물

**Files:**
- Create: `scripts/build-engine-bank.py`
- Create: `public/audio/ninja400/engine/{1320,2250,2760,3750,4100,4620,5520,6500,7500}.ogg`, `start.ogg`, `stop.ogg`, `bank.json` (스크립트 출력)
- Modify: `.gitignore` (`/ninja400/` 아래 원본은 이미 무시됨; `ninja400/audio/` 포함 확인)

**입력:** `ninja400/audio/641223.mp3`, `ninja400/audio/724077.mp3` (없으면 `https://cdn.freesound.org/previews/641/641223_6598647-hq.mp3`, `https://cdn.freesound.org/previews/724/724077_97550... ` — 정확한 URL은 스크립트가 `https://freesound.org/s/{id}/` 페이지에서 `-hq.mp3` 링크를 긁어 얻는다).

**알고리즘 (스펙 §4.2):**
1. `track_rpm(x, sr)`: 8 kHz 리샘플 → STFT(nperseg 8192, hop 800) → f0 ∈ [15, 230] Hz, 0.5 Hz 간격으로 `Σ_{k=1..6} P(k·f0)/k` 최대 → rpm = f0·60. 에너지 하위 35% 프레임은 무효.
2. `steady_windows(track, tol=0.04, min_s=0.8)` → `[(start_s, dur_s, rpm)]`.
3. 목표 rpm마다: 정속 창 중 |rpm − 목표| 최소이고 |차이| < 6%인 것을 고른다. 없으면 `flatten_from_sweep(target)`: f0가 목표의 ±12% 안인 연속 0.6 s 이상 구간을 골라 40 ms 프레임마다 `resample_poly`로 목표 f0로 맞춰 이어 붙인다.
4. `make_loop(seg, rpm, sr)`: 주기 `P = 60/rpm`, 길이 `N·P`(1.2 ≤ N·P ≤ 2.0)로 자르고, 끝 80 ms를 앞 80 ms와 등파워 크로스페이드로 섞어 루프 이음새 제거. 30 Hz 4차 버터워스 하이패스. RMS −18 dBFS.
5. 원샷: `start` = 641223의 시동 구간(크랭킹 시작 ~ rpm이 1000을 처음 넘은 뒤 0.4 s), `stop` = 마지막 rpm > 800 시각부터 1.2 s. 같은 정규화.
6. `soundfile.write(path, y, 44100, format='OGG', subtype='VORBIS')`. bank.json:
   ```json
   { "loops": [{"rpm": 1320, "file": "1320.ogg"}, ...], "start": "start.ogg", "stop": "stop.ogg",
     "credits": [{"id": 641223, "author": "AlexanderChe", "license": "CC0"}, {"id": 724077, "author": "brucehep", "license": "CC0"}] }
   ```
7. 표 출력: 목표 rpm / 실측 rpm / 출처·구간 / 길이 / 이음새 RMS 차(dB).

- [ ] Step 1: 스크립트 작성(함수 단위, `if __name__ == '__main__'`), `python3 scripts/build-engine-bank.py --out public/audio/ninja400/engine`
- [ ] Step 2: 출력 표 검토 — 실측 rpm이 목표 ±6% 안, 총 용량 ≤ 1 MB. 스펙트로그램 PNG(`--plot`)로 각 루프에 배음이 수평으로 서 있는지 확인.
- [ ] Step 3: 커밋 `엔진음 뱅크 생성 스크립트와 CC0 녹음 기반 루프`

---

### Task 4: 엔진음 v3 런타임 (샘플 크로스페이드)

**Files:**
- Modify: `src/products/ninja400/audio/engineSound.ts` (전면 재작성)
- Create: `src/products/ninja400/audio/bankMix.ts` (+ `bankMix.test.ts`)
- Modify: `src/products/ninja400/audio/engineSound.test.ts` (합성 테스트 삭제, preload/stop 계약만)
- Modify: `src/products/ninja400/product.tsx` 또는 `NinjaFinale` (`engineSound.preload()` 한 번)

**Interfaces:**
```ts
// bankMix.ts
export interface Loop { rpm: number; file: string }
export interface Mix { lower: number; upper: number; t: number }  // loops 인덱스, t∈[0,1]
export function bankMix(rpm: number, loops: Loop[]): Mix
// rpm ≤ loops[0].rpm → {0,0,0}; ≥ 마지막 → {n-1,n-1,0}; 사이 → 선형 t
// engineSound.ts
export function preload(): Promise<void>
export function start(): void; stop(): void; setRpm(rpm): void; setThrottle(t): void; setLoad(l): void; blip(): void
```

동작(스펙 §4.3): 소스 슬롯 2개(`slotA`, `slotB`)에 각각 `{ index, src: AudioBufferSourceNode, gain: GainNode }`. tick(25 ms)마다 `bankMix`로 lower/upper를 얻고, 슬롯이 다른 인덱스를 들고 있으면 새 소스를 임의 오프셋(`buffer.duration·Math.random()`)에서 `loop=true`로 시작하고 옛 소스는 30 ms 페이드 후 `stop`. `playbackRate.setTargetAtTime(rpm/loopRpm, now, 0.02)`, 게인 `cos(t·π/2)`·`sin(t·π/2)`·MASTER. 톤 lowpass `1400 + 4600·throttle` Hz, 게인 `dB(−5 + 5·throttle + 3·load)`. `start()`는 `start.ogg` 원샷 후 0.8 s부터 루프 페이드인(0.3 s). `stop()`은 루프 0.15 s 페이드아웃 + `stop.ogg`. visibilitychange·suspend 처리와 compressor는 기존 코드에서 옮긴다. 뱅크 미준비면 `console.warn` 한 번, 무음.

- [ ] Step 1: `bankMix.test.ts`(경계·중간·단조 연속) → 실패 → 구현 → 통과
- [ ] Step 2: engineSound.ts 재작성, 기존 합성 테스트 삭제/대체, preload 호출 배선
- [ ] Step 3: `npx vitest run && npx tsc --noEmit && npm run build`
- [ ] Step 4: 커밋 `엔진음 v3: 실녹음 루프 크로스페이드, 시동·정지 원샷`

---

### Task 5: 실물 모델 파이프라인 + 런타임 + 엔진 훅 + 크레딧

**전제:** `ninja400/zx6r/scene.gltf`(사용자가 내려받은 Sketchfab glTF)가 있어야 한다. 없으면 스크립트·런타임·훅·크레딧까지 만들고 glb 생성만 남긴다.

**Files:**
- Create: `scripts/prepare-ride-model.mjs`
- Modify: `package.json` (devDependencies: `@gltf-transform/core`, `@gltf-transform/extensions`, `@gltf-transform/functions`, `sharp`, `meshoptimizer`)
- Create: `public/models/ninja400/ride.glb`, `public/models/ninja400/ride.json` (스크립트 출력)
- Modify: `src/engine/types.ts` (`assemblyHidden?`), `src/engine/scene/Assembly.tsx` (훅 적용: 장착 부품·Props 숨김, 고스트 유지)
- Create: `src/products/ninja400/render/RideModel.tsx`, `src/products/ninja400/render/rideLayout.ts`, `src/products/ninja400/onlyKeyLeft.ts` (+ test)
- Modify: `src/products/ninja400/product.tsx` (assemblyHidden, RideModel 마운트 via Finale), `parts.ts` (`ignition_key` mount = `IGNITION`), `Starter.tsx`/`Throttle.tsx` (rideLayout 사용)
- Modify: `src/engine/ui/Hud.tsx` + `src/styles.css` (`.hud-credits`, `ProductDef.credits?: string` — 엔진은 문자열만 보여 준다), `product.tsx`에 credits 문자열
- Modify: `CLAUDE.md` (형상 규칙 예외 한 줄)

**Interfaces:**
```ts
// engine/types.ts
assemblyHidden?: (s: { phase: string; mounted: Mounted }) => boolean
credits?: string   // keyed/running 등 assembly 이후 phase에서 HUD 하단에 표시
// onlyKeyLeft.ts
export const onlyKeyLeft = (mounted: Mounted, parts: PartDef[], keyId = 'ignition_key'): boolean
// rideLayout.ts (mm) — 초기값, 브라우저 보정 대상
export const IGNITION: Vec3 = [540, 980, 60]
export const STARTER_HOUSING: Vec3 = [400, 940, 200]
export const GRIP: Vec3 = [400, 900, 280]
```

**스크립트 단계 (스펙 §1.2):** `node scripts/prepare-ride-model.mjs ninja400/zx6r/scene.gltf --out public/models/ninja400 [--flip] [--tex 2048]`. 바퀴 검출은 접지점 근처 정점(y < minY + 0.02·높이)을 PCA 최장축 좌표로 2-means 군집 → 액슬 x = 군집 평균, 반지름 = 군집 정점의 y 최대치·0.5… 대신 **군집 정점의 x 분산에서 원 맞춤** 없이 단순히 `r = 0.5·(군집 x 범위)`로 잡고 ride.json에 기록한다(런타임 회전축은 액슬 중심 y = r). 스케일 `1370·MM / (rearX − frontX)`. 노드 재구성: 프리미티브 바운딩박스가 `|x − axleX| ≤ r + 20mm` 이고 `y ≤ 2r + 20mm`면 해당 바퀴 노드로 이동(원점을 액슬로 옮겨 회전 중심을 만든다). 그 다음 `textureCompress({encoder: sharp, targetFormat: 'webp', resize: [tex, tex]})`, `meshopt({encoder: MeshoptEncoder, level: 'medium'})`, `write`.

**런타임:** `RideModel`은 `useGLTF(url, undefined, undefined, (loader) => loader.setMeshoptDecoder(MeshoptDecoder))`; 보이는 조건은 `useAssembly(s => product.assemblyHidden!(s))`; 처음 보일 때 0.5 s opacity 페이드(재질 clone·transparent, 끝나면 원복); `useFrame`에서 `wheel_front.rotation.z -= frontWheelRpm/60·2π·dt`, `wheel_rear` 동일. `Suspense` 경계와 `ErrorBoundary`(실패 시 null + warn).

- [ ] Step 1: `onlyKeyLeft.test.ts` → 구현. `types.ts`·`Assembly.tsx` 훅(고스트는 유지, `MountedPart`와 `Props`만 숨김) + 엔진 테스트 1개(assemblyHidden true면 장착 부품 렌더 안 함 — store 단위로 검사 가능한 부분만).
- [ ] Step 2: devDependencies 설치, 스크립트 작성, 실행 → ride.glb ≤ 12 MB, ride.json 확인. `/dev/parts` 뷰어 URL 상수를 ride.glb로 바꿔 시각 확인(개발 전용).
- [ ] Step 3: `RideModel.tsx`, `rideLayout.ts`, Starter/Throttle/parts 좌표 연결, credits HUD, CLAUDE.md 예외.
- [ ] Step 4: `npx vitest run && npx tsc --noEmit && npm run build`
- [ ] Step 5: 커밋 `키 삽입부터 실물 모델(ZX-6R, CC-BY) 표시, 조립체 숨김 훅, 크레딧`

---

### Task 6: 통합 보정 (브라우저)

- [ ] 5174 서버로 키만 남은 상태까지 건너뛰기 → 실물 모델 등장·페이드 확인, 키 고스트가 모델 계기판 위 적절한 곳에 있는지 → `rideLayout` 보정.
- [ ] 시동 → 시동 원샷·아이들 루프(스펙트로그램 대신 `AnalyserNode`로 기본 주파수 로그) → ↑ 가속 시 타일 흐름·속도계·바퀴 회전 → Shift+←/→ 변속 시 rpm 변화 → 스톨.
- [ ] 스크린샷 3장(키 삽입 뷰·주행 뷰·계기) 저장, 사용자에게 전달.
- [ ] 커밋 `주행 뷰 위치 보정` (변경이 있을 때만)
