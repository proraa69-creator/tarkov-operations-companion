import { useSyncExternalStore } from 'react'
import { DEFAULT_RESTOCK_SETTINGS, pruneNotified, sanitizeRestockSettings, type RestockSettings } from './restock'

/** Settings → «Уведомления о рестоке»: kept on this device (localStorage), shared by all modes. */
const KEY = 'tarkov-restock-notify-v1'
const NOTIFIED_KEY = 'tarkov-restock-notified-v1'
const EVENT = 'tarkov-restock-settings-changed'

let cachedRaw: string | null | undefined
let cached: RestockSettings = DEFAULT_RESTOCK_SETTINGS

export function readRestockSettings(): RestockSettings {
  let raw: string | null = null
  try { raw = localStorage.getItem(KEY) } catch { /* storage unavailable */ }
  // useSyncExternalStore needs a stable snapshot: parse only when the stored text changed.
  if (raw === cachedRaw) return cached
  cachedRaw = raw
  try { cached = sanitizeRestockSettings(raw ? JSON.parse(raw) : undefined) } catch { cached = DEFAULT_RESTOCK_SETTINGS }
  return cached
}

export function writeRestockSettings(patch: Partial<RestockSettings>) {
  const next = sanitizeRestockSettings({ ...readRestockSettings(), ...patch })
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* storage unavailable */ }
  window.dispatchEvent(new Event(EVENT))
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

export function useRestockSettings() {
  return useSyncExternalStore(subscribe, readRestockSettings, () => DEFAULT_RESTOCK_SETTINGS)
}

/** Restocks already notified about (survives a reload, so one restock never notifies twice). */
export function readNotified(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(NOTIFIED_KEY) ?? '[]') as unknown
    return new Set(Array.isArray(raw) ? raw.filter((key): key is string => typeof key === 'string') : [])
  } catch {
    return new Set()
  }
}

export function rememberNotified(keys: Iterable<string>, now = Date.now()) {
  try { localStorage.setItem(NOTIFIED_KEY, JSON.stringify(pruneNotified(keys, now))) } catch { /* storage unavailable */ }
}
