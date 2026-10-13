import { describe, expect, it } from 'vitest'
import { INPUT_CHECK_MS, INPUT_HEALS_MAX, InputWatch, isReattaching, reattachInput, REATTACH_PX, type Bounds, type SizedWindow } from './inputReattach'

/** A window that records every size it is given; `later` keeps the timers so a test runs them when it wants. */
function fakeWindow(start: Bounds = { x: 1400, y: 24, width: 436, height: 360 }) {
  const sizes: Bounds[] = []
  let bounds = { ...start }
  let visible = true
  let destroyed = false
  const window: SizedWindow & { sizes: Bounds[]; hide(): void; destroy(): void; move(next: Partial<Bounds>): void } = {
    sizes,
    isDestroyed: () => destroyed,
    isVisible: () => visible,
    getBounds: () => ({ ...bounds }),
    setBounds: (next) => { bounds = { ...next }; sizes.push({ ...next }) },
    hide: () => { visible = false },
    destroy: () => { destroyed = true },
    move: (next) => { bounds = { ...bounds, ...next } },
  }
  const timers: Array<() => void> = []
  const later = (run: () => void) => { timers.push(run) }
  const runTimers = () => { while (timers.length) timers.shift()!() }
  return { window, later, runTimers }
}

describe('reattachInput: what the size slider did, done after every show', () => {
  it('grows the window by a few pixels and puts it back a moment later', () => {
    const { window, later, runTimers } = fakeWindow()
    expect(reattachInput(window, later)).toBe(true)
    expect(window.sizes).toEqual([{ x: 1400, y: 24, width: 436, height: 360 + REATTACH_PX }])
    expect(isReattaching(window)).toBe(true)
    runTimers()
    expect(window.sizes.at(-1)).toEqual({ x: 1400, y: 24, width: 436, height: 360 })
    expect(isReattaching(window)).toBe(false)
  })

  it('leaves a size the page set meanwhile (it fits the window back itself) and keeps a new position', () => {
    const fitted = fakeWindow()
    reattachInput(fitted.window, fitted.later)
    fitted.window.setBounds({ x: 1400, y: 24, width: 436, height: 360 })
    fitted.runTimers()
    expect(fitted.window.sizes).toHaveLength(2)

    const moved = fakeWindow()
    reattachInput(moved.window, moved.later)
    moved.window.move({ x: 900, y: 80 })
    moved.runTimers()
    expect(moved.window.sizes.at(-1)).toEqual({ x: 900, y: 80, width: 436, height: 360 })
  })

  it('does nothing for a hidden or closed window, and once at a time', () => {
    const hidden = fakeWindow()
    hidden.window.hide()
    expect(reattachInput(hidden.window, hidden.later)).toBe(false)
    const closed = fakeWindow()
    closed.window.destroy()
    expect(reattachInput(closed.window, closed.later)).toBe(false)

    const twice = fakeWindow()
    expect(reattachInput(twice.window, twice.later)).toBe(true)
    expect(reattachInput(twice.window, twice.later)).toBe(false)
    expect(twice.window.sizes).toHaveLength(1)
    twice.runTimers()
    expect(reattachInput(twice.window, twice.later)).toBe(true)
  })

  it('a window closed before the size goes back is left alone', () => {
    const { window, later, runTimers } = fakeWindow()
    reattachInput(window, later)
    window.destroy()
    runTimers()
    expect(window.sizes).toHaveLength(1)
  })
})

describe('InputWatch: the input window hidden without a show (cursor on a control)', () => {
  it('resizes only when Windows says the input window is hidden; not when it is shown or cannot tell', () => {
    const watch = new InputWatch()
    const { window, later, runTimers } = fakeWindow()
    expect(watch.check(window, 0, () => true, later)).toBe(false)
    expect(watch.check(window, INPUT_CHECK_MS, () => null, later)).toBe(false)
    expect(window.sizes).toHaveLength(0)
    expect(watch.check(window, 2 * INPUT_CHECK_MS, () => false, later)).toBe(true)
    expect(window.sizes).toHaveLength(1)
    runTimers()
  })

  it('looks at most once a second', () => {
    const watch = new InputWatch()
    const { window, later, runTimers } = fakeWindow()
    let looked = 0
    const hidden = () => { looked += 1; return false }
    watch.check(window, 0, hidden, later)
    runTimers()
    watch.check(window, INPUT_CHECK_MS - 1, hidden, later)
    expect(looked).toBe(1)
    watch.check(window, INPUT_CHECK_MS, hidden, later)
    expect(looked).toBe(2)
    runTimers()
  })

  it('stops after a few tries per show (the input window was not the cause then), and starts over on the next show', () => {
    const watch = new InputWatch()
    const { window, later, runTimers } = fakeWindow()
    let now = 0
    for (let index = 0; index < INPUT_HEALS_MAX + 2; index += 1) {
      watch.check(window, now, () => false, later)
      runTimers()
      now += INPUT_CHECK_MS
    }
    expect(window.sizes).toHaveLength(2 * INPUT_HEALS_MAX)
    watch.reset()
    expect(watch.check(window, now, () => false, later)).toBe(true)
    runTimers()
  })
})
