# 닌자 400 주행 실물화 설계 (2026-09-20)

사용자 요구 네 가지를 한 스펙으로 묶는다. 조립 단계는 그대로 두고, **키 삽입부터 완성차가 보이는 구간**을 실물처럼 바꾼다.

1. 엔진음이 실제 같지 않다 → **실녹음 샘플 기반 엔진음 v3** (합성 v2 폐기)
2. 모델의 결이 실물과 다르다 → **키 삽입부터는 외부 실물 모델(glTF)로 교체**해 그것으로 주행 연출
3. 시동 후 주행할 때 속도를 체감할 바닥 → **타일 바닥이 속도에 맞춰 흘러간다**
4. 기어를 바꿔도 rpm이 안 변한다 → **구동계 물리 v2** (엔진 관성·클러치·차속·기어비로 rpm이 결정된다)

사용자 결정(2026-09-20): 모델은 **무료 다른 가와사키로 대체**, 엔진음은 **실녹음 샘플을 내가 무료로 수배**.

## 0. 범위 밖

- 조립 단계(작업대·드래그·도색)는 건드리지 않는다. 도색에서 고른 색은 실물 모델의 도장(리버리)에 적용하지 않는다 — 모델의 텍스처를 그대로 쓴다.
- 조향·기울임·코너링 없음. 직진 가감속만 체험한다.
- 라이더 모델 없음.
- 사운드는 배기·흡기 한 계통으로 충분하다 (타이어·바람 소리 없음).

## 1. 실물 모델 교체

### 1.1 출처와 라이선스

- 후보 조사(2026-09-20, Sketchfab 공개 API, `downloadable=true`): 닌자 400 본인은 이미 기각한 스캔 하나뿐. 대체 후보 중 **Kawasaki ninja ZX-6R (valvetin)** 을 고른다 — CC-BY 4.0, 335,509 삼각형, 재질 4·텍스처 24장, 가와사키 그린 리버리, 소형 슈퍼스포츠라 닌자 400과 실루엣이 가장 가깝다. 닌자 650(alban)은 사진 스캔이라 기각, ZX-10R(niev)은 텍스처 없음, H2 계열은 차종 인상이 다르다.
- 라이선스 의무: 저작자 표기. HUD에 키 삽입 이후 항상 보이는 크레딧 한 줄을 둔다(§6).
- 원본 zip은 사용자가 Sketchfab에서 glTF로 내려받아 `ninja400/zx6r/`에 둔다(gitignore). 저장소에는 변환된 `public/models/ninja400/ride.glb` 하나만 커밋한다.

### 1.2 변환 파이프라인 `scripts/prepare-ride-model.mjs`

`@gltf-transform/core|extensions|functions` (devDependency)로 한 번 돌리는 스크립트. 입력 `ninja400/zx6r/scene.gltf`, 출력 `public/models/ninja400/ride.glb` + `public/models/ninja400/ride.json`.

1. `dedup → prune → weld → flatten` (노드 계층을 평평하게, 이름 유지)
2. **좌표 정규화** (전부 자동, 결과는 ride.json에 기록):
   - 바퀴 검출: 지면에 가장 가까운 정점들을 진행축을 따라 2군집으로 나눠 앞뒤 액슬 x와 타이어 반지름을 구한다. 진행축은 PCA 최장축.
   - 앞 판별: 두 끝 중 **윈드스크린 쪽(꼭대기 y가 높은 끝)** 이 앞. 판별이 뒤집히면 `--flip` 플래그로 강제한다.
   - 축간거리를 **1370 mm(닌자 400 WHEELBASE)** 에 맞춰 균등 스케일, 앞이 +x, 지면 y=0, 좌우 중심 z=0. 단위는 저장소 좌표(mm × MM)와 같은 units.
