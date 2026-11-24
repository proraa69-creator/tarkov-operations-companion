import { readFileSync, writeFileSync } from 'node:fs'
import type { BrowserWindow } from 'electron'

/**
 * Where the main window was left (a player's proposal, №71, 06.11.2026: «не запоминает на каком мониторе оно последний раз было…
 * размеры окна и положение»): its monitor, place, size and whether it was maximized, kept in a small file beside the app's data.
 * A monitor that is gone gives the usual first start, never a window out of sight.
 */
export interface Rect { x: number; y: number; width: number; height: number }
export interface SavedWindow extends Rect { maximized: boolean }

/** So much of the window must lie on a monitor to count as being there: enough to take it by its title. */
const MIN_VISIBLE = { width: 120, height: 40 }
const SAVE_AFTER_MS = 500

export function parseSavedWindow(raw: unknown): SavedWindow | null {
  if (!raw || typeof raw !== 'object') return null
  const { x, y, width, height, maximized } = raw as Record<string, unknown>
  if (![x, y, width, height].every((value) => typeof value === 'number' && Number.isFinite(value))) return null
  if ((width as number) <= 0 || (height as number) <= 0) return null
  return { x: Math.round(x as number), y: Math.round(y as number), width: Math.round(width as number), height: Math.round(height as number), maximized: maximized === true }
}

const overlap = (a: Rect, b: Rect) => ({
  width: Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
  height: Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
})

/** The place to open at: on the monitor holding the most of the window, fitted into it. Nothing when no monitor holds enough of it. */
export function restoredBounds(saved: Rect, areas: readonly Rect[], minimum: { width: number; height: number }): Rect | null {
  let best: { area: Rect; shared: number } | null = null
  for (const area of areas) {
    const { width, height } = overlap(saved, area)
    if (width < MIN_VISIBLE.width || height < MIN_VISIBLE.height) continue
    const shared = width * height
    if (!best || shared > best.shared) best = { area, shared }
  }
  if (!best) return null
  const { area } = best
  const width = Math.min(Math.max(saved.width, minimum.width), area.width)
  const height = Math.min(Math.max(saved.height, minimum.height), area.height)
  return {
    x: Math.max(area.x, Math.min(saved.x, area.x + area.width - width)),
    y: Math.max(area.y, Math.min(saved.y, area.y + area.height - height)),
    width,
    height,
  }
}

export function readSavedWindow(file: string): SavedWindow | null {
  try { return parseSavedWindow(JSON.parse(readFileSync(file, 'utf8'))) } catch { return null }
}

/** Kept as it changes, not only on closing: a crash or a switched-off computer loses nothing. */
export function rememberWindow(window: BrowserWindow, file: string) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const save = () => {
    if (timer) { clearTimeout(timer); timer = undefined }
    if (window.isDestroyed()) return
    // The normal place even when maximized or minimized: that is where it comes back to.
    const state: SavedWindow = { ...window.getNormalBounds(), maximized: window.isMaximized() }
    try { writeFileSync(file, JSON.stringify(state)) } catch { /* the next change tries again */ }
  }
  const later = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(save, SAVE_AFTER_MS)
  }
  window.on('resized', later)
  window.on('moved', later)
  window.on('maximize', later)
  window.on('unmaximize', later)
  window.on('close', save)
}
