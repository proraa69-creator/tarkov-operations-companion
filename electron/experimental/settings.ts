import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import { DEFAULT_ITEM_KEY, DEFAULT_MINIMAP_KEY, isKnownHotkey } from '../../src/overlay/hotkeys.js'
import { minimapWidth } from '../../src/overlay/minimapSize.js'

export interface ExperimentalSettings {
  version: 4
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
  minimapKey: string
  /** Empty string = no hotkey for the Collector item scan. */
  collectorKey: string
  minimapOpacity: number
  minimapWidth: number
  playerMarker: 'arrow' | 'chevron' | 'dot'
  /** EFT screenshots folder chosen by hand; empty = auto-detect. */
  screenshotsDir: string
  minimapPosition: { x: number; y: number } | null
  /** Start with administrator rights: the game runs elevated, and Windows hides its keys from apps that are not. */
  runAsAdmin: boolean
  /** Open the minimap for a moment when the player takes a screenshot in the game. */
  showOnScreenshot: boolean
  /**
   * «Отключить мини-карту» (owner, 14.10.2026: «отключить карту полностью и эта функция не будет работать»): the map key
   * does nothing, there is no minimap window and the app does not watch the screenshots folder (so no player's dot
   * anywhere, the phone included). The item card keeps working. A key of its own: the removed `minimap` switch may still
   * be false in settings files saved before it went.
   */
  minimapOff: boolean
}

export const DEFAULT_SETTINGS: ExperimentalSettings = {
  version: 4,
  itemLookup: true,
  minimap: true,
  tracking: true,
  autoScreenshot: false,
  screenshotIntervalMs: 1500,
  itemKey: DEFAULT_ITEM_KEY,
  minimapKey: DEFAULT_MINIMAP_KEY,
  collectorKey: '',
  minimapOpacity: 0.9,
  minimapWidth: 420,
  playerMarker: 'arrow',
  screenshotsDir: '',
  minimapPosition: null,
  runAsAdmin: false,
  showOnScreenshot: false,
  minimapOff: false,
}

/**
 * The owner's switch for every app (owner, 14.10.2026: «включить или выключить функции миникарты… после обновления
 * приложения у всех по стандарту функция миникарты выключена»; server/src/routes/announcement.ts `features.minimap`).
 * The renderer learns it from the server and passes it here (`experimental:set-remote-minimap`), the last known value
 * first. Off until then: not known yet counts as off.
 */
let remoteMinimap = false
/**
 * The owner's second switch (owner, 14.10.2026: «отключить именно мини карту по кнопке. то есть ее выключаешь и
 * местоположение появляется только в приложении. а всплывающее окно не появляется вообще»; `features.minimapOverlay`):
 * the minimap window over the game. On unless the owner turned it off, so the first switch alone gives the whole minimap.
 */
let remoteOverlay = true
/** `overlay` left out (a caller from before the second switch): the window follows the first switch alone. */
export const setRemoteMinimap = (enabled: boolean, overlay = true) => { remoteMinimap = enabled; remoteOverlay = overlay }
export const remoteMinimapOn = () => remoteMinimap
export const remoteOverlayOn = () => remoteOverlay

/**
 * The minimap's tracking and what it needs (the screenshots folder, the position on the app's maps and the phone) are
 * on: the owner allows it for everybody, and the player did not turn it off («Отключить мини-карту»).
 */
export const minimapOn = (settings: Pick<ExperimentalSettings, 'minimap' | 'minimapOff'>, remote = remoteMinimap) => remote && settings.minimap && !settings.minimapOff

/**
 * The minimap window over the game, its key and «Показать / скрыть»: the tracking is on (minimapOn) and the owner also
 * allows the window. Off: the position shows only in the app.
 */
export const minimapOverlayOn = (settings: Pick<ExperimentalSettings, 'minimap' | 'minimapOff'>, remote = remoteMinimap, overlay = remoteOverlay) => minimapOn(settings, remote) && overlay

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
  const flag = (key: keyof ExperimentalSettings) => typeof value[key] === 'boolean' ? value[key] as boolean : DEFAULT_SETTINGS[key] as boolean
  const interval = Number(value.screenshotIntervalMs)
  return {
    version: 4,
    // Always on: the item card and the minimap work by their keys (the on/off switches were removed).
    itemLookup: true,
    minimap: true,
    // Always on: the player's position comes from the game's screenshots (the switch was removed).
    tracking: true,
    // Removed: the game's «screenshot taken» notice kept popping up and distracted the player. The app presses no keys
    // at all (owner, 14.10.2026): the player's own screenshots update the position.
    autoScreenshot: false,
    screenshotIntervalMs: Number.isFinite(interval) ? Math.min(15000, Math.max(1000, Math.round(interval))) : DEFAULT_SETTINGS.screenshotIntervalMs,
    itemKey: isKnownHotkey(value.itemKey) ? value.itemKey : DEFAULT_ITEM_KEY,
    minimapKey: isKnownHotkey(value.minimapKey) ? value.minimapKey : DEFAULT_MINIMAP_KEY,
    collectorKey: isKnownHotkey(value.collectorKey) ? value.collectorKey : '',
    minimapOpacity: Number.isFinite(Number(value.minimapOpacity)) ? Math.min(1, Math.max(0.3, Number(value.minimapOpacity))) : DEFAULT_SETTINGS.minimapOpacity,
    minimapWidth: minimapWidth(value.minimapWidth),
    playerMarker: value.playerMarker === 'chevron' || value.playerMarker === 'dot' ? value.playerMarker : 'arrow',
    screenshotsDir: typeof value.screenshotsDir === 'string' ? value.screenshotsDir.slice(0, 500) : '',
    minimapPosition: readPoint(value.minimapPosition),
    runAsAdmin: flag('runAsAdmin'),
    // The owner removed «Показывать мини-карту при скриншоте»: the minimap opens only by its key.
    showOnScreenshot: false,
    minimapOff: flag('minimapOff'),
  }
}

function readPoint(value: unknown) {
  if (!value || typeof value !== 'object') return null
  const { x, y } = value as Record<string, unknown>
  return Number.isFinite(Number(x)) && Number.isFinite(Number(y)) ? { x: Math.round(Number(x)), y: Math.round(Number(y)) } : null
}
