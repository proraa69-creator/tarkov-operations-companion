import { describe, expect, it } from 'vitest'
import { ENGINE, HandGestureEngine } from './gestureEngine'
import { syntheticHand, type SyntheticHand } from './testHand'
import { DEFAULT_SETTINGS, type HandEvent, type HandFrame } from './types'

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
  it('maps the index fingertip into calibrated, mirrored window space', () => {
    const engine = new HandGestureEngine({ ...DEFAULT_SETTINGS, calibration: { x0: 0, y0: 0, x1: 1, y1: 1 } })
    const { frames } = run(engine, 0, 500, () => ({ x: 0.3, y: 0.6, k: 1000, fingers: { index: 0 } }))
    const last = frames.at(-1)!
    expect(last.tracking).toBe('good')
    expect(last.phase).toBe('point')
    // tip is 0.03 m left and 0.175 m above the wrist → mirrored x ≈ 1 - (0.3 - 0.047)
    expect(last.pointer!.x).toBeCloseTo(0.747, 2)
    expect(last.pointer!.y).toBeCloseTo(0.6 - (0.175 * 1000) / 480, 2)
    expect(last.skeleton).toHaveLength(21)
    expect(last.events).toEqual([])
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

  it('needs a pointing finger first — folding from a closed hand is not a tap', () => {
    const engine = new HandGestureEngine(DEFAULT_SETTINGS)
    const rest = run(engine, 0, 1000, () => ({ x: 0.5, y: 0.6, k: 1000 }))
    const fold = run(engine, rest.end, 300, () => ({ x: 0.5, y: 0.6, k: 1000, fingers: { index: 110 } }))
    expect(fold.events).toEqual([])
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
  function enterScroll(engine: HandGestureEngine) {
    const rest = run(engine, 0, 600, () => ({ x: 0.5, y: 0.6, k: 1000, fingers: pointing }))
    const pose = run(engine, rest.end, 300, () => ({ x: 0.5, y: 0.6, k: 1000, fingers: raisedTwo }))
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

  it('does not treat an open palm as the scroll pose', () => {
    const engine = new HandGestureEngine(DEFAULT_SETTINGS)
    const open = run(engine, 0, 800, () => ({ x: 0.5, y: 0.6, k: 1000, fingers: { index: 10, middle: 10, ring: 10, pinky: 10 } }))
    expect(open.events).toEqual([])
  })
})
