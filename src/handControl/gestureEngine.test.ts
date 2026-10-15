import { describe, expect, it } from 'vitest'
import { ENGINE, HandGestureEngine } from './gestureEngine'
import { GHOST_PALM_PX } from './ghostPose'
import { indexTipAt, syntheticHand, THUMB_OUT, type SyntheticHand } from './testHand'
import { DEFAULT_SETTINGS as BASE_SETTINGS, type HandEvent, type HandFrame, type Point3 } from './types'

// These tests and recordings use the index-fold tap; the pinch click has its own tests.
const DEFAULT_SETTINGS = { ...BASE_SETTINGS, clickMode: 'tap' as const }

const FPS = 30
const STEP = 1000 / FPS
const pointing = { index: 30 }
const raisedTwo = { index: 15, middle: 15 }

function run(engine: HandGestureEngine, from: number, ms: number, hand: (t: number, progress: number) => Omit<SyntheticHand, 't'> | null) {
  const frames: HandFrame[] = []
  for (let t = from; t < from + ms; t += STEP) {
    const spec = hand(t, (t - from) / ms)
    frames.push(spec ? engine.process(syntheticHand({ ...spec, t })) : engine.process(null, t))
  }
  return { frames, end: from + ms, events: frames.flatMap((frame) => frame.events) }
}

const types = (events: HandEvent[]) => events.map((event) => event.type)
const lerp = (a: number, b: number, p: number) => a + (b - a) * p

/** Pointing → index folds to `to` degrees in `foldMs` → holds → unfolds. */
function tap(engine: HandGestureEngine, from: number, { to = 110, foldMs = 120, holdMs = 150, x = 0.5, extra = {} as Partial<Omit<SyntheticHand, 't'>> } = {}) {
  const fold = run(engine, from, foldMs, (_t, p) => ({ x, y: 0.6, k: 1000, fingers: { index: lerp(30, to, p) }, ...extra }))
  const hold = run(engine, fold.end, holdMs, () => ({ x, y: 0.6, k: 1000, fingers: { index: to }, ...extra }))
  const back = run(engine, hold.end, 120, (_t, p) => ({ x, y: 0.6, k: 1000, fingers: { index: lerp(to, 30, p) }, ...extra }))
  const rest = run(engine, back.end, 150, () => ({ x, y: 0.6, k: 1000, fingers: pointing, ...extra }))
  const frames = [...fold.frames, ...hold.frames, ...back.frames, ...rest.frames]
  return { frames, end: rest.end, events: frames.flatMap((frame) => frame.events) }
}

describe('HandGestureEngine — pointing', () => {
  it('aims with the drawn index distal phalanx, placed on the palm (calibrated, mirrored)', () => {
    const engine = new HandGestureEngine({ ...DEFAULT_SETTINGS, calibration: { x0: 0, y0: 0, x1: 1, y1: 1 } })
    const { frames } = run(engine, 0, 500, () => ({ x: 0.3, y: 0.6, k: 1000, fingers: { index: 0 } }))
    const last = frames.at(-1)!
    expect(last.tracking).toBe('good')
    expect(last.phase).toBe('point')
    // The drawn hand stands on the palm centre (mean of wrist and knuckles), mirrored.
    expect(last.hand!.x).toBeCloseTo(0.7, 3)
    expect(last.hand!.y).toBeCloseTo(0.6 - (0.072 * 1000) / 480, 3)
    // Its fingers keep their real shape at GHOST_PALM_PX per palm span (0.0949 m here): the middle
    // of the distal phalanx is 0.03 m to the side and 0.093 m above the palm centre.
    const span = Math.hypot(0.03, 0.09)
    expect(last.pointer!.x - last.hand!.x).toBeCloseTo(((0.03 / span) * GHOST_PALM_PX) / 1920, 4)
    expect(last.pointer!.y - last.hand!.y).toBeCloseTo((-(0.093 / span) * GHOST_PALM_PX) / 1080, 4)
    expect(last.skeleton).toHaveLength(21)
    expect(last.events).toEqual([])
  })

  it('a still hand stays exactly still on screen whatever the fingers do (tracking noise and knuckle shifts included)', () => {
    const engine = new HandGestureEngine(DEFAULT_SETTINGS)
    const rest = run(engine, 0, 800, () => ({ x: 0.5, y: 0.6, k: 1000, fingers: pointing }))
    const before = rest.frames.at(-1)!.hand!
    // Noise up to ±0.04 span, and folding fingers drag the knuckles (the palm centre) by up to
    // 0.5 span — as MediaPipe does on real taps.
    const noise = (t: number) => 0.04 * 95 * Math.sin(t * 0.37) / 640
    const fingers = run(engine, rest.end, 3000, (t, p) => {
      const fold = Math.abs(Math.sin(p * 14))
      return { x: 0.5 + noise(t), y: 0.6 + (fold * 0.5 * 95) / 480 + noise(t * 1.3) * 0.75, k: 1000, fingers: { index: lerp(30, 120, fold), middle: lerp(0, 90, Math.abs(Math.cos(p * 9))) } }
    })
    for (const frame of fingers.frames) {
      expect(frame.hand!.x).toBeCloseTo(before.x, 4)
      expect(frame.hand!.y).toBeCloseTo(before.y, 4)
    }
  })

  it('the hand follows as soon as the whole hand really moves', () => {
    const engine = new HandGestureEngine(DEFAULT_SETTINGS)
    const rest = run(engine, 0, 800, () => ({ x: 0.5, y: 0.6, k: 1000, fingers: pointing }))
    const before = rest.frames.at(-1)!.hand!
    const move = run(engine, rest.end, 400, (_t, p) => ({ x: 0.5 - 0.2 * p, y: 0.6, k: 1000, fingers: pointing }))
    // Mirrored: the hand moving left in the image goes right on screen, trailing a little.
    expect(move.frames.at(-1)!.hand!.x - before.x).toBeGreaterThan(0.25)
  })

  it('folding, flicking or pinching fingers does not move the hand or the aim — only the hand moves them', () => {
    const engine = new HandGestureEngine(DEFAULT_SETTINGS)
    const rest = run(engine, 0, 800, () => ({ x: 0.5, y: 0.6, k: 1000, fingers: pointing }))
    const before = rest.frames.at(-1)!.hand!
    const fingers = run(engine, rest.end, 1500, (_t, p) => ({ x: 0.5, y: 0.6, k: 1000, fingers: { index: lerp(0, 120, Math.abs(Math.sin(p * 9))), middle: lerp(0, 120, Math.abs(Math.cos(p * 7))) }, thumbTip: p > 0.5 ? THUMB_OUT : undefined }))
    for (const frame of fingers.frames) {
      expect(Math.abs(frame.hand!.x - before.x)).toBeLessThan(0.005)
      expect(Math.abs(frame.hand!.y - before.y)).toBeLessThan(0.005)
    }
  })

  it('holds the pointer through a short dropout without emitting events', () => {
    const engine = new HandGestureEngine(DEFAULT_SETTINGS)
    const rest = run(engine, 0, 600, () => ({ x: 0.5, y: 0.6, k: 1000, fingers: pointing }))
    const blip = run(engine, rest.end, 60, () => null)
    expect(blip.events).toEqual([])
    expect(blip.frames.every((frame) => frame.pointer && frame.tracking === 'weak')).toBe(true)
  })
})

