import { describe, expect, it } from 'vitest'
import { CALIBRATION, CALIBRATION_TARGETS, CalibrationSession, fitCalibration } from './calibration'
import { applyHomography, solveHomography, toWindowSpace } from './handGeometry'
import { syntheticHand } from './testHand'
import { DEFAULT_SETTINGS, LM } from './types'

const STEP = 1000 / 30
const K = 1000
// Where the index tip lands relative to the wrist position of a synthetic hand.
const reference = syntheticHand({ x: 0, y: 0, k: K, fingers: { index: 20 }, t: 0 }).image[LM.INDEX_TIP]
/** A pointing hand whose index tip is at (x, y) in the camera image. */
const handWithTipAt = (x: number, y: number, t: number, fingers: { index?: number } = { index: 20 }) =>
  syntheticHand({ x: x - reference.x, y: y - reference.y, k: K, fingers, t })

/**
 * Camera above the monitor looking down at the hand: the far (upper) part of the screen is seen
 * smaller — a keystone. Screen point → where the fingertip appears in the (unmirrored) image.
 */
const keystone = (p: { x: number; y: number }) => {
  const shrink = 0.7 + 0.3 * p.y // top row 70 % as wide as the bottom row
  return { x: 0.5 + (p.x - 0.5) * 0.5 * shrink, y: 0.25 + p.y * 0.4 }
}

function feedFor(session: CalibrationSession, from: number, ms: number, at: (t: number) => ReturnType<typeof handWithTipAt> | null) {
  let last: ReturnType<CalibrationSession['feed']> | null = null
  for (let t = from; t < from + ms; t += STEP) {
    last = session.feed(at(t), t)
    if (last.result) return { end: t, result: last }
  }
  return { end: from + ms, result: last! }
}

/** Points at every target in turn, the way `project` places the fingertip in the image. */
function calibrate(session: CalibrationSession, project: (p: { x: number; y: number }) => { x: number; y: number }) {
  let t = 0
  let last = null as ReturnType<typeof feedFor> | null
  for (const target of CALIBRATION_TARGETS) {
    const tip = project(target)
    last = feedFor(session, t, CALIBRATION.holdMs + 200, (time) => handWithTipAt(tip.x, tip.y, time))
    t = last.end + STEP
  }
  return last!.result
}

describe('homography', () => {
  it('recovers a projective map from five point pairs', () => {
    const src = CALIBRATION_TARGETS.map(keystone)
    const h = solveHomography(src, [...CALIBRATION_TARGETS])!
    expect(h).not.toBeNull()
    for (const point of [{ x: 0.3, y: 0.7 }, { x: 0.75, y: 0.2 }]) {
      const mapped = applyHomography(h, keystone(point))
      // A keystone is not exactly projective in this toy model, but close enough inside the targets.
      expect(Math.hypot(mapped.x - point.x, mapped.y - point.y)).toBeLessThan(0.03)
    }
  })

  it('refuses points on a line', () => {
    const line = [0, 0.25, 0.5, 0.75, 1].map((v) => ({ x: v, y: v }))
    expect(solveHomography(line, [...CALIBRATION_TARGETS])).toBeNull()
  })

  it('is used by toWindowSpace instead of the box, after mirroring', () => {
    const h = solveHomography(CALIBRATION_TARGETS.map(keystone), [...CALIBRATION_TARGETS])!
    const image = keystone({ x: 0.3, y: 0.6 })
    const mapped = toWindowSpace({ x: 1 - image.x, y: image.y }, DEFAULT_SETTINGS.calibration, true, h)
    expect(mapped.x).toBeCloseTo(0.3, 1)
    expect(mapped.y).toBeCloseTo(0.6, 1)
  })
})

describe('CalibrationSession (5 points)', () => {
  it('captures each target once the hand is held still and fits the camera angle', () => {
    const session = new CalibrationSession(false)
    const result = calibrate(session, keystone)
    expect(result.result).toBeDefined()
    const { homography, box } = result.result!
    // The fingertip seen where the screen point (0.3, 0.6) is now maps onto it.
    const mapped = applyHomography(homography, keystone({ x: 0.3, y: 0.6 }))
    expect(Math.hypot(mapped.x - 0.3, mapped.y - 0.6)).toBeLessThan(0.03)
    expect(box.x1).toBeGreaterThan(box.x0)
    expect(box.y1).toBeGreaterThan(box.y0)
  })

  it('does not capture while the hand moves, and asks to move on after a capture', () => {
    const session = new CalibrationSession(false)
    const moving = feedFor(session, 0, 1500, (t) => handWithTipAt(0.3 + t / 6000, 0.3, t))
    expect(moving.result.state.step).toBe(0)
    const first = feedFor(session, moving.end, CALIBRATION.holdMs + 100, (t) => handWithTipAt(0.3, 0.3, t))
    expect(first.result.state.step).toBe(1)
    // Still at the first target: the second one waits for the finger to point elsewhere.
    const stay = feedFor(session, first.end, 1500, (t) => handWithTipAt(0.3, 0.3, t))
    expect(stay.result.state.step).toBe(1)
    expect(stay.result.state.hint).toBe('move')
  })

  it('asks for an extended index finger', () => {
    const session = new CalibrationSession(false)
    const folded = feedFor(session, 0, 1500, (t) => handWithTipAt(0.3, 0.3, t, {}))
    expect(folded.result.state.step).toBe(0)
    expect(folded.result.state.hint).toBe('point')
  })

  it('a short tracking dropout does not reset the progress', () => {
    const session = new CalibrationSession(false)
    feedFor(session, 0, 500, (t) => handWithTipAt(0.3, 0.3, t))
    const blip = feedFor(session, 500, 150, () => null)
    expect(blip.result.state.progress).toBeGreaterThan(0.5)
    const done = feedFor(session, 650, 300, (t) => handWithTipAt(0.3, 0.3, t))
    expect(done.result.state.step).toBe(1)
  })

  it('starts over when the targets do not line up', () => {
    const session = new CalibrationSession(false)
    // The "centre" was aimed far off, towards the bottom-right corner.
    const result = calibrate(session, (p) => (p.x === 0.5 ? keystone({ x: 0.75, y: 0.75 }) : keystone(p)))
    expect(result.result).toBeUndefined()
    expect(result.state).toEqual(expect.objectContaining({ step: 0, hint: 'retry' }))
  })

  it('works in mirrored mode like the pointer does', () => {
    const session = new CalibrationSession(true)
    const result = calibrate(session, (p) => { const image = keystone(p); return { x: 1 - image.x, y: image.y } })
    const image = keystone({ x: 0.7, y: 0.4 })
    const mapped = toWindowSpace({ x: 1 - image.x, y: image.y }, result.result!.box, true, result.result!.homography)
    expect(Math.hypot(mapped.x - 0.7, mapped.y - 0.4)).toBeLessThan(0.03)
  })
})

describe('fitCalibration', () => {
  it('rejects a crossed (non-convex) corner order', () => {
    const captures = CALIBRATION_TARGETS.map(keystone)
    ;[captures[1], captures[2]] = [captures[2], captures[1]]
    expect(fitCalibration(captures)).toBeNull()
  })

  it('rejects a tiny area', () => {
    expect(fitCalibration(CALIBRATION_TARGETS.map((p) => ({ x: 0.5 + p.x * 0.05, y: 0.5 + p.y * 0.05 })))).toBeNull()
  })
})
