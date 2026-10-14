import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startActivePolling } from './activePolling'

describe('polling only while the window is in use', () => {
  let focus: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    vi.useFakeTimers()
    focus = vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  /** The game takes the front (src/app/appActivity.ts reads focus a moment after `blur`). */
  const toGame = () => { focus.mockReturnValue(false); window.dispatchEvent(new Event('blur')); vi.advanceTimersByTime(1) }
  const backToApp = () => { focus.mockReturnValue(true); window.dispatchEvent(new Event('focus')) }

  it('asks at once, every interval while in use, never while the game is in front, and at once on the way back', () => {
    const load = vi.fn()
    const stop = startActivePolling(load, { activeEveryMs: 2000 })
    expect(load).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(6000)
    expect(load).toHaveBeenCalledTimes(4)

    toGame()
    vi.advanceTimersByTime(30 * 60_000)
    expect(load).toHaveBeenCalledTimes(4)

    backToApp()
    expect(load).toHaveBeenCalledTimes(5)
    vi.advanceTimersByTime(2000)
    expect(load).toHaveBeenCalledTimes(6)

    // Minimized: hidden, the timer stops too.
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    vi.advanceTimersByTime(10 * 60_000)
    expect(load).toHaveBeenCalledTimes(6)
    visibility.mockReturnValue('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    expect(load).toHaveBeenCalledTimes(7)

    stop()
    vi.advanceTimersByTime(60_000)
    toGame()
    backToApp()
    expect(load).toHaveBeenCalledTimes(7)
  })

  it('without an interval: only at once and each time the window is used again (the Overview card)', () => {
    const load = vi.fn()
    const stop = startActivePolling(load)
    vi.advanceTimersByTime(10 * 60_000)
    expect(load).toHaveBeenCalledTimes(1)
    toGame()
    vi.advanceTimersByTime(60 * 60_000)
    expect(load).toHaveBeenCalledTimes(1)
    backToApp()
    expect(load).toHaveBeenCalledTimes(2)
    stop()
  })

  it('started while the game is in front: one answer, then nothing until the window is used', () => {
    focus.mockReturnValue(false)
    const load = vi.fn()
    const stop = startActivePolling(load, { activeEveryMs: 2000 })
    vi.advanceTimersByTime(60_000)
    expect(load).toHaveBeenCalledTimes(1)
    backToApp()
    vi.advanceTimersByTime(2000)
    expect(load).toHaveBeenCalledTimes(3)
    stop()
  })
})
