import { afterEach, describe, expect, it, vi } from 'vitest'
import { circleRadius, originPoint, pictureUrls, prepareTheme, settle, SETTLE_MS, themePictureUrls, withThemeTransition } from './themeTransition'

type Doc = { startViewTransition?: unknown }

afterEach(() => {
  delete (document as unknown as Doc).startViewTransition
  document.documentElement.removeAttribute('data-theme-motion')
  document.head.querySelectorAll('style[data-test]').forEach((style) => style.remove())
  document.body.innerHTML = ''
  vi.useRealTimers()
})

function stubTransition() {
  const calls: Array<() => void> = []
  ;(document as unknown as Doc).startViewTransition = (update: () => void) => {
    calls.push(update)
    update()
    return { ready: Promise.resolve(), finished: Promise.resolve() }
  }
  return calls
}

describe('the circle of the colour scheme change', () => {
  it('reaches past the farthest corner from any point', () => {
    const screen = { width: 1600, height: 950 }
    for (const point of [{ x: 1248, y: 34 }, { x: 0, y: 0 }, { x: 800, y: 475 }, { x: 1600, y: 950 }]) {
      const corners = [[0, 0], [1600, 0], [0, 950], [1600, 950]].map(([x, y]) => Math.hypot(x! - point.x, y! - point.y))
      const radius = circleRadius(point, screen)
      expect(radius).toBeGreaterThan(Math.max(...corners))
      expect(radius).toBeGreaterThan(Math.max(...corners) * 1.05)
      expect(radius).toBeLessThan(Math.max(...corners) * 1.07 + 9)
    }
  })

  it('opens from the centre of the pressed button, not from the last press elsewhere', () => {
    const button = document.createElement('button')
    button.getBoundingClientRect = () => ({ left: 1229, top: 14.5, width: 38, height: 38, right: 1267, bottom: 52.5, x: 1229, y: 14.5, toJSON: () => ({}) })
    document.body.appendChild(button)
    document.dispatchEvent(new MouseEvent('pointerdown', { clientX: 980, clientY: 30 }))
    expect(originPoint(button)).toEqual({ x: 1248, y: 33.5 })
    expect(originPoint({ x: 10, y: 20 })).toEqual({ x: 10, y: 20 })
  })

  it('without view transitions the scheme simply changes', () => {
    const apply = vi.fn()
    withThemeTransition(apply)
    expect(apply).toHaveBeenCalledTimes(1)
    expect(document.documentElement.hasAttribute('data-theme-motion')).toBe(false)
  })

  it('starts at once when the pictures are ready, centred on the button and covering the screen', () => {
    const calls = stubTransition()
    const apply = vi.fn()
    withThemeTransition(apply, { origin: { x: 300, y: 40 }, prepared: { done: true, promise: Promise.resolve() } })
    expect(calls).toHaveLength(1)
    expect(apply).toHaveBeenCalledTimes(1)
    const style = document.documentElement.style
    expect(style.getPropertyValue('--vt-x')).toBe('300px')
    expect(style.getPropertyValue('--vt-y')).toBe('40px')
    expect(parseInt(style.getPropertyValue('--vt-r'))).toBe(circleRadius({ x: 300, y: 40 }, { width: window.innerWidth, height: window.innerHeight }))
  })

  it('waits for pictures still decoding, but not for ever; a newer press wins', async () => {
    vi.useFakeTimers()
    const calls = stubTransition()
    let finish!: () => void
    const decoding = { done: false, promise: new Promise<void>((resolve) => { finish = resolve }) }
    const first = vi.fn()
    withThemeTransition(first, { origin: { x: 1, y: 1 }, prepared: decoding })
    expect(calls).toHaveLength(0)
    finish()
    await vi.advanceTimersByTimeAsync(0)
    expect(calls).toHaveLength(1)
    expect(first).toHaveBeenCalledTimes(1)

    const stuck = { done: false, promise: new Promise<void>(() => {}) }
    const slow = vi.fn()
    withThemeTransition(slow, { origin: { x: 1, y: 1 }, prepared: stuck })
    await vi.advanceTimersByTimeAsync(899)
    expect(slow).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(slow).toHaveBeenCalledTimes(1)

    const older = vi.fn()
    const newer = vi.fn()
    withThemeTransition(older, { origin: { x: 1, y: 1 }, prepared: { done: false, promise: new Promise<void>(() => {}) } })
    withThemeTransition(newer, { origin: { x: 1, y: 1 }, prepared: { done: true, promise: Promise.resolve() } })
    await vi.advanceTimersByTimeAsync(1000)
    expect(older).not.toHaveBeenCalled()
    expect(newer).toHaveBeenCalledTimes(1)
  })
})

