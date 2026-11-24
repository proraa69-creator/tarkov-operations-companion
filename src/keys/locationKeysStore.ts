import { useSyncExternalStore } from 'react'

/**
 * «Ключи локации» (owner, 18.11.2026, report 186: «список ключей… окно, которое можно двигать… оно всегда поверх всего. Я
 * переключил… на вкладку карты, а окно с ключами у меня остается… Если я на картах нажимаю эту кнопку еще раз, то окно
 * закрывается, то есть они должны взаимодействовать»): one window for the whole app, whichever button opened it. Where it
 * stands is kept on this device; open or not, only while the app runs.
 */
export interface LocationKeysState {
  open: boolean
  /** The location whose keys are listed. */
  mapId: string
  /** The key whose doors the map shows («Показать на карте»), with its location; null: the list. */
  focus: { keyId: string; mapId: string } | null
  /** Top-left corner on the screen, px; null: the default place (right side). */
  position: { x: number; y: number } | null
}

const POSITION_KEY = 'raidos-location-keys-position-v1'

function readPosition(): LocationKeysState['position'] {
  try {
    const raw = JSON.parse(localStorage.getItem(POSITION_KEY) ?? 'null') as { x?: unknown; y?: unknown } | null
    return raw && typeof raw.x === 'number' && typeof raw.y === 'number' && Number.isFinite(raw.x) && Number.isFinite(raw.y) ? { x: raw.x, y: raw.y } : null
  } catch { return null }
}

let state: LocationKeysState = { open: false, mapId: '', focus: null, position: readPosition() }
const listeners = new Set<() => void>()
const set = (next: Partial<LocationKeysState>) => {
  state = { ...state, ...next }
  for (const listener of listeners) listener()
}

export const locationKeys = {
  get: () => state,
  /** Every «Ключи» button: opens the window on that location, or closes it when it is already open there. */
  toggle(mapId: string) {
    if (state.open && (state.mapId === mapId || !mapId)) set({ open: false, focus: null })
    else set({ open: true, mapId: mapId || state.mapId, focus: null })
  },
  close: () => set({ open: false, focus: null }),
  showMap: (mapId: string) => set({ mapId, focus: null }),
  /** The map page's map changed: the list follows it (owner, 19.11.2026: no picker), a key's doors stay open. */
  followMap(mapId: string) { if (mapId && state.mapId !== mapId) set({ mapId }) },
  focus: (keyId: string, mapId: string) => set({ focus: { keyId, mapId } }),
  back: () => set({ focus: null }),
  move(position: { x: number; y: number }) {
    set({ position })
    try { localStorage.setItem(POSITION_KEY, JSON.stringify(position)) } catch { /* the place is just not remembered */ }
  },
  /** Tests. */
  reset: () => set({ open: false, mapId: '', focus: null, position: null }),
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }

export function useLocationKeys(): LocationKeysState {
  return useSyncExternalStore(subscribe, locationKeys.get, locationKeys.get)
}
