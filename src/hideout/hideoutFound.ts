/**
 * What the player marked as found for the hideout («+» / «−» on «Убежище»): item id → pieces, on this device per profile
 * and mode (PvP, PvE and Season apart), outside the profile like the raid checks (progression/questChecks.ts).
 */
import { useCallback, useSyncExternalStore } from 'react'
import type { RaidMode } from '../domain/types'

const KEY_PREFIX = 'raidos-hideout-found-v1:'
const EVENT = 'raidos-hideout-found-changed'
const NONE: ReadonlyMap<string, number> = new Map()
const snapshots = new Map<string, { raw: string | null; found: ReadonlyMap<string, number> }>()

const key = (profileId: string, mode: RaidMode) => `${KEY_PREFIX}${profileId}:${mode}`

export function readHideoutFound(profileId: string, mode: RaidMode): ReadonlyMap<string, number> {
  const storageKey = key(profileId, mode)
  let raw: string | null = null
  try { raw = localStorage.getItem(storageKey) } catch { /* storage unavailable */ }
  const cached = snapshots.get(storageKey)
  if (cached && cached.raw === raw) return cached.found
  let found = NONE
  try {
    const value: unknown = raw ? JSON.parse(raw) : null
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      found = new Map(Object.entries(value).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1]) && entry[1] > 0))
    }
  } catch { /* a damaged value reads as nothing found */ }
  snapshots.set(storageKey, { raw, found })
  return found
}

/** Sets the pieces found of one item (0 forgets it), never below 0 or above `max`. */
export function setHideoutFound(profileId: string, mode: RaidMode, itemId: string, count: number, max = Number.MAX_SAFE_INTEGER) {
  const next = new Map(readHideoutFound(profileId, mode))
  const value = Math.min(max, Math.max(0, Math.round(count)))
  if (value) next.set(itemId, value)
  else next.delete(itemId)
  try {
    if (next.size) localStorage.setItem(key(profileId, mode), JSON.stringify(Object.fromEntries(next)))
    else localStorage.removeItem(key(profileId, mode))
  } catch { /* storage unavailable */ }
  window.dispatchEvent(new Event(EVENT))
}

export function useHideoutFound(profileId: string, mode: RaidMode) {
  const subscribe = useCallback((notify: () => void) => {
    window.addEventListener(EVENT, notify)
    window.addEventListener('storage', notify)
    return () => { window.removeEventListener(EVENT, notify); window.removeEventListener('storage', notify) }
  }, [])
  return useSyncExternalStore(subscribe, () => readHideoutFound(profileId, mode), () => NONE)
}
