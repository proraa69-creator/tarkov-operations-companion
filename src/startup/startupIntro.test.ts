import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { endStartupIntro, FADE_MS, HOLD_MS, MAX_PLAY_MS, removeStartupIntro, STATIC_HOLD_MS, startupIntroShown } from './startupIntro'

const root = () => document.documentElement
const intro = () => document.getElementById('startup-intro')
const fading = () => root().hasAttribute('data-startup-intro-out')

function show(mode: 'play' | 'still' | null, animations: Array<{ finished: Promise<unknown> }> = []) {
  const element = document.createElement('div')
  element.id = 'startup-intro'
  Object.assign(element, { getAnimations: () => animations })
  document.body.append(element)
  if (mode) root().setAttribute('data-startup-intro', mode)
  return element
}

const reducedMotion = (on: boolean) => vi.stubGlobal('matchMedia', (query: string) => ({ matches: on && query.includes('reduce'), addEventListener: () => {}, removeEventListener: () => {} }))

beforeEach(() => { vi.useFakeTimers(); reducedMotion(false) })
afterEach(() => { removeStartupIntro(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('the start intro ends when the app has what to show (owner, 06.11.2026)', () => {
  it('the site takes over the moment it opens: no fade, and the intro goes when the opening is over', async () => {
    let over = () => {}
    const open = vi.fn(() => new Promise<void>((resolve) => { over = resolve }))
    const element = show('play', [{ finished: Promise.resolve() }])
    endStartupIntro(document, open)
    await vi.advanceTimersByTimeAsync(HOLD_MS)
    expect(open).toHaveBeenCalledWith(element, document)
    expect(fading()).toBe(true)
    await vi.advanceTimersByTimeAsync(FADE_MS * 4)
    expect(intro()).toBe(element)
    over()
    await vi.advanceTimersByTimeAsync(0)
    expect(intro()).toBeNull()
    expect(startupIntroShown()).toBe(false)
  })

  it('an opening that cannot run or fails: the plain fade, the page opens all the same', async () => {
    for (const open of [() => undefined, () => { throw new Error('no') }]) {
      show('play', [{ finished: Promise.resolve() }])
      endStartupIntro(document, open)
      await vi.advanceTimersByTimeAsync(HOLD_MS + FADE_MS)
      expect(intro()).toBeNull()
      expect(startupIntroShown()).toBe(false)
    }
  })

  it('an opening that breaks halfway does not leave the intro standing', async () => {
    show('play', [{ finished: Promise.resolve() }])
    endStartupIntro(document, () => Promise.reject(new Error('no')))
    await vi.advanceTimersByTimeAsync(HOLD_MS)
    expect(intro()).toBeNull()
  })

  it('a fast start: plays to its end, a moment on the logo, then opens', async () => {
    let finish = () => {}
    show('play', [{ finished: new Promise<void>((resolve) => { finish = resolve }) }])
    endStartupIntro()
    await vi.advanceTimersByTimeAsync(1000)
    expect(fading()).toBe(false)
    finish()
    await vi.advanceTimersByTimeAsync(HOLD_MS - 1)
    expect(fading()).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(fading()).toBe(true)
  })

  it('the thread that turns while it waits is not what it plays to the end of', async () => {
    const element = show('play', [
      { finished: Promise.resolve(), effect: { getComputedTiming: () => ({ endTime: 1770 }) } },
      { finished: new Promise(() => {}), effect: { getComputedTiming: () => ({ endTime: Infinity }) } },
    ] as unknown as Array<{ finished: Promise<unknown> }>)
    const open = vi.fn(() => undefined)
    endStartupIntro(document, open)
    await vi.advanceTimersByTimeAsync(HOLD_MS)
    expect(open).toHaveBeenCalledWith(element, document)
  })

  it('a slow start: nothing happens until the app says so, however long it takes', async () => {
    show('play', [{ finished: Promise.resolve() }])
    await vi.advanceTimersByTimeAsync(15_000)
    expect(startupIntroShown()).toBe(true)
    expect(fading()).toBe(false)
    endStartupIntro()
    await vi.advanceTimersByTimeAsync(HOLD_MS)
    expect(fading()).toBe(true)
  })

  it('goes away after the fade, by its end event or by the clock', async () => {
    const element = show('still')
    endStartupIntro()
    await vi.advanceTimersByTimeAsync(0)
    expect(fading()).toBe(true)
    expect(intro()).toBe(element)
    element.dispatchEvent(new Event('animationend'))
    expect(intro()).toBeNull()
    expect(startupIntroShown()).toBe(false)
    expect(fading()).toBe(false)

    show('still')
    endStartupIntro()
    await vi.advanceTimersByTimeAsync(FADE_MS)
    expect(intro()).toBeNull()
  })

  it('an animation inside it ending does not end the fade', async () => {
    const element = show('still')
    const inner = document.createElement('i')
    element.append(inner)
    endStartupIntro()
    await vi.advanceTimersByTimeAsync(0)
    inner.dispatchEvent(new Event('animationend', { bubbles: true }))
    expect(intro()).toBe(element)
  })

  it('a reload in the same window: the finished logo is not held', async () => {
    show('still')
    endStartupIntro()
    await vi.advanceTimersByTimeAsync(0)
    expect(fading()).toBe(true)
  })

  it('motion turned off: the logo stands a moment, counted from the start of the page', async () => {
    reducedMotion(true)
    vi.spyOn(performance, 'now').mockReturnValue(100)
    show('play')
    endStartupIntro()
    await vi.advanceTimersByTimeAsync(STATIC_HOLD_MS - 101)
    expect(fading()).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(fading()).toBe(true)
  })

  it('animations that never report their end (a hidden window) do not hold it for ever', async () => {
    show('play', [{ finished: new Promise(() => {}) }])
    endStartupIntro()
    await vi.advanceTimersByTimeAsync(MAX_PLAY_MS + HOLD_MS)
    expect(fading()).toBe(true)
  })

  it('a stopped animation counts as ended', async () => {
    show('play', [{ finished: Promise.reject(new DOMException('cancelled', 'AbortError')) }])
    endStartupIntro()
    await vi.advanceTimersByTimeAsync(HOLD_MS)
    expect(fading()).toBe(true)
  })

  it('may be called any number of times', async () => {
    const element = show('still')
    const listen = vi.spyOn(element, 'addEventListener')
    endStartupIntro()
    endStartupIntro()
    await vi.advanceTimersByTimeAsync(0)
    endStartupIntro()
    await vi.advanceTimersByTimeAsync(0)
    expect(listen).toHaveBeenCalledTimes(1)
  })

  it('no intro on this start (a browser under automation): its unused markup goes, nothing else happens', () => {
    show(null)
    expect(startupIntroShown()).toBe(false)
    endStartupIntro()
    expect(intro()).toBeNull()
    expect(() => endStartupIntro()).not.toThrow()
  })

  it('a start that failed: at once, the message must be read', () => {
    show('play', [{ finished: new Promise(() => {}) }])
    removeStartupIntro()
    expect(intro()).toBeNull()
    expect(startupIntroShown()).toBe(false)
  })
})
