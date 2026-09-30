import { useSyncExternalStore } from 'react'

/**
 * Settings «Дым за боссами»: the signal smoke behind the boss figures on the Overview raid card (default on, green).
 * Width and speed are multipliers; hue is the colour wheel angle the pre-baked green sprites are turned to; tone makes
 * the colour darker (−1) or lighter (+1); with gradient on, the smoke shifts to topHue as it rises.
 */
const KEY = 'tarkov-raid-smoke'
const OPTIONS_KEY = 'tarkov-raid-smoke-options'
const EVENT = 'tarkov-raid-smoke-changed'

export const SMOKE_GREEN_HUE = 115
export interface RaidSmokeOptions { width: number; speed: number; hue: number; tone: number; gradient: boolean; topHue: number }
export const DEFAULT_SMOKE_OPTIONS: RaidSmokeOptions = { width: 1, speed: 1, hue: SMOKE_GREEN_HUE, tone: 0, gradient: false, topHue: 55 }
export const SMOKE_WIDTH = { min: 0.5, max: 2 }
export const SMOKE_SPEED = { min: 0.25, max: 4 }

const clamp = (value: unknown, min: number, max: number, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback

export function isRaidSmokeEnabled() {
  try { return localStorage.getItem(KEY) !== '0' } catch { return true }
}

export function setRaidSmokeEnabled(enabled: boolean) {
  try { localStorage.setItem(KEY, enabled ? '1' : '0') } catch { /* storage unavailable */ }
  window.dispatchEvent(new Event(EVENT))
}

let cachedRaw: string | null | undefined
let cachedOptions = DEFAULT_SMOKE_OPTIONS

/** Same object while the stored value is unchanged (useSyncExternalStore needs a stable snapshot). */
export function raidSmokeOptions(): RaidSmokeOptions {
  let raw: string | null = null
  try { raw = localStorage.getItem(OPTIONS_KEY) } catch { /* storage unavailable */ }
  if (raw === cachedRaw) return cachedOptions
  cachedRaw = raw
  let parsed: Partial<RaidSmokeOptions> = {}
  try { parsed = raw ? JSON.parse(raw) as Partial<RaidSmokeOptions> : {} } catch { /* broken value: defaults */ }
  cachedOptions = {
    width: clamp(parsed.width, SMOKE_WIDTH.min, SMOKE_WIDTH.max, 1),
    speed: clamp(parsed.speed, SMOKE_SPEED.min, SMOKE_SPEED.max, 1),
    hue: Math.round(clamp(parsed.hue, 0, 359, SMOKE_GREEN_HUE)),
    tone: Math.round(clamp(parsed.tone, -1, 1, 0) * 100) / 100,
    gradient: parsed.gradient === true,
    topHue: Math.round(clamp(parsed.topHue, 0, 359, DEFAULT_SMOKE_OPTIONS.topHue)),
  }
  return cachedOptions
}

export function setRaidSmokeOptions(next: Partial<RaidSmokeOptions>) {
  const value = Object.keys(next).length ? { ...raidSmokeOptions(), ...next } : DEFAULT_SMOKE_OPTIONS
  try { localStorage.setItem(OPTIONS_KEY, JSON.stringify(value)) } catch { /* storage unavailable */ }
  window.dispatchEvent(new Event(EVENT))
}

function subscribe(listener: () => void) {
  const onStorage = (event: StorageEvent) => { if (event.key === KEY || event.key === OPTIONS_KEY) listener() }
  window.addEventListener(EVENT, listener)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(EVENT, listener)
    window.removeEventListener('storage', onStorage)
  }
}

export function useRaidSmokeEnabled() {
  return useSyncExternalStore(subscribe, isRaidSmokeEnabled, () => true)
}

export function useRaidSmokeOptions() {
  return useSyncExternalStore(subscribe, raidSmokeOptions, () => DEFAULT_SMOKE_OPTIONS)
}
