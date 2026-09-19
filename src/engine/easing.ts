export const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t)

export const easeOutCubic = (t: number) => 1 - Math.pow(1 - clamp01(t), 3)

/** 끝에서 살짝 넘쳤다가 돌아온다. 오버슈트 크기는 s로 조절 (기본 1.70158 ≈ 10%). */
export function easeOutBack(t: number, s = 1.2): number {
  const x = clamp01(t) - 1
  return 1 + x * x * ((s + 1) * x + s)
}

export const easeInOutCubic = (t: number) => {
  const x = clamp01(t)
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2
}

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t

export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}