describe('HandGestureEngine — tap (index fold)', () => {
  it('presses on a quick fold and clicks on unfold at the aim point from before the fold', () => {
    const engine = new HandGestureEngine(DEFAULT_SETTINGS)
    const rest = run(engine, 0, 800, () => ({ x: 0.5, y: 0.6, k: 1000, fingers: pointing }))
    const aim = rest.frames.at(-1)!.pointer!
    const result = tap(engine, rest.end)
    expect(types(result.events)).toEqual(['press', 'click'])
    const click = result.events.find((event) => event.type === 'click') as Extract<HandEvent, { type: 'click' }>
    // The fingertip drops a lot while folding; the click stays where the user aimed.
    expect(Math.abs(click.y - aim.y)).toBeLessThan(0.03)
    expect(Math.abs(click.x - aim.x)).toBeLessThan(0.03)
    expect(Math.max(...result.frames.map((frame) => frame.indexFlex))).toBeGreaterThan(100)
  })

  it('ignores a slow curl of the index finger', () => {
    const engine = new HandGestureEngine(DEFAULT_SETTINGS)
    run(engine, 0, 800, () => ({ x: 0.5, y: 0.6, k: 1000, fingers: pointing }))
    const curl = run(engine, 800, 2500, (_t, p) => ({ x: 0.5, y: 0.6, k: 1000, fingers: { index: lerp(30, 115, p) } }))
    expect(curl.events).toEqual([])
  })

  it('cancels when the finger stays folded (resting, not a tap)', () => {
    const engine = new HandGestureEngine(DEFAULT_SETTINGS)
    const rest = run(engine, 0, 800, () => ({ x: 0.5, y: 0.6, k: 1000, fingers: pointing }))
    const long = tap(engine, rest.end, { holdMs: ENGINE.maxPressMs + 200 })
    expect(types(long.events)).toEqual(['press', 'cancel'])
  })

  it('cancels a press without clicking when the hand is lost', () => {
    const engine = new HandGestureEngine(DEFAULT_SETTINGS)
    const rest = run(engine, 0, 800, () => ({ x: 0.5, y: 0.6, k: 1000, fingers: pointing }))
    const fold = run(engine, rest.end, 150, (_t, p) => ({ x: 0.5, y: 0.6, k: 1000, fingers: { index: lerp(30, 110, p) } }))
    const gone = run(engine, fold.end, 400, () => null)
    expect(types([...fold.events, ...gone.events])).toEqual(['press', 'cancel'])
    const last = gone.frames.at(-1)!
    expect(last.tracking).toBe('none')
    expect(last.pointer).toBeNull()
  })

  it('never presses with weak tracking confidence', () => {
    const engine = new HandGestureEngine(DEFAULT_SETTINGS)
    const rest = run(engine, 0, 800, () => ({ x: 0.5, y: 0.6, k: 1000, fingers: pointing, score: 0.6 }))
    expect(tap(engine, rest.end, { extra: { score: 0.6 } }).events).toEqual([])
  })

  it('keeps a cooldown between consecutive taps', () => {
    const engine = new HandGestureEngine(DEFAULT_SETTINGS)
    let t = run(engine, 0, 800, () => ({ x: 0.5, y: 0.6, k: 1000, fingers: pointing })).end
    const frames: HandFrame[] = []
    for (let i = 0; i < 3; i++) {
      const result = tap(engine, t, { holdMs: 60 })
      frames.push(...result.frames)
      t = result.end
    }
    const at = (type: HandEvent['type']) => frames.filter((frame) => frame.events.some((event) => event.type === type)).map((frame) => frame.t)
    expect(at('click').length).toBe(3)
    for (const click of at('click')) {
      const next = at('press').find((press) => press > click)
      if (next !== undefined) expect(next - click).toBeGreaterThanOrEqual(ENGINE.clickCooldownMs)
    }
  })

  it('poke mode: a quick push of the hand presses, pulling back clicks; a fold does nothing', () => {
    const engine = new HandGestureEngine({ ...DEFAULT_SETTINGS, clickMode: 'poke' })
    const rest = run(engine, 0, 1000, () => ({ x: 0.5, y: 0.6, k: 1000, fingers: pointing }))
    const folded = tap(engine, rest.end)
    expect(folded.events).toEqual([])
    const calm = run(engine, folded.end, 1200, () => ({ x: 0.5, y: 0.6, k: 1000, fingers: pointing }))
    const push = run(engine, calm.end, 150, (_t, p) => ({ x: 0.5, y: 0.6, k: 1000 * (1 + 0.12 * p), fingers: pointing }))
    const hold = run(engine, push.end, 60, () => ({ x: 0.5, y: 0.6, k: 1120, fingers: pointing }))
    const back = run(engine, hold.end, 150, (_t, p) => ({ x: 0.5, y: 0.6, k: 1120 - 120 * p, fingers: pointing }))
    const settle = run(engine, back.end, 300, () => ({ x: 0.5, y: 0.6, k: 1000, fingers: pointing }))
    expect(types([...push.events, ...hold.events, ...back.events, ...settle.events])).toEqual(['press', 'click'])
  })

  it('tap mode ignores a push or slow lean of the whole hand', () => {
    const engine = new HandGestureEngine(DEFAULT_SETTINGS)
    run(engine, 0, 1000, () => ({ x: 0.5, y: 0.6, k: 1000, fingers: pointing }))
    const push = run(engine, 1000, 150, (_t, p) => ({ x: 0.5, y: 0.6, k: 1000 * (1 + 0.15 * p), fingers: pointing }))
    const lean = run(engine, push.end, 4000, (_t, p) => ({ x: 0.5, y: 0.6, k: 1150 * (1 + 0.1 * p), fingers: pointing }))
    expect([...push.events, ...lean.events]).toEqual([])
  })
})