3. **바퀴 노드 묶기**: 각 프리미티브의 바운딩박스가 액슬 중심의 반지름 (타이어R+20 mm) 원기둥 안에 완전히 들어가면 그 바퀴 소속으로 보고 `wheel_front` / `wheel_rear` 노드 아래로 옮긴다(회전 중심 = 액슬). 나머지는 `body`.
4. 텍스처: 최대 2048px로 축소, WebP(품질 80)로 재인코딩 (`sharp` devDependency). 메시는 `meshopt` 압축.
5. 목표 크기 12 MB 이하. 넘으면 텍스처를 1024로 내린다(스크립트 옵션 `--tex 1024`).
6. ride.json: `{ wheelbaseMm, front: {x, y, r}, rear: {x, y, r}, bounds: {min, max}, source: {name, author, url, license} }`.

### 1.3 런타임 `src/products/ninja400/render/RideModel.tsx`

- `useGLTF('/models/ninja400/ride.glb')` + meshopt 디코더(`three/examples/jsm/libs/meshopt_decoder.module.js`). 제품 마운트 시 `useGLTF.preload`로 미리 받는다(조립하는 동안 내려받는다).
- **보이는 조건**: `phase !== 'assembly'` 이거나, assembly라도 **키(`ignition_key`)만 남았을 때**. 즉 키를 꽂는 순간부터 실물 모델 위에 꽂는다.
- 나타날 때 0.5초 페이드인(재질 opacity). 절차 조립체는 같은 순간 사라진다.
- `wheel_front`/`wheel_rear`는 `ride.frontWheelRpm`/`ride.wheelRpm`으로 z축 회전(+x 진행이면 −z 방향 회전).
- 캐스트/리시브 섀도 켠다. 바닥 접촉 그림자는 기존 ContactShadows가 그대로 덮는다.
- 로딩 실패 시(파일 없음·디코드 실패) 조용히 절차 조립체를 유지한다 — 콘솔 경고 한 줄.

### 1.4 엔진 훅 (제품 무관)

- `ProductDef.assemblyHidden?: (s: { phase: string; mounted: Mounted; parts: PartDef[] }) => boolean`. 엔진의 `Assembly`는 이 값이 true면 장착 부품과 소품을 그리지 않는다. **고스트와 드래그는 그대로** 동작한다(키를 꽂아야 하므로).
- 닌자는 `assemblyHidden = (s) => s.phase !== 'assembly' || onlyKeyLeft(s.mounted)`.

### 1.5 위치 맞춤 `src/products/ninja400/render/rideLayout.ts`

실물 모델 위에서 상호작용 지점이 되는 좌표(mm)를 한 파일에 둔다. 초기값은 닌자 spec의 값을 쓰고, 모델을 띄운 뒤 브라우저에서 보정한다.

- `IGNITION` — 키 장착 위치(`ignition_key` 부품의 mount 좌표를 이 값으로 바꾼다)
- `STARTER_HOUSING` — 시동 스위치 하우징(Starter.tsx가 이 값을 쓴다)
- `GRIP` — 스로틀 그립(Throttle.tsx가 이 값을 쓴다)

## 2. 구동계 물리 v2 (`finale/rideModel.ts` 재작성)

### 2.1 제원 (EX400G 공식)

| 항목 | 값 |
|---|---|
| 1차 감속 | 2.219 |
| 2차(스프로킷) | 2.929 |
| 기어비 1~6 | 2.929 / 2.056 / 1.619 / 1.333 / 1.154 / 1.037 |
| 아이들 | 1300 rpm |
| 리미터 | 12,000 rpm (레드존 시작) |
| 뒷바퀴 유효 반지름 | 0.306 m |
| 차량+라이더 질량 | 243 kg |
| 엔진 회전 관성 | 0.03 kg·m² (전개 공회전 1300→12000이 약 1초) |
| 공기저항 | ½·1.2·0.42·v² N |
| 구름저항 | 0.015·m·g N (v>0일 때) |
| 앞브레이크 최대 | 3200 N |
| 클러치 전달 용량 | 90 Nm × 물림도 |

총감속비 R(gear) = 2.219 × 기어비 × 2.929. 6단 12,000 rpm ≈ 205 km/h.

### 2.2 엔진 토크

