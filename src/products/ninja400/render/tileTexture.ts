// 주행 바닥 타일 텍스처를 코드로 그린다 — 외부 이미지 파일 없음(스펙 §3).
// 그리기 본체(drawTiles)는 캔버스 API 중 fillStyle·fillRect만 쓰는 순수 함수라
// DOM 없이 mock으로 검증한다. 캔버스 생성은 makeTileCanvas 한 곳에만 둔다.

/** 타일 한 변 (mm) */
export const TILE_MM = 600
/** 줄눈 폭 (mm) */
export const GROUT_MM = 15
/** 텍스처 한 장에 담는 타일 수 (한 변) */
export const TILES_PER_TEX = 8
/** 텍스처 한 장이 덮는 실제 거리 (m) = 4.8 m */
export const TEX_M = (TILE_MM * TILES_PER_TEX) / 1000
/** 주행 바닥 평면 한 변 (m) */
export const ROAD_M = 60
/** 타일 기준색 */
export const TILE_COLOR = '#1a1b1e'
/** 줄눈 색 */
export const GROUT_COLOR = '#0b0b0d'
/** 타일마다 흔드는 명도 폭 (±비율) */
const LIGHTNESS_JITTER = 0.06

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
 * 정사각형을 줄눈 색으로 한 번 덮고, 그 위에 tiles² 개의 타일을 줄눈 폭만큼 안으로 물려 그린다.
 * 타일 사이에는 줄눈이 한 폭(양쪽 반 폭씩), 텍스처 가장자리에는 반 폭이 남아 반복해도 이어진다.
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