describe('HandGestureEngine — two-finger scrolling', () => {
  function enterScroll(engine: HandGestureEngine, y = 0.6) {
    const rest = run(engine, 0, 600, () => ({ x: 0.5, y, k: 1000, fingers: pointing }))
    const pose = run(engine, rest.end, 300, () => ({ x: 0.5, y, k: 1000, fingers: raisedTwo }))
    return { rest, pose }
  }

  it('each quick fold of both fingers scrolls one step; their return does not scroll back', () => {
    const engine = new HandGestureEngine(DEFAULT_SETTINGS)
    const { pose } = enterScroll(engine)
    expect(types(pose.events)).toEqual(['scroll-start'])
    let t = pose.end
    const events: HandEvent[] = []
    for (let i = 0; i < 3; i++) {
      const fold = run(engine, t, 120, (_t, p) => ({ x: 0.5, y: 0.6, k: 1000, fingers: { index: lerp(15, 105, p), middle: lerp(15, 105, p) } }))
      const hold = run(engine, fold.end, 200, () => ({ x: 0.5, y: 0.6, k: 1000, fingers: { index: 105, middle: 105 } }))
      const back = run(engine, hold.end, 120, (_t, p) => ({ x: 0.5, y: 0.6, k: 1000, fingers: { index: lerp(105, 15, p), middle: lerp(105, 15, p) } }))
      const up = run(engine, back.end, 300, () => ({ x: 0.5, y: 0.6, k: 1000, fingers: raisedTwo }))
      events.push(...fold.events, ...hold.events, ...back.events, ...up.events)
      t = up.end
    }
    const scrolls = events.filter((event) => event.type === 'scroll') as Array<Extract<HandEvent, { type: 'scroll' }>>
    expect(scrolls.map((event) => [event.dy, event.step])).toEqual([[0.35, true], [0.35, true], [0.35, true]])
    expect(types(events)).not.toContain('click')
    expect(types(events)).not.toContain('scroll-end')
  })

  it('flick direction setting reverses the step', () => {
    const engine = new HandGestureEngine({ ...DEFAULT_SETTINGS, flickDirection: 'up' })
    const { pose } = enterScroll(engine)
    const fold = run(engine, pose.end, 120, (_t, p) => ({ x: 0.5, y: 0.6, k: 1000, fingers: { index: lerp(15, 105, p), middle: lerp(15, 105, p) } }))
    const step = fold.events.find((event) => event.type === 'scroll') as Extract<HandEvent, { type: 'scroll' }>
    expect(step.dy).toBeLessThan(0)
  })

  it('moving the raised hand up scrolls continuously (natural), pointer stays anchored', () => {
    const engine = new HandGestureEngine(DEFAULT_SETTINGS)
    const { pose } = enterScroll(engine)
    const anchor = pose.frames.at(-1)!.pointer!
    const move = run(engine, pose.end, 600, (_t, p) => ({ x: 0.5, y: 0.6 - 0.25 * p, k: 1000, fingers: raisedTwo }))
    const drags = move.events.filter((event) => event.type === 'scroll' && !event.step) as Array<Extract<HandEvent, { type: 'scroll' }>>
    expect(drags.length).toBeGreaterThan(5)
    expect(drags.reduce((sum, event) => sum + event.dy, 0)).toBeGreaterThan(0.3)
    expect(move.frames.every((frame) => frame.phase === 'scroll' && frame.pointer!.y === anchor.y)).toBe(true)
  })

  it('small hand drift does not scroll', () => {
    const engine = new HandGestureEngine(DEFAULT_SETTINGS)
    const { pose } = enterScroll(engine)
    const drift = run(engine, pose.end, 600, (_t, p) => ({ x: 0.5, y: 0.6 - 0.015 * Math.sin(p * Math.PI * 2), k: 1000, fingers: raisedTwo }))
    expect(drift.events).toEqual([])
  })

  it('returns to pointing when only the index stays raised', () => {
    const engine = new HandGestureEngine(DEFAULT_SETTINGS)
    const { pose } = enterScroll(engine)
    const back = run(engine, pose.end, 400, () => ({ x: 0.5, y: 0.6, k: 1000, fingers: pointing }))
    expect(types(back.events)).toEqual(['scroll-end'])
    expect(back.frames.at(-1)!.phase).toBe('point')
  })

  it('quick flicks in a row scroll further and further (up to 3× a step)', () => {
    const engine = new HandGestureEngine(DEFAULT_SETTINGS)
    const { pose } = enterScroll(engine)
    let t = pose.end
    const events: HandEvent[] = []
    for (let i = 0; i < 5; i++) {
      const fold = run(engine, t, 120, (_t, p) => ({ x: 0.5, y: 0.6, k: 1000, fingers: { index: lerp(15, 105, p), middle: lerp(15, 105, p) } }))
      const back = run(engine, fold.end, 120, (_t, p) => ({ x: 0.5, y: 0.6, k: 1000, fingers: { index: lerp(105, 15, p), middle: lerp(105, 15, p) } }))
      const up = run(engine, back.end, 200, () => ({ x: 0.5, y: 0.6, k: 1000, fingers: raisedTwo }))
      events.push(...fold.events, ...back.events, ...up.events)
      t = up.end
    }
    const steps = (events.filter((event) => event.type === 'scroll') as Array<Extract<HandEvent, { type: 'scroll' }>>).map((event) => event.dy)
    expect(steps.map((dy) => Number(dy.toFixed(3)))).toEqual([0.35, 0.525, 0.787, 1.05, 1.05])
    // A pause resets the chain.
    run(engine, t, 900, () => ({ x: 0.5, y: 0.6, k: 1000, fingers: raisedTwo }))
    const again = run(engine, t + 900, 120, (_t, p) => ({ x: 0.5, y: 0.6, k: 1000, fingers: { index: lerp(15, 105, p), middle: lerp(15, 105, p) } }))
    expect(again.events.filter((event) => event.type === 'scroll').map((event) => (event as { dy: number }).dy)).toEqual([0.35])
  })

  it('a fast swipe of the raised hand flings the content; the stroke back does not undo it', () => {
    const engine = new HandGestureEngine(DEFAULT_SETTINGS)
    const { pose } = enterScroll(engine)
    const swipe = run(engine, pose.end, 150, (_t, p) => ({ x: 0.5, y: lerp(0.6, 0.35, p), k: 1000, fingers: raisedTwo }))
    const hold = run(engine, swipe.end, 100, () => ({ x: 0.5, y: 0.35, k: 1000, fingers: raisedTwo }))
    const flings = [...swipe.events, ...hold.events].filter((event) => event.type === 'fling') as Array<Extract<HandEvent, { type: 'fling' }>>
    expect(flings).toHaveLength(1)
    // Hand up with natural scrolling → content further down, like the drag; several screens/s.
    expect(flings[0].v).toBeGreaterThan(3)
    const back = run(engine, hold.end, 250, (_t, p) => ({ x: 0.5, y: lerp(0.35, 0.6, p), k: 1000, fingers: raisedTwo }))
    const rest = run(engine, back.end, 300, () => ({ x: 0.5, y: 0.6, k: 1000, fingers: raisedTwo }))
    const after = [...back.events, ...rest.events]
    expect(types(after)).not.toContain('fling')
    const dragBack = (after.filter((event) => event.type === 'scroll') as Array<Extract<HandEvent, { type: 'scroll' }>>).reduce((sum, event) => sum + event.dy, 0)
    expect(Math.abs(dragBack)).toBeLessThan(0.15)
  })

  it('swiping down flings the other way; a slow move only drags', () => {
    const engine = new HandGestureEngine(DEFAULT_SETTINGS)
    const { pose } = enterScroll(engine, 0.35)
    const swipe = run(engine, pose.end, 150, (_t, p) => ({ x: 0.5, y: lerp(0.35, 0.6, p), k: 1000, fingers: raisedTwo }))
    const fling = swipe.events.find((event) => event.type === 'fling') as Extract<HandEvent, { type: 'fling' }>
    expect(fling.v).toBeLessThan(-3)
    const slow = new HandGestureEngine(DEFAULT_SETTINGS)
    const entered = enterScroll(slow)
    const move = run(slow, entered.pose.end, 900, (_t, p) => ({ x: 0.5, y: lerp(0.6, 0.35, p), k: 1000, fingers: raisedTwo }))
    expect(types(move.events)).not.toContain('fling')
  })

  it('a fist stops content still coasting after a swipe', () => {
    const engine = new HandGestureEngine(DEFAULT_SETTINGS)
    const { pose } = enterScroll(engine)
    const swipe = run(engine, pose.end, 150, (_t, p) => ({ x: 0.5, y: lerp(0.6, 0.35, p), k: 1000, fingers: raisedTwo }))
    expect(types(swipe.events)).toContain('fling')
    const fist = run(engine, swipe.end, 1000, () => ({ x: 0.5, y: 0.35, k: 1000 }))
    expect(fist.events.filter((event) => event.type === 'fling')).toEqual([expect.objectContaining({ v: 0 })])
  })

  it('does not treat an open palm as the scroll pose', () => {
    const engine = new HandGestureEngine(DEFAULT_SETTINGS)
    const open = run(engine, 0, 800, () => ({ x: 0.5, y: 0.6, k: 1000, fingers: { index: 10, middle: 10, ring: 10, pinky: 10 } }))
    expect(open.events).toEqual([])
  })
})

