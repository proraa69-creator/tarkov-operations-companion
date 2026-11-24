import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'

/**
 * «Места устранения» on the map (maps/killObjectives.ts): the zones of the kill quests are drawn until the player turns them
 * off — the tick in «Устранения» and the row in «Точки на карте» are one switch. Kept on this device, like the other layers.
 */
const KEY = 'raidos-map-kill-zones-v1'
const EVENT = 'raidos-map-kill-zones-changed'
/** Without storage the switch still holds until the page reloads. */
let memory = true

function read(): boolean {
  try { return localStorage.getItem(KEY) !== 'off' } catch { return memory }
}

export function setKillZonesShown(shown: boolean) {
  memory = shown
  try {
    if (shown) localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, 'off')
  } catch { /* storage unavailable */ }
  window.dispatchEvent(new Event(EVENT))
}

function subscribe(listener: () => void) {
  window.addEventListener(EVENT, listener)
  window.addEventListener('storage', listener)
  return () => {
    window.removeEventListener(EVENT, listener)
    window.removeEventListener('storage', listener)
  }
}

export function useKillZonesShown() {
  return useSyncExternalStore(subscribe, read, () => true)
}

/** The phone's «Устранения» window: open or not; another map, or no kills left on this one, closes it. */
export function useKillsWindow(mapId: string, empty: boolean) {
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  // eslint-disable-next-line react-hooks/set-state-in-effect -- another map, or no kills left on this one, closes the window
  useEffect(() => { setOpen(false) }, [mapId, empty])
  return [open, setOpen, close] as const
}
