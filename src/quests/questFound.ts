/**
 * What the player marked as found for the quests («+» / «−» on «Квесты» next to «Убежище»): item id → pieces, per profile
 * and mode (PvP, PvE and Season apart), on this device. A completed quest's items count by themselves
 * (quests/questItemNeeds.ts); these marks are the pieces put aside for the quests still to do.
 */
import { useCallback, useSyncExternalStore } from 'react'
import type { RaidMode } from '../domain/types'

const KEY_PREFIX = 'raidos-quest-found-v1:'
const EVENT = 'raidos-quest-found-changed'
const NONE: ReadonlyMap<string, number> = new Map()
const snapshots = new Map<string, { raw: string | null; found: ReadonlyMap<string, number> }>()

const key = (profileId: string, mode: RaidMode) => `${KEY_PREFIX}${profileId}:${mode}`

export function readQuestFound(profileId: string, mode: RaidMode): ReadonlyMap<string, number> {
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
export function setQuestFound(profileId: string, mode: RaidMode, itemId: string, count: number, max = Number.MAX_SAFE_INTEGER) {
  const next = new Map(readQuestFound(profileId, mode))
  const value = Math.min(max, Math.max(0, Math.round(count)))
  if (value) next.set(itemId, value)
  else next.delete(itemId)
  try {
    if (next.size) localStorage.setItem(key(profileId, mode), JSON.stringify(Object.fromEntries(next)))
    else localStorage.removeItem(key(profileId, mode))
  } catch { /* storage unavailable */ }
  window.dispatchEvent(new Event(EVENT))
}

export function useQuestFound(profileId: string, mode: RaidMode) {
  const subscribe = useCallback((listener: () => void) => {
    window.addEventListener(EVENT, listener)
    window.addEventListener('storage', listener)
    return () => { window.removeEventListener(EVENT, listener); window.removeEventListener('storage', listener) }
  }, [])
  return useSyncExternalStore(subscribe, () => readQuestFound(profileId, mode), () => NONE)
}
