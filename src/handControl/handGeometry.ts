import { LM, type CalibrationBox, type HandObservation, type Point3 } from './types'

const sub = (a: Point3, b: Point3): Point3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
const dot = (a: Point3, b: Point3) => a.x * b.x + a.y * b.y + a.z * b.z
const len = (a: Point3) => Math.hypot(a.x, a.y, a.z)

const FINGERS = {
  index: [LM.INDEX_MCP, LM.INDEX_PIP, LM.INDEX_DIP, LM.INDEX_TIP],
  middle: [LM.MIDDLE_MCP, LM.MIDDLE_PIP, LM.MIDDLE_DIP, LM.MIDDLE_TIP],
  ring: [LM.RING_MCP, LM.RING_PIP, LM.RING_DIP, LM.RING_TIP],
  pinky: [LM.PINKY_MCP, LM.PINKY_PIP, LM.PINKY_DIP, LM.PINKY_TIP],
} as const

export type FingerName = keyof typeof FINGERS

/**
 * How straight a finger is in metric 3D space: cosine between the first and the last
 * phalanx direction (1 = straight, <0 = curled). Uses world landmarks, so it does not
 * depend on how the hand is rotated towards the camera.
 */
export function fingerStraightness(world: Point3[], finger: FingerName) {
  const [mcp, pip, dip, tip] = FINGERS[finger].map((index) => world[index])
  const base = sub(pip, mcp)
  const end = sub(tip, dip)
  const norm = len(base) * len(end)
  if (!norm) return 0
  const straight = dot(base, end) / norm
  // A curled finger can still look straight if folded flat, so also require the tip to be
  // further from the wrist than the middle joint.
  const wrist = world[LM.WRIST]
  return len(sub(tip, wrist)) > len(sub(pip, wrist)) ? straight : Math.min(straight, -0.2)
}

const angleBetween = (a: Point3, b: Point3) => {
  const norm = len(a) * len(b)
  return norm ? (Math.acos(Math.min(1, Math.max(-1, dot(a, b) / norm))) * 180) / Math.PI : 0
}

/**
 * Bend of a finger relative to the palm, degrees: direction wrist→knuckle vs knuckle→tip.
 * ~10–40° when the finger is raised/pointing, 90–130° when it is folded forward in a tap.
 */
export function fingerFlex(world: Point3[], finger: FingerName) {
  const [mcp, , , tip] = FINGERS[finger].map((index) => world[index])
  return angleBetween(sub(mcp, world[LM.WRIST]), sub(tip, mcp))
}

const dist = (a: Point3, b: Point3) => len(sub(a, b))

/** Centre of the palm (wrist + four knuckles): stays put while the fingers tap, flick or pinch. */
export const PALM_POINTS = [LM.WRIST, LM.INDEX_MCP, LM.MIDDLE_MCP, LM.RING_MCP, LM.PINKY_MCP] as const

export function palmCenter(points: Array<{ x: number; y: number }>) {
  let x = 0
  let y = 0
  for (const index of PALM_POINTS) { x += points[index].x; y += points[index].y }
  return { x: x / PALM_POINTS.length, y: y / PALM_POINTS.length }
}

/** Palm length (wrist → middle knuckle) in metres; the unit for hand-relative distances. */
export function palmLength(world: Point3[]) {
  return dist(world[LM.WRIST], world[LM.MIDDLE_MCP]) || 0.09
}

/** Thumb tip ↔ index tip distance in palm lengths: < 0.3 pinched, > 0.75 spread. */
export function pinchDistance(world: Point3[]) {
  return dist(world[LM.THUMB_TIP], world[LM.INDEX_TIP]) / palmLength(world)
}

/** Thumb tip ↔ index knuckle in palm lengths: ~0.4 tucked against the hand, > 0.65 sticking out. */
export function thumbOut(world: Point3[]) {
  return dist(world[LM.THUMB_TIP], world[LM.INDEX_MCP]) / palmLength(world)
}

const PALM_SEGMENTS: Array<[number, number]> = [
  [LM.WRIST, LM.INDEX_MCP], [LM.WRIST, LM.PINKY_MCP], [LM.WRIST, LM.MIDDLE_MCP],
  [LM.INDEX_MCP, LM.MIDDLE_MCP], [LM.MIDDLE_MCP, LM.RING_MCP], [LM.RING_MCP, LM.PINKY_MCP], [LM.INDEX_MCP, LM.PINKY_MCP],
]

/**
 * Inverse-distance proxy (pixels per metre) from the palm: the projected palm size in the
 * frame divided by the metric size of the same segments in the camera plane. Pinhole
 * projection makes this proportional to 1/Z and largely independent of palm rotation.
 * Returns NaN when the palm is edge-on and the estimate is unreliable.
 */
