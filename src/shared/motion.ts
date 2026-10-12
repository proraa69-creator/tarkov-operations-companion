/**
 * The app's motion curves for JS-driven motion (WAAPI, number tweens); the same values as --ease-out and
 * --ease-in-out in src/styles/tokens.css. Owner, 12.10.2026: «сделай нам так же плавно все приложение».
 */
export const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)'
export const EASE_IN_OUT = 'cubic-bezier(0.77, 0, 0.175, 1)'

/** A CSS cubic-bezier(x1, y1, x2, y2) as a function of progress 0…1, for tweens that run in JS (counting numbers). */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number) {
  const ax = 3 * x1 - 3 * x2 + 1
  const bx = 3 * x2 - 6 * x1
  const cx = 3 * x1
  const ay = 3 * y1 - 3 * y2 + 1
  const by = 3 * y2 - 6 * y1
  const cy = 3 * y1
  const x = (t: number) => ((ax * t + bx) * t + cx) * t
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx
  const y = (t: number) => ((ay * t + by) * t + cy) * t
  return (progress: number) => {
    if (progress <= 0) return 0
    if (progress >= 1) return 1
    // Newton steps on x(t) = progress, bisection when the slope is flat.
    let t = progress
    for (let i = 0; i < 8; i++) {
      const error = x(t) - progress
      if (Math.abs(error) < 1e-5) return y(t)
      const slope = dx(t)
      if (Math.abs(slope) < 1e-6) break
      t -= error / slope
    }
    let low = 0
    let high = 1
    t = progress
    for (let i = 0; i < 30; i++) {
      if (x(t) < progress) low = t
      else high = t
      t = (low + high) / 2
    }
    return y(t)
  }
}

export const easeOut = cubicBezier(0.23, 1, 0.32, 1)

export function prefersReducedMotion() {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

/** JS motion runs only in a real browser with frames and without the reduced-motion preference (not in jsdom tests). */
export function canAnimate() {
  return typeof window !== 'undefined'
    && typeof window.requestAnimationFrame === 'function'
    && typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function'
    && !/jsdom/i.test(navigator.userAgent)
    && !prefersReducedMotion()
}
