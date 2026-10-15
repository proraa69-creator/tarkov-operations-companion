import { applyHomography, fingerStraightness, homographyScale, palmCenter, solveHomography, type Homography } from './handGeometry'
import type { CalibrationBox, HandObservation } from './types'

export type CalibrationHint = 'hold' | 'move' | 'lost' | 'point' | 'retry'

export interface CalibrationState {
  /** index of the current target (0..CALIBRATION_TARGETS.length-1), null when not calibrating */
  step: number | null
  /** 0..1 how long the hand has been held still at the current target */
  progress: number
  hint: CalibrationHint
}

export interface CalibrationResult {
  box: CalibrationBox
  homography: Homography
}

/**
 * On-screen targets in window space: four corners (clockwise from top-left) and the centre. The
 * user points the index finger at where each target really is on the monitor, so the map from the
 * camera image to the screen absorbs the camera's position and angle (usually above the monitor,
 * looking down at the hand).
 */
export const CALIBRATION_TARGETS = [
  { x: 0.1, y: 0.12 },
  { x: 0.9, y: 0.12 },
  { x: 0.9, y: 0.88 },
  { x: 0.1, y: 0.88 },
  { x: 0.5, y: 0.5 },
] as const

export const CALIBRATION = {
  holdMs: 800,
  /** palm travel (camera-frame units) that still counts as "held still" */
  stillRadius: 0.03,
  lostResetMs: 400,
  /** each captured palm position must be at least this far from the earlier ones (camera-frame units) */
  minSeparation: 0.03,
  /** the corner quad must be at least this wide / tall in the camera frame, or the pointer gets jittery */
  minWidth: 0.1,
  minHeight: 0.08,
  /** largest allowed miss of a target by the fitted map, window units */
  maxResidual: 0.1,
  /** the projective scale must stay above this over the whole camera frame (no "horizon" in view) */
  minScale: 0.2,
  /** the index finger must be extended to aim */
  minStraight: 0.6,
  minScore: 0.5,
} as const

type Sample = { t: number; x: number; y: number }
type Point = { x: number; y: number }

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]

/**
 * Five-point calibration. The engine keeps running (only its events are dropped) while the user
 * points the index finger at each target in turn; a target is captured once the palm stays still
 * for a moment. The palm positions are then fitted with a homography (palm → target minus the
 * drawn phalanx offset): it corrects the perspective of a camera above (or beside) the screen.
 */
export class CalibrationSession {
  private step = 0
  private palmRun: Sample[] = []
  private offsetRun: Point[] = []
  private offsets: Point[] = []
  private lostSince = Number.NaN
  private captures: Point[] = []
  private hint: CalibrationHint = 'hold'

  constructor(private readonly mirror: boolean) {}

  /** Feeds one observation; returns the result once all targets are captured and the fit is sound. */
  /**
   * @param aimOffset where the aim (the drawn index phalanx) sits relative to the hand anchor, in
   * window units; the palm is mapped to `target - aimOffset`, so the phalanx lands on the target.
   */
  feed(observation: HandObservation | null, t = observation?.t ?? 0, aimOffset: Point | null = null): { state: CalibrationState; result?: CalibrationResult } {
    if (!observation || observation.score < CALIBRATION.minScore) {
      if (Number.isNaN(this.lostSince)) this.lostSince = t
      if (t - this.lostSince >= CALIBRATION.lostResetMs) { this.resetRun(); this.hint = 'lost' }
      return { state: this.state(t) }
    }
    this.lostSince = Number.NaN
    if (fingerStraightness(observation.world, 'index') < CALIBRATION.minStraight) {
      this.resetRun()
      this.hint = 'point'
      return { state: this.state(t) }
    }
    const center = palmCenter(observation.image)
    const palm = { t, x: this.user(center.x), y: center.y }
    if (!this.farFromCaptures(palm)) {
      this.resetRun()
      this.hint = 'move'
      return { state: this.state(t) }
    }
    const anchor = this.palmRun[0]
    if (!anchor || Math.hypot(palm.x - anchor.x, palm.y - anchor.y) > CALIBRATION.stillRadius) this.resetRun()
    this.palmRun.push(palm)
    this.offsetRun.push(aimOffset ?? { x: 0, y: 0 })
    // After a failed fit the 'retry' notice stays until the first target is captured again.
    if (this.hint !== 'retry') this.hint = 'hold'

    if (t - this.palmRun[0].t < CALIBRATION.holdMs) return { state: this.state(t) }
    this.captures.push({ x: median(this.palmRun.map((point) => point.x)), y: median(this.palmRun.map((point) => point.y)) })
    this.offsets.push({ x: median(this.offsetRun.map((point) => point.x)), y: median(this.offsetRun.map((point) => point.y)) })
    this.resetRun()
    this.step++
    this.hint = 'move'
    if (this.step < CALIBRATION_TARGETS.length) return { state: this.state(t) }

    const result = fitCalibration(this.captures, this.offsets)
    if (!result) {
      // A target was missed (or the hand barely moved): start over rather than keep a skewed map.
      this.captures = []
      this.offsets = []
      this.step = 0
      this.hint = 'retry'
      return { state: this.state(t) }
    }
    return { state: { step: null, progress: 1, hint: 'hold' }, result }
  }

