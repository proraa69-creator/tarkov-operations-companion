import { screen, type BrowserWindow, type Display } from 'electron'

/**
 * The interface looks like on a Full HD screen on any screen (owner, 11.10.2026: «на каждом разрешении выглядело как
 * Full HD», «программа сама автоматически должна определять разрешение экрана»). The page is zoomed by the display's
 * size in Windows units (DIP, so the Windows scaling is already in it) over 1920×1080: 4K at 100 % → 2, 4K at 150 % or
 * 1440p at 100 % → 1.33, an ultrawide 3440×1440 → 1.33 (by its height, more room across), Full HD and smaller → 1.
 * The CSS layout therefore always sees about 1920×1080, and text and pictures are drawn at the screen's full sharpness.
 * Moving the window to another monitor re-scales it (and resizes it in proportion, so the layout stays the same).
 */
export const FULL_HD = { width: 1920, height: 1080 }
const MAX_SCALE = 3

export function uiScaleFor(size: { width: number; height: number }) {
  const ratio = Math.min(size.width / FULL_HD.width, size.height / FULL_HD.height)
  if (!Number.isFinite(ratio)) return 1
  return Math.min(MAX_SCALE, Math.max(1, Math.round(ratio * 20) / 20))
}

export const displayScale = (display: Pick<Display, 'size'>) => uiScaleFor(display.size)

/** The window's size and minimum size at a scale (designed for Full HD), never larger than the display's work area. */
export function scaledWindowSize(base: { width: number; height: number; minWidth: number; minHeight: number }, scale: number, area: { width: number; height: number }) {
  const fit = (value: number, limit: number) => Math.min(Math.round(value * scale), limit)
  return { width: fit(base.width, area.width), height: fit(base.height, area.height), minWidth: fit(base.minWidth, area.width), minHeight: fit(base.minHeight, area.height) }
}

/**
 * Keeps a window's page zoom at its display's scale: after every page load, after the window was moved (to another
 * monitor) and when the displays change (resolution, Windows scaling, a monitor plugged in). `minimum`: the window's
 * minimum size at scale 1, re-applied at the new scale.
 */
export function followDisplayScale(window: BrowserWindow, minimum?: { width: number; height: number }) {
  let current = 0
  const apply = () => {
    if (window.isDestroyed()) return
    const display = screen.getDisplayMatching(window.getBounds())
    const scale = displayScale(display)
    if (scale !== current) {
      const previous = current
      current = scale
      if (minimum) {
        window.setMinimumSize(Math.min(Math.round(minimum.width * scale), display.workArea.width), Math.min(Math.round(minimum.height * scale), display.workArea.height))
      }
      // A monitor with another scale: the same layout, so the window grows or shrinks with it.
      if (previous && !window.isMaximized() && !window.isFullScreen()) {
        const bounds = window.getBounds()
        const area = display.workArea
        const width = Math.min(Math.round(bounds.width * scale / previous), area.width)
        const height = Math.min(Math.round(bounds.height * scale / previous), area.height)
        window.setBounds({ x: Math.max(area.x, Math.min(bounds.x, area.x + area.width - width)), y: Math.max(area.y, Math.min(bounds.y, area.y + area.height - height)), width, height })
      }
    }
    if (Math.abs(window.webContents.getZoomFactor() - scale) > 0.001) window.webContents.setZoomFactor(scale)
  }
  window.webContents.on('did-finish-load', apply)
  window.on('moved', apply)
  window.on('maximize', apply)
  const onDisplays = () => apply()
  screen.on('display-metrics-changed', onDisplays)
  screen.on('display-added', onDisplays)
  screen.on('display-removed', onDisplays)
  window.once('closed', () => {
    screen.off('display-metrics-changed', onDisplays)
    screen.off('display-added', onDisplays)
    screen.off('display-removed', onDisplays)
  })
  apply()
  return apply
}
