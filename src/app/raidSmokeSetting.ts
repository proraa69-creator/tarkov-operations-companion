import { useSyncExternalStore } from 'react'

/** Settings «Дым за боссами»: the green signal smoke behind the boss figures on the Overview raid card (default on). */
const KEY = 'tarkov-raid-smoke'
const EVENT = 'tarkov-raid-smoke-changed'

export function isRaidSmokeEnabled() {
  try { return localStorage.getItem(KEY) !== '0' } catch { return true }
}

export function setRaidSmokeEnabled(enabled: boolean) {
  try { localStorage.setItem(KEY, enabled ? '1' : '0') } catch { /* storage unavailable */ }
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

export function useRaidSmokeEnabled() {
  return useSyncExternalStore(subscribe, isRaidSmokeEnabled, () => true)
}