describe('HandGestureEngine — no fixation while the hand moves', () => {
  it('a hand sweeping across the screen with depth wobble never freezes and never presses or grabs', () => {
    const engine = new HandGestureEngine({ ...DEFAULT_SETTINGS, clickMode: 'both' })
    run(engine, 0, 500, () => ({ x: 0.3, y: 0.6, k: 1000, fingers: pointing }))
    // Sideways sweep while drifting 10% closer and back (people do not move in a perfect plane).
    const sweep = run(engine, 500, 1200, (_t, p) => ({ x: 0.3 + 0.4 * p, y: 0.6, k: 1000 * (1 + 0.1 * Math.sin(p * Math.PI)), fingers: pointing }))
    expect(sweep.events).toEqual([])
    const xs = sweep.frames.map((frame) => frame.pointer!.x)
    for (let i = 3; i < xs.length; i++) expect(xs[i]).not.toBe(xs[i - 1])
    const palm = { x: 0.3, y: 0.6, k: 1000, fingers: { index: 10, middle: 10, ring: 10, pinky: 10 }, thumbTip: THUMB_OUT }
    const palmSweep = run(engine, sweep.end, 1200, (_t, p) => ({ ...palm, x: 0.7 - 0.4 * p, k: 1000 * (1 + 0.12 * Math.sin(p * Math.PI)) }))
    expect(palmSweep.events).toEqual([])
  })

  it('a fold made while the hand is moving is not a tap', () => {
    const engine = new HandGestureEngine(DEFAULT_SETTINGS)
    run(engine, 0, 500, () => ({ x: 0.3, y: 0.6, k: 1000, fingers: pointing }))
    const moving = run(engine, 500, 600, (_t, p) => ({ x: 0.3 + 0.4 * p, y: 0.6, k: 1000, fingers: { index: p < 0.3 ? 30 : p < 0.5 ? lerp(30, 110, (p - 0.3) / 0.2) : lerp(110, 30, Math.min(1, (p - 0.5) / 0.2)) } }))
    expect(moving.events).toEqual([])
  })

  it('releases a held aim as soon as the hand moves on', () => {
    const engine = new HandGestureEngine(DEFAULT_SETTINGS)
    run(engine, 0, 800, () => ({ x: 0.5, y: 0.6, k: 1000, fingers: pointing }))
    // Half a fold (not a tap) freezes the aim, then the hand moves away.
    const half = run(engine, 800, 60, (_t, p) => ({ x: 0.5, y: 0.6, k: 1000, fingers: { index: lerp(30, 55, p) } }))
    const frozen = half.frames.at(-1)!.pointer!
    const move = run(engine, half.end, 200, (_t, p) => ({ x: 0.5 + 0.2 * p, y: 0.6, k: 1000, fingers: { index: 55 } }))
    expect(move.frames.at(-1)!.pointer!.x).not.toBeCloseTo(frozen.x, 2)
    expect(move.events).toEqual([])
  })

})

