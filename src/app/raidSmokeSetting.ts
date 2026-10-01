import { useSyncExternalStore } from 'react'

/**
 * Settings «Дым за боссами»: the signal smoke behind the boss figures on the Overview raid card (default on, green).
 * The look is fixed (DEFAULT_SMOKE_OPTIONS): width and speed multipliers, hue the sprites are turned to, tone darker (−1)
 * or lighter (+1), optional gradient to topHue.
 */
const KEY = 'tarkov-raid-smoke'
const EVENT = 'tarkov-raid-smoke-changed'

export const SMOKE_GREEN_HUE = 115
export interface RaidSmokeOptions { width: number; speed: number; hue: number; tone: number; gradient: boolean; topHue: number }
/** The look the owner picked in the settings preview (01.10.2026); the tuning menu was removed after that. */
export const DEFAULT_SMOKE_OPTIONS: RaidSmokeOptions = { width: 0.6, speed: 1.95, hue: 106, tone: -0.85, gradient: false, topHue: 101 }

export function isRaidSmokeEnabled() {
  try { return localStorage.getItem(KEY) !== '0' } catch { return true }
}

export function setRaidSmokeEnabled(enabled: boolean) {
  try { localStorage.setItem(KEY, enabled ? '1' : '0') } catch { /* storage unavailable */ }
  window.dispatchEvent(new Event(EVENT))
}

/** Fixed smoke look; only «Дым за боссами» on/off stays in Settings. */
export function raidSmokeOptions(): RaidSmokeOptions {
  return DEFAULT_SMOKE_OPTIONS
}

function subscribe(listener: () => void) {
  const onStorage = (event: StorageEvent) => { if (event.key === KEY) listener() }
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
