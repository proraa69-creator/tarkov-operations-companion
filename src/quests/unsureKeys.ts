import { useCallback, useSyncExternalStore } from 'react'
import type { RaidMode } from '../domain/types'
import { forgetKeysAddedByTaken } from '../progression/takenItems'
import { addSeenKeys, OWNED_KEYS_EVENT } from './ownedKeys'

/**
 * «Ключи под вопросом» (owner, 27.11.2026: «сделай ключи под вопросом и подсвечивай… мигающим… оранжевым. И после конца
 * сканирования открывается это окно автоматически»): the labels several keys carry that a «Найти ключи» saw and no tooltip
 * told («Времянка»: two keys, one label and one picture in the game) — label → its keys and how many cells of it the scan
 * saw. Such a label adds no key by itself: it waits for the player's choice (quests/QuestKeysStash.tsx UnsureKeysDialog)
 * until the next scan that sees the key container. Per profile and mode, kept in the account like «Ключи в схроне»
 * (sync/playerStateStores.ts: 'unsure-keys').
 */
const PREFIX = 'raidos-unsure-keys-v1:'
export const unsureKeysKey = (profileId: string, mode: RaidMode) => `${PREFIX}${profileId}:${mode}`

/** `ids`: the keys of the label; `seen`: how many of its cells the scan read. */
export interface UnsureKey { ids: string[]; seen: number }

export function isUnsureKey(value: unknown): value is UnsureKey {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const { ids, seen } = value as Record<string, unknown>
  return Array.isArray(ids) && ids.length > 0 && ids.every((id) => typeof id === 'string')
    && typeof seen === 'number' && Number.isInteger(seen) && seen >= 1
}

const NONE: ReadonlyMap<string, UnsureKey> = new Map()
const snapshots = new Map<string, { raw: string | null; labels: ReadonlyMap<string, UnsureKey> }>()

function readRaw(key: string) {
  try { return localStorage.getItem(key) } catch { return null }
}

export function readUnsureKeys(profileId: string, mode: RaidMode): ReadonlyMap<string, UnsureKey> {
  const key = unsureKeysKey(profileId, mode)
  const raw = readRaw(key)
  const kept = snapshots.get(key)
  if (kept && kept.raw === raw) return kept.labels
  let labels = NONE
  try {
    const value: unknown = raw ? JSON.parse(raw) : null
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      labels = new Map(Object.entries(value).filter((entry): entry is [string, UnsureKey] => isUnsureKey(entry[1])))
    }
  } catch { /* a damaged value reads as nothing */ }
  snapshots.set(key, { raw, labels })
  return labels
}

/** The labels of a scan take the place of the last scan's; nothing is written (nor sent to the account) when nothing changed. */
export function writeUnsureKeys(profileId: string, mode: RaidMode, labels: ReadonlyMap<string, UnsureKey>) {
  const key = unsureKeysKey(profileId, mode)
  const next = labels.size ? JSON.stringify(Object.fromEntries(labels)) : null
  if (readRaw(key) === next) return
  try {
    if (next) localStorage.setItem(key, next)
    else localStorage.removeItem(key)
  } catch { /* storage unavailable */ }
  window.dispatchEvent(new Event(OWNED_KEYS_EVENT))
}

/** «Убрать»: labels the player does not want; nothing is added for them. */
export function dropUnsureKeys(profileId: string, mode: RaidMode, labels: Iterable<string>) {
  const next = new Map(readUnsureKeys(profileId, mode))
  for (const label of labels) next.delete(label)
  writeUnsureKeys(profileId, mode, next)
}

/**
 * «Ок» (owner: «выбираешь какой надо и нажимаешь галочку… какой и сколько добавить»): the keys ticked join «Ключи в схроне»
 * as a scan's would (at least as many as ticked), and each label with a key ticked leaves the list; a label left without a
 * tick stays. `picked`: label → key → pieces. Returns how many keys the stash did not have.
 */
export function resolveUnsureKeys(profileId: string, mode: RaidMode, picked: ReadonlyMap<string, ReadonlyMap<string, number>>) {
  const labels = readUnsureKeys(profileId, mode)
  const add = new Map<string, number>()
  const done: string[] = []
  for (const [label, keys] of picked) {
    const entry = labels.get(label)
    if (!entry) continue
    let any = false
    for (const [id, pieces] of keys) {
      if (!entry.ids.includes(id) || !(pieces >= 1)) continue
      add.set(id, (add.get(id) ?? 0) + Math.round(pieces))
      any = true
    }
    if (any) done.push(label)
  }
  const added = add.size ? addSeenKeys(profileId, mode, add) : 0
  // a key «Взял» put in the list and chosen now: «Есть в схроне», as after a scan
  if (add.size) forgetKeysAddedByTaken(profileId, mode, add.keys())
  dropUnsureKeys(profileId, mode, done)
  return added
}

function subscribe(listener: () => void) {
  const onStorage = (event: StorageEvent) => { if (event.key === null || event.key.startsWith(PREFIX)) listener() }
  window.addEventListener(OWNED_KEYS_EVENT, listener)
  window.addEventListener('storage', onStorage)
  return () => { window.removeEventListener(OWNED_KEYS_EVENT, listener); window.removeEventListener('storage', onStorage) }
}

export function useUnsureKeys(profileId: string, mode: RaidMode) {
  const read = useCallback(() => readUnsureKeys(profileId, mode), [profileId, mode])
  return useSyncExternalStore(subscribe, read, read)
}
