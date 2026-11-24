import { useCallback, useSyncExternalStore } from 'react'
import type { RaidMode } from '../domain/types'

/**
 * «Ключи в схроне» (owner, 07.11.2026: «По нажатию кнопки «Найти ключи» человек заходит в игру и открывает контейнер со всеми ключами…
 * Программа находит ключи… И добавь кнопку «Ключи в схроне»… Там же должна быть кнопка «Добавить вручную»»): the keys the player has,
 * found on screen (quests/keyScan.ts) or added by hand — item id → pieces — and, when known, how many uses each has left. Per profile
 * and mode (PvP, PvE, Season apart), kept in the account (sync/playerStateStores.ts: 'owned-keys', 'key-uses'), so the phone shows the
 * PC's scan.
 */
const OWNED_PREFIX = 'raidos-owned-keys-v1:'
const USES_PREFIX = 'raidos-key-uses-v1:'
export const OWNED_KEYS_EVENT = 'raidos-owned-keys-changed'

export const ownedKeysKey = (profileId: string, mode: RaidMode) => `${OWNED_PREFIX}${profileId}:${mode}`
export const keyUsesKey = (profileId: string, mode: RaidMode) => `${USES_PREFIX}${profileId}:${mode}`

const NONE: ReadonlyMap<string, number> = new Map()
const snapshots = new Map<string, { raw: string | null; counts: ReadonlyMap<string, number> }>()

function readMap(key: string): ReadonlyMap<string, number> {
  let raw: string | null = null
  try { raw = localStorage.getItem(key) } catch { /* storage unavailable */ }
  const kept = snapshots.get(key)
  if (kept && kept.raw === raw) return kept.counts
  let counts = NONE
  try {
    const value: unknown = raw ? JSON.parse(raw) : null
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      counts = new Map(Object.entries(value).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1]) && entry[1] >= 0))
    }
  } catch { /* a damaged value reads as nothing */ }
  snapshots.set(key, { raw, counts })
  return counts
}

function writeMap(key: string, counts: ReadonlyMap<string, number>) {
  try {
    if (counts.size) localStorage.setItem(key, JSON.stringify(Object.fromEntries(counts)))
    else localStorage.removeItem(key)
  } catch { /* storage unavailable */ }
  window.dispatchEvent(new Event(OWNED_KEYS_EVENT))
}

export const readOwnedKeys = (profileId: string, mode: RaidMode) => readMap(ownedKeysKey(profileId, mode))
export const readKeyUses = (profileId: string, mode: RaidMode) => readMap(keyUsesKey(profileId, mode))

/** Sets how many of one key the player has; 0 takes it off the list (and forgets its uses). */
export function setOwnedKey(profileId: string, mode: RaidMode, itemId: string, pieces: number) {
  const next = new Map(readOwnedKeys(profileId, mode))
  if (pieces > 0) next.set(itemId, Math.round(pieces))
  else {
    next.delete(itemId)
    const uses = new Map(readKeyUses(profileId, mode))
    if (uses.delete(itemId)) writeMap(keyUsesKey(profileId, mode), uses)
  }
  writeMap(ownedKeysKey(profileId, mode), next)
}

/**
 * What a scan saw joins the list: a key seen gets at least the pieces seen, nothing found earlier is taken off (a scan sees what is on
 * screen, not what is not). Returns how many keys the list did not have before.
 */
export function addSeenKeys(profileId: string, mode: RaidMode, seen: ReadonlyMap<string, number>): number {
  const owned = readOwnedKeys(profileId, mode)
  const next = new Map(owned)
  let added = 0
  for (const [id, pieces] of seen) {
    if (!owned.has(id)) added += 1
    next.set(id, Math.max(owned.get(id) ?? 0, pieces))
  }
  if (added || [...seen].some(([id, pieces]) => pieces > (owned.get(id) ?? 0))) writeMap(ownedKeysKey(profileId, mode), next)
  return added
}

/** How many uses one key has left (undefined: not known). */
export function setKeyUses(profileId: string, mode: RaidMode, itemId: string, uses: number | undefined) {
  const next = new Map(readKeyUses(profileId, mode))
  if (uses === undefined || !Number.isFinite(uses) || uses < 0) next.delete(itemId)
  else next.set(itemId, Math.round(uses))
  writeMap(keyUsesKey(profileId, mode), next)
}

function subscribe(listener: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key.startsWith(OWNED_PREFIX) || event.key.startsWith(USES_PREFIX)) listener()
  }
  window.addEventListener(OWNED_KEYS_EVENT, listener)
  window.addEventListener('storage', onStorage)
  return () => { window.removeEventListener(OWNED_KEYS_EVENT, listener); window.removeEventListener('storage', onStorage) }
}

export function useOwnedKeys(profileId: string, mode: RaidMode) {
  const read = useCallback(() => readOwnedKeys(profileId, mode), [profileId, mode])
  return useSyncExternalStore(subscribe, read, read)
}

export function useKeyUses(profileId: string, mode: RaidMode) {
  const read = useCallback(() => readKeyUses(profileId, mode), [profileId, mode])
  return useSyncExternalStore(subscribe, read, read)
}
