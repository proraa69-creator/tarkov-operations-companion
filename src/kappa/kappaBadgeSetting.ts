import { useSyncExternalStore } from 'react'

/**
 * «Предметы для «Коллекционера»» → «Значок «Каппа» в рейде только на недостающих» (owner, 13.10.2026): when on, the
 * in-raid item card shows the «Каппа» badge only on Collector items not yet checked on that page in the current mode
 * (components/ExperimentalBridge.tsx); when off, on every Collector item. On by default: with nothing checked the card
 * looks the same either way.
 */
const KEY = 'tarkov-kappa-badge-missing-only'
const EVENT = 'tarkov-kappa-badge-changed'

export function isKappaBadgeMissingOnly() {
  try { return localStorage.getItem(KEY) !== '0' } catch { return true }
}

export function setKappaBadgeMissingOnly(on: boolean) {
  try { localStorage.setItem(KEY, on ? '1' : '0') } catch { /* storage unavailable */ }
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

export function useKappaBadgeMissingOnly() {
  return useSyncExternalStore(subscribe, isKappaBadgeMissingOnly, () => true)
}
