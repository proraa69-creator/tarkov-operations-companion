import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'

export interface ExperimentalSettings {
  version: 2
  itemLookup: boolean
  minimap: boolean
  tracking: boolean
  autoScreenshot: boolean
  screenshotIntervalMs: number
}

export const DEFAULT_SETTINGS: ExperimentalSettings = {
  version: 2,
  itemLookup: true,
  minimap: true,
  tracking: true,
  autoScreenshot: true,
  screenshotIntervalMs: 1500,
}

let current: ExperimentalSettings | null = null

function file() {
  return join(app.getPath('userData'), 'experimental.json')
}

export function readSettings(): ExperimentalSettings {
  if (current) return current
  try {
    const saved = JSON.parse(readFileSync(file(), 'utf8')) as Record<string, unknown>
    current = sanitize(saved.version === 2 ? saved : { ...saved, autoScreenshot: true })
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
    version: 2,
    itemLookup: flag('itemLookup'),
    minimap: flag('minimap'),
    tracking: flag('tracking'),
    autoScreenshot: flag('autoScreenshot'),
    screenshotIntervalMs: Number.isFinite(interval) ? Math.min(2000, Math.max(1000, Math.round(interval))) : DEFAULT_SETTINGS.screenshotIntervalMs,
  }
}
