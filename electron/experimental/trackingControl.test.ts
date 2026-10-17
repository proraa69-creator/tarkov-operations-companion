import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/raidos-tracking-control-test' } }))
const { DEFAULT_SETTINGS, setRemoteMinimap } = await import('./settings')
const { createTrackingControl } = await import('./trackingControl')

function setup(saved = { ...DEFAULT_SETTINGS }) {
  let settings = saved
  const tracker = {
    running: false,
    start: vi.fn(async () => { tracker.running = true }),
    stop: vi.fn(() => { tracker.running = false }),
  }
  const onOff = vi.fn()
  const control = createTrackingControl({ tracker, readSettings: () => settings, setScreenshotsOverride: () => {}, onOff })
  return { tracker, onOff, control, change: (patch: Partial<typeof settings>) => { settings = { ...settings, ...patch }; return control.apply(settings) } }
}

afterEach(() => setRemoteMinimap(false))

describe('the owner\'s position switch in the main process', () => {
  it('a switch turned on after the start follows the screenshots: unknown → off → on', () => {
    const { tracker, control } = setup()
    // The start: the owner's switch is not known yet and counts as off.
    expect(control.apply(DEFAULT_SETTINGS)).toBe(false)
    expect(tracker.running).toBe(false)
    // The renderer sends the last known value (off), then the server's answer (on).
    expect(control.setRemote(false)).toBe(false)
    expect(tracker.running).toBe(false)
    expect(control.setRemote(true)).toBe(true)
    expect(tracker.start).toHaveBeenCalled()
    expect(tracker.running).toBe(true)
  })

  it('the same value again starts a tracker that is not running (it never stays off while the switch is on)', () => {
    const { tracker, control } = setup()
    control.setRemote(true)
    tracker.running = false
    control.setRemote(true)
    expect(tracker.running).toBe(true)
  })

  it('off for everybody: nothing is followed and the dot goes from the maps', () => {
    const { tracker, control, onOff } = setup()
    control.setRemote(true)
    expect(control.setRemote(false)).toBe(false)
    expect(tracker.running).toBe(false)
    expect(onOff).toHaveBeenCalledTimes(1)
    // Off again: nothing more to take away.
    control.setRemote(false)
    expect(onOff).toHaveBeenCalledTimes(1)
  })

  it('a player\'s «minimapOff» no longer stops it: only the owner\'s switch does (owner, 16.10.2026)', () => {
    const { tracker, control, onOff, change } = setup()
    control.setRemote(true)
    expect(change({ minimapOff: true })).toBe(true)
    expect(tracker.running).toBe(true)
    expect(onOff).not.toHaveBeenCalled()
  })
})