describe('HandGestureEngine — zoom with the L pose (index up, thumb out)', () => {
  const L = { x: 0.5, y: 0.6, k: 1000, fingers: pointing, thumbTip: THUMB_OUT }

  function enterZoom(engine: HandGestureEngine) {
    run(engine, 0, 600, () => ({ x: 0.5, y: 0.6, k: 1000, fingers: pointing }))
    return run(engine, 600, 400, () => L)
  }
  const zoomSteps = (events: HandEvent[]) => events.filter((event) => event.type === 'zoom').map((event) => (event as Extract<HandEvent, { type: 'zoom' }>).steps)
  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)

  it('the L pose enters zoom mode; moving the hand away zooms in, bringing it closer zooms out', () => {
    const engine = new HandGestureEngine(DEFAULT_SETTINGS)
    const pose = enterZoom(engine)
    expect(pose.frames.at(-1)!.phase).toBe('zoom')
    expect(pose.events).toEqual([])
    // Away: the palm shrinks to 70 % (log −0.36) → five steps in (one per 0.07).
    const away = run(engine, pose.end, 700, (_t, p) => ({ ...L, k: 1000 * Math.exp(-0.36 * p) }))
    const hold = run(engine, away.end, 400, () => ({ ...L, k: 1000 * Math.exp(-0.36) }))
    expect(zoomSteps([...away.events, ...hold.events]).every((steps) => steps > 0)).toBe(true)
    expect(sum(zoomSteps([...away.events, ...hold.events]))).toBe(5)
    // Closer: the palm grows to ×1.9 of that (log +0.62; 0.01 was left over from the way out) → eight steps out.
    const closer = run(engine, hold.end, 900, (_t, p) => ({ ...L, k: 1000 * Math.exp(-0.36 + 0.62 * p) }))
    const rest = run(engine, closer.end, 400, () => ({ ...L, k: 1000 * Math.exp(0.26) }))
    expect(zoomSteps([...closer.events, ...rest.events]).every((steps) => steps < 0)).toBe(true)
    expect(sum(zoomSteps([...closer.events, ...rest.events]))).toBe(-8)
    expect(types([...away.events, ...closer.events]).filter((type) => type !== 'zoom')).toEqual([])
  })

  it('a still hand in the L does not zoom', () => {
    const engine = new HandGestureEngine(DEFAULT_SETTINGS)
    const pose = enterZoom(engine)
    // Tracking wobble: ±4 % from frame to frame on top of a slow ±2 % sway (measured on the recording).
    let frame = 0
    const still = run(engine, pose.end, 3000, (t) => ({ ...L, k: 1000 * (1 + (frame++ % 2 ? 0.04 : -0.04) + 0.02 * Math.sin(t / 300)) }))
    expect(still.events).toEqual([])
  })

  it('zooms around where the phalanx pointed when the L pose began', () => {
    const engine = new HandGestureEngine(DEFAULT_SETTINGS)
    const pointed = run(engine, 0, 600, () => ({ x: 0.5, y: 0.6, k: 1000, fingers: pointing })).frames.at(-1)!.pointer!
    const pose = run(engine, 600, 400, () => L)
    const away = run(engine, pose.end, 500, (_t, p) => ({ ...L, k: 1000 * Math.exp(-0.3 * p) }))
    const zoom = away.events.find((event) => event.type === 'zoom') as Extract<HandEvent, { type: 'zoom' }>
    expect(zoom.x).toBeCloseTo(pointed.x, 2)
    expect(zoom.y).toBeCloseTo(pointed.y, 2)
  })

  it('back to pointing leaves zoom mode, and taps work again', () => {
    const engine = new HandGestureEngine(DEFAULT_SETTINGS)
    const pose = enterZoom(engine)
    const back = run(engine, pose.end, 800, () => ({ x: 0.5, y: 0.6, k: 1000, fingers: pointing }))
    expect(back.frames.at(-1)!.phase).toBe('point')
    expect(back.events).toEqual([])
    expect(types(tap(engine, back.end + 400).events)).toEqual(['press', 'click'])
  })

  it('plain pointing (thumb along the hand) never enters zoom mode, even moving in depth', () => {
    const engine = new HandGestureEngine(DEFAULT_SETTINGS)
    const frames = run(engine, 0, 2000, (_t, p) => ({ x: 0.5, y: 0.6, k: 1000 * Math.exp(-0.4 * p), fingers: { index: 0 } })).frames
    expect(frames.every((frame) => frame.phase !== 'zoom' && frame.events.every((event) => event.type !== 'zoom'))).toBe(true)
  })

  it('can be switched off', () => {
    const engine = new HandGestureEngine({ ...DEFAULT_SETTINGS, pinchZoom: false })
    const pose = enterZoom(engine)
    const away = run(engine, pose.end, 700, (_t, p) => ({ ...L, k: 1000 * Math.exp(-0.4 * p) }))
    expect(pose.frames.at(-1)!.phase).not.toBe('zoom')
    expect(away.events.filter((event) => event.type === 'zoom')).toEqual([])
  })
})

