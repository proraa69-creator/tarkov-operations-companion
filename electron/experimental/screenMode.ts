import { copyFile, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * «Безрамочный режим» on the Mini Map page (owner, 10.10.2026; off by default): the overlays (minimap, item card) are
 * drawn over the game only in «Оконный без рамки», so the app can set that mode in the game's own settings file
 * (%APPDATA%\Battlestate Games\Escape from Tarkov\Settings\Graphics.ini, JSON) — only while the game is closed (it writes
 * the file back on exit), with a copy of the file kept once (Graphics.ini.raidos-backup) and the old value remembered,
 * so switching it off puts the game back. Nothing else in the file changes; nothing is injected into the game.
 */
export const BORDERLESS_VALUE = 1
const KEY = /^full\s*screen\s*mode$/i

export const graphicsFile = (appData: string) => join(appData, 'Battlestate Games', 'Escape from Tarkov', 'Settings', 'Graphics.ini')

/** The path of the screen-mode field (FullScreenMode / FullscreenMode, possibly nested), or null. */
export function findScreenMode(value: unknown, path: string[] = []): string[] | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (KEY.test(key) && typeof child === 'number') return [...path, key]
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const found = findScreenMode(child, [...path, key])
    if (found) return found
  }
  return null
}

function indentOf(text: string) {
  const match = /\n([ \t]+)"/.exec(text)
  return match ? match[1] : '  '
}

/** The file with the screen mode set to `mode`; null when the file has no such field. `previous` is the old value. */
export function withScreenMode(text: string, mode: number): { text: string; previous: number } | null {
  let parsed: unknown
  try { parsed = JSON.parse(text.replace(/^\uFEFF/, '')) } catch { return null }
  const path = findScreenMode(parsed)
  if (!path) return null
  let holder = parsed as Record<string, unknown>
  for (const key of path.slice(0, -1)) holder = holder[key] as Record<string, unknown>
  const last = path[path.length - 1]
  const previous = holder[last] as number
  holder[last] = mode
  return { text: JSON.stringify(parsed, null, indentOf(text)), previous }
}

export type ScreenModeResult = 'applied' | 'already' | 'restored' | 'game-running' | 'no-file' | 'no-setting' | 'off' | 'error'

/**
 * Sets borderless (`on`) or puts the remembered mode back (`!on`, when the app had changed it). Returns what happened
 * and the value to remember for later (`previous`: the player's own mode before the app changed it).
 */
export async function applyScreenMode(options: { file: string; on: boolean; previous: number | null; gameRunning: boolean | null }): Promise<{ result: ScreenModeResult; previous: number | null }> {
  const { file, on, previous, gameRunning } = options
  if (!on && previous === null) return { result: 'off', previous: null }
  if (gameRunning) return { result: 'game-running', previous }
  if (!existsSync(file)) return { result: 'no-file', previous }
  try {
    const text = await readFile(file, 'utf8')
    const target = on ? BORDERLESS_VALUE : previous!
    const changed = withScreenMode(text, target)
    if (!changed) return { result: 'no-setting', previous }
    if (changed.previous === target) return { result: on ? 'already' : 'restored', previous: on ? previous : null }
    if (!existsSync(`${file}.raidos-backup`)) await copyFile(file, `${file}.raidos-backup`)
    await writeFile(file, changed.text, 'utf8')
    return on ? { result: 'applied', previous: previous ?? changed.previous } : { result: 'restored', previous: null }
  } catch {
    return { result: 'error', previous }
  }
}
