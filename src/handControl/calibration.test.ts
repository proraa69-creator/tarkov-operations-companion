import { describe, expect, it } from 'vitest'
import { CALIBRATION, CalibrationSession } from './calibration'
import { syntheticHand } from './testHand'

const STEP = 1000 / 30
const hand = (x: number, y: number, t: number) => syntheticHand({ x, y, k: 1000, fingers: { index: 20 }, t })

function feedFor(session: CalibrationSession, from: number, ms: number, at: (t: number) => ReturnType<typeof hand> | null) {
  let last: ReturnType<CalibrationSession['feed']> | null = null
  for (let t = from; t < from + ms; t += STEP) {
    last = session.feed(at(t), t)
    if (last.box) return { end: t, result: last }
  }
  return { end: from + ms, result: last! }
}

describe('CalibrationSession', () => {
  it('captures each corner once the palm is held still, and returns the box', () => {
    const session = new CalibrationSession(false)
    // Moving towards the corner: nothing is captured while moving.
    const moving = feedFor(session, 0, 600, (t) => hand(0.2 + t / 6000, 0.4, t))
    expect(moving.result.state.step).toBe('top-left')
    const first = feedFor(session, moving.end, CALIBRATION.holdMs + 100, (t) => hand(0.3, 0.4, t))
    expect(first.result.state.step).toBe('bottom-right')
    // Still at the first corner: the second step waits for the hand to move away.
    const stay = feedFor(session, first.end, 1500, (t) => hand(0.3, 0.4, t))
    expect(stay.result.box).toBeUndefined()
    expect(stay.result.state.hint).toBe('move')
    const second = feedFor(session, stay.end, CALIBRATION.holdMs + 200, (t) => hand(0.7, 0.8, t))
    expect(second.result.box).toBeDefined()
    const box = second.result.box!
    expect(box.x1 - box.x0).toBeCloseTo(0.4, 2)
    expect(box.y1 - box.y0).toBeCloseTo(0.4, 2)
  })

  it('a short tracking dropout does not reset the progress', () => {
    const session = new CalibrationSession(false)
    feedFor(session, 0, 500, (t) => hand(0.3, 0.4, t))
    const blip = feedFor(session, 500, 150, () => null)
    expect(blip.result.state.progress).toBeGreaterThan(0.5)
    const done = feedFor(session, 650, 300, (t) => hand(0.3, 0.4, t))
    expect(done.result.state.step).toBe('bottom-right')
  })

  it('mirrors x like the pointer does', () => {
    const session = new CalibrationSession(true)
    feedFor(session, 0, CALIBRATION.holdMs + 100, (t) => hand(0.7, 0.4, t))
    const second = feedFor(session, 1000, CALIBRATION.holdMs + 200, (t) => hand(0.3, 0.8, t))
    expect(second.result.box!.x0).toBeCloseTo(0.3, 2)
  })
})
