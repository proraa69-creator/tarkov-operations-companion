// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BrowserWindow, WebContents } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Rect = { x: number; y: number; width: number; height: number }
type FakeDisplay = { id: number; bounds: Rect; workArea: Rect; size: { width: number; height: number }; scaleFactor: number }

const { fakeScreen } = vi.hoisted(() => {
  const listeners = new Map<string, Set<() => void>>()
  const shared = (a: Rect, b: Rect) => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
  const fakeScreen = {
    displays: [] as FakeDisplay[],
    getAllDisplays: () => fakeScreen.displays,
    getDisplayMatching(rect: Rect) {
      return fakeScreen.displays.reduce((best, display) => (shared(rect, display.bounds) > shared(rect, best.bounds) ? display : best), fakeScreen.displays[0]!)
    },
    on(event: string, listener: () => void) {
      if (!listeners.has(event)) listeners.set(event, new Set())
      listeners.get(event)!.add(listener)
      return fakeScreen
    },
    off(event: string, listener: () => void) {
      listeners.get(event)?.delete(listener)
      return fakeScreen
    },
    emit(event: string) {
      for (const listener of [...(listeners.get(event) ?? [])]) listener()
    },
    listenerCount: (event: string) => listeners.get(event)?.size ?? 0,
  }
  return { fakeScreen }
})
vi.mock('electron', () => ({ screen: fakeScreen }))
const { followDisplayScale, monitorOfWindow, opensMaximized, pinInterfaceZoom, rescaledBounds, scaledWindowSize, SETTLE_MS, SWITCH_MARGIN, uiScaleFor, zoomToRestore } = await import('./uiScale')

describe('a Full HD look on every screen (owner, 11.10.2026)', () => {
  it('zooms by the display size in Windows units over 1920×1080', () => {
    expect(uiScaleFor({ width: 1920, height: 1080 })).toBe(1)
    expect(uiScaleFor({ width: 3840, height: 2160 })).toBe(2) // 4K at 100 % Windows scaling
    expect(uiScaleFor({ width: 2560, height: 1440 })).toBe(1.35) // 4K at 150 %, 1440p at 100 %
    expect(uiScaleFor({ width: 3440, height: 1440 })).toBe(1.35) // ultrawide: by its height
    expect(uiScaleFor({ width: 5120, height: 2880 })).toBe(2.65)
    expect(uiScaleFor({ width: 1366, height: 768 })).toBe(0.8) // smaller screens: zoomed out, down to 0.8 (owner, 14.11.2026)
    expect(uiScaleFor({ width: 1600, height: 900 })).toBe(0.85)
    expect(uiScaleFor({ width: 1536, height: 864 })).toBe(0.8) // Full HD laptop at 125 %
    expect(uiScaleFor({ width: 1280, height: 720 })).toBe(0.8) // never below 0.8
    expect(uiScaleFor({ width: 7680, height: 4320 })).toBe(3)
  })

  it('an upright (9:16) monitor is measured against Full HD upright (report 158, owner 14.11.2026)', () => {
    expect(uiScaleFor({ width: 1080, height: 1920 })).toBe(1)
    expect(uiScaleFor({ width: 2160, height: 3840 })).toBe(2) // 4K upright, as 4K lying down
    expect(uiScaleFor({ width: 1440, height: 2560 })).toBe(1.35)
    expect(uiScaleFor({ width: 1200, height: 1920 })).toBe(1) // 16:10 upright
  })

  it('the first start fills an upright monitor or a small screen, not a Full HD one', () => {
    const base = { width: 1500, height: 930, minWidth: 1050, minHeight: 700 }
    const at = (screen: { width: number; height: number }, area: { width: number; height: number }) => opensMaximized(scaledWindowSize(base, uiScaleFor(screen), area), area)
    expect(at({ width: 1920, height: 1080 }, { width: 1920, height: 1040 })).toBe(false)
    expect(at({ width: 2560, height: 1440 }, { width: 2560, height: 1400 })).toBe(false)
    expect(at({ width: 1080, height: 1920 }, { width: 1080, height: 1880 })).toBe(true)
    expect(at({ width: 1366, height: 768 }, { width: 1366, height: 728 })).toBe(true)
  })

  it('sizes the window for the scale, never past the work area', () => {
    const base = { width: 1500, height: 930, minWidth: 1050, minHeight: 700 }
    expect(scaledWindowSize(base, 2, { width: 3840, height: 2100 })).toEqual({ width: 3000, height: 1860, minWidth: 2100, minHeight: 1400 })
    expect(scaledWindowSize(base, 1, { width: 1366, height: 728 })).toEqual({ width: 1366, height: 728, minWidth: 1050, minHeight: 700 })
  })
})

