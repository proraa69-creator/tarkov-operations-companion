import { useCallback, useSyncExternalStore } from 'react'
import type { RaidMode } from '../domain/types'

/**
 * «Взял» on an item the Overview asks for (report 157, owner 14.11.2026: «Отмечается правой кнопкой, нажимаешь взял. Ставится
 * галочка в углу… После выхода с рейда… эти галочки сбрасываются»). Only a note, kept on this device per profile and mode as
 * `{ itemId: takenAt (ms) }`. The desktop app clears the marks made before a raid once that raid is over
 * (components/QuestChecksRaidReset.tsx); a mark can also be taken back with «Не взял».
 */
const KEY_PREFIX = 'raidos-taken-items-v1:'
const EVENT = 'raidos-taken-items-changed'
const MODES: RaidMode[] = ['pvp', 'pve', 'seasonal']

type Taken = ReadonlyMap<string, number>
const NOTHING: Taken = new Map()
const snapshots = new Map<string, { raw: string | null; taken: Taken }>()
const keyOf = (profileId: string, mode: RaidMode) => `${KEY_PREFIX}${profileId}:${mode}`

function parse(raw: string | null): Taken {
  if (!raw) return NOTHING
  try {
    const stored: unknown = JSON.parse(raw)
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return NOTHING
    return new Map(Object.entries(stored).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1])))
  } catch {
    return NOTHING
  }
}

export function readTakenItems(profileId: string, mode: RaidMode): Taken {
  const key = keyOf(profileId, mode)
  let raw: string | null = null
  try { raw = localStorage.getItem(key) } catch { /* storage unavailable */ }
  // useSyncExternalStore needs a stable snapshot: parse only when the stored text changed.
  const cached = snapshots.get(key)
  if (cached && cached.raw === raw) return cached.taken
  const taken = parse(raw)
  snapshots.set(key, { raw, taken })
  return taken
}

function write(profileId: string, mode: RaidMode, taken: Taken) {
  try {
    if (taken.size) localStorage.setItem(keyOf(profileId, mode), JSON.stringify(Object.fromEntries(taken)))
    else localStorage.removeItem(keyOf(profileId, mode))
  } catch { /* storage unavailable */ }
  window.dispatchEvent(new Event(EVENT))
}

export function setItemTaken(profileId: string, mode: RaidMode, itemId: string, taken: boolean, now = Date.now()) {
  const current = readTakenItems(profileId, mode)
  if (taken === current.has(itemId)) return
  const next = new Map(current)
  if (taken) next.set(itemId, now)
  else next.delete(itemId)
  write(profileId, mode, next)
}

/** The raid that started at `startedAt` is over: the marks made before it go, in every mode of the profile. */
export function clearTakenItemsBefore(profileId: string, startedAt: number) {
  for (const mode of MODES) {
    const taken = readTakenItems(profileId, mode)
    const kept = new Map([...taken].filter(([, at]) => at >= startedAt))
    if (kept.size !== taken.size) write(profileId, mode, kept)
  }
}

/**
 * Keys «Взял» put into «Ключи в схроне» (owner, 15.11.2026: «человек его… не отметил в ключах для квестов… но он знает, что он у
 * него есть, он нажимает «взял»… он должен добавляться в ключ, который есть у него в схроне»). They stay there: «Не взял» means only
 * «not taking it into this raid» (owner, 16.11.2026: «если снять отметку «Взял»… ключ должен остаться «в наличии»»), and they keep
 * saying «Есть в наличии» until a scan sees them («Есть в схроне», forgetKeysAddedByTaken). Per profile and mode, like the marks.
 */
const ADDED_PREFIX = 'raidos-taken-keys-added-v1:'
const addedKey = (profileId: string, mode: RaidMode) => `${ADDED_PREFIX}${profileId}:${mode}`
const NO_KEYS: ReadonlySet<string> = new Set()
const addedSnapshots = new Map<string, { raw: string | null; ids: ReadonlySet<string> }>()

export function keysAddedByTaken(profileId: string, mode: RaidMode): ReadonlySet<string> {
  const key = addedKey(profileId, mode)
  let raw: string | null = null
  try { raw = localStorage.getItem(key) } catch { /* storage unavailable */ }
  const cached = addedSnapshots.get(key)
  if (cached && cached.raw === raw) return cached.ids
  let ids = NO_KEYS
  try {
    const stored: unknown = raw ? JSON.parse(raw) : null
    if (Array.isArray(stored)) ids = new Set(stored.filter((id): id is string => typeof id === 'string'))
  } catch { /* a damaged value reads as nothing */ }
  addedSnapshots.set(key, { raw, ids })
  return ids
}

function writeAdded(profileId: string, mode: RaidMode, ids: string[]) {
  try {
    if (ids.length) localStorage.setItem(addedKey(profileId, mode), JSON.stringify(ids))
    else localStorage.removeItem(addedKey(profileId, mode))
  } catch { /* storage unavailable */ }
  window.dispatchEvent(new Event(EVENT))
}

export function setKeyAddedByTaken(profileId: string, mode: RaidMode, itemId: string, added: boolean) {
  const current = keysAddedByTaken(profileId, mode)
  if (added === current.has(itemId)) return
  writeAdded(profileId, mode, added ? [...current, itemId] : [...current].filter((id) => id !== itemId))
}

/** A scan saw these keys: they are in the stash now («Есть в схроне»), no longer known only from «Взял». */
export function forgetKeysAddedByTaken(profileId: string, mode: RaidMode, ids: Iterable<string>) {
  const current = keysAddedByTaken(profileId, mode)
  const seen = new Set(ids)
  if ([...current].some((id) => seen.has(id))) writeAdded(profileId, mode, [...current].filter((id) => !seen.has(id)))
}

/** «Удалить все данные». */
export function clearAllTakenItems() {
  try {
    const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
    for (const key of keys) if (key?.startsWith(KEY_PREFIX) || key?.startsWith(ADDED_PREFIX)) localStorage.removeItem(key)
  } catch { /* storage unavailable */ }
  window.dispatchEvent(new Event(EVENT))
}

function subscribe(listener: () => void) {
  const onStorage = (event: StorageEvent) => { if (event.key === null || event.key.startsWith(KEY_PREFIX) || event.key.startsWith(ADDED_PREFIX)) listener() }
  window.addEventListener(EVENT, listener)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(EVENT, listener)
    window.removeEventListener('storage', onStorage)
  }
}

export function useTakenItems(profileId: string, mode: RaidMode): Taken {
  const read = useCallback(() => readTakenItems(profileId, mode), [profileId, mode])
  return useSyncExternalStore(subscribe, read, () => NOTHING)
}

/** The keys «Взял» put into «Ключи в схроне», still not seen by a scan. */
export function useKeysAddedByTaken(profileId: string, mode: RaidMode): ReadonlySet<string> {
  const read = useCallback(() => keysAddedByTaken(profileId, mode), [profileId, mode])
  return useSyncExternalStore(subscribe, read, () => NO_KEYS)
}
