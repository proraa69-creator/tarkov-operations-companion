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

/** «Удалить все данные». */
export function clearAllTakenItems() {
  try {
    const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
    for (const key of keys) if (key?.startsWith(KEY_PREFIX)) localStorage.removeItem(key)
  } catch { /* storage unavailable */ }
  window.dispatchEvent(new Event(EVENT))
}

function subscribe(listener: () => void) {
  const onStorage = (event: StorageEvent) => { if (event.key === null || event.key.startsWith(KEY_PREFIX)) listener() }
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