/** A monitor as Electron reports it on Windows: bounds, work area and size in Windows units (DIP), the Windows scaling apart. */
const monitor = (id: number, x: number, pixels: { width: number; height: number }, scaleFactor: number): FakeDisplay => {
  const width = Math.round(pixels.width / scaleFactor)
  const height = Math.round(pixels.height / scaleFactor)
  return { id, bounds: { x, y: 0, width, height }, workArea: { x, y: 0, width, height: height - 40 }, size: { width, height }, scaleFactor }
}
// The report's computer: two Full HD monitors and a 2K one, side by side.
const LEFT_FULL_HD = monitor(1, -1920, { width: 1920, height: 1080 }, 1)
const FULL_HD = monitor(2, 0, { width: 1920, height: 1080 }, 1)
const QHD = monitor(3, 1920, { width: 2560, height: 1440 }, 1)
const PLAYER = [LEFT_FULL_HD, FULL_HD, QHD]
// Three monitors of different Windows scaling: Full HD at 100 %, 2K at 125 %, 4K at 150 %.
const QHD_125 = monitor(4, 1920, { width: 2560, height: 1440 }, 1.25)
const UHD_150 = monitor(5, 1920 + 2048, { width: 3840, height: 2160 }, 1.5)
/** The zoom an older version left in Chromium's Preferences on a 2K monitor: level 1.646, 1.2^level = 1.35. */
const OLD_LEVEL = 1.6460181545591597
const OLD_ZOOM = 1.2 ** OLD_LEVEL

/**
 * The page as Chromium keeps its zoom (checked in Electron 44.4.5): in the default mode a zoom per page address, the whole file://
 * address, that a resize snaps the page to (a page change alone keeps what is drawn); in the isolated mode one zoom for the page.
 * `remembered`: zooms by address, as in Preferences. `seen`: every zoom the player saw, in order.
 */
function fakePage(options: { remembered?: Record<string, number>; mode?: string; zoom?: number } = {}) {
  const handlers = new Map<string, Array<() => void>>()
  const page = {
    address: '#/',
    mode: options.mode ?? 'default',
    own: options.zoom ?? 1,
    remembered: { ...options.remembered },
    rendered: 0,
    seen: [] as number[],
    zoomSets: [] as number[],
    limits: null as [number, number] | null,
    destroyed: false,
    current: () => (page.mode === 'isolated' ? page.own : page.remembered[page.address] ?? 1),
    show(zoom: number) {
      if (Math.abs(zoom - page.rendered) < 1e-9) return
      page.rendered = zoom
      page.seen.push(Math.round(zoom * 100) / 100)
    },
    isDestroyed: () => page.destroyed,
    getZoomFactor: () => page.current(),
    setZoomFactor(factor: number) {
      page.zoomSets.push(factor)
      if (page.mode === 'isolated') page.own = factor
      else page.remembered[page.address] = factor
      page.show(factor)
    },
    getZoomMode: () => page.mode,
    setZoomMode(mode: string) {
      if (mode === 'isolated' && page.mode !== 'isolated') page.own = page.rendered
      page.mode = mode
    },
    setVisualZoomLevelLimits(minimum: number, maximum: number) {
      page.limits = [minimum, maximum]
      return Promise.resolve()
    },
    on(event: string, handler: () => void) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler])
      return page
    },
    emit(event: string) {
      for (const handler of handlers.get(event) ?? []) handler()
    },
    /** A menu button: the router's pushState; the page is not loaded again. */
    go(address: string) {
      page.address = address
      page.emit('did-navigate-in-page')
    },
    /** A resize (maximize, full screen, a monitor's DPI): Chromium sends the page its zoom again. */
    sync() {
      page.show(page.current())
    },
    reload() {
      page.show(page.current())
      page.emit('did-navigate')
      page.emit('did-finish-load')
    },
    /** Ctrl + the mouse wheel: Electron only asks ('zoom-changed'). */
    ctrlWheel() {
      page.emit('zoom-changed')
    },
  }
  page.show(page.current())
  page.seen = []
  return page
}

