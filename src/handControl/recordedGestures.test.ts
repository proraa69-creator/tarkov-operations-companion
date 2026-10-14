import { describe, expect, it } from 'vitest'
import { gunzipSync, strFromU8 } from 'fflate'
// gzip + base64 keeps the fixture small and loadable with Vite's ?raw.
import recordingB64 from './fixtures/recorded-gestures.json.gz.b64?raw'
import { HandGestureEngine } from './gestureEngine'
import { DEFAULT_SETTINGS, type HandEvent, type HandObservation } from './types'

// MediaPipe landmarks (no video) of the reference gestures recorded by the product owner:
// pointing 0.6–11.4 s, four index taps, then index+middle raised with four flicks.
type Frame = { t: number; score?: number; hand?: 'Left' | 'Right'; image?: number[][]; world?: number[][] }
const gz = Uint8Array.from(atob(recordingB64.trim()), (char) => char.charCodeAt(0))
const recording = JSON.parse(strFromU8(gunzipSync(gz))) as { W: number; H: number; frames: Frame[] }

function replay() {
  const engine = new HandGestureEngine(DEFAULT_SETTINGS)
  const events: Array<{ t: number; event: HandEvent }> = []
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
    for (const event of engine.process(observation, t).events) events.push({ t: frame.t, event })
  }
  return events
}

const near = (times: number[], expected: number[], tolerance = 0.2) =>
  times.length === expected.length && times.every((time, index) => Math.abs(time - expected[index]) <= tolerance)

describe('recorded reference gestures', () => {
  const events = replay()
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
})
