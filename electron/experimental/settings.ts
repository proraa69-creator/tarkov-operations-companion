import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import { DEFAULT_ITEM_KEY, DEFAULT_MINIMAP_KEY, isKnownHotkey } from '../../src/overlay/hotkeys.js'
import { SCREENSHOT_KEY_CHOICES } from '../../src/overlay/gameKeys.js'

export interface ExperimentalSettings {
  version: 3
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
  playerMarker: 'arrow' | 'chevron' | 'dot'
  /** EFT screenshots folder chosen by hand; empty = auto-detect. */
  screenshotsDir: string
  minimapPosition: { x: number; y: number } | null
  /** Start with administrator rights: the game runs elevated, and Windows hides its keys from apps that are not. */
  runAsAdmin: boolean
  /** Open the minimap for a moment when the player takes a screenshot in the game. */
  showOnScreenshot: boolean
  /** Unity key name the app presses for a screenshot when the minimap opens; empty = detected from the game settings. */
  screenshotKey: string
}

export const DEFAULT_SETTINGS: ExperimentalSettings = {
  version: 3,
  itemLookup: true,
  minimap: true,
  tracking: true,
  autoScreenshot: false,
  screenshotIntervalMs: 1500,
  itemKey: DEFAULT_ITEM_KEY,
  minimapKey: DEFAULT_MINIMAP_KEY,
  collectorKey: '',
  minimapOpacity: 0.9,
  playerMarker: 'arrow',
  screenshotsDir: '',
  minimapPosition: null,
  runAsAdmin: false,
  showOnScreenshot: false,
  screenshotKey: '',
}

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

function sanitize(raw: unknown): ExperimentalSettings {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const flag = (key: keyof ExperimentalSettings) => typeof value[key] === 'boolean' ? value[key] as boolean : DEFAULT_SETTINGS[key] as boolean
  const interval = Number(value.screenshotIntervalMs)
  return {
    version: 3,
    // Always on: the item card and the minimap work by their keys (the on/off switches were removed).
    itemLookup: true,
    minimap: true,
    // Always on: the player's position comes from the game's screenshots (the switch was removed).
    tracking: true,
    // Removed: the game's «screenshot taken» notice kept popping up and distracted the player. The app
    // still takes one screenshot when the minimap opens, and the player's own screenshots update the position.
    autoScreenshot: false,
    screenshotIntervalMs: Number.isFinite(interval) ? Math.min(15000, Math.max(1000, Math.round(interval))) : DEFAULT_SETTINGS.screenshotIntervalMs,
    itemKey: isKnownHotkey(value.itemKey) ? value.itemKey : DEFAULT_ITEM_KEY,
    minimapKey: isKnownHotkey(value.minimapKey) ? value.minimapKey : DEFAULT_MINIMAP_KEY,
    collectorKey: isKnownHotkey(value.collectorKey) ? value.collectorKey : '',
    minimapOpacity: Number.isFinite(Number(value.minimapOpacity)) ? Math.min(1, Math.max(0.3, Number(value.minimapOpacity))) : DEFAULT_SETTINGS.minimapOpacity,
    playerMarker: value.playerMarker === 'chevron' || value.playerMarker === 'dot' ? value.playerMarker : 'arrow',
    screenshotsDir: typeof value.screenshotsDir === 'string' ? value.screenshotsDir.slice(0, 500) : '',
    minimapPosition: readPoint(value.minimapPosition),
    runAsAdmin: flag('runAsAdmin'),
    // The owner removed «Показывать мини-карту при скриншоте»: the minimap opens only by its key.
    showOnScreenshot: false,
    screenshotKey: (SCREENSHOT_KEY_CHOICES as readonly unknown[]).includes(value.screenshotKey) ? value.screenshotKey as string : '',
  }
}

function readPoint(value: unknown) {
  if (!value || typeof value !== 'object') return null
  const { x, y } = value as Record<string, unknown>
  return Number.isFinite(Number(x)) && Number.isFinite(Number(y)) ? { x: Math.round(Number(x)), y: Math.round(Number(y)) } : null
}
