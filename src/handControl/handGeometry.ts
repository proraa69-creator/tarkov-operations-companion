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

/** Image point → user space (mirrored like a mirror when the camera faces the user) → calibrated window space. */
export function toWindowSpace(point: { x: number; y: number }, box: CalibrationBox, mirror: boolean) {
  const ux = mirror ? 1 - point.x : point.x
  return {
    x: (ux - box.x0) / Math.max(0.05, box.x1 - box.x0),
    y: (point.y - box.y0) / Math.max(0.05, box.y1 - box.y0),
  }
}

/** Calibration box from fingertip samples taken at the comfortable top-left and bottom-right corners (user space). */
export function calibrationFromCorners(topLeft: Array<{ x: number; y: number }>, bottomRight: Array<{ x: number; y: number }>): CalibrationBox | null {
  const median = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b)
    return sorted[Math.floor(sorted.length / 2)]
  }
  if (topLeft.length < 5 || bottomRight.length < 5) return null
  const x0 = median(topLeft.map((point) => point.x))
  const y0 = median(topLeft.map((point) => point.y))
  const x1 = median(bottomRight.map((point) => point.x))
  const y1 = median(bottomRight.map((point) => point.y))
  if (x1 - x0 < 0.08 || y1 - y0 < 0.08) return null
  return { x0, y0, x1, y1 }
}

export const clamp01 = (value: number) => Math.min(1, Math.max(0, value))
