// @vitest-environment node
import type { BrowserWindow, WebContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'

type Rect = { x: number; y: number; width: number; height: number }
type FakeDisplay = { id: number; bounds: Rect; workArea: Rect; scaleFactor: number }

const { fakeScreen } = vi.hoisted(() => {
  const listeners = new Map<string, Set<() => void>>()
  const shared = (a: Rect, b: Rect) => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
  const fakeScreen = {
    displays: [] as FakeDisplay[],
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
const { fitMinimumSizeToDisplay, INTERFACE_ZOOM, minimumSizeOn, opensMaximized, pinInterfaceZoom, windowSizeFor, zoomToRestore } = await import('./uiScale')

/** A monitor as Electron reports it on Windows: bounds and work area in Windows units (DIP), the Windows scaling apart. */
const monitor = (id: number, x: number, pixels: { width: number; height: number }, scaleFactor: number): FakeDisplay => {
  const width = Math.round(pixels.width / scaleFactor)
  const height = Math.round(pixels.height / scaleFactor)
  return { id, bounds: { x, y: 0, width, height }, workArea: { x, y: 0, width, height: height - 40 }, scaleFactor }
}
// Three monitors of different Windows scaling side by side: Full HD at 100 %, 2K at 125 %, 4K at 150 %.
const FULL_HD = monitor(1, 0, { width: 1920, height: 1080 }, 1)
const QHD_125 = monitor(2, 1920, { width: 2560, height: 1440 }, 1.25)
const UHD_150 = monitor(3, 1920 + 2048, { width: 3840, height: 2160 }, 1.5)
// The report's computer: two Full HD monitors and a 2K one (the zoom used to be 1, 1 and 1.35 on them).
const PLAYER = [monitor(1, -1920, { width: 1920, height: 1080 }, 1), monitor(2, 0, { width: 1920, height: 1080 }, 1), monitor(3, 1920, { width: 2560, height: 1440 }, 1)]

function fakePage() {
  const handlers = new Map<string, Array<() => void>>()
  const page = {
    zoom: 1,
    mode: 'default',
    limits: null as [number, number] | null,
    zoomSets: [] as number[],
    destroyed: false,
    isDestroyed: () => page.destroyed,
    getZoomFactor: () => page.zoom,
    setZoomFactor: (factor: number) => { page.zoomSets.push(factor); page.zoom = factor },
    getZoomMode: () => page.mode,
    setZoomMode: (mode: string) => { page.mode = mode },
    setVisualZoomLevelLimits: (minimum: number, maximum: number) => { page.limits = [minimum, maximum]; return Promise.resolve() },
    on(event: string, handler: () => void) { handlers.set(event, [...(handlers.get(event) ?? []), handler]); return page },
    emit(event: string) { for (const handler of handlers.get(event) ?? []) handler() },
  }
  return page
}

function fakeWindow(bounds: Rect) {
  const handlers = new Map<string, Array<() => void>>()
  const window = {
    bounds,
    minimum: null as { width: number; height: number } | null,
    minimumSets: 0,
    boundsSets: 0,
    isDestroyed: () => false,
    getBounds: () => window.bounds,
    setBounds: () => { window.boundsSets += 1 },
    setMinimumSize: (width: number, height: number) => { window.minimum = { width, height }; window.minimumSets += 1 },
    on(event: string, handler: () => void) { handlers.set(event, [...(handlers.get(event) ?? []), handler]); return window },
    once(event: string, handler: () => void) { return window.on(event, handler) },
    emit(event: string) { for (const handler of handlers.get(event) ?? []) handler() },
    /** Dragged onto a monitor and let go there ('moved' comes at the end of the drag on Windows). */
    moveTo(display: FakeDisplay) {
      window.bounds = { ...window.bounds, x: display.workArea.x + 40, y: display.workArea.y + 20 }
      window.emit('moved')
    },
  }
  return window
}

const asPage = (page: ReturnType<typeof fakePage>) => page as unknown as WebContents
const asWindow = (window: ReturnType<typeof fakeWindow>) => window as unknown as BrowserWindow
const BASE = { width: 1500, height: 930, minWidth: 1050, minHeight: 700 }

describe('one interface size, always (report 234, owner 25.11.2026)', () => {
  it("the page zoom is 1 and the window's own, not one per page address, from the start", () => {
    const page = fakePage()
    pinInterfaceZoom(asPage(page))
    expect(INTERFACE_ZOOM).toBe(1)
    expect(page.mode).toBe('isolated')
    expect(page.zoom).toBe(1)
    expect(page.zoomSets).toEqual([])
  })

  it('moving the window across three monitors of different Windows scaling changes neither the zoom nor the window', () => {
    fakeScreen.displays = [FULL_HD, QHD_125, UHD_150]
    const page = fakePage()
    const window = fakeWindow({ x: 100, y: 60, width: 1500, height: 930 })
    pinInterfaceZoom(asPage(page))
    fitMinimumSizeToDisplay(asWindow(window), { width: BASE.minWidth, height: BASE.minHeight })
    for (const display of [QHD_125, UHD_150, FULL_HD, UHD_150, QHD_125]) {
      window.moveTo(display)
      fakeScreen.emit('display-metrics-changed')
      expect(page.zoom).toBe(1)
    }
    expect(page.zoomSets).toEqual([])
    expect(window.boundsSets).toBe(0)
    expect(window.bounds).toMatchObject({ width: 1500, height: 930 })
  })

  it("the report's two Full HD monitors and a 2K one: 1 on each, never 1.35", () => {
    fakeScreen.displays = PLAYER
    const page = fakePage()
    const window = fakeWindow({ x: 100, y: 60, width: 1500, height: 930 })
    pinInterfaceZoom(asPage(page))
    fitMinimumSizeToDisplay(asWindow(window), { width: BASE.minWidth, height: BASE.minHeight })
    for (const display of [PLAYER[2]!, PLAYER[0]!, PLAYER[2]!, PLAYER[1]!]) {
      window.moveTo(display)
      window.emit('maximize')
      expect(page.zoom).toBe(1)
    }
    expect(page.zoomSets).toEqual([])
  })

  it('a menu button, a reload, Ctrl + the mouse wheel: whatever moved the zoom, it goes back to 1', () => {
    const page = fakePage()
    pinInterfaceZoom(asPage(page))
    // Chromium gave the new page address the zoom it remembered for it (1.35, set on a 2K monitor by an older version).
    page.zoom = 1.35
    page.emit('did-navigate-in-page')
    expect(page.zoom).toBe(1)
    // A load that left the default zoom mode: the window's own zoom again.
    page.mode = 'default'
    page.zoom = 0.8
    page.emit('did-navigate')
    expect(page.mode).toBe('isolated')
    expect(page.zoom).toBe(1)
    page.zoom = 1.2
    page.emit('zoom-changed')
    expect(page.zoom).toBe(1)
    page.emit('did-finish-load')
    expect(page.limits).toEqual([1, 1])
    expect(page.zoomSets).toEqual([1, 1, 1])
  })

  it('sets the zoom back only when it differs', () => {
    expect(zoomToRestore(1)).toBeNull()
    expect(zoomToRestore(1.0004)).toBeNull()
    expect(zoomToRestore(1.35)).toBe(1)
    expect(zoomToRestore(0.8)).toBe(1)
    expect(zoomToRestore(Number.NaN)).toBe(1)
    expect(zoomToRestore(1, 1.1)).toBe(1.1)
  })

  it('leaves a closed page alone', () => {
    const page = fakePage()
    page.destroyed = true
    page.zoom = 1.35
    pinInterfaceZoom(asPage(page))
    page.emit('did-finish-load')
    expect(page.zoomSets).toEqual([])
    expect(page.limits).toBeNull()
  })
})

describe('the main window on any monitor', () => {
  it('opens at the same size everywhere, fitted into a smaller work area', () => {
    expect(windowSizeFor(BASE, FULL_HD.workArea)).toEqual({ width: 1500, height: 930, minWidth: 1050, minHeight: 700 })
    expect(windowSizeFor(BASE, PLAYER[2]!.workArea)).toEqual({ width: 1500, height: 930, minWidth: 1050, minHeight: 700 }) // was 2025×1256 at 1.35
    expect(windowSizeFor(BASE, UHD_150.workArea)).toEqual({ width: 1500, height: 930, minWidth: 1050, minHeight: 700 })
    expect(windowSizeFor(BASE, QHD_125.workArea)).toEqual({ width: 1500, height: 930, minWidth: 1050, minHeight: 700 })
    expect(windowSizeFor(BASE, { width: 1366, height: 728 })).toEqual({ width: 1366, height: 728, minWidth: 1050, minHeight: 700 })
    expect(windowSizeFor(BASE, { width: 1093, height: 574 })).toEqual({ width: 1093, height: 574, minWidth: 1050, minHeight: 574 }) // 1366×768 at 125 %
  })

  it('the first start fills an upright monitor or a small screen, not a Full HD or 2K one', () => {
    const at = (area: { width: number; height: number }) => opensMaximized(windowSizeFor(BASE, area), area)
    expect(at(FULL_HD.workArea)).toBe(false)
    expect(at(PLAYER[2]!.workArea)).toBe(false)
    expect(at(UHD_150.workArea)).toBe(false)
    expect(at({ width: 1080, height: 1880 })).toBe(true)
    expect(at({ width: 1366, height: 728 })).toBe(true)
  })

  it('the minimum size never exceeds the work area of the monitor the window is on', () => {
    const laptop = monitor(4, -1093, { width: 1366, height: 768 }, 1.25)
    fakeScreen.displays = [FULL_HD, laptop]
    const window = fakeWindow({ x: 100, y: 60, width: 1500, height: 930 })
    fitMinimumSizeToDisplay(asWindow(window), { width: BASE.minWidth, height: BASE.minHeight })
    expect(window.minimum).toEqual({ width: 1050, height: 700 })
    window.moveTo(laptop)
    expect(window.minimum).toEqual(minimumSizeOn({ width: 1050, height: 700 }, laptop.workArea))
    expect(window.minimum).toEqual({ width: 1050, height: 574 })
    window.moveTo(FULL_HD)
    expect(window.minimum).toEqual({ width: 1050, height: 700 })
    const sets = window.minimumSets
    window.moveTo(FULL_HD)
    fakeScreen.emit('display-added')
    expect(window.minimumSets).toBe(sets)
    expect(window.boundsSets).toBe(0)
  })

  it('stops following the monitors once the window is closed', () => {
    fakeScreen.displays = [FULL_HD]
    const before = fakeScreen.listenerCount('display-metrics-changed')
    const window = fakeWindow({ x: 100, y: 60, width: 1500, height: 930 })
    fitMinimumSizeToDisplay(asWindow(window), { width: BASE.minWidth, height: BASE.minHeight })
    expect(fakeScreen.listenerCount('display-metrics-changed')).toBe(before + 1)
    window.emit('closed')
    expect(fakeScreen.listenerCount('display-metrics-changed')).toBe(before)
    expect(fakeScreen.listenerCount('display-added')).toBe(fakeScreen.listenerCount('display-removed'))
  })
})
