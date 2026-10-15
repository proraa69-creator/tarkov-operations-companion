import { describe, expect, it } from 'vitest'
import { gunzipSync, strFromU8 } from 'fflate'
// gzip + base64 keeps the fixture small and loadable with Vite's ?raw.
import recordingB64 from './fixtures/recorded-gestures.json.gz.b64?raw'
import zoomRecordingB64 from './fixtures/recorded-zoom.json.gz.b64?raw'
import zoomDepthRecordingB64 from './fixtures/recorded-zoom-depth.json.gz.b64?raw'
import { HandGestureEngine } from './gestureEngine'
import { DEFAULT_SETTINGS, type HandEvent, type HandFrame, type HandObservation } from './types'

// MediaPipe landmarks (no video) of the reference gestures recorded by the product owner:
// pointing 0.6–11.4 s, four index taps, then index+middle raised with four flicks.
type Frame = { t: number; score?: number; hand?: 'Left' | 'Right'; image?: number[][]; world?: number[][] }
type Recording = { W: number; H: number; frames: Frame[] }
const load = (b64: string) => JSON.parse(strFromU8(gunzipSync(Uint8Array.from(atob(b64.trim()), (char) => char.charCodeAt(0))))) as Recording
const recording = load(recordingB64)

function replay(recording: Recording) {
  const engine = new HandGestureEngine(DEFAULT_SETTINGS)
  const events: Array<{ t: number; event: HandEvent }> = []
  const frames: Array<{ t: number; frame: HandFrame }> = []
  for (const frame of recording.frames) {
    const t = frame.t * 1000
    const observation: HandObservation | null = frame.image && frame.world ? {
      t,
      score: frame.score ?? 0,
      handedness: frame.hand ?? 'Right',
      frameWidth: recording.W,
      frameHeight: recording.H,
      image: frame.image.map(([x, y, z]) => ({ x, y, z })),
      world: frame.world.map(([x, y, z]) => ({ x, y, z })),
    } : null
    const out = engine.process(observation, t)
    frames.push({ t: frame.t, frame: out })
    for (const event of out.events) events.push({ t: frame.t, event })
  }
  return { events, frames }
}

const near = (times: number[], expected: number[], tolerance = 0.2) =>
  times.length === expected.length && times.every((time, index) => Math.abs(time - expected[index]) <= tolerance)

describe('recorded reference gestures', () => {
  const { events, frames } = replay(recording)
  const at = (predicate: (event: HandEvent) => boolean) => events.filter(({ event }) => predicate(event)).map(({ t }) => t)

  it('turns the four index taps into exactly four clicks', () => {
    expect(near(at((event) => event.type === 'click'), [11.83, 12.63, 13.47, 14.47])).toBe(true)
    expect(at((event) => event.type === 'press')).toHaveLength(4)
    expect(at((event) => event.type === 'cancel')).toHaveLength(0)
  })

  it('produces nothing while the user only points around (0–11.4 s)', () => {
    expect(events.filter(({ t }) => t < 11.4)).toEqual([])
  })

  it('turns the four two-finger flicks into four scroll steps and nothing else in scroll mode', () => {
    expect(near(at((event) => event.type === 'scroll' && Boolean(event.step)), [15.1, 15.7, 16.57, 17.5])).toBe(true)
    const start = at((event) => event.type === 'scroll-start')
    expect(start).toHaveLength(1)
    expect(events.some(({ t, event }) => t > start[0] && (event.type === 'press' || event.type === 'click'))).toBe(false)
    // Only a little real hand movement may drag-scroll right after entering the mode.
    const drag = events.filter(({ event }) => event.type === 'scroll' && !event.step).reduce((sum, { event }) => sum + Math.abs((event as Extract<HandEvent, { type: 'scroll' }>).dy), 0)
    expect(drag).toBeLessThan(0.15)
  })

  it('the drawn hand stays exactly where it was while the finger taps', () => {
    const presses = events.filter(({ event }) => event.type === 'press').map(({ t }) => t)
    const clicks = events.filter(({ event }) => event.type === 'click').map(({ t }) => t)
    presses.forEach((press, index) => {
      const during = frames.filter(({ t }) => t >= press && t <= clicks[index]).map(({ frame }) => frame.hand!)
      const range = Math.hypot(Math.max(...during.map((p) => p.x)) - Math.min(...during.map((p) => p.x)), Math.max(...during.map((p) => p.y)) - Math.min(...during.map((p) => p.y)))
      expect(range).toBeLessThan(0.005)
    })
  })
})

// The earlier zoom recording: the L pose held in place while the thumb is closed onto the index
// and opened again six times. Zoom now follows the hand's distance, so this is not a zoom — and
// never a click.
describe('recorded L pose with the thumb closing in place', () => {
  const { events } = replay(load(zoomRecordingB64))

  it('does not zoom (the hand stays at the same distance) and never clicks', () => {
    expect(events.filter(({ event }) => event.type === 'zoom')).toEqual([])
    expect(events.filter(({ event }) => event.type === 'click' || event.type === 'scroll-start' || event.type === 'grab-start')).toEqual([])
  })
})

// The product owner's recording of zoom by distance: the L pose held at 14.6–18.9 s, the hand
// moving away from the camera (~16.4–17.8 s), then towards it (~17.8–18.9 s).
describe('recorded zoom by distance', () => {
  const { events } = replay(load(zoomDepthRecordingB64))
  const zooms = events.filter(({ event }) => event.type === 'zoom').map(({ t, event }) => ({ t, steps: (event as Extract<HandEvent, { type: 'zoom' }>).steps }))

  it('zooms in while the hand moves away and out while it comes closer', () => {
    const away = zooms.filter(({ t }) => t >= 16.4 && t < 17.8)
    const closer = zooms.filter(({ t }) => t >= 17.8 && t <= 19.1)
    expect(away.length).toBeGreaterThanOrEqual(2)
    expect(away.every(({ steps }) => steps > 0)).toBe(true)
    expect(closer.length).toBeGreaterThanOrEqual(2)
    expect(closer.every(({ steps }) => steps < 0)).toBe(true)
    // Nothing while the L is just held (14.6–16.4 s).
    expect(zooms.filter(({ t }) => t < 16.4)).toEqual([])
  })

  it('does nothing else', () => {
    expect(events.filter(({ event }) => event.type !== 'zoom' && event.type !== 'cancel')).toEqual([])
  })
})
