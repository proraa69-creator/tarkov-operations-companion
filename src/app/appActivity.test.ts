import { afterEach, describe, expect, it, vi } from 'vitest'
import { isAppActive, onAppActivityChange, startAppActivity } from './appActivity'

describe('app activity (decorative motion sleeps while the window is not in use)', () => {
  afterEach(() => vi.restoreAllMocks())

  it('goes idle when the window loses focus or is hidden and wakes when it is used again', async () => {
    const focus = vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    const stop = startAppActivity()
    const seen: boolean[] = []
    const off = onAppActivityChange((active) => seen.push(active))
    expect(isAppActive()).toBe(true)
    expect(document.documentElement.hasAttribute('data-app-idle')).toBe(false)

    // the player switches to the game
    focus.mockReturnValue(false)
    window.dispatchEvent(new Event('blur'))
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(isAppActive()).toBe(false)
    expect(document.documentElement.hasAttribute('data-app-idle')).toBe(true)

    focus.mockReturnValue(true)
    window.dispatchEvent(new Event('focus'))
    expect(isAppActive()).toBe(true)

    // minimized: hidden although focus has not been reported lost
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    expect(isAppActive()).toBe(false)
    visibility.mockReturnValue('visible')
    document.dispatchEvent(new Event('visibilitychange'))

    expect(seen).toEqual([false, true, false, true])
    off()
    stop()
    expect(document.documentElement.hasAttribute('data-app-idle')).toBe(false)
  })

  it('stays active when focus only moves into an embedded page', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    const stop = startAppActivity()
    window.dispatchEvent(new Event('blur'))
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(isAppActive()).toBe(true)
    stop()
  })
})
