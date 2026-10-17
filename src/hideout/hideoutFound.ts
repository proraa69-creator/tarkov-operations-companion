/**
 * What the player marked as found for the hideout («+» / «−» on «Убежище»): item id → pieces, per profile and mode (PvP,
 * PvE and Season apart), outside the profile like the raid checks (progression/questChecks.ts). The device copy is the
 * offline cache of the account's copy on the server (sync/serverSync.ts syncHideout): a local change marks the mode
 * «dirty» until the server has it, and the account's other devices reload it at once (owner, 17.10.2026: «все что
 * добавляется в телефоне, сразу же обновляется и в приложении»).
 */
import { useCallback, useSyncExternalStore } from 'react'
import type { RaidMode } from '../domain/types'

const KEY_PREFIX = 'raidos-hideout-found-v1:'
export const HIDEOUT_FOUND_EVENT = 'raidos-hideout-found-changed'
const EVENT = HIDEOUT_FOUND_EVENT
const DIRTY_PREFIX = 'raidos-hideout-found-dirty-v1:'
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
  writeHideoutFound(profileId, mode, next)
}

/** The whole list at once: a local change (marked dirty until the server has it) or, `fromServer`, the account's copy. */
export function writeHideoutFound(profileId: string, mode: RaidMode, found: ReadonlyMap<string, number>, options: { fromServer?: boolean } = {}) {
  try {
    if (found.size) localStorage.setItem(key(profileId, mode), JSON.stringify(Object.fromEntries(found)))
    else localStorage.removeItem(key(profileId, mode))
    if (!options.fromServer) localStorage.setItem(DIRTY_PREFIX + key(profileId, mode), '1')
  } catch { /* storage unavailable */ }
  window.dispatchEvent(new Event(EVENT))
}

export function isHideoutDirty(profileId: string, mode: RaidMode) {
  try { return localStorage.getItem(DIRTY_PREFIX + key(profileId, mode)) === '1' } catch { return false }
}

export function clearHideoutDirty(profileId: string, mode: RaidMode) {
  try { localStorage.removeItem(DIRTY_PREFIX + key(profileId, mode)) } catch { /* storage unavailable */ }
}

export function useHideoutFound(profileId: string, mode: RaidMode) {
  const subscribe = useCallback((notify: () => void) => {
    window.addEventListener(EVENT, notify)
    window.addEventListener('storage', notify)
    return () => { window.removeEventListener(EVENT, notify); window.removeEventListener('storage', notify) }
  }, [])
  return useSyncExternalStore(subscribe, () => readHideoutFound(profileId, mode), () => NONE)
}
