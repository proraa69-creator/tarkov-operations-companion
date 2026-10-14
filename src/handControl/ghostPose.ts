import { palmCenter } from './handGeometry'
import { LM, type HandFrame } from './types'

/** Palm span the drawn hand is scaled to, in CSS pixels. */
export const GHOST_PALM_PX = 64

/**
 * Rotation-robust hand size in pixels: the longest palm span. Turning the hand edge-on or
 * showing its back shortens some spans but rarely all of them.
 */
export function handSpan(frame: HandFrame, width: number, height: number) {
  const points = frame.skeleton!
  const d = (a: number, b: number) => Math.hypot((points[a].x - points[b].x) * width, (points[a].y - points[b].y) * height)
  return Math.max(d(LM.WRIST, LM.MIDDLE_MCP), d(LM.WRIST, LM.INDEX_MCP), d(LM.WRIST, LM.PINKY_MCP), d(LM.INDEX_MCP, LM.PINKY_MCP) * 1.3)
}

/**
 * Screen pose of the drawn hand: real finger shape at a steady size, anchored by the palm centre
 * on the live hand position, so folding fingers never moves the hand. `z` is in the same pixel
 * scale, positive = closer to the viewer.
 */
export function ghostPose(frame: HandFrame, width: number, height: number, span: number) {
  const points = frame.skeleton!
  const center = palmCenter(points)
  const scale = Math.min(3, Math.max(0.15, GHOST_PALM_PX / Math.max(1, span)))
  const anchorX = frame.hand!.x * width
  const anchorY = frame.hand!.y * height
  const wristZ = points[LM.WRIST].z
  return {
    scale,
    points: points.map((point) => ({
      x: anchorX + (point.x - center.x) * width * scale,
      y: anchorY + (point.y - center.y) * height * scale,
      z: -(point.z - wristZ) * width * scale,
    })),
  }
}