- 전개 토크 곡선(Nm, 크랭크): (1000,18) (2000,24) (3000,28) (4000,31) (5000,33) (6000,35) (7000,37) (8000,38) (9000,37.5) (10000,36) (11000,32) (12000,26). 사이는 선형보간.
- 순토크 `T_e = T_wot(rpm)·throttle − T_brake(rpm)·(1−throttle)`, 엔진 브레이크 `T_brake = 3 + 2.5·rpm/1000`.
- 아이들 거버너: throttle < 0.05일 때 `T_e += clamp(0.02·(1300 − rpm), 0, 12)`.
- 리미터: rpm > 12,000이면 `T_wot` 항을 0으로 (rpm이 12,000 근처에서 튄다).

### 2.3 클러치와 결합

- 레버 `c`(0 놓음 ~ 1 잡음)는 지금처럼 Shift 키로 0.12 s 시정수. 물림도 `e = clamp01((0.7 − c)/0.5)`, 전달 용량 `T_cap = 90·e`.
- 동기 회전 `ω_sync = ω_w·R`. 슬립 `Δ = ω_e − ω_sync`.
- **자유(중립 또는 e=0)**: `ω_e' = T_e/J_e`. 차체에 구동력 없음.
- **슬립(|Δ| > 10 rad/s 또는 요구 토크 > T_cap)**: 클러치 토크 `T_c = T_cap·tanh(Δ/20)`. 엔진 `ω_e' = (T_e − T_c)/J_e`, 바퀴 구동력 `F_d = T_c·R/r`.
- **직결(|Δ| ≤ 10 그리고 |T_e − T_load| ≤ T_cap)**: 합성 관성 `J_eff = J_e + m·r²/R²`, `ω_e' = (T_e − F_res·r/R)/J_eff`, `ω_w = ω_e/R`.
- 차체: `m·v' = F_d − F_drag − F_roll − F_brake`, v ≥ 0.
- 결과로: **감속 변속 → 클러치를 놓는 순간 rpm이 차속에 맞춰 뛰어오르고 차가 엔진 브레이크로 느려진다. 가속 변속 → rpm이 떨어진다. 스로틀을 닫으면 기어가 물린 채 엔진 브레이크로 감속한다.** 이것이 요구 4의 핵심이다.

### 2.4 시동 꺼짐

- 결합 상태(e > 0, 기어 물림)에서 rpm < 900이면 즉시 스톨. rpm < 1050이 0.4 s 지속되어도 스톨.
- 스톨 후 차체는 관성으로 굴러가다 선다. 재시동은 지금 규칙(기어 물림이면 클러치 잡고).

### 2.5 상태와 출력

`RideSim`: `rpm, throttle, clutch, brake, gear, speed(m/s), distance(m), stalled, running, lowRpmFor`. 파생: `wheelRpm = speed/(2π·0.306)·60`, `frontWheelRpm = speed/(2π·0.293)·60`, `speedKmh`. 사운드 부하 `rideLoad = e·throttle`(중립이면 0).

변속 규칙(클러치 잡아야 변속, 1-N-2-…-6)은 유지한다.

### 2.6 계기 (`RideGauge`)

- 막대 눈금 0~13,000, 레드존 12,000부터.
- 큰 숫자로 **속도 km/h**, 그 옆에 기어, 아래 rpm. 나머지 램프·힌트는 유지.

### 2.7 테스트 (순수 함수)

1. 중립·스로틀 0에서 2초 돌리면 rpm 1300 ± 60.
2. 중립 전개: 1300→12,000 도달 0.6~1.5 s, 12,500을 넘지 않는다.
3. 1단, 클러치 놓음, 스로틀 0, 정지 상태에서 → 1 s 안에 stalled.
4. 1단 전개 + 클러치 서서히 놓기(0.5 s) → 3 s 뒤 speed > 5 m/s, stalled 아님.
5. 60 km/h·4단 직결 상태에서 클러치 잡고 3단으로 내린 뒤 클러치 놓기 → 0.5 s 뒤 rpm이 3단 동기 회전 ±5%, 전보다 높다.
6. 같은 상태에서 5단으로 올리면 rpm이 낮아진다.
7. 4단 직결·스로틀 0·60 km/h → 2 s 뒤 속도가 줄었고 rpm은 여전히 차속 동기(엔진 브레이크).
8. 6단 전개 60 s → 190~210 km/h에서 수렴.
9. 브레이크 1 → 60 km/h에서 3 s 안에 정지, 클러치 안 잡았으면 stalled.

