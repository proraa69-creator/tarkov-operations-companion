import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import { DEFAULT_ITEM_KEY, isKnownHotkey } from '../../src/overlay/hotkeys.js'

/**
 * The settings of the game-related functions (the item key, the Collector scan key, the position from the game's
 * screenshots). The in-game overlays went on 15.10.2026 (owner: «убирай функции оверлей, карта поверх игры и информация о
 * предмете поверх игры»): their key, opacity, size and place are dropped from settings files saved before.
 */
export interface ExperimentalSettings {
  version: 5
  /** Always true (kept for older settings files and the server sync). */
  itemLookup: boolean
  /** Always true (kept for older settings files and the server sync). */
  minimap: boolean
  tracking: boolean
  /** Always false: automatic screenshots were removed. */
  autoScreenshot: boolean
  screenshotIntervalMs: number
  /** KeyboardEvent.code values, see src/overlay/hotkeys.ts */
  itemKey: string
  /** Empty string = no hotkey for the Collector item scan. */
  collectorKey: string
  /** How the player's position is drawn on the app's maps. */
  playerMarker: 'arrow' | 'chevron' | 'dot'
  /** EFT screenshots folder chosen by hand; empty = auto-detect. */
  screenshotsDir: string
  /**
   * «Отключить местоположение» (was «Отключить мини-карту», owner, 14.10.2026: «отключить карту полностью и эта функция не
   * будет работать»): the app does not watch the screenshots folder, so no player's dot anywhere, the phone included.
   * The item card keeps working. A key of its own: the removed `minimap` switch may still be false in settings files
   * saved before it went.
   */
  minimapOff: boolean
}

export const DEFAULT_SETTINGS: ExperimentalSettings = {
  version: 5,
  itemLookup: true,
  minimap: true,
  tracking: true,
  autoScreenshot: false,
  screenshotIntervalMs: 1500,
  itemKey: DEFAULT_ITEM_KEY,
  collectorKey: '',
  playerMarker: 'arrow',
  screenshotsDir: '',
  minimapOff: false,
}

/**
 * The owner's switch for every app (owner, 14.10.2026: «включить или выключить функции миникарты… после обновления
 * приложения у всех по стандарту функция миникарты выключена»; server/src/routes/announcement.ts `features.minimap`): the
 * position tracking. The renderer learns it from the server and passes it here (`experimental:set-remote-minimap`), the
 * last known value first. Off until then: not known yet counts as off. The server's second switch (`minimapOverlay`, the
 * window over the game) only concerns the apps from before 15.10.2026: this app draws nothing over the game.
 */
let remoteMinimap = false
export const setRemoteMinimap = (enabled: boolean) => { remoteMinimap = enabled }
export const remoteMinimapOn = () => remoteMinimap

/**
 * The position tracking and what it needs (the screenshots folder, the position on the app's maps and the phone) is on
 * while the owner allows it for everybody. The player's own «Отключить местоположение» is gone (owner, 16.10.2026:
 * «выключения кнопку удали, могу выключить только я, а пока я не выключил эта функция у них работает»): a `minimapOff`
 * saved before no longer counts.
 */
export const trackingOn = (settings: Pick<ExperimentalSettings, 'minimap'>, remote = remoteMinimap) => remote && settings.minimap

let current: ExperimentalSettings | null = null

function file() {
  return join(app.getPath('userData'), 'experimental.json')
}

export function readSettings(): ExperimentalSettings {
  if (current) return current
  try {
    const saved = JSON.parse(readFileSync(file(), 'utf8')) as Record<string, unknown>
    current = sanitize(saved)
  } catch {
    current = { ...DEFAULT_SETTINGS }
  }
  return current
}

export async function updateSettings(patch: unknown): Promise<ExperimentalSettings> {
  current = sanitize({ ...readSettings(), ...(patch && typeof patch === 'object' ? patch : {}) })
  await writeFile(file(), JSON.stringify(current, null, 2), 'utf8').catch(() => {})
  return current
}

/** Saved settings (any shape, any older version) as the current ones. Exported for the tests. */
export function sanitize(raw: unknown): ExperimentalSettings {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const interval = Number(value.screenshotIntervalMs)
  return {
    version: 5,
    // Always on: the item card works by its key, the position by the game's screenshots (the on/off switches were removed).
    itemLookup: true,
    minimap: true,
    // Always on: the player's position comes from the game's screenshots (the switch was removed).
    tracking: true,
    // Removed: the game's «screenshot taken» notice kept popping up and distracted the player. The app presses no keys
    // at all (owner, 14.10.2026): the player's own screenshots update the position.
    autoScreenshot: false,
    screenshotIntervalMs: Number.isFinite(interval) ? Math.min(15000, Math.max(1000, Math.round(interval))) : DEFAULT_SETTINGS.screenshotIntervalMs,
    itemKey: isKnownHotkey(value.itemKey) ? value.itemKey : DEFAULT_ITEM_KEY,
    collectorKey: isKnownHotkey(value.collectorKey) ? value.collectorKey : '',
    playerMarker: value.playerMarker === 'chevron' || value.playerMarker === 'dot' ? value.playerMarker : 'arrow',
    screenshotsDir: typeof value.screenshotsDir === 'string' ? value.screenshotsDir.slice(0, 500) : '',
    // Only the owner turns the position off now (see trackingOn): a player's earlier «выключено» is dropped.
    minimapOff: false,
  }
}
