import type { HandObservation, Point3 } from './types'

type Finger = 'index' | 'middle' | 'ring' | 'pinky'

export interface SyntheticHand {
  /** wrist position in normalized image coordinates */
  x: number
  y: number
  /** pixels per metre, i.e. inverse distance */
  k: number
  /**
   * Per finger: a number is a straight finger folded at the knuckle by that many degrees
   * (0 = raised, 90 = pointing at the camera, 110 = folded in a tap); `true` = 0;
   * `false`/missing = curled into the palm.
   */
  fingers?: Partial<Record<Finger, boolean | number>>
  /** thumb tip in metres relative to the wrist; default tucked against the hand */
  thumbTip?: Point3
  /** whole hand tilted towards the camera around the wrist, degrees (wrist bent down) */
  tilt?: number
  /** whole hand turned around the vertical axis, degrees (palm towards the side) */
  turn?: number
  /** whole hand rolled in the image plane, degrees (fingers pointing up-left / up-right) */
  roll?: number
  score?: number
  t: number
}

const FRAME_W = 640
const FRAME_H = 480
const MCP_X: Record<Finger, number> = { index: -0.03, middle: -0.01, ring: 0.01, pinky: 0.03 }

/** Builds a plausible MediaPipe-shaped observation for tests: palm facing the camera, fingers up. */
export function syntheticHand({ x, y, k, fingers = {}, thumbTip, tilt = 0, turn = 0, roll = 0, score = 0.95, t }: SyntheticHand): HandObservation {
  const world: Point3[] = new Array(21)
  world[0] = { x: 0, y: 0, z: 0 }
  world[1] = { x: -0.03, y: -0.02, z: 0 }
  world[2] = { x: -0.05, y: -0.04, z: 0 }
  world[3] = { x: -0.06, y: -0.06, z: 0 }
  world[4] = thumbTip ?? { x: -0.07, y: -0.075, z: 0 }
  const order: Finger[] = ['index', 'middle', 'ring', 'pinky']
  order.forEach((finger, i) => {
    const base = 5 + i * 4
    const mcp = { x: MCP_X[finger], y: -0.09, z: 0 }
    const spec = fingers[finger]
    let pip: Point3, dip: Point3, tip: Point3
    if (spec === undefined || spec === false) {
      pip = { x: mcp.x, y: mcp.y - 0.03, z: -0.01 }
      dip = { x: pip.x, y: pip.y, z: pip.z - 0.02 }
      tip = { x: dip.x, y: dip.y + 0.02, z: dip.z + 0.01 }
    } else {
      const angle = ((spec === true ? 0 : spec) * Math.PI) / 180
      // Raised = -y (up in the image); folding rotates the finger towards the camera (-z).
      const step = (from: Point3, length: number) => ({ x: from.x, y: from.y - Math.cos(angle) * length, z: from.z - Math.sin(angle) * length })
      pip = step(mcp, 0.04)
      dip = step(pip, 0.025)
      tip = step(dip, 0.02)
    }
    world[base] = mcp
    world[base + 1] = pip
    world[base + 2] = dip
    world[base + 3] = tip
  })
  if (tilt) {
    const a = (tilt * Math.PI) / 180
    for (let i = 0; i < world.length; i++) {
      const p = world[i]
      world[i] = { x: p.x, y: p.y * Math.cos(a) - p.z * Math.sin(a), z: p.y * Math.sin(a) + p.z * Math.cos(a) }
    }
  }
  if (turn) {
    const a = (turn * Math.PI) / 180
    for (let i = 0; i < world.length; i++) {
      const p = world[i]
      world[i] = { x: p.x * Math.cos(a) + p.z * Math.sin(a), y: p.y, z: -p.x * Math.sin(a) + p.z * Math.cos(a) }
    }
  }
  if (roll) {
    const a = (roll * Math.PI) / 180
    for (let i = 0; i < world.length; i++) {
      const p = world[i]
      world[i] = { x: p.x * Math.cos(a) - p.y * Math.sin(a), y: p.x * Math.sin(a) + p.y * Math.cos(a), z: p.z }
    }
  }
  const image = world.map((point) => ({ x: x + (point.x * k) / FRAME_W, y: y + (point.y * k) / FRAME_H, z: point.z }))
  return { t, image, world, score, handedness: 'Right', frameWidth: FRAME_W, frameHeight: FRAME_H }
}

/** Index fingertip of a synthetic hand with the index raised `angle` degrees (for pinch tests). */
export function indexTipAt(angle: number): Point3 {
  const a = (angle * Math.PI) / 180
  return { x: -0.03, y: -0.09 - Math.cos(a) * 0.085, z: -Math.sin(a) * 0.085 }
}

/** Thumb sticking out sideways (open hand / spread pinch). */
export const THUMB_OUT: Point3 = { x: -0.11, y: -0.05, z: 0 }
