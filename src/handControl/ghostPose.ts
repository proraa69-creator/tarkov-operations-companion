import type { HandFrame } from './types'

/** Palm span of the drawn hand, CSS pixels. */
export const GHOST_PALM_PX = 64

/**
 * Screen pose of the drawn hand in CSS pixels. The engine already places the real finger shape at
 * a steady size on the hand's anchor (see HandGestureEngine.drawnHand), so fingers moving never
 * move the hand; `z` is in pixels, positive = closer to the viewer.
 */
export function ghostPose(frame: HandFrame, width: number, height: number) {
  return frame.skeleton!.map((point) => ({ x: point.x * width, y: point.y * height, z: point.z }))
}
