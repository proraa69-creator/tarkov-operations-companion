import { useSyncExternalStore } from 'react'

/** The map's own buttons for rooms (components/MapRoomMarks.tsx). Everything is on until the player turns it off; kept on this device. */
export type RoomLayerId = 'keycard' | 'traps' | 'signs'

const KEY = 'raidos-map-room-layers-v1'
const EVENT = 'raidos-map-room-layers-changed'
const NONE: ReadonlySet<RoomLayerId> = new Set()
let kept: { raw: string | null; hidden: ReadonlySet<RoomLayerId> } = { raw: null, hidden: NONE }

function read(): ReadonlySet<RoomLayerId> {
  let raw: string | null = null
  try { raw = localStorage.getItem(KEY) } catch { /* storage unavailable */ }
  if (raw === kept.raw) return kept.hidden
  let hidden = NONE
  try {
    const stored: unknown = raw ? JSON.parse(raw) : null
    if (Array.isArray(stored)) hidden = new Set(stored.filter((id): id is RoomLayerId => id === 'keycard' || id === 'traps' || id === 'signs'))
  } catch { /* a damaged value reads as nothing hidden */ }
  kept = { raw, hidden }
  return hidden
}

export function toggleRoomLayer(id: RoomLayerId) {
  const hidden = new Set(read())
  if (hidden.has(id)) hidden.delete(id)
  else hidden.add(id)
  try {
    if (hidden.size) localStorage.setItem(KEY, JSON.stringify([...hidden]))
    else localStorage.removeItem(KEY)
  } catch { /* storage unavailable */ }
  window.dispatchEvent(new Event(EVENT))
}

function subscribe(listener: () => void) {
  window.addEventListener(EVENT, listener)
  return () => window.removeEventListener(EVENT, listener)
}

export function useHiddenRoomLayers() {
  return useSyncExternalStore(subscribe, read, () => NONE)
}
