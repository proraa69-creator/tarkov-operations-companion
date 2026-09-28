import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import { DEFAULT_ITEM_KEY, DEFAULT_MINIMAP_KEY, isKnownHotkey } from '../../src/overlay/hotkeys.js'

export interface ExperimentalSettings {
  version: 3
  itemLookup: boolean
  minimap: boolean
  tracking: boolean
  autoScreenshot: boolean
  screenshotIntervalMs: number
  /** KeyboardEvent.code values, see src/overlay/hotkeys.ts */
  itemKey: string
  minimapKey: string
  /** Empty string = no hotkey for the Collector item scan. */
  collectorKey: string
  /** How long the item card stays over the game. */
  itemHideMs: number
  /** Read the item card aloud: works even over exclusive full screen, where no window can be drawn. */
  speakItem: 'off' | 'exclusive' | 'always'
}

export const DEFAULT_SETTINGS: ExperimentalSettings = {
  version: 3,
  itemLookup: true,
  minimap: true,
  tracking: true,
  autoScreenshot: true,
  screenshotIntervalMs: 1500,
  itemKey: DEFAULT_ITEM_KEY,
  minimapKey: DEFAULT_MINIMAP_KEY,
  collectorKey: '',
  itemHideMs: 6000,
  speakItem: 'exclusive',
}

let current: ExperimentalSettings | null = null

function file() {
  return join(app.getPath('userData'), 'experimental.json')
}

export function readSettings(): ExperimentalSettings {
  if (current) return current
  try {
    const saved = JSON.parse(readFileSync(file(), 'utf8')) as Record<string, unknown>
    current = sanitize(saved.version === 2 || saved.version === 3 ? saved : { ...saved, autoScreenshot: true })
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
    itemLookup: flag('itemLookup'),
    minimap: flag('minimap'),
    tracking: flag('tracking'),
    autoScreenshot: flag('autoScreenshot'),
    screenshotIntervalMs: Number.isFinite(interval) ? Math.min(2000, Math.max(1000, Math.round(interval))) : DEFAULT_SETTINGS.screenshotIntervalMs,
    itemKey: isKnownHotkey(value.itemKey) ? value.itemKey : DEFAULT_ITEM_KEY,
    minimapKey: isKnownHotkey(value.minimapKey) ? value.minimapKey : DEFAULT_MINIMAP_KEY,
    collectorKey: isKnownHotkey(value.collectorKey) ? value.collectorKey : '',
    itemHideMs: Number.isFinite(Number(value.itemHideMs)) ? Math.min(15000, Math.max(3000, Math.round(Number(value.itemHideMs)))) : DEFAULT_SETTINGS.itemHideMs,
    speakItem: value.speakItem === 'off' || value.speakItem === 'always' ? value.speakItem : 'exclusive',
  }
}