export function inverseDepth(observation: HandObservation) {
  const { image, world, frameWidth, frameHeight } = observation
  let pixels = 0
  let metres = 0
  for (const [a, b] of PALM_SEGMENTS) {
    pixels += Math.hypot((image[a].x - image[b].x) * frameWidth, (image[a].y - image[b].y) * frameHeight)
    metres += Math.hypot(world[a].x - world[b].x, world[a].y - world[b].y)
  }
  if (metres < 0.04) return Number.NaN
  return pixels / metres
}

/**
 * Rotation-robust palm size in camera pixels: the longest palm span. Turning the hand edge-on or
 * showing its back shortens some spans but rarely all of them.
 */
export function imageSpan(observation: HandObservation) {
  const { image, frameWidth, frameHeight } = observation
  const d = (a: number, b: number) => Math.hypot((image[a].x - image[b].x) * frameWidth, (image[a].y - image[b].y) * frameHeight)
  return Math.max(d(LM.WRIST, LM.MIDDLE_MCP), d(LM.WRIST, LM.INDEX_MCP), d(LM.WRIST, LM.PINKY_MCP), d(LM.INDEX_MCP, LM.PINKY_MCP) * 1.3)
}

/** 3×3 projective map (row-major, h33 = 1) from user-space image points to window space. */
export type Homography = number[]

/**
 * Least-squares homography (DLT with h33 = 1) mapping `src` onto `dst`; ≥ 4 point pairs.
 * Returns null for a degenerate set (points on a line, duplicates).
 */
export function solveHomography(src: Array<{ x: number; y: number }>, dst: Array<{ x: number; y: number }>): Homography | null {
  if (src.length < 4 || src.length !== dst.length) return null
  // Normal equations AᵀA·h = Aᵀb for the 2n×8 system.
  const ata = Array.from({ length: 8 }, () => new Array<number>(8).fill(0))
  const atb = new Array<number>(8).fill(0)
  const addRow = (row: number[], value: number) => {
    for (let i = 0; i < 8; i++) {
      atb[i] += row[i] * value
      for (let j = 0; j < 8; j++) ata[i][j] += row[i] * row[j]
    }
  }
  src.forEach(({ x, y }, index) => {
    const { x: u, y: v } = dst[index]
    addRow([x, y, 1, 0, 0, 0, -u * x, -u * y], u)
    addRow([0, 0, 0, x, y, 1, -v * x, -v * y], v)
  })
  // Gaussian elimination with partial pivoting.
  for (let col = 0; col < 8; col++) {
    let pivot = col
    for (let row = col + 1; row < 8; row++) if (Math.abs(ata[row][col]) > Math.abs(ata[pivot][col])) pivot = row
    if (Math.abs(ata[pivot][col]) < 1e-10) return null
    ;[ata[col], ata[pivot]] = [ata[pivot], ata[col]]
    ;[atb[col], atb[pivot]] = [atb[pivot], atb[col]]
    for (let row = col + 1; row < 8; row++) {
      const factor = ata[row][col] / ata[col][col]
      for (let j = col; j < 8; j++) ata[row][j] -= factor * ata[col][j]
      atb[row] -= factor * atb[col]
    }
  }
  const h = new Array<number>(8).fill(0)
  for (let row = 7; row >= 0; row--) {
    let sum = atb[row]
    for (let j = row + 1; j < 8; j++) sum -= ata[row][j] * h[j]
    h[row] = sum / ata[row][row]
  }
  return h.every(Number.isFinite) ? [...h, 1] : null
}

/** Projective denominator of `h` at a point: must stay positive where the hand can be. */
export const homographyScale = (h: Homography, point: { x: number; y: number }) => h[6] * point.x + h[7] * point.y + h[8]

export function applyHomography(h: Homography, point: { x: number; y: number }) {
  // The calibration guarantees a positive scale over the whole camera frame; the floor and the
  // clamp only keep a stray landmark from throwing the pointer to infinity.
  const w = Math.max(0.05, homographyScale(h, point))
  const clampWide = (value: number) => Math.min(2, Math.max(-1, value))
  return {
    x: clampWide((h[0] * point.x + h[1] * point.y + h[2]) / w),
    y: clampWide((h[3] * point.x + h[4] * point.y + h[5]) / w),
  }
}

/**
 * Image point → user space (mirrored like a mirror when the camera faces the user) → calibrated
 * window space. With a homography (5-point calibration) the camera's viewing angle — e.g. a
 * webcam above the monitor looking down at the hand — is corrected; otherwise the box is used.
 */
export function toWindowSpace(point: { x: number; y: number }, box: CalibrationBox, mirror: boolean, homography?: Homography | null) {
  const ux = mirror ? 1 - point.x : point.x
  if (homography) return applyHomography(homography, { x: ux, y: point.y })
  return {
    x: (ux - box.x0) / Math.max(0.05, box.x1 - box.x0),
    y: (point.y - box.y0) / Math.max(0.05, box.y1 - box.y0),
  }
}

export const clamp01 = (value: number) => Math.min(1, Math.max(0, value))
