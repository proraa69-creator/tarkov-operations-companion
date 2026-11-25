import { screen, type BrowserWindow, type Display, type WebContents } from 'electron'

/**
 * The interface looks like on a Full HD screen on any screen (owner, 11.10.2026: «на каждом разрешении выглядело как
 * Full HD», «программа сама автоматически должна определять разрешение экрана»). The page is zoomed by the display's
 * size in Windows units (DIP, so the Windows scaling is already in it) over 1920×1080: 4K at 100 % → 2, 4K at 150 % or
 * 1440p at 100 % → 1.35, an ultrawide 3440×1440 → 1.35 (by its height, more room across), Full HD and smaller → 1.
 * The CSS layout therefore always sees about 1920×1080, and text and pictures are drawn at the screen's full sharpness.
 * Moving the window to another monitor re-scales it (and resizes it in proportion, so the layout stays the same).
 *
 * Owner, 14.11.2026 («адаптацию под все мониторы, все размеры… сама определяла, какое разрешение стоит, и сама автоматически
 * выставляла размер»): a monitor stood upright (9:16) is measured against Full HD upright, 1080×1920, so a 4K one gets 2 as
 * it does lying down; and a screen smaller than Full HD (1366×768, 1600×900, a laptop at 125 %) is zoomed out down to 0.8,
 * so the layout still sees about Full HD instead of a cramped page.
 *
 * Report 234 (owner, 25.11.2026: «Интерфейс не должен вообще никак изменяться по размеру: не прыгать, не увеличиваться, не
 * уменьшаться»): the zoom is the monitor's and changes only when the window moves to a monitor of another size, or the monitors
 * themselves change. It jumped before because Chromium keeps a zoom set by setZoomFactor per page address, and a file:// page has
 * no host, so the address is the whole of it, #/section?query included (kept in Chromium's Preferences file across starts too).
 * A menu button took the page to an address with another remembered zoom (or none: 1), and the next resize, maximize, full screen
 * or move snapped the page to it: 1.35 of a 2K monitor on a Full HD one (the report's screenshot), 1 on the 2K one. The window's
 * zoom mode is now 'isolated': one zoom for its page that no address overrides (checked in Electron 44: it holds through pushState
 * + resize, a reload and another page; a remembered 1.35 is ignored and nothing new is written to Preferences).
 */
export const FULL_HD = { width: 1920, height: 1080 }
export const FULL_HD_UPRIGHT = { width: 1080, height: 1920 }
const MIN_SCALE = 0.8
const MAX_SCALE = 3

export function uiScaleFor(size: { width: number; height: number }) {
  const reference = size.height > size.width ? FULL_HD_UPRIGHT : FULL_HD
  const ratio = Math.min(size.width / reference.width, size.height / reference.height)
  if (!Number.isFinite(ratio) || ratio <= 0) return 1
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(ratio * 20) / 20))
}

export const displayScale = (display: Pick<Display, 'size'>) => uiScaleFor(display.size)

/** The window's size and minimum size at a scale (designed for Full HD), never larger than the display's work area. */
export function scaledWindowSize(base: { width: number; height: number; minWidth: number; minHeight: number }, scale: number, area: { width: number; height: number }) {
  const fit = (value: number, limit: number) => Math.min(Math.round(value * scale), limit)
  return { width: fit(base.width, area.width), height: fit(base.height, area.height), minWidth: fit(base.minWidth, area.width), minHeight: fit(base.minHeight, area.height) }
}

/**
 * The first start (no remembered place): a window that would take almost the whole work area anyway — an upright monitor,
 * a small laptop screen — opens maximized instead of a few pixels short of it.
 */
export function opensMaximized(size: { width: number; height: number }, area: { width: number; height: number }) {
  return size.width >= area.width * 0.9 || size.height >= area.height * 0.95
}

/** One zoom for the window's page instead of one per page address (Electron's webPreferences.zoomMode / setZoomMode). */
export const INTERFACE_ZOOM_MODE = 'isolated'

/** The zoom to set the page back to, or null when it has it already. */
export function zoomToRestore(current: number, target: number): number | null {
  return Number.isFinite(current) && Math.abs(current - target) < 0.001 ? null : target
}

/**
 * Keeps the page at the window's zoom (`zoom()`: its monitor's): the zoom mode and the zoom, again after every page load and page
 * change (should anything have moved them) and when Ctrl + the mouse wheel asks for a zoom (Electron zooms nothing by itself:
 * 'zoom-changed' is only the request). The pinch of a touch screen or touchpad is off (Electron's default, made sure of after each
 * load).
 */