describe('HandGestureEngine — open palm grab', () => {
  const palm = { y: 0.6, fingers: { index: 10, middle: 10, ring: 10, pinky: 10 }, thumbTip: THUMB_OUT }

  it('a quick push of the open palm holds, moving drags, pulling back releases', () => {
    const engine = new HandGestureEngine(DEFAULT_SETTINGS)
    const rest = run(engine, 0, 800, () => ({ ...palm, x: 0.5, k: 1000 }))
    const push = run(engine, rest.end, 150, (_t, p) => ({ ...palm, x: 0.5, k: 1000 * (1 + 0.14 * p) }))
    const drag = run(engine, push.end, 500, (_t, p) => ({ ...palm, x: 0.5 - 0.2 * p, k: 1140 }))
    const back = run(engine, drag.end, 200, (_t, p) => ({ ...palm, x: 0.3, k: 1140 - 140 * p }))
    const events = [...push.events, ...drag.events, ...back.events]
    expect(events[0].type).toBe('grab-start')
    const moves = events.filter((event) => event.type === 'grab-move') as Array<Extract<HandEvent, { type: 'grab-move' }>>
    expect(moves.length).toBeGreaterThan(5)
    // Mirrored camera: the hand moving left in the image moves right on screen.
    expect(moves.at(-1)!.x - (events[0] as Extract<HandEvent, { type: 'grab-start' }>).x).toBeGreaterThan(0.15)
    expect(events.at(-1)!.type).toBe('grab-end')
    expect(types(events).filter((type) => type === 'click' || type === 'press')).toEqual([])
  })

  it('closing the hand also releases the grab', () => {
    const engine = new HandGestureEngine(DEFAULT_SETTINGS)
    const rest = run(engine, 0, 800, () => ({ ...palm, x: 0.5, k: 1000 }))
    const push = run(engine, rest.end, 150, (_t, p) => ({ ...palm, x: 0.5, k: 1000 * (1 + 0.14 * p) }))
    const fist = run(engine, push.end, 400, () => ({ x: 0.5, y: 0.6, k: 1140 }))
    expect(types([...push.events, ...fist.events])).toEqual(['grab-start', 'grab-end'])
  })

  it('a slow approach of the open palm does not grab', () => {
    const engine = new HandGestureEngine(DEFAULT_SETTINGS)
    run(engine, 0, 800, () => ({ ...palm, x: 0.5, k: 1000 }))
    const lean = run(engine, 800, 3000, (_t, p) => ({ ...palm, x: 0.5, k: 1000 * (1 + 0.2 * p) }))
    expect(lean.events).toEqual([])
  })
})

describe('HandGestureEngine — leaving scroll mode', () => {
  it('ends scrolling when the two-finger pose is gone for a while (no stuck mode)', () => {
    const engine = new HandGestureEngine(DEFAULT_SETTINGS)
    run(engine, 0, 600, () => ({ x: 0.5, y: 0.6, k: 1000, fingers: pointing }))
    const pose = run(engine, 600, 300, () => ({ x: 0.5, y: 0.6, k: 1000, fingers: raisedTwo }))
    expect(types(pose.events)).toEqual(['scroll-start'])
    const fist = run(engine, pose.end, 1000, () => ({ x: 0.5, y: 0.6, k: 1000 }))
    expect(types(fist.events)).toEqual(['scroll-end'])
    expect(fist.frames.at(-1)!.phase).toBe('point')
  })
})

