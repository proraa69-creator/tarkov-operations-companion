import type { PlayerPosition } from './screenshotPosition.js'

/**
 * The game's screenshot key and where it was read. The player presses it; the app never presses anything (owner,
 * 14.10.2026): it only reads the binding to tell whether it is the minimap's key too.
 */
export interface ScreenshotKeyInfo {
  /** Unity key names pressed together, e.g. ["F12"] or ["LeftAlt", "F12"]. */
  keys: string[]
  label: string
  /** game-settings: the game's Control.ini; game-log: the keys the game logs at start; default: neither, PrtSc. */
  source: 'game-settings' | 'game-log' | 'default'
  /** The game has no screenshot key. */
  unbound: boolean
}

export interface ScreenshotCheckFile { name: string; at: number; position: PlayerPosition | null }

/** Step-by-step answer of the «Проверить скриншоты» button. */
export interface ScreenshotCheck {
  phase: 'running' | 'waiting-game' | 'waiting-file' | 'done'
  /** Seconds left to switch to the game. */
  countdown: number
  folder: { path: string; exists: boolean; images: number; withCoordinates: number; newest: ScreenshotCheckFile | null }
  key: ScreenshotKeyInfo
  elevated: boolean | null
  nativeError: string
  /** The screenshot the game wrote during the check: the player presses the game's key, the app waits for the file. */
  file: ScreenshotCheckFile | null
  raid: { inRaid: boolean; location?: string }
  verdict: 'ok' | 'no-native' | 'no-key' | 'no-game' | 'no-file' | 'no-coordinates' | null
}