## 3. 바닥 타일 (`render/RoadTiles.tsx`)

- `phase === 'running'`에서만 그린다. 기존 Floor(검은 무한 평면·접촉 그림자) 위 1 mm.
- 60 m × 60 m 평면, 차 중심 고정. 재질은 `meshStandardMaterial`에 **코드로 만든 CanvasTexture**(1024², 8×8 타일, 타일 600 mm, 줄눈 15 mm) — 외부 이미지 없음. 타일 색 `#1a1b1e`에 타일마다 ±6% 명도 해시, 줄눈 `#0b0b0d`. `wrapS/T = Repeat`, `anisotropy = 8`, repeat = 60 m / 4.8 m.
- 매 프레임 `map.offset.x = −(ride.distance mod 4.8) / 4.8` → 차가 +x로 가면 바닥이 −x로 흐른다.
- 멀리서 배경에 녹도록 running 동안 장면에 `fogExp2(배경색 #0A0A0B, 0.045)`.
- running 진입 카메라는 뒤 3/4 낮은 시점 `{azimuth: 215, polar: 72, distance: 3400}`, target `[0, 600, 0]` — 바닥이 흘러가는 것이 보이는 각도. 사용자가 돌리면 그 시점을 유지한다(CameraRig 규칙 그대로).

## 4. 엔진음 v3 — 실녹음 샘플

### 4.1 소스 (freesound, CC0, 2026-09-20 확인)

| id | 제목 | 내용 | 용도 |
|---|---|---|---|
| 641223 | bike, ignition, start, idle, working, rev, bmw f800gs (AlexanderChe) | 3분 34초. 시동(25 s), 아이들 1320 rpm 장시간(80~115, 130~150 s), 정속 구간 2760·3750·4050·4620·5520 rpm, 스윕 25~47 s와 189~205 s, 엔진 정지 | 아이들·중회전 루프, 시동·정지 원샷, 고회전 그레인 |
| 724077 | Motorcycle Accelerate and Cruise 24-sec (brucehep, BMW F800GSA, 배기 근접 마이크) | 기어 올리며 가속, 2250 rpm 순항 | 저회전 온스로틀 루프 |

둘 다 병렬 2기통(BMW F800, 360° 크랭크). 닌자 400은 180° 크랭크라 점화 간격이 다르지만, 무료·상업 가능 녹음 중 스윕과 아이들이 함께 깨끗한 것은 이 둘뿐이다. HQ 미리듣기 mp3(로그인 없이 공개)를 쓴다.

### 4.2 뱅크 생성 `scripts/build-engine-bank.py`

Python(numpy·scipy·soundfile). 한 번 돌려 결과를 커밋한다.

1. 입력 mp3를 `ninja400/audio/`에서 읽는다(없으면 freesound CDN에서 받는다).
2. f0 추적: 8 kHz로 다운샘플 → STFT(8192, hop 800) → 15~230 Hz에서 6배음 가중합 최대. rpm = f0 × 60 (아이들 1320 rpm으로 보정 확인).
3. 루프 추출 목표 rpm: **1320, 2250(724077), 2760, 3750, 4100, 4620, 5520, 6500, 7500**. 정속 창(±4%, ≥0.8 s)이 있으면 그 창에서 잘라 내고, 없으면(6500·7500) 스윕에서 f0가 ±12% 안에 드는 0.6 s 구간을 골라 프레임별 리샘플로 **피치를 평탄화**한다.
4. 각 루프는 점화 주기의 정수배 길이(1.2~2.0 s), 끝-처음 80 ms 등파워 크로스페이드로 이음새 제거, 30 Hz 하이패스, RMS −18 dBFS 정규화.
5. 원샷: `start`(641223 시동 크랭킹→점화, 약 1.5 s), `stop`(정지, 약 1.2 s).
6. 출력 `public/audio/ninja400/engine/{rpm}.ogg`, `start.ogg`, `stop.ogg` (Vorbis q≈0.5, 모노 44.1 kHz) + `bank.json`: `{ loops: [{rpm, file}], start, stop, credits: [...] }`. 총 1 MB 이하.
7. 스크립트는 각 루프의 실측 rpm과 이음새 RMS 차이를 표로 출력한다(검수용).