describe('HandGestureEngine — fist resets', () => {
  const open = { index: 10, middle: 10, ring: 10, pinky: 10 }

  it('closing an open hand into a fist (and opening it again) is not a click', () => {
    const engine = new HandGestureEngine(DEFAULT_SETTINGS)
    run(engine, 0, 800, () => ({ x: 0.5, y: 0.6, k: 1000, fingers: open }))
    const close = run(engine, 800, 120, (_t, p) => ({ x: 0.5, y: 0.6, k: 1000, fingers: { index: lerp(10, 120, p), middle: lerp(10, 120, p), ring: lerp(10, 120, p), pinky: lerp(10, 120, p) } }))
    const fist = run(engine, close.end, 400, () => ({ x: 0.5, y: 0.6, k: 1000 }))
    const reopen = run(engine, fist.end, 300, () => ({ x: 0.5, y: 0.6, k: 1000, fingers: open }))
    expect([...close.events, ...fist.events, ...reopen.events]).toEqual([])
  })

  it('a fist releases a map grab and nothing starts again while the hand stays closed', () => {
    const engine = new HandGestureEngine(DEFAULT_SETTINGS)
    const palm = { fingers: open, thumbTip: THUMB_OUT, y: 0.6 }
    run(engine, 0, 800, () => ({ ...palm, x: 0.5, k: 1000 }))
    const push = run(engine, 800, 150, (_t, p) => ({ ...palm, x: 0.5, k: 1000 * (1 + 0.14 * p) }))
    expect(types(push.events)).toContain('grab-start')
    const fist = run(engine, push.end, 1500, () => ({ x: 0.5, y: 0.6, k: 1140 }))
    expect(types(fist.events)).toEqual(['grab-end'])
  })

  it('a held fist ends scrolling', () => {
    const engine = new HandGestureEngine(DEFAULT_SETTINGS)
    run(engine, 0, 600, () => ({ x: 0.5, y: 0.6, k: 1000, fingers: pointing }))
    run(engine, 600, 300, () => ({ x: 0.5, y: 0.6, k: 1000, fingers: raisedTwo }))
    const fist = run(engine, 900, 1000, () => ({ x: 0.5, y: 0.6, k: 1000 }))
    expect(types(fist.events)).toEqual(['scroll-end'])
  })
})

describe('HandGestureEngine — pinch click (thumb and index together)', () => {
  const PINCH = { ...BASE_SETTINGS, clickMode: 'pinch' as const }
  const thumbTo = (from: Point3, to: Point3, p: number): Point3 => ({ x: lerp(from.x, to.x, p), y: lerp(from.y, to.y, p), z: lerp(from.z, to.z, p) })
  // Relaxed pointing: thumb a little away from the index (gap ≈ 0.8 palm lengths, like the recordings).
  const relaxed: Point3 = { x: -0.075, y: -0.1, z: -0.03 }
  const onTip = indexTipAt(30)
  const hand = (thumbTip: Point3, x = 0.5) => ({ x, y: 0.6, k: 1000, fingers: pointing, thumbTip })

  function pinchOnce(engine: HandGestureEngine, from: number, { closeMs = 150, holdMs = 150, x = 0.5 } = {}) {
    const close = run(engine, from, closeMs, (_t, p) => hand(thumbTo(relaxed, onTip, p), x))
    const hold = run(engine, close.end, holdMs, () => hand(onTip, x))
    const open = run(engine, hold.end, 150, (_t, p) => hand(thumbTo(onTip, relaxed, p), x))
    const rest = run(engine, open.end, 300, () => hand(relaxed, x))
    const frames = [...close.frames, ...hold.frames, ...open.frames, ...rest.frames]
    return { frames, end: rest.end, events: frames.flatMap((frame) => frame.events) }
  }

  it('pinching presses, opening clicks where the phalanx was before the pinch', () => {
    const engine = new HandGestureEngine(PINCH)
    const before = run(engine, 0, 800, () => hand(relaxed)).frames.at(-1)!.pointer!
    const result = pinchOnce(engine, 800)
    expect(types(result.events)).toEqual(['press', 'click'])
    const click = result.events.find((event) => event.type === 'click') as Extract<HandEvent, { type: 'click' }>
    expect(click.x).toBeCloseTo(before.x, 2)
    expect(click.y).toBeCloseTo(before.y, 2)
  })

  it('pinch and move drags (a held mouse button), opening releases', () => {
    const engine = new HandGestureEngine(PINCH)
    run(engine, 0, 800, () => hand(relaxed))
    const close = run(engine, 800, 150, (_t, p) => hand(thumbTo(relaxed, onTip, p)))
    const hold = run(engine, close.end, 250, () => hand(onTip))
    const move = run(engine, hold.end, 500, (_t, p) => hand(onTip, 0.5 - 0.15 * p))
    const open = run(engine, move.end, 200, (_t, p) => hand(thumbTo(onTip, relaxed, p), 0.35))
    const events = [...close.events, ...hold.events, ...move.events, ...open.events]
    expect(types(events).filter((type) => type !== 'grab-move')).toEqual(['press', 'cancel', 'grab-start', 'grab-end'])
    const moves = events.filter((event) => event.type === 'grab-move') as Array<Extract<HandEvent, { type: 'grab-move' }>>
    const start = events.find((event) => event.type === 'grab-start') as Extract<HandEvent, { type: 'grab-start' }>
    // Mirrored: the hand moving left in the image drags right on screen.
    expect(moves.at(-1)!.x - start.x).toBeGreaterThan(0.1)
  })

  it('a slow drift of the thumb does not click', () => {
    const engine = new HandGestureEngine(PINCH)
    run(engine, 0, 800, () => hand(relaxed))
    const slow = run(engine, 800, 2500, (_t, p) => hand(thumbTo(relaxed, onTip, p)))
    expect(slow.events).toEqual([])
  })

  it('closing the whole hand into a fist is not a pinch', () => {
    const engine = new HandGestureEngine(PINCH)
    run(engine, 0, 800, () => ({ x: 0.5, y: 0.6, k: 1000, fingers: { index: 10, middle: 10, ring: 10, pinky: 10 }, thumbTip: relaxed }))
    const fist = run(engine, 800, 200, (_t, p) => ({ x: 0.5, y: 0.6, k: 1000, fingers: { index: lerp(10, 120, p), middle: lerp(10, 120, p), ring: lerp(10, 120, p), pinky: lerp(10, 120, p) }, thumbTip: thumbTo(relaxed, onTip, p) }))
    const held = run(engine, fist.end, 600, () => ({ x: 0.5, y: 0.6, k: 1000, thumbTip: onTip }))
    expect(types([...fist.events, ...held.events]).filter((type) => type === 'press' || type === 'click')).toEqual([])
  })

  it('the drawn hand stays still through a pinch click', () => {
    const engine = new HandGestureEngine(PINCH)
    const before = run(engine, 0, 800, () => hand(relaxed)).frames.at(-1)!.hand!
    const result = pinchOnce(engine, 800)
    for (const frame of result.frames) {
      expect(frame.hand!.x).toBeCloseTo(before.x, 4)
      expect(frame.hand!.y).toBeCloseTo(before.y, 4)
    }
  })
})

