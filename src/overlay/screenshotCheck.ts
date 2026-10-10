import type { PlayerPosition } from './screenshotPosition.js'

/** The screenshot key the app presses and where it was found. */
export interface ScreenshotKeyInfo {
  /** Unity key names pressed together, e.g. ["F12"] or ["LeftAlt", "F12"]. */
  keys: string[]
  label: string
  /**
   * standard: PrtSc, the game's standard key (the default); setting: another key chosen on the Mini Map page;
   * game-settings: the game's Control.ini; game-log: the game's log; default: nothing found there, PrtSc.
   */
  source: 'standard' | 'setting' | 'game-settings' | 'game-log' | 'default'
  /** The game has no screenshot key. */
  unbound: boolean
  /** The app can press it (mouse buttons it cannot). */
  sendable: boolean
}

export interface ScreenshotCheckFile { name: string; at: number; position: PlayerPosition | null }

/** Step-by-step answer of the «Проверить скриншоты» button. */
export interface ScreenshotCheck {
  phase: 'running' | 'waiting-game' | 'waiting-file' | 'done'
  /** Seconds left to switch to the game. */
  countdown: number
  folder: { path: string; exists: boolean; images: number; withCoordinates: number; newest: ScreenshotCheckFile | null }
  key: ScreenshotKeyInfo
  snipping: 'on' | 'off' | 'unknown'
  elevated: boolean | null
  nativeError: string
  /** The app pressed the key while the game was in front. */
  pressed: boolean
  /** The screenshot the game wrote during the check (after the app's press or the player's own). */
  file: ScreenshotCheckFile | null
  raid: { inRaid: boolean; location?: string }
  verdict: 'ok' | 'no-native' | 'no-key' | 'snipping' | 'no-game' | 'no-file' | 'no-coordinates' | null
}