### 4.3 런타임 `audio/engineSound.ts` v3

공개 API는 유지: `start / stop / setRpm / setThrottle / setLoad / blip`, `preload()` 추가.

- `preload()`: bank.json과 모든 ogg를 fetch → decodeAudioData. 제품 마운트에서 한 번 부른다.
- 그래프: 루프 소스 A·B → 각 gain → `tone`(lowpass) → `master` → compressor → destination. 원샷은 master로 직접.
- 매 tick(25 ms): rpm으로 이웃 루프 두 개(lower, upper)와 위치 t를 고른다(`bankMix(rpm, loops)` 순수 함수). 각 소스 `playbackRate = rpm / loopRpm`, 게인은 등파워 `cos/sin(t·π/2)`. rpm이 구간을 넘어가면 새 이웃 루프를 임의 오프셋에서 시작하고 30 ms 크로스페이드로 역할을 넘긴다. 최고 루프 위는 pitch-up(12,000/7500 = 1.6배), 아이들 아래는 pitch-down.
- 톤: 스로틀 0 → lowpass 1400 Hz·−5 dB, 1 → 6000 Hz·0 dB; 부하는 +3 dB까지. 시정수 50 ms.
- `start()`: `start.ogg` 재생, 0.8 s 뒤부터 루프 게인 페이드인. `stop()`: 루프 0.15 s 페이드아웃 + `stop.ogg`.
- 뱅크가 아직 없으면(디코드 전·실패) 소리 없이 진행하고 콘솔 경고 한 줄. 합성 v2 코드는 삭제한다.
- 테스트: `bankMix` — 경계값, 최저 아래·최고 위, 단조 증가 rpm에서 t 연속성.

## 5. 카메라·힌트

- keyed 뷰는 실물 모델의 계기판 주변이 보이도록 rideLayout의 IGNITION을 target으로 쓴다.
- 힌트 `running: '스로틀 개방'` 유지. 계기 키 안내 줄 유지.

## 6. 크레딧 (라이선스 의무)

HUD 하단 왼쪽, `.hud-credits`(11px, 회색 #8b8f98, 링크 밑줄 없음, 호버 시 밝아짐). keyed·running에서만 보인다.

> 모델 Kawasaki ninja ZX-6R · valvetin · CC BY 4.0 / 엔진음 AlexanderChe, brucehep · freesound · CC0

## 7. 저장소 규칙과의 관계

- "형상은 코드 생성만" 규칙은 **조립 부품**에 적용된다. 완성차 실물 모델은 사용자 지시로 예외이며, 이 스펙이 그 근거다. CLAUDE.md의 해당 줄에 예외를 한 줄 추가한다.
- 바닥 타일 텍스처는 코드로 만든다(외부 이미지 없음).
- 엔진 경계(`boundary.test.ts`)는 유지: 새 훅 `assemblyHidden`은 타입만 엔진에 둔다.

## 8. 검증

- vitest: rideModel v2(§2.7), bankMix, onlyKeyLeft, RoadTiles 텍스처 생성 함수(크기·반복 수), product.test의 기어비·부품 위치.
- 브라우저(5174, LAN): 키만 남았을 때 실물 모델 등장, 키 꽂기, 시동음→아이들, ↑로 가속 시 타일 흐름·속도계, 변속 시 rpm 변화, 감속 변속 rpm 상승, 스톨.
- 사용자 청취·시승 피드백이 최종 판정이다(내가 소리를 들을 수 없으므로 스펙트로그램으로만 검수한다).