describe('HandGestureEngine — taps work at any angle of the hand', () => {
  const angles: Array<[string, Partial<SyntheticHand>]> = [
    ['tilted 40° towards the camera', { tilt: 40 }],
    ['tilted 30° back', { tilt: -30 }],
    ['turned 50° to the side', { turn: 50 }],
    ['turned 60° the other way', { turn: -60 }],
    ['rolled 45° in the image', { roll: 45 }],
    ['rolled 60° the other way', { roll: -60 }],
    ['tilted and turned', { tilt: 30, turn: 40 }],
  ]
  for (const [name, pose] of angles) {
    it(`a tap clicks with the hand ${name}`, () => {
      const engine = new HandGestureEngine(DEFAULT_SETTINGS)
      run(engine, 0, 800, () => ({ x: 0.5, y: 0.6, k: 1000, fingers: pointing, ...pose }))
      expect(types(tap(engine, 800, { extra: pose }).events)).toEqual(['press', 'click'])
    })
  }
})

describe('HandGestureEngine — wrist tilt is not a finger gesture', () => {
  it('bending the wrist down from a vertical hand (index comes towards the camera) neither taps nor freezes', () => {
    const engine = new HandGestureEngine({ ...DEFAULT_SETTINGS, clickMode: 'both' })
    run(engine, 0, 800, () => ({ x: 0.5, y: 0.5, k: 1000, fingers: { index: 10 } }))
    // Wrist bends the whole hand 70° towards the camera; the index looks a little more folded too.
    const tilt = run(engine, 800, 300, (_t, p) => ({ x: 0.5, y: 0.5, k: 1000, fingers: { index: lerp(10, 75, p) }, tilt: 70 * p }))
    const hold = run(engine, tilt.end, 600, () => ({ x: 0.5, y: 0.5, k: 1000, fingers: { index: 75 }, tilt: 70 }))
    const back = run(engine, hold.end, 300, (_t, p) => ({ x: 0.5, y: 0.5, k: 1000, fingers: { index: lerp(75, 10, p) }, tilt: 70 * (1 - p) }))
    expect([...tilt.events, ...hold.events, ...back.events]).toEqual([])
    expect([...tilt.frames, ...hold.frames].every((frame) => frame.pressProgress < ENGINE.freezeAt)).toBe(true)
  })

  it('a two-finger hand tilting forward does not scroll a step', () => {
    const engine = new HandGestureEngine(DEFAULT_SETTINGS)
    run(engine, 0, 600, () => ({ x: 0.5, y: 0.6, k: 1000, fingers: pointing }))
    run(engine, 600, 300, () => ({ x: 0.5, y: 0.6, k: 1000, fingers: raisedTwo }))
    const tilt = run(engine, 900, 250, (_t, p) => ({ x: 0.5, y: 0.6, k: 1000, fingers: { index: lerp(15, 45, p), middle: lerp(15, 45, p) }, tilt: 70 * p }))
    expect(tilt.events.filter((event) => event.type === 'scroll')).toEqual([])
  })

  it('a real tap with the hand slightly tilted still clicks', () => {
    const engine = new HandGestureEngine(DEFAULT_SETTINGS)
    const rest = run(engine, 0, 800, () => ({ x: 0.5, y: 0.6, k: 1000, fingers: pointing, tilt: 40 }))
    const result = tap(engine, rest.end, { extra: { tilt: 40 } })
    expect(types(result.events)).toEqual(['press', 'click'])
  })
})

describe('HandGestureEngine — opening the hand is neither a zoom nor a grab', () => {
  it('fist → open palm (thumb springs out, palm grows in the image) does nothing to the map', () => {
    const engine = new HandGestureEngine(DEFAULT_SETTINGS)
    run(engine, 0, 800, () => ({ x: 0.5, y: 0.6, k: 1000 }))
    // All fingers and the thumb open within ~150 ms; the hand also comes a little closer.
    const opening = run(engine, 800, 150, (_t, p) => ({
      x: 0.5, y: 0.6, k: 1000 * (1 + 0.12 * p),
      fingers: { index: lerp(120, 10, p), middle: lerp(120, 10, p), ring: lerp(120, 10, p), pinky: lerp(120, 10, p) },
      thumbTip: { x: lerp(-0.03, THUMB_OUT.x, p), y: lerp(-0.12, THUMB_OUT.y, p), z: 0 },
    }))
    const open = run(engine, opening.end, 800, () => ({ x: 0.5, y: 0.6, k: 1120, fingers: { index: 10, middle: 10, ring: 10, pinky: 10 }, thumbTip: THUMB_OUT }))
    expect([...opening.events, ...open.events]).toEqual([])
  })
})
