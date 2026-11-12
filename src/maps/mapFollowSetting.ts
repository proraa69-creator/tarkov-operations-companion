import { useSyncExternalStore } from 'react'

/**
 * Settings «Перемещать карту к точке» (report 143, owner 11.11.2026: «сделай в настройках переключатель»; the player: «что бы
 * тебя не передвигало когда ты нажимаешь на какую то метку или… ставишь галочку… кому то это мешает а кому то помогает»).
 * On (the default, as before): a picked point — a tap on a marker, the next point after a tick — is flown to. Off: the map
 * stays where the player left it; «Показать точку на карте» and a way in from another page («Показать на карте», a door
 * from «Барахолка») still bring the point into view, since they are asked for.
 */
const KEY = 'raidos-map-follow-point'
const EVENT = 'raidos-map-follow-point-changed'

export function isMapFollowEnabled() {
  try { return localStorage.getItem(KEY) !== '0' } catch { return true }
}

export function setMapFollowEnabled(enabled: boolean) {
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

export function useMapFollowEnabled() {
  return useSyncExternalStore(subscribe, isMapFollowEnabled, () => true)
}
