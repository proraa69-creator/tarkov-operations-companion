import { describe, expect, it } from 'vitest'
import { ENGINE, HandGestureEngine } from './gestureEngine'
import { indexTipAt, syntheticHand, THUMB_OUT, type SyntheticHand } from './testHand'
import { DEFAULT_SETTINGS, type HandEvent, type HandFrame, type Point3 } from './types'

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
  it('puts the aim on the index fingertip, moving with the palm (calibrated, mirrored)', () => {
    const engine = new HandGestureEngine({ ...DEFAULT_SETTINGS, calibration: { x0: 0, y0: 0, x1: 1, y1: 1 } })
    const { frames } = run(engine, 0, 500, () => ({ x: 0.3, y: 0.6, k: 1000, fingers: { index: 0 } }))
    const last = frames.at(-1)!
    expect(last.tracking).toBe('good')
    expect(last.phase).toBe('point')
    // Index tip: 0.03 m left of and 0.175 m above the wrist → mirrored x ≈ 1 - (0.3 - 0.047).
    expect(last.pointer!.x).toBeCloseTo(0.747, 2)
    expect(last.pointer!.y).toBeCloseTo(0.6 - (0.175 * 1000) / 480, 2)
    // The drawn hand is placed by the palm centre (mean of wrist and knuckles).
    expect(last.hand!.x).toBeCloseTo(0.7, 2)
    expect(last.hand!.y).toBeCloseTo(0.6 - (0.072 * 1000) / 480, 2)
    expect(last.skeleton).toHaveLength(21)
    expect(last.events).toEqual([])
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

describe('HandGestureEngine — pinch zoom', () => {
  const thumbPath = (from: Point3, to: Point3, p: number): Point3 => ({ x: lerp(from.x, to.x, p), y: lerp(from.y, to.y, p), z: lerp(from.z, to.z, p) })
  const pinched = indexTipAt(30)

  it('quickly moving the thumb away from the index zooms in, quickly pinching zooms out', () => {
    const engine = new HandGestureEngine(DEFAULT_SETTINGS)
    run(engine, 0, 600, () => ({ x: 0.5, y: 0.6, k: 1000, fingers: pointing, thumbTip: pinched }))
    const open = run(engine, 600, 250, (_t, p) => ({ x: 0.5, y: 0.6, k: 1000, fingers: pointing, thumbTip: thumbPath(pinched, THUMB_OUT, p) }))
    const hold = run(engine, open.end, 600, () => ({ x: 0.5, y: 0.6, k: 1000, fingers: pointing, thumbTip: THUMB_OUT }))
    const close = run(engine, hold.end, 250, (_t, p) => ({ x: 0.5, y: 0.6, k: 1000, fingers: pointing, thumbTip: thumbPath(THUMB_OUT, pinched, p) }))
    const zooms = [...open.events, ...hold.events, ...close.events].filter((event) => event.type === 'zoom') as Array<Extract<HandEvent, { type: 'zoom' }>>
    expect(zooms.map((event) => event.steps)).toEqual([1, -1])
    expect([...open.events, ...close.events].some((event) => event.type === 'press')).toBe(false)
  })

  it('a slow thumb movement does not zoom (so the thumb can be repositioned)', () => {
    const engine = new HandGestureEngine(DEFAULT_SETTINGS)
    run(engine, 0, 600, () => ({ x: 0.5, y: 0.6, k: 1000, fingers: pointing, thumbTip: THUMB_OUT }))
    const slow = run(engine, 600, 1500, (_t, p) => ({ x: 0.5, y: 0.6, k: 1000, fingers: pointing, thumbTip: thumbPath(THUMB_OUT, pinched, p) }))
    expect(slow.events).toEqual([])
  })

  it('can be switched off', () => {
    const engine = new HandGestureEngine({ ...DEFAULT_SETTINGS, pinchZoom: false })
    run(engine, 0, 600, () => ({ x: 0.5, y: 0.6, k: 1000, fingers: pointing, thumbTip: pinched }))
    const open = run(engine, 600, 250, (_t, p) => ({ x: 0.5, y: 0.6, k: 1000, fingers: pointing, thumbTip: thumbPath(pinched, THUMB_OUT, p) }))
    expect(open.events).toEqual([])
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
