import { useSyncExternalStore } from 'react'

/**
 * «Настройки карты» → «Местоположение» → «Приближать карту к точке» (owner, 20.11.2026: «нажимаешь на местоположение клавишу,
 * появляется точка, и карта увеличивается и перемещается ближе к точки персонажа. А если выключаешь, то карта остается как есть,
 * появляется только точка»). On (the default, as before): a new screenshot brings the PC's map to the player's dot
 * (components/LivePlayerMarker.tsx useFollowPlayer). Off: the map keeps its zoom and place, only the dot is drawn. The raid's
 * map and the player's floor are still opened: without them there is no dot to see.
 *
 * Kept on this device, as the other switches of «Настройки карты» (maps/nearbyKeys.ts, maps/neededSpawns.ts).
 */
const KEY = 'raidos-map-follow-player-v1'
const EVENT = 'raidos-map-follow-player-changed'

export function isPlayerFollowOn() {
  try { return localStorage.getItem(KEY) !== 'off' } catch { return true }
}

export function setPlayerFollowOn(on: boolean) {
  try { if (on) localStorage.removeItem(KEY); else localStorage.setItem(KEY, 'off') } catch { /* storage unavailable */ }
  window.dispatchEvent(new Event(EVENT))
}

function subscribe(listener: () => void) {
  const onStorage = (event: StorageEvent) => { if (event.key === null || event.key === KEY) listener() }
  window.addEventListener(EVENT, listener)
  window.addEventListener('storage', onStorage)
  return () => { window.removeEventListener(EVENT, listener); window.removeEventListener('storage', onStorage) }
}

export const usePlayerFollowOn = () => useSyncExternalStore(subscribe, isPlayerFollowOn, () => true)
