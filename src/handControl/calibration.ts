import { calibrationFromCorners, palmCenter } from './handGeometry'
import type { CalibrationBox, HandObservation } from './types'

export type CalibrationStep = 'top-left' | 'bottom-right'
export type CalibrationHint = 'hold' | 'move' | 'lost'

export interface CalibrationState {
  step: CalibrationStep | null
  /** 0..1 how long the palm has been held still at the current corner */
  progress: number
  hint: CalibrationHint
}

export const CALIBRATION = {
  holdMs: 800,
  stillRadius: 0.03,
  lostResetMs: 400,
  /** the second corner must be clearly away from the first (user-space units) */
  minSpan: 0.15,
  minScore: 0.5,
} as const

type Sample = { t: number; x: number; y: number }

/**
 * Two-corner calibration of the comfortable hand area. The pointer keeps moving meanwhile (the
 * gesture engine runs as usual, only its events are dropped); a corner is captured once the palm
 * stays still for a moment — no countdown races, no fixed timing.
 */
export class CalibrationSession {
  private step: CalibrationStep = 'top-left'
  private run: Sample[] = []
  private lostSince = Number.NaN
  private topLeft: Sample[] = []
  private hint: CalibrationHint = 'hold'

  constructor(private readonly mirror: boolean) {}

  /** Feeds one observation; returns the box when both corners are captured. */
  feed(observation: HandObservation | null, t = observation?.t ?? 0): { state: CalibrationState; box?: CalibrationBox } {
    if (!observation || observation.score < CALIBRATION.minScore) {
      if (Number.isNaN(this.lostSince)) this.lostSince = t
      if (t - this.lostSince >= CALIBRATION.lostResetMs) { this.run = []; this.hint = 'lost' }
      return { state: this.state(t) }
    }
    this.lostSince = Number.NaN
    const center = palmCenter(observation.image)
    const sample = { t, x: this.mirror ? 1 - center.x : center.x, y: center.y }

    if (this.step === 'bottom-right' && !this.farEnough(sample)) {
      this.run = []
      this.hint = 'move'
      return { state: this.state(t) }
    }
    const anchor = this.run[0]
    if (!anchor || Math.hypot(sample.x - anchor.x, sample.y - anchor.y) > CALIBRATION.stillRadius) this.run = [sample]
    else this.run.push(sample)
    this.hint = 'hold'

    if (t - this.run[0].t < CALIBRATION.holdMs) return { state: this.state(t) }
    if (this.step === 'top-left') {
      this.topLeft = this.run
      this.run = []
      this.step = 'bottom-right'
      this.hint = 'move'
      return { state: this.state(t) }
    }
    const box = calibrationFromCorners(this.topLeft, this.run)
    if (!box) {
      this.run = []
      this.hint = 'move'
      return { state: this.state(t) }
    }
    return { state: { step: null, progress: 1, hint: 'hold' }, box }
  }

  private farEnough(sample: Sample) {
    const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
    const x0 = median(this.topLeft.map((point) => point.x))
    const y0 = median(this.topLeft.map((point) => point.y))
    return sample.x - x0 >= CALIBRATION.minSpan && sample.y - y0 >= CALIBRATION.minSpan
  }

  private state(t: number): CalibrationState {
    const progress = this.run.length ? Math.min(1, (t - this.run[0].t) / CALIBRATION.holdMs) : 0
    return { step: this.step, progress, hint: this.hint }
  }
}
