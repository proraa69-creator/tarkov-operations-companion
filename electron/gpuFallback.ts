/**
 * Drawing without the graphics card when it draws nothing (owner, 23.11.2026, after a player's support chat: «скачал ваше
 * приложение, но когда я его запускаю, то появляется черный экран»; «по перезапуску приложения из за черного экрана делай»).
 *
 * The window is shown with its first picture, or after 5 s whatever it has (main.ts): a graphics driver Chromium cannot use
 * leaves it dark. When at a start the graphics process dies, or the page dies, or nothing is drawn for FIRST_PAINT_MS, the app
 * notes it (gpu-fallback.json in its data folder) and starts again once, drawing in software
 * (app.disableHardwareAcceleration(), which must be called before the app is ready). It stays so: a card that failed once is not
 * tried at every start. A start with `--disable-gpu` draws in software too (Chromium's own switch).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const GPU_FALLBACK_FILE = 'gpu-fallback.json'
/** How long a start may take to draw its page before the graphics card is blamed (a slow PC's first start included). */
export const FIRST_PAINT_MS = 25_000

export interface GpuFallbackState {
  /** Drawing in software since a start that drew nothing. */
  softwareDrawing: boolean
  reason?: string
  at?: string
}

export function readGpuFallback(dataFolder: string): GpuFallbackState {
  const file = join(dataFolder, GPU_FALLBACK_FILE)
  if (!existsSync(file)) return { softwareDrawing: false }
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<GpuFallbackState>
    return { softwareDrawing: parsed.softwareDrawing === true, ...(typeof parsed.reason === 'string' ? { reason: parsed.reason } : {}), ...(typeof parsed.at === 'string' ? { at: parsed.at } : {}) }
  } catch {
    return { softwareDrawing: false }
  }
}

export function writeGpuFallback(dataFolder: string, reason: string, now = new Date()) {
  const state: GpuFallbackState = { softwareDrawing: true, reason, at: now.toISOString() }
  writeFileSync(join(dataFolder, GPU_FALLBACK_FILE), JSON.stringify(state))
  return state
}

export type DrawingTrouble =
  /** The graphics process ended (details.type 'GPU' of app 'child-process-gone'), with its reason. */
  | { kind: 'gpu-gone'; reason: string }
  /** The page's process ended before it drew anything. */
  | { kind: 'page-gone'; reason: string }
  /** Nothing drawn FIRST_PAINT_MS after the window was made. */
  | { kind: 'no-picture' }

/** Reasons a process ends that are no failure of the card. */
const CLEAN_ENDS = new Set(['clean-exit'])

/**
 * Whether this trouble starts the app again in software: only once (never while already drawing in software), and only before
 * the page's first picture (a card that has drawn the page works; a later failure Chromium recovers from itself).
 */
export function shouldDrawInSoftware(trouble: DrawingTrouble, state: { softwareDrawing: boolean; painted: boolean; disabledByArgument: boolean }) {
  if (state.softwareDrawing || state.disabledByArgument || state.painted) return false
  if (trouble.kind === 'no-picture') return true
  return !CLEAN_ENDS.has(trouble.reason)
}
