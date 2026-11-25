import { screen, type BrowserWindow, type WebContents } from 'electron'

/**
 * One interface size, always (report 234, owner 25.11.2026: «Интерфейс не должен вообще никак изменяться по размеру: не прыгать,
 * не увеличиваться, не уменьшаться»). The page zoom is 1 on every monitor and never changes while the app runs: not by the monitor
 * the window is on, not by a move to another one, not by a button, a page or a reload. Each monitor's own Windows scaling stays
 * Chromium's: it draws the window at that monitor's DPI by itself (no device scale factor is forced). The player's «Размер шрифта»
 * (src/theme/fontSize.ts) is a CSS variable of the page and is not touched here.
 *
 * Why it jumped: from 11.10 to 25.11.2026 the zoom followed the monitor (its size over Full HD: 1.35 on a 2K one). Chromium keeps
 * a zoom set by setZoomFactor per page address, and a file:// page has no host, so the address is the whole of it, #/section?query
 * included (kept in Chromium's Preferences file across starts too). A menu button took the page to an address with another
 * remembered zoom (or none: 1), and the next resize, maximize or move to another monitor snapped the page to it: 1.35 of the 2K
 * monitor on a Full HD one (the report's screenshot), back to 1 on the 2K one. The 'isolated' zoom mode gives the window one zoom
 * of its own that no address overrides. Checked in Electron 44: a remembered 1.35 is ignored after pushState + resize, a reload
 * and another page, and no new address is written to Preferences.
 */
export const INTERFACE_ZOOM = 1
/** One zoom for the window's page instead of one per page address (Electron's webPreferences.zoomMode / setZoomMode). */
export const INTERFACE_ZOOM_MODE = 'isolated'

/** The zoom to set the page back to, or null when it has the fixed one already. */
export function zoomToRestore(current: number, fixed: number = INTERFACE_ZOOM): number | null {
  return Number.isFinite(current) && Math.abs(current - fixed) < 0.001 ? null : fixed
}

/**
 * Keeps the page at the fixed zoom: the zoom mode and the zoom at once, and again after every page load and page change (should
 * anything have moved them) and when Ctrl + the mouse wheel asks for a zoom (Electron zooms nothing by itself: 'zoom-changed' is
 * only the request). The pinch of a touch screen or touchpad is off (Electron's default, made sure of after each load).
 */
export function pinInterfaceZoom(page: WebContents, zoom: number = INTERFACE_ZOOM) {
  const pin = () => {
    if (page.isDestroyed()) return
    if (page.getZoomMode() !== INTERFACE_ZOOM_MODE) page.setZoomMode(INTERFACE_ZOOM_MODE)
    const restore = zoomToRestore(page.getZoomFactor(), zoom)
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

type Size = { width: number; height: number }

/** The main window's size and minimum size: the same on every monitor (Windows units), never larger than the work area. */
export function windowSizeFor(base: Size & { minWidth: number; minHeight: number }, area: Size) {
  return { width: Math.min(base.width, area.width), height: Math.min(base.height, area.height), minWidth: Math.min(base.minWidth, area.width), minHeight: Math.min(base.minHeight, area.height) }
}

/**
 * The first start (no remembered place): a window that would take almost the whole work area anyway — an upright monitor,
 * a small laptop screen — opens maximized instead of a few pixels short of it.
 */
export function opensMaximized(size: Size, area: Size) {
  return size.width >= area.width * 0.9 || size.height >= area.height * 0.95
}

/** The window's minimum size on a monitor: its own, or that monitor's work area where it is smaller. */
export function minimumSizeOn(minimum: Size, area: Size): Size {
  return { width: Math.min(minimum.width, area.width), height: Math.min(minimum.height, area.height) }
}

/**
 * A window moved to a smaller monitor can still be made to fit it: its minimum size never exceeds the work area of the monitor it
 * is on (after a move, and when the monitors change). Only the minimum size: the window keeps its size and the page its zoom.
 */
export function fitMinimumSizeToDisplay(window: BrowserWindow, minimum: Size) {
  let applied = ''
  const fit = () => {
    if (window.isDestroyed()) return
    const size = minimumSizeOn(minimum, screen.getDisplayMatching(window.getBounds()).workArea)
    const key = `${size.width}x${size.height}`
    if (key === applied) return
    applied = key
    window.setMinimumSize(size.width, size.height)
  }
  window.on('moved', fit)
  screen.on('display-metrics-changed', fit)
  screen.on('display-added', fit)
  screen.on('display-removed', fit)
  window.once('closed', () => {
    screen.off('display-metrics-changed', fit)
    screen.off('display-added', fit)
    screen.off('display-removed', fit)
  })
  fit()
  return fit
}