describe('the new scheme is whole before the circle opens it (owner, 15.11.2026: «должна доходить до конца плавно»)', () => {
  it('waits for the scheme\'s pictures and for the pictures its pieces added, not for those already on the page', async () => {
    vi.useFakeTimers()
    const old = document.createElement('img')
    Object.defineProperty(old, 'complete', { value: false })
    old.decode = () => new Promise<void>(() => {})
    document.body.appendChild(old)
    const before = new Set(Array.from(document.images))
    let decoded!: () => void
    const added = document.createElement('img')
    Object.defineProperty(added, 'complete', { value: false })
    added.decode = () => new Promise<void>((resolve) => { decoded = resolve })
    document.body.appendChild(added)
    let pictures!: () => void
    const prepared = { done: false, promise: new Promise<void>((resolve) => { pictures = resolve }) }
    let settled = false
    void settle(prepared, before).then(() => { settled = true })
    await vi.advanceTimersByTimeAsync(10)
    expect(settled).toBe(false)
    pictures()
    await vi.advanceTimersByTimeAsync(10)
    expect(settled).toBe(false)
    decoded()
    await vi.advanceTimersByTimeAsync(0)
    expect(settled).toBe(true)
  })

  it('never keeps the old picture longer than SETTLE_MS', async () => {
    vi.useFakeTimers()
    let settled = false
    void settle({ done: false, promise: new Promise<void>(() => {}) }, new Set()).then(() => { settled = true })
    await vi.advanceTimersByTimeAsync(SETTLE_MS - 1)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(settled).toBe(true)
  })

  it('the circle\'s change runs the scheme change and then waits for it to settle', async () => {
    const calls = stubTransition()
    const apply = vi.fn()
    withThemeTransition(apply, { origin: { x: 10, y: 10 }, prepared: { done: true, promise: Promise.resolve() } })
    expect(calls).toHaveLength(1)
    expect(apply).toHaveBeenCalledTimes(1)
  })
})

describe('the pictures of a scheme', () => {
  it('takes from an image-set only the picture this screen draws', () => {
    const css = '--tex: image-set(url("/t/a-2048.webp") 1x, url("/t/a-4096.webp") 2x); background: url(/t/rivet.svg), url(\'/t/grain.webp\')'
    expect(pictureUrls(css, 1)).toEqual(['/t/a-2048.webp', '/t/rivet.svg', '/t/grain.webp'])
    expect(pictureUrls(css, 1.33)).toEqual(['/t/a-4096.webp', '/t/rivet.svg', '/t/grain.webp'])
    expect(pictureUrls(css, 3)).toEqual(['/t/a-4096.webp', '/t/rivet.svg', '/t/grain.webp'])
  })

  it('finds the raster pictures of one scheme in the page styles', () => {
    const style = document.createElement('style')
    style.dataset.test = ''
    style.textContent = `
      :root[data-theme="slate"] { --tex: image-set(url("/assets/slate-2048.webp") 1x, url("/assets/slate-4096.webp") 2x); }
      :root[data-theme="slate"] .panel { background-image: url("/assets/bolt.svg"), url("/assets/scratch.png"); }
      :root[data-theme="gear"] .panel { background-image: url("/assets/webbing.webp"); }
      .plain { background: url("/assets/other.webp"); }`
    document.head.appendChild(style)
    const urls = themePictureUrls('slate').map((url) => new URL(url).pathname)
    expect(urls).toEqual(expect.arrayContaining(['/assets/scratch.png']))
    expect(urls.some((url) => url.startsWith('/assets/slate-'))).toBe(true)
    expect(urls).not.toContain('/assets/bolt.svg')
    expect(urls).not.toContain('/assets/webbing.webp')
    expect(urls).not.toContain('/assets/other.webp')
  })

  it('a scheme without pictures is ready at once', () => {
    expect(prepareTheme('no-such-scheme').done).toBe(true)
  })
})
