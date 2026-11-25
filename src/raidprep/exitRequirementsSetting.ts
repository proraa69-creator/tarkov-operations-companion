import { useSyncExternalStore } from 'react'

/**
 * Settings «Показывать требования для выхода» (report 235, owner 25.11.2026: «Нужно добавить функцию включения и выключения в
 * требованиях рейда реактивного сигнала для выхода. Многие путают»; the player: «можно случайно спутать, что он для квеста»).
 * On (the default, as before): «Требования рейда» has a line of its own, «Для выхода», for the green flare of each exit of the map
 * opened by one (raidprep/exitFlares.ts). Off: those lines go; whatever a quest needs stays, the flare of «Прекратить огонь!» that
 * leaves by an exit too.
 */
const KEY = 'raidos-exit-requirements-v1'
const EVENT = 'raidos-exit-requirements-changed'
/** The account's other devices keep this too: sync/playerStateStores.ts reads and writes it in this format. */
export const EXIT_REQUIREMENTS_SYNC = { key: KEY, event: EVENT } as const

export function exitRequirementsShown() {
  try { return localStorage.getItem(KEY) !== '0' } catch { return true }
}

export function setExitRequirementsShown(shown: boolean) {
  try { localStorage.setItem(KEY, shown ? '1' : '0') } catch { /* storage unavailable */ }
  window.dispatchEvent(new Event(EVENT))
}

function subscribe(listener: () => void) {
  const onStorage = (event: StorageEvent) => { if (event.key === null || event.key === KEY) listener() }
  window.addEventListener(EVENT, listener)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(EVENT, listener)
    window.removeEventListener('storage', onStorage)
  }
}

export function useExitRequirementsShown() {
  return useSyncExternalStore(subscribe, exitRequirementsShown, () => true)
}
