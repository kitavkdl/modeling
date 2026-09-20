import { describe, expect, it } from 'vitest'
import {
  drawTiles,
  GROUT_COLOR,
  GROUT_MM,
  ROAD_M,
  TEX_M,
  TILE_COLOR,
  TILE_MM,
  TILES_PER_TEX,
  type TileCtx,
} from './tileTexture'

interface Call {
  style: string
  rect: [number, number, number, number]
}

/** DOM 없이 그리기 호출만 기록하는 mock. 실제 캔버스는 브라우저에서만 만든다 */
function recorder(): { ctx: TileCtx; calls: Call[] } {
  const calls: Call[] = []
  const ctx: TileCtx = {
    fillStyle: '',
    fillRect(x, y, w, h) {
      calls.push({ style: String(ctx.fillStyle), rect: [x, y, w, h] })
    },
  }
  return { ctx, calls }
}

const SIZE = 1024
const TILES = TILES_PER_TEX

describe('tileTexture 상수', () => {
  it('타일 600 mm · 줄눈 15 mm · 텍스처 4.8 m · 도로 60 m', () => {
    expect(TILE_MM).toBe(600)
    expect(GROUT_MM).toBe(15)
    expect(TILES_PER_TEX).toBe(8)
    expect(TEX_M).toBeCloseTo(4.8, 10)
    expect(ROAD_M).toBe(60)
  })
})

describe('drawTiles', () => {
  it('바탕 1 + 타일 tiles² 번 그린다', () => {
    const { ctx, calls } = recorder()
    drawTiles(ctx, SIZE, TILES)
    expect(calls).toHaveLength(TILES * TILES + 1)
  })

  it('첫 호출은 줄눈 색으로 정사각형 전체를 덮는다', () => {
    const { ctx, calls } = recorder()
    drawTiles(ctx, SIZE, TILES)
    expect(calls[0].style).toBe(GROUT_COLOR)
    expect(calls[0].rect).toEqual([0, 0, SIZE, SIZE])
  })

  it('모든 타일이 정사각형 안에 있고 줄눈만큼 줄어 있다', () => {
    const { ctx, calls } = recorder()
    drawTiles(ctx, SIZE, TILES)
    const cell = SIZE / TILES
    const groutPx = (GROUT_MM / (TILE_MM * TILES)) * SIZE
    for (const { rect } of calls.slice(1)) {
      const [x, y, w, h] = rect
      expect(w).toBeCloseTo(cell - groutPx, 6)
      expect(h).toBeCloseTo(cell - groutPx, 6)
      expect(x).toBeGreaterThanOrEqual(0)
      expect(y).toBeGreaterThanOrEqual(0)
      expect(x + w).toBeLessThanOrEqual(SIZE)
      expect(y + h).toBeLessThanOrEqual(SIZE)
    }
  })

  it('타일마다 해시로 명도가 갈려 색이 한 가지가 아니다', () => {
    const { ctx, calls } = recorder()
    drawTiles(ctx, SIZE, TILES)
    const styles = new Set(calls.slice(1).map((c) => c.style))
    expect(styles.size).toBeGreaterThanOrEqual(2)
    // 기준색에서 ±6% 안이라 여전히 어두운 회색이다
    for (const s of styles) expect(s).toMatch(/^#[0-9a-f]{6}$/)
    expect(TILE_COLOR).toBe('#1a1b1e')
  })

  it('두 번 그려도 같은 결과다 (Math.random 없음)', () => {
    const a = recorder()
    const b = recorder()
    drawTiles(a.ctx, SIZE, TILES)
    drawTiles(b.ctx, SIZE, TILES)
    expect(a.calls).toEqual(b.calls)
  })
})