  private user(x: number) {
    return this.mirror ? 1 - x : x
  }

  private resetRun() {
    this.palmRun = []
    this.offsetRun = []
  }

  private farFromCaptures(palm: Point) {
    return this.captures.every((capture) => Math.hypot(palm.x - capture.x, palm.y - capture.y) >= CALIBRATION.minSeparation)
  }

  private state(t: number): CalibrationState {
    const progress = this.palmRun.length ? Math.min(1, (t - this.palmRun[0].t) / CALIBRATION.holdMs) : 0
    return { step: this.step, progress, hint: this.hint }
  }
}

const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)

/**
 * Fits and sanity-checks the camera → window map from palm positions captured while the drawn
 * index phalanx pointed at CALIBRATION_TARGETS (`offsets`: phalanx relative to the palm, window units).
 */
export function fitCalibration(captures: Point[], offsets: Point[] = captures.map(() => ({ x: 0, y: 0 }))): CalibrationResult | null {
  if (captures.length !== CALIBRATION_TARGETS.length) return null
  const [tl, tr, br, bl] = captures
  // The four corners must form a convex quad of reasonable size.
  const turns = [cross(tl, tr, br), cross(tr, br, bl), cross(br, bl, tl), cross(bl, tl, tr)]
  if (!(turns.every((turn) => turn > 0) || turns.every((turn) => turn < 0))) return null
  const width = (Math.hypot(tr.x - tl.x, tr.y - tl.y) + Math.hypot(br.x - bl.x, br.y - bl.y)) / 2
  const height = (Math.hypot(bl.x - tl.x, bl.y - tl.y) + Math.hypot(br.x - tr.x, br.y - tr.y)) / 2
  if (width < CALIBRATION.minWidth || height < CALIBRATION.minHeight) return null

  const anchors = CALIBRATION_TARGETS.map((target, index) => ({ x: target.x - offsets[index].x, y: target.y - offsets[index].y }))
  const homography = solveHomography(captures, anchors)
  if (!homography) return null
  // The scale is linear in x, y, so checking the frame corners covers the whole camera frame.
  const frame = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }]
  if (frame.some((corner) => homographyScale(homography, corner) < CALIBRATION.minScale)) return null
  const residual = Math.max(...captures.map((capture, index) => {
    const mapped = applyHomography(homography, capture)
    return Math.hypot(mapped.x - anchors[index].x, mapped.y - anchors[index].y)
  }))
  if (residual > CALIBRATION.maxResidual) return null

  // Box: the same area as an axis-aligned rectangle, extrapolated from the targets (0.1..0.9 and
  // 0.12..0.88) to the full window. Kept as the fallback map.
  const left = Math.min((tl.x + bl.x) / 2, (tr.x + br.x) / 2)
  const right = Math.max((tl.x + bl.x) / 2, (tr.x + br.x) / 2)
  const top = Math.min((tl.y + tr.y) / 2, (bl.y + br.y) / 2)
  const bottom = Math.max((tl.y + tr.y) / 2, (bl.y + br.y) / 2)
  const spanX = (right - left) / 0.8
  const spanY = (bottom - top) / 0.76
  const x0 = left - 0.1 * spanX
  const y0 = top - 0.12 * spanY
  return { box: { x0, y0, x1: x0 + spanX, y1: y0 + spanY }, homography }
}
