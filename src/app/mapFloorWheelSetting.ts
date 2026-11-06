import { useSyncExternalStore } from 'react'

/**
 * «Этажи: Alt и колесо мыши» (owner, 06.11.2026: «быстро переключаться между ними с помощью Alt+scrollUP, Alt+scrollDOWN… сделай эту
 * настройку по умолчанию выключенной. А в настройках можно ее включить»): on this device, off until the player turns it on.
 */
const KEY = 'raidos-map-floor-wheel'
const EVENT = 'raidos-map-floor-wheel-changed'

export function mapFloorWheelEnabled() {
  try { return localStorage.getItem(KEY) === 'on' } catch { return false }
}

export function setMapFloorWheelEnabled(on: boolean) {
  try {
    if (on) localStorage.setItem(KEY, 'on')
    else localStorage.removeItem(KEY)
  } catch { /* storage unavailable: stays off */ }
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

export function useMapFloorWheelEnabled() {
  return useSyncExternalStore(subscribe, mapFloorWheelEnabled, () => false)
}