export function pinInterfaceZoom(page: WebContents, zoom: () => number) {
  const pin = () => {
    if (page.isDestroyed()) return
    if (page.getZoomMode() !== INTERFACE_ZOOM_MODE) page.setZoomMode(INTERFACE_ZOOM_MODE)
    const target = zoom()
    if (!(target > 0)) return
    const restore = zoomToRestore(page.getZoomFactor(), target)
    if (restore !== null) page.setZoomFactor(restore)
  }
  page.on('did-finish-load', () => {
    pin()
    if (!page.isDestroyed()) void page.setVisualZoomLevelLimits(1, 1).catch(() => {})
  })
  page.on('did-navigate', pin)
  page.on('did-navigate-in-page', pin)
  page.on('zoom-changed', pin)
  pin()
  return pin
}

type Rect = { x: number; y: number; width: number; height: number }

const sharedArea = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))

/** How much more of the window (a share of it) another monitor must hold than the window's own before the window moves over. */
export const SWITCH_MARGIN = 0.1

/**
 * The monitor the window belongs to: the one holding the larger part of it. A window left across the edge stays with its monitor
 * until another one holds clearly more of it (SWITCH_MARGIN), so a nudge at the edge never toggles the zoom; a monitor that is
 * gone, or no longer under the window, gives way at once. Undefined when the window is on no monitor at all.
 */
export function monitorOfWindow<T extends { id: number; bounds: Rect }>(current: number | undefined, window: Rect, displays: readonly T[]): T | undefined {
  const area = Math.max(1, window.width * window.height)
  let best: T | undefined
  let bestShare = 0
  let own: T | undefined
  let ownShare = 0
  for (const display of displays) {
    const share = sharedArea(window, display.bounds) / area
    if (share > bestShare) {
      best = display
      bestShare = share
    }
    if (display.id === current) {
      own = display
      ownShare = share
    }
  }
  if (!best) return undefined
  if (!own || ownShare <= 0) return best
  return bestShare >= ownShare + SWITCH_MARGIN ? best : own
}

/** The window's bounds at a new zoom: the same layout, so it grows or shrinks with the zoom, kept inside the work area. */
export function rescaledBounds(bounds: Rect, previous: number, next: number, area: Rect): Rect {
  const width = Math.min(Math.round(bounds.width * next / previous), area.width)
  const height = Math.min(Math.round(bounds.height * next / previous), area.height)
  return { x: Math.max(area.x, Math.min(bounds.x, area.x + area.width - width)), y: Math.max(area.y, Math.min(bounds.y, area.y + area.height - height)), width, height }
}

/** A window moved without a drag (a Windows key, Snap, the monitors changing) takes its monitor's zoom once it has stood this long. */
export const SETTLE_MS = 400

/**
 * Keeps a window's page zoom at its monitor's scale. The zoom changes only when the window has moved to a monitor of another size
 * (decided when a drag is let go, or once a move without a drag has settled: never while the window is dragged across the edge)
 * and when the monitors change (resolution, Windows scaling, a monitor plugged in or out). Page changes, buttons, full screen,
 * maximize, reloads, Ctrl + the wheel and pinch leave it as it is (pinInterfaceZoom). `minimum`: the window's minimum size at
 * scale 1, re-applied at the new scale.
 */
export function followDisplayScale(window: BrowserWindow, minimum?: { width: number; height: number }) {
  let scale = 0
  let monitor: number | undefined
  let dragging = false
  let settle: ReturnType<typeof setTimeout> | undefined
  let pin = () => {}
  const stopSettle = () => {
    if (settle) clearTimeout(settle)
    settle = undefined
  }
  const apply = () => {
    stopSettle()
    if (window.isDestroyed()) return
    const bounds = window.getBounds()
    const display = monitorOfWindow(monitor, bounds, screen.getAllDisplays()) ?? screen.getDisplayMatching(bounds)
    monitor = display.id
    const next = displayScale(display)
    if (next !== scale) {
      const previous = scale
      scale = next
      if (minimum) {
        window.setMinimumSize(Math.min(Math.round(minimum.width * next), display.workArea.width), Math.min(Math.round(minimum.height * next), display.workArea.height))
      }
      // A monitor of another size: the same layout, so the window grows or shrinks with it.
      if (previous && !window.isMaximized() && !window.isFullScreen()) window.setBounds(rescaledBounds(bounds, previous, next, display.workArea))
    }
    pin()
  }
  // A move without a drag: once the window has stood still. A drag: its end ('moved') decides.
  const settleThenApply = () => {
    if (dragging) return
    stopSettle()
    settle = setTimeout(apply, SETTLE_MS)
  }
  apply()
  pin = pinInterfaceZoom(window.webContents, () => scale)
  window.on('will-move', () => {
    dragging = true
    stopSettle()
  })
  window.on('moved', () => {
    dragging = false
    apply()
  })
  window.on('move', settleThenApply)
  window.on('maximize', apply)
  screen.on('display-metrics-changed', settleThenApply)
  screen.on('display-added', settleThenApply)
  screen.on('display-removed', settleThenApply)
  window.once('closed', () => {
    stopSettle()
    screen.off('display-metrics-changed', settleThenApply)
    screen.off('display-added', settleThenApply)
    screen.off('display-removed', settleThenApply)
  })
  return apply
}
