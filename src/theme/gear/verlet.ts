/**
 * Tiny Verlet rope for the Gear theme's hanging kit (cords, chains, strap tails). Point 0 is pinned to an
 * anchor; the last point carries the hanging piece (heavier). Distance constraints keep segment lengths,
 * a soft second-neighbour constraint gives straps some bending stiffness, and a damped spring models the
 * piece twisting around the cord (drawn as a horizontal squash, which reads as 3D rotation).
 * Units are CSS pixels and seconds. Pure math, no DOM: unit-tested in verlet.test.ts.
 */
export interface Rope {
  n: number
  seg: number
  x: Float64Array
  y: Float64Array
  px: Float64Array
  py: Float64Array
  /** Inverse mass per point: 0 = pinned. */
  w: Float64Array
  /** 0 = limp cord, ~0.3 = webbing strap. */
  bend: number
  twist: number
  twistV: number
  /** Extra hit radius of the hanging piece around the last point. */
  tipRadius: number
}

export interface RopeOptions { bend?: number; tipMass?: number; tipRadius?: number }

export const GRAVITY = 2600
const DAMPING = 0.986
const ITERATIONS = 10

export function createRope(n: number, seg: number, ax: number, ay: number, options: RopeOptions = {}): Rope {
  const x = new Float64Array(n), y = new Float64Array(n), w = new Float64Array(n)
  for (let i = 0; i < n; i++) { x[i] = ax; y[i] = ay + i * seg; w[i] = i === 0 ? 0 : 1 }
  if (n > 1) w[n - 1] = 1 / (options.tipMass ?? 3)
  return { n, seg, x, y, px: x.slice(), py: y.slice(), w, bend: options.bend ?? 0, twist: 0, twistV: 0, tipRadius: options.tipRadius ?? 10 }
}

/** Put the rope at rest straight below the anchor (used after a jump, and for reduced motion). */
export function settleRope(r: Rope, ax: number, ay: number) {
  for (let i = 0; i < r.n; i++) { r.x[i] = r.px[i] = ax; r.y[i] = r.py[i] = ay + i * r.seg }
  r.twist = r.twistV = 0
}

/** Advance one fixed step. The anchor may have moved (scroll, layout) — the rope follows with inertia. */
export function stepRope(r: Rope, ax: number, ay: number, dt: number) {
  const { n, x, y, px, py, w, seg } = r
  // A big jump (route change, window resize) would fling the rope: just re-hang it.
  if (Math.abs(ax - x[0]) > 120 || Math.abs(ay - y[0]) > 160) settleRope(r, ax, ay)
  x[0] = px[0] = ax; y[0] = py[0] = ay
  const g = GRAVITY * dt * dt
  for (let i = 1; i < n; i++) {
    const vx = (x[i] - px[i]) * DAMPING, vy = (y[i] - py[i]) * DAMPING
    px[i] = x[i]; py[i] = y[i]
    x[i] += vx; y[i] += vy + g
  }
  for (let k = 0; k < ITERATIONS; k++) {
    for (let i = 0; i < n - 1; i++) satisfy(r, i, i + 1, seg, 1)
    if (r.bend > 0) for (let i = 0; i < n - 2; i++) satisfy(r, i, i + 2, seg * 2, r.bend)
  }
  // Twist: a damped torsion spring.
  r.twistV += (-60 * r.twist - 3.2 * r.twistV) * dt
  r.twist += r.twistV * dt
}

function satisfy(r: Rope, a: number, b: number, rest: number, stiffness: number) {
  const { x, y, w } = r
  const dx = x[b] - x[a], dy = y[b] - y[a]
  const d = Math.hypot(dx, dy) || 1e-6
  const wa = w[a], wb = w[b], ws = wa + wb
  if (ws === 0) return
  const diff = ((d - rest) / d) * stiffness
  x[a] += dx * diff * (wa / ws); y[a] += dy * diff * (wa / ws)
  x[b] -= dx * diff * (wb / ws); y[b] -= dy * diff * (wb / ws)
}

/**
 * The pointer brushing past: points within `radius` get part of the pointer's velocity (px/s).
 * Returns true when anything was touched.
 */
export function pushRope(r: Rope, pxPos: number, pyPos: number, vx: number, vy: number, radius: number, dt: number) {
  let hit = false
  const cap = 900
  const cvx = Math.max(-cap, Math.min(cap, vx)), cvy = Math.max(-cap, Math.min(cap, vy))
  for (let i = 1; i < r.n; i++) {
    const rad = i === r.n - 1 ? radius + r.tipRadius : radius
    const d = Math.hypot(r.x[i] - pxPos, r.y[i] - pyPos)
    if (d >= rad) continue
    const f = (1 - d / rad) * 0.85 * Math.min(1, 0.45 + r.w[i])
    r.px[i] -= cvx * dt * f
    r.py[i] -= cvy * dt * f * 0.6
    if (i === r.n - 1) r.twistV += cvx * 0.018 * (1 - d / rad)
    hit = true
  }
  return hit
}

/** Largest per-step movement (px) — the simulation sleeps below a small threshold. */
export function ropeMotion(r: Rope) {
  let m = Math.abs(r.twistV) * 0.02 + Math.abs(r.twist) * 0.5
  for (let i = 1; i < r.n; i++) m = Math.max(m, Math.abs(r.x[i] - r.px[i]), Math.abs(r.y[i] - r.py[i]))
  return m
}

/** Angle (radians) of the last segment from straight down; positive swings to the right. */
export function tipAngle(r: Rope) {
  const i = r.n - 1
  return Math.atan2(-(r.x[i] - r.x[i - 1]), r.y[i] - r.y[i - 1])
}
