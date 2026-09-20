import { describe, expect, it } from 'vitest'
import { MM } from '../../../engine/types'
import {
  PROC_NORMAL,
  REAL_NORMAL,
  REFINE_S,
  SWEEP_FRONT_MM,
  SWEEP_REAR_MM,
  procPlaneConstant,
  realPlaneConstant,
  refine,
  sweepXMm,
  sweepXUnits,
} from './Refine'

/** three가 남기는 쪽: n·p + constant > 0 */
const keeps = (normal: readonly number[], constant: number, x: number): boolean => normal[0] * x + constant > 0

describe('sweepXMm', () => {
  it('앞끝에서 출발해 뒤끝에서 멈춘다', () => {
    expect(sweepXMm(0)).toBe(SWEEP_FRONT_MM)
    expect(sweepXMm(REFINE_S)).toBe(SWEEP_REAR_MM)
    expect(sweepXMm(REFINE_S / 2)).toBeCloseTo((SWEEP_FRONT_MM + SWEEP_REAR_MM) / 2, 6)
  })

  it('구간 밖은 끝값으로 물린다', () => {
    expect(sweepXMm(-3)).toBe(SWEEP_FRONT_MM)
    expect(sweepXMm(REFINE_S + 3)).toBe(SWEEP_REAR_MM)
  })

  it('시간이 갈수록 뒤로만 간다', () => {
    let prev = Infinity
    for (let t = 0; t <= REFINE_S; t += 0.25) {
      const x = sweepXMm(t)
      expect(x).toBeLessThan(prev)
      prev = x
    }
  })

  it('씬 단위는 mm × MM이다', () => {
    expect(sweepXUnits(0)).toBeCloseTo(SWEEP_FRONT_MM * MM, 9)
  })
})

describe('클리핑 평면', () => {
  const sx = sweepXUnits(REFINE_S / 2) // 칼날이 차 한가운데

  it('절차 조립체는 칼날 뒤쪽(아직 안 지나간 쪽)만 남는다', () => {
    expect(keeps(PROC_NORMAL, procPlaneConstant(sx), sx - 10)).toBe(true)
    expect(keeps(PROC_NORMAL, procPlaneConstant(sx), sx + 10)).toBe(false)
  })

  it('실물 모델은 칼날 앞쪽(지나간 쪽)에만 나타난다', () => {
    expect(keeps(REAL_NORMAL, realPlaneConstant(sx), sx + 10)).toBe(true)
    expect(keeps(REAL_NORMAL, realPlaneConstant(sx), sx - 10)).toBe(false)
  })

  it('두 평면이 공간을 빈틈없이 반씩 나눈다', () => {
    for (const x of [-200, -50, 50, 200]) {
      const proc = keeps(PROC_NORMAL, procPlaneConstant(sx), x)
      const real = keeps(REAL_NORMAL, realPlaneConstant(sx), x)
      expect(proc).not.toBe(real)
    }
  })

  it('시작 순간에는 차 전체가 절차 조립체다', () => {
    const x0 = sweepXUnits(0)
    expect(keeps(PROC_NORMAL, procPlaneConstant(x0), 0)).toBe(true)
    expect(keeps(REAL_NORMAL, realPlaneConstant(x0), 0)).toBe(false)
  })

  it('끝나는 순간에는 차 전체가 실물 모델이다', () => {
    const x1 = sweepXUnits(REFINE_S)
    expect(keeps(PROC_NORMAL, procPlaneConstant(x1), 0)).toBe(false)
    expect(keeps(REAL_NORMAL, realPlaneConstant(x1), 0)).toBe(true)
  })
})

describe('refine 싱글턴', () => {
  it('처음에는 아무것도 돌지 않는다', () => {
    expect(refine).toEqual({ active: false, t: 0, done: false })
  })
})