function fakeWindow(page: ReturnType<typeof fakePage>, bounds: Rect) {
  const handlers = new Map<string, Array<() => void>>()
  const window = {
    webContents: page,
    bounds: { ...bounds },
    maximized: false,
    minimum: null as { width: number; height: number } | null,
    boundsSets: [] as Rect[],
    isDestroyed: () => false,
    getBounds: () => ({ ...window.bounds }),
    isMaximized: () => window.maximized,
    isFullScreen: () => false,
    setMinimumSize(width: number, height: number) {
      window.minimum = { width, height }
    },
    setBounds(next: Rect) {
      window.boundsSets.push(next)
      window.bounds = { ...next }
      page.sync()
      window.emit('move')
    },
    on(event: string, handler: () => void) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler])
      return window
    },
    once(event: string, handler: () => void) {
      return window.on(event, handler)
    },
    emit(event: string) {
      for (const handler of handlers.get(event) ?? []) handler()
    },
    /** Held by the title bar at this place (the drag goes on). */
    hold(x: number) {
      window.emit('will-move')
      window.bounds = { ...window.bounds, x }
      window.emit('move')
      page.sync()
    },
    /** The drag ends where the window is. */
    letGo() {
      window.emit('moved')
    },
    /** Dragged by the title bar through these places and let go at the last one. */
    drag(...xs: number[]) {
      for (const x of xs) window.hold(x)
      window.letGo()
    },
    /** Moved without a drag (Win+Shift+arrow, Snap): 'move' only, no 'moved'. */
    shift(x: number) {
      window.bounds = { ...window.bounds, x }
      window.emit('move')
      page.sync()
    },
  }
  return window
}

const MINIMUM = { width: 1050, height: 700 }
const follow = (window: ReturnType<typeof fakeWindow>) => followDisplayScale(window as unknown as BrowserWindow, MINIMUM)
const sharesOn = (x: number, width = 1500) => ({ x, y: 60, width, height: 930 })

