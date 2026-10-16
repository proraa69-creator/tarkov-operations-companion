import { afterEach, describe, expect, it, vi } from 'vitest'
import { isAppActive, onAppActivityChange, pausedAnimationCount, startAppActivity } from './appActivity'

/** A CSS animation as document.getAnimations() lists it: endless, on an element of the page. */
function fakeAnimation(target: Element) {
  return {
    playState: 'running' as AnimationPlayState,
    effect: { target, getTiming: () => ({ iterations: Infinity }) },
    pause() { this.playState = 'paused' },
    play() { this.playState = 'running' },
    cancel() { this.playState = 'idle' },
  }
}

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

  it('keeps only the paused animations it will resume: spinners that stopped while idle are let go', async () => {
    const focus = vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    let animations: Array<ReturnType<typeof fakeAnimation>> = []
    Object.defineProperty(document, 'getAnimations', { value: () => animations.filter((animation) => animation.playState !== 'idle'), configurable: true })
    try {
      const stop = startAppActivity()
      const pulse = fakeAnimation(document.body)
      animations = [pulse]
      focus.mockReturnValue(false)
      window.dispatchEvent(new Event('blur'))
      await new Promise((resolve) => setTimeout(resolve, 5))
      expect(pulse.playState).toBe('paused')
      expect(pausedAnimationCount()).toBe(1)

      // The top-bar refresh spinner, once a minute while the player is in the game: it starts, is paused, stops.
      for (let minute = 0; minute < 30; minute += 1) {
        const spinner = fakeAnimation(document.body)
        animations.push(spinner)
        document.dispatchEvent(new Event('animationstart'))
        expect(spinner.playState).toBe('paused')
        spinner.cancel()
      }
      // A paused one whose element left the page is let go too.
      const detached = fakeAnimation(document.createElement('span'))
      animations.push(detached)
      document.dispatchEvent(new Event('animationstart'))
      document.dispatchEvent(new Event('animationstart'))
      expect(pausedAnimationCount()).toBe(1)

      focus.mockReturnValue(true)
      window.dispatchEvent(new Event('focus'))
      expect(pulse.playState).toBe('running')
      expect(pausedAnimationCount()).toBe(0)
      stop()
    } finally {
      Reflect.deleteProperty(document, 'getAnimations')
    }
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
