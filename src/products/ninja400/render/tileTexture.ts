// 주행 바닥 타일 텍스처를 코드로 그린다 — 외부 이미지 파일 없음(스펙 §3).
// 그리기 본체(drawTiles)는 캔버스 API 중 fillStyle·fillRect만 쓰는 순수 함수라
// DOM 없이 mock으로 검증한다. 캔버스 생성은 makeTileCanvas 한 곳에만 둔다.

/** 타일 한 변 (mm) */
export const TILE_MM = 600
/** 줄눈 폭 (mm). 달리면서 격자가 거의 안 보인다는 피드백에 15 → 24로 넓혔다 */
export const GROUT_MM = 24
/** 텍스처 한 장에 담는 타일 수 (한 변) */
export const TILES_PER_TEX = 8
/** 텍스처 한 장이 덮는 실제 거리 (m) = 4.8 m */
export const TEX_M = (TILE_MM * TILES_PER_TEX) / 1000
/** 주행 바닥 평면 한 변 (m) */
export const ROAD_M = 60
/** 타일 기준색 */
export const TILE_COLOR = '#1d1f24'
/** 줄눈 색. 타일보다 밝아야 격자가 읽힌다 (전에는 타일보다 어두워서 사실상 안 보였다) */
export const GROUT_COLOR = '#4b4f58'
/** 4칸마다 한 번 긋는 밝은 줄눈 색. 멀리서도 흐르는 속도가 읽히게 하는 굵은 선이다 */
export const GROUT_ACCENT_COLOR = '#6a6f7a'
/** 밝은 줄눈 간격 (타일 칸 수) */
export const ACCENT_EVERY = 4
/** 타일마다 흔드는 명도 폭 (±비율) */
const LIGHTNESS_JITTER = 0.08

/** drawTiles가 쓰는 캔버스 2D 문맥의 최소 부분. 테스트에서 mock으로 대체한다 */
export interface TileCtx {
  fillStyle: string | CanvasGradient | CanvasPattern
  fillRect(x: number, y: number, w: number, h: number): void
}

/** (i, j) → 0~1. Math.random을 쓰지 않아 매번 같은 무늬가 나온다 */
function hash01(i: number, j: number): number {
  let h = Math.imul(i, 374761393) + Math.imul(j, 668265263)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

const hex2 = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')

/** 기준색의 명도를 k배 한 #rrggbb */
function shade(color: string, k: number): string {
  const n = parseInt(color.slice(1), 16)
  return `#${hex2(((n >> 16) & 255) * k)}${hex2(((n >> 8) & 255) * k)}${hex2((n & 255) * k)}`
}

/**
 * 밝은 줄눈이 놓이는 격자선 번호. 텍스처 이음매(0번 선)를 비껴가도록 2, 6, … 으로 둔다 —
 * 가장자리에 걸치면 반쪽만 그려져 반복할 때 굵기가 달라 보인다.
 * tiles가 ACCENT_EVERY의 배수라야 텍스처를 이어 붙여도 간격이 일정하다 (8 / 4 = 2칸).
 */
export function accentLines(tiles: number): number[] {
  const out: number[] = []
  for (let k = 0; k < tiles; k++) if (k % ACCENT_EVERY === ACCENT_EVERY / 2) out.push(k)
  return out
}

/**
 * 정사각형을 줄눈 색으로 한 번 덮고, 그 위에 tiles² 개의 타일을 줄눈 폭만큼 안으로 물려 그린다.
 * 타일 사이에는 줄눈이 한 폭(양쪽 반 폭씩), 텍스처 가장자리에는 반 폭이 남아 반복해도 이어진다.
 * 마지막으로 ACCENT_EVERY칸마다 가로·세로로 밝은 줄눈을 한 줄씩 덧그린다.
 */
export function drawTiles(ctx: TileCtx, size: number, tiles: number): void {
  ctx.fillStyle = GROUT_COLOR
  ctx.fillRect(0, 0, size, size)
  const cell = size / tiles
  // 텍스처 한 변이 덮는 거리는 TILE_MM × tiles (mm)
  const grout = (GROUT_MM / (TILE_MM * tiles)) * size
  for (let j = 0; j < tiles; j++) {
    for (let i = 0; i < tiles; i++) {
      ctx.fillStyle = shade(TILE_COLOR, 1 + (hash01(i, j) * 2 - 1) * LIGHTNESS_JITTER)
      ctx.fillRect(i * cell + grout / 2, j * cell + grout / 2, cell - grout, cell - grout)
    }
  }
  ctx.fillStyle = GROUT_ACCENT_COLOR
  for (const k of accentLines(tiles)) {
    ctx.fillRect(k * cell - grout / 2, 0, grout, size) // 세로
    ctx.fillRect(0, k * cell - grout / 2, size, grout) // 가로
  }
}

/** 브라우저에서만 부른다 (RoadTiles의 useMemo) */
export function makeTileCanvas(size = 1024, tiles = TILES_PER_TEX): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (ctx) drawTiles(ctx, size, tiles)
  return canvas
}