describe('report 234: the zoom changes only with the monitor (owner, 25.11.2026)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('on one monitor nothing changes it: page changes with a resize, maximize, full screen, a reload, Ctrl + the wheel', () => {
    fakeScreen.displays = PLAYER
    // Zooms older versions left by address: on this 2K monitor a page change + a resize used to snap to them.
    const page = fakePage({ remembered: { '#/profile': 1, '#/hideout': 0.8 } })
    const window = fakeWindow(page, { x: 2000, y: 60, width: 2025, height: 1256 })
    follow(window)
    expect(page.mode).toBe('isolated')
    expect(page.rendered).toBe(1.35)
    for (const address of ['#/quests', '#/profile', '#/hideout', '#/arsenal/builds?weapon=5447a9cd4bdc2dbd208b4567', '#/']) {
      page.go(address)
      page.sync()
      expect(page.rendered).toBe(1.35)
    }
    window.maximized = true
    window.emit('maximize')
    page.sync()
    page.reload()
    page.ctrlWheel()
    page.go('#/arsenal/range')
    page.sync() // «На весь экран»
    vi.advanceTimersByTime(10 * SETTLE_MS)
    expect(page.rendered).toBe(1.35)
    expect(page.seen).toEqual([1.35])
    expect(window.boundsSets).toEqual([])
    expect(page.limits).toEqual([1, 1])
  })

  it("the report's monitors: 1 on each Full HD one, 1.35 on the 2K one, every time", () => {
    fakeScreen.displays = PLAYER
    const page = fakePage()
    const window = fakeWindow(page, sharesOn(100))
    follow(window)
    expect(page.rendered).toBe(1)
    window.drag(1200, 1700, 2100)
    expect(page.rendered).toBe(1.35)
    page.go('#/maps/customs')
    page.sync()
    expect(page.rendered).toBe(1.35)
    window.drag(800, -400, -1700)
    expect(page.rendered).toBe(1)
    page.go('#/quests')
    page.reload()
    window.drag(-900, 200)
    expect(page.rendered).toBe(1)
    window.drag(1300, 2300)
    expect(page.rendered).toBe(1.35)
    expect(page.seen).toEqual([1.35, 1, 1.35])
  })

  it('dragged back and forth across the edge: nothing while dragged, one change when let go', () => {
    fakeScreen.displays = PLAYER
    const page = fakePage()
    const window = fakeWindow(page, sharesOn(100))
    follow(window)
    // Through the edge again and again (majority Full HD, 2K, Full HD, 2K…), held still on each side for a while.
    for (const x of [700, 1300, 800, 1400, 1000, 1350, 1500]) {
      window.hold(x)
      vi.advanceTimersByTime(3 * SETTLE_MS)
      expect(page.seen).toEqual([])
    }
    // Let go mostly on the 2K one: its zoom, once.
    window.letGo()
    vi.advanceTimersByTime(3 * SETTLE_MS)
    expect(page.seen).toEqual([1.35])
    expect(page.zoomSets).toEqual([1.35])
    // The same layout: the window grows with the zoom, into the 2K monitor.
    expect(window.boundsSets).toEqual([{ x: 1920, y: 60, width: 2025, height: 1256 }])
    // Across the edge and back, let go where it was: no change at all.
    const sets = page.zoomSets.length
    window.drag(1000, 300, 1200, 1940)
    expect(page.zoomSets.length).toBe(sets)
    expect(page.seen).toEqual([1.35])
  })

  it('three monitors of different Windows scaling: each its own zoom, once per move', () => {
    fakeScreen.displays = [FULL_HD, QHD_125, UHD_150]
    const page = fakePage()
    const window = fakeWindow(page, sharesOn(100))
    follow(window)
    window.drag(900, 2000)
    expect(page.rendered).toBe(1.05) // 2K at 125 %: 2048×1152 in Windows units
    window.drag(3000, 4100)
    expect(page.rendered).toBe(1.35) // 4K at 150 %: 2560×1440
    window.drag(2500, 100)
    expect(page.rendered).toBe(1)
    expect(page.seen).toEqual([1.05, 1.35, 1])
  })

  it('moved without a drag (Win+Shift+arrow): its monitor once it has stood still', () => {
    fakeScreen.displays = PLAYER
    const page = fakePage()
    const window = fakeWindow(page, sharesOn(100))
    follow(window)
    window.shift(1000)
    window.shift(1700)
    window.shift(2000)
    vi.advanceTimersByTime(SETTLE_MS - 50)
    expect(page.rendered).toBe(1)
    vi.advanceTimersByTime(100)
    expect(page.rendered).toBe(1.35)
    vi.advanceTimersByTime(10 * SETTLE_MS)
    expect(page.seen).toEqual([1.35])
  })

  it('a window let go across the edge stays with its monitor until another holds clearly more of it', () => {
    const window = (x: number) => sharesOn(x, 1000)
    // 52 % on the 2K one: stays on the Full HD one; 70 %: moves over.
    expect(monitorOfWindow(FULL_HD.id, window(1440), PLAYER)?.id).toBe(FULL_HD.id)
    expect(monitorOfWindow(FULL_HD.id, window(1620), PLAYER)?.id).toBe(QHD.id)
    expect(SWITCH_MARGIN).toBeGreaterThan(0)
    // No monitor yet, or its monitor gone: the larger part decides at once.
    expect(monitorOfWindow(undefined, window(1440), PLAYER)?.id).toBe(QHD.id)
    expect(monitorOfWindow(FULL_HD.id, window(1440), [LEFT_FULL_HD, QHD])?.id).toBe(QHD.id)
    expect(monitorOfWindow(FULL_HD.id, { x: 9000, y: 9000, width: 100, height: 100 }, PLAYER)).toBeUndefined()
  })

  it('the monitors change (Windows scaling, a monitor unplugged): the new zoom once', () => {
    fakeScreen.displays = [FULL_HD, QHD]
    const page = fakePage()
    const window = fakeWindow(page, { x: 2000, y: 60, width: 2025, height: 1256 })
    follow(window)
    expect(page.rendered).toBe(1.35)
    // 125 % set for the 2K monitor in Windows: 2048×1152 in Windows units.
    fakeScreen.displays = [FULL_HD, { ...monitor(3, 1920, { width: 2560, height: 1440 }, 1.25) }]
    fakeScreen.emit('display-metrics-changed')
    fakeScreen.emit('display-metrics-changed')
    vi.advanceTimersByTime(SETTLE_MS + 50)
    expect(page.rendered).toBe(1.05)
    // The 2K monitor unplugged: Windows puts the window on the Full HD one.
    fakeScreen.displays = [FULL_HD]
    fakeScreen.emit('display-removed')
    window.shift(200)
    vi.advanceTimersByTime(SETTLE_MS + 50)
    expect(page.rendered).toBe(1)
    expect(page.seen).toEqual([1.35, 1.05, 1])
  })

  it('zooms an older version left in Preferences (level 1.646) do nothing', () => {
    expect(OLD_ZOOM).toBeCloseTo(1.35, 3)
    fakeScreen.displays = PLAYER
    const addresses = ['#/', '#/quests', '#/maps/customs', '#/arsenal/builds?weapon=5447a9cd4bdc2dbd208b4567', '#/requests']
    const remembered = Object.fromEntries(addresses.map((address) => [address, OLD_ZOOM]))
    // As main.ts opens it: isolated, at the zoom of its monitor (Full HD: 1).
    const page = fakePage({ remembered, mode: 'isolated', zoom: 1 })
    const window = fakeWindow(page, sharesOn(100))
    follow(window)
    for (const address of addresses) {
      page.go(address)
      page.sync()
      page.reload()
    }
    expect(page.rendered).toBe(1)
    expect(page.seen).toEqual([])
    expect(page.zoomSets).toEqual([])
  })

  it('keeps the page at the monitor value, whatever moved it', () => {
    let target = 1.35
    const page = fakePage({ remembered: { '#/': 1 } })
    pinInterfaceZoom(page as unknown as WebContents, () => target)
    expect(page.mode).toBe('isolated')
    expect(page.rendered).toBe(1.35)
    page.mode = 'default'
    page.go('#/fresh')
    expect(page.mode).toBe('isolated')
    expect(page.rendered).toBe(1.35)
    page.own = 1.2
    page.ctrlWheel()
    expect(page.own).toBe(1.35)
    target = 0
    page.own = 1.1
    page.reload()
    expect(page.own).toBe(1.1) // no monitor value yet: nothing set
    expect(zoomToRestore(1.35, 1.35)).toBeNull()
    expect(zoomToRestore(1.3504, 1.35)).toBeNull()
    expect(zoomToRestore(1, 1.35)).toBe(1.35)
    expect(zoomToRestore(Number.NaN, 1)).toBe(1)
  })

  it('a window let go moves into its new monitor at the new zoom, the layout the same', () => {
    expect(rescaledBounds({ x: 1500, y: 60, width: 1500, height: 930 }, 1, 1.35, QHD.workArea)).toEqual({ x: 1920, y: 60, width: 2025, height: 1256 })
    expect(rescaledBounds({ x: 1940, y: 60, width: 2025, height: 1256 }, 1.35, 1, FULL_HD.workArea)).toEqual({ x: 420, y: 60, width: 1500, height: 930 })
  })

  it('stops following the monitors once the window is closed', () => {
    fakeScreen.displays = PLAYER
    const before = fakeScreen.listenerCount('display-metrics-changed')
    const page = fakePage()
    const window = fakeWindow(page, sharesOn(100))
    follow(window)
    expect(fakeScreen.listenerCount('display-metrics-changed')).toBe(before + 1)
    window.shift(2000)
    window.emit('closed')
    vi.advanceTimersByTime(10 * SETTLE_MS)
    expect(page.rendered).toBe(1)
    expect(fakeScreen.listenerCount('display-metrics-changed')).toBe(before)
    expect(fakeScreen.listenerCount('display-removed')).toBe(before)
  })

  it('main.ts opens the window isolated, at the zoom of its monitor', () => {
    const main = readFileSync(join(__dirname, 'main.ts'), 'utf8')
    expect(main).toContain('zoomMode: INTERFACE_ZOOM_MODE')
    expect(main).toContain('zoomFactor: startZoom')
    expect(main).toContain('followDisplayScale(mainWindow')
  })
})
