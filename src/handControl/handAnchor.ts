/**
 * Where the drawn hand stands. Rule from the product owner: if the hand itself does not move,
 * the hand on screen does not move — moving the fingers in any way never moves it.
 *
 * Measured on the recorded reference gestures (palm "span" ≈ 97 px in a 640×360 frame):
 * - a hand held still: the palm centre wanders 0.05–0.09 span within 300 ms (tracking noise);
 * - during a tap MediaPipe shifts the knuckles, and so the palm centre, by 0.45–0.75 span,
 *   and the image of the palm takes ~0.3 s to settle after the finger is back.
 * So the anchor is a "rubber band" with a radius above the noise, and it is held in place while
 * the fingers articulate (and a moment after), unless the palm clearly travels further than any
 * finger movement could shift it.
 */
export const ANCHOR = {
  /** the palm must leave this radius (in palm spans) before the drawn hand follows */
  stickRadius: 0.1,
  /** finger articulation: a flex change this large (degrees) within the window holds the hand */
  articulationDeg: 12,
  /** thumb articulation: a thumb↔index distance change this large (palm lengths) within the window */
  articulationPinch: 0.15,
  articulationWindowMs: 100,
  /**
   * Keep holding this long after the fingers stop: the image of the palm settles after a tap
   * (measured: the knuckles take ~0.3–0.4 s to come back).
   */
  holdAfterMs: 500,
  /** while the fingers move, a palm shift beyond this (palm spans) is a real move of the whole hand */
  holdBreak: 0.9,
  /**
   * After the fingers stopped, the knuckles drift back towards where they were; a palm moving
   * further away than its closest point since then by this much (palm spans) is the hand moving.
   */
  settleBreak: 0.25,
  /** after a hold, a gap larger than this (palm spans) is closed smoothly instead of in one jump */
  glideFrom: 0.25,
  glideMs: 120,
  /** when the hand breaks out of a hold (it really moves), catch up quickly */
  breakGlideMs: 40,
} as const

type Point = { x: number; y: number }
type Articulation = { t: number; flex: number[]; pinch: number }

export class HandAnchor {
  private held: Point | null = null
  private holdUntil = Number.NEGATIVE_INFINITY
  private recent: Articulation[] = []

  reset() {
    this.held = null
    this.holdUntil = Number.NEGATIVE_INFINITY
    this.recent = []
    this.holding = false
    this.gliding = false
    this.holdSince = Number.NaN
    this.lastT = Number.NaN
    this.settleBase = Number.NaN
  }

  /** True while the fingers are moving (or just stopped): the hand stays where it is. */
  holding = false
  /** True while the anchor glides to the palm after a hold (not a movement of the hand). */
  gliding = false
  /** When the current hold began (NaN when not holding). */
  holdSince = Number.NaN
  private lastT = Number.NaN
  private glideMs: number = ANCHOR.glideMs
  /** smallest anchor→palm offset since the fingers stopped (NaN while they move) */
  private settleBase = Number.NaN
  private glideSince = Number.NaN

  /**
   * @param raw palm centre in camera pixels (user space, i.e. already mirrored if needed)
   * @param span palm size in the same pixels (slowly smoothed)
   * @param flex fold of each finger, degrees
   * @param pinch thumb tip ↔ index tip in palm lengths
   * @param busy a finger gesture is under way (e.g. the finger is held folded in a press)
   * @param free the hand is dragging something: follow it, never hold
   */
  update(t: number, raw: Point, span: number, flex: number[], pinch: number, busy = false, free = false): Point {
    this.recent.push({ t, flex, pinch })
    while (this.recent.length && t - this.recent[0].t > ANCHOR.articulationWindowMs) this.recent.shift()
    if (free) this.holdUntil = Number.NEGATIVE_INFINITY
    const articulating = !free && (busy || this.articulating())
    if (articulating) this.holdUntil = t + ANCHOR.holdAfterMs

    const dt = Number.isNaN(this.lastT) ? 0 : Math.max(0, t - this.lastT)
    this.lastT = t
    if (!this.held) {
      this.held = { ...raw }
      this.holding = false
      return { ...this.held }
    }
    const unit = Math.max(1, span)
    const dx = raw.x - this.held.x
    const dy = raw.y - this.held.y
    const offset = Math.hypot(dx, dy) / unit
    const wasHolding = this.holding
    if (articulating) this.settleBase = Number.NaN
    else if (t < this.holdUntil) this.settleBase = Number.isNaN(this.settleBase) ? offset : Math.min(this.settleBase, offset)
    const movedOn = !articulating && offset > this.settleBase + ANCHOR.settleBreak
    // In a press (finger held folded) the hand never moves: the click goes where it was pressed.
    this.holding = busy || (t < this.holdUntil && offset <= ANCHOR.holdBreak && !movedOn)
    if (this.holding) {
      if (!wasHolding) this.holdSince = t
      this.gliding = false
      return { ...this.held }
    }
    this.holdSince = Number.NaN
    const broke = t < this.holdUntil
    if (broke) this.holdUntil = Number.NEGATIVE_INFINITY // the whole hand clearly moved
    this.settleBase = Number.NaN
    // Close the gap left by a hold smoothly: quickly when the hand broke away, gently otherwise.
    if (wasHolding && (broke || offset - ANCHOR.stickRadius > ANCHOR.glideFrom)) {
      this.gliding = true
      this.glideSince = t
      this.glideMs = broke ? ANCHOR.breakGlideMs : ANCHOR.glideMs
    }
    // Rubber band: a still hand (noise inside the radius) never moves the anchor; a moving hand
    // drags it along, trailing by the radius. After a hold the gap is closed smoothly.
    if (offset > ANCHOR.stickRadius) {
      const keep = ANCHOR.stickRadius / offset
      const target = { x: raw.x - dx * keep, y: raw.y - dy * keep }
      if (this.gliding) {
        const k = 1 - Math.exp(-dt / this.glideMs)
        this.held = { x: this.held.x + (target.x - this.held.x) * k, y: this.held.y + (target.y - this.held.y) * k }
        // Done once caught up (a moving hand keeps a small lag) or after a few time constants.
        const gap = Math.hypot(target.x - this.held.x, target.y - this.held.y) / unit
        if (gap < ANCHOR.stickRadius || t - this.glideSince > this.glideMs * 4) this.gliding = false
      } else this.held = target
    } else this.gliding = false
    return { ...this.held }
  }

  private articulating() {
    if (this.recent.length < 2) return false
    const fingers = this.recent[0].flex.length
    for (let finger = 0; finger < fingers; finger++) {
      let min = Infinity
      let max = -Infinity
      for (const sample of this.recent) {
        min = Math.min(min, sample.flex[finger])
        max = Math.max(max, sample.flex[finger])
      }
      if (max - min >= ANCHOR.articulationDeg) return true
    }
    const pinches = this.recent.map((sample) => sample.pinch)
    return Math.max(...pinches) - Math.min(...pinches) >= ANCHOR.articulationPinch
  }
}
