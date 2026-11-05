import { useCallback, useEffect, useSyncExternalStore } from 'react'
import type { RaidMode } from '../domain/types'
import type { RaidStateSource } from './questChecks'
import type { RaidState } from '../import/raidState'

/**
 * «Нашёл» on a battle pass document (a player's idea, owner, 05.11.2026: «добавь кнопку галочки на каждом документе при открытии и
 * тогда этот документ исчезнет только в этом рейде, когда человек вышел из этого рейда, то они возвращаются на карту»). Only a
 * note, kept on this device per profile and mode as `{ markerId: foundAt (ms) }`. The desktop app clears it when the raid ends
 * (components/QuestChecksRaidReset.tsx). Where no raid can be seen (no game logs, the phone) it lasts FOUND_MAX_MS, longer than
 * any raid, or until «Вернуть найденные» on the map.
 */
const KEY_PREFIX = 'raidos-found-documents-v1:'
const EVENT = 'raidos-found-documents-changed'
const MODES: RaidMode[] = ['pvp', 'pve', 'seasonal']
export const FOUND_MAX_MS = 3 * 60 * 60 * 1000
const RECHECK_MS = 5 * 60 * 1000

type Found = ReadonlyMap<string, number>
const NOTHING: Found = new Map()
const snapshots = new Map<string, { raw: string | null; found: Found }>()
const keyOf = (profileId: string, mode: RaidMode) => `${KEY_PREFIX}${profileId}:${mode}`

function parse(raw: string | null): Found {
  if (!raw) return NOTHING
  try {
    const stored: unknown = JSON.parse(raw)
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return NOTHING
    return new Map(Object.entries(stored).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1])))
  } catch {
    // A damaged value reads as nothing found: every document is back on the map.
    return NOTHING
  }
}

export function readFoundDocuments(profileId: string, mode: RaidMode): Found {
  const key = keyOf(profileId, mode)
  let raw: string | null = null
  try { raw = localStorage.getItem(key) } catch { /* storage unavailable */ }
  // useSyncExternalStore needs a stable snapshot: parse only when the stored text changed.
  const cached = snapshots.get(key)
  if (cached && cached.raw === raw) return cached.found
  const found = parse(raw)
  snapshots.set(key, { raw, found })
  return found
}

function write(profileId: string, mode: RaidMode, found: Found) {
  try {
    if (found.size) localStorage.setItem(keyOf(profileId, mode), JSON.stringify(Object.fromEntries(found)))
    else localStorage.removeItem(keyOf(profileId, mode))
  } catch { /* storage unavailable */ }
  window.dispatchEvent(new Event(EVENT))
}

export function markDocumentFound(profileId: string, mode: RaidMode, markerId: string, now = Date.now()) {
  write(profileId, mode, new Map([...readFoundDocuments(profileId, mode), [markerId, now]]))
}

/** «Вернуть найденные»: every document of this mode back on the map. */
export function clearFoundDocuments(profileId: string, mode: RaidMode) {
  if (readFoundDocuments(profileId, mode).size) write(profileId, mode, NOTHING)
}

/** The raid is over: back on the map in every mode of the profile (the app may show another mode than the game plays). */
export function clearFoundDocumentsOfProfile(profileId: string) {
  for (const mode of MODES) clearFoundDocuments(profileId, mode)
}

/** Older than any raid: no raid's end was seen, so the time ends it. */
export function dropExpiredFoundDocuments(profileId: string, mode: RaidMode, now = Date.now()) {
  const found = readFoundDocuments(profileId, mode)
  const kept = new Map([...found].filter(([, at]) => now - at < FOUND_MAX_MS))
  if (kept.size !== found.size) write(profileId, mode, kept)
}

/** «Удалить все данные». */
export function clearAllFoundDocuments() {
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

export function useFoundDocuments(profileId: string, mode: RaidMode): Found {
  const read = useCallback(() => readFoundDocuments(profileId, mode), [profileId, mode])
  useEffect(() => {
    dropExpiredFoundDocuments(profileId, mode)
    const timer = window.setInterval(() => dropExpiredFoundDocuments(profileId, mode), RECHECK_MS)
    return () => window.clearInterval(timer)
  }, [profileId, mode])
  return useSyncExternalStore(subscribe, read, () => NOTHING)
}

/**
 * Calls `onEnd` when a raid is over: «in raid» turned off, or the app opened with the game's logs saying no raid is on. Returns
 * the unsubscribe function. Logs not followed say nothing: `inRaid: false` without `tracked` is no end.
 */
export function watchRaidEnds(source: RaidStateSource, onEnd: () => void) {
  let stopped = false
  let inRaid: boolean | null = null
  const follow = (state: RaidState) => {
    if (stopped) return
    const before = inRaid
    inRaid = state.inRaid
    if (!state.inRaid && (before === true || (before === null && state.tracked))) onEnd()
  }
  // The state asked for at the start is older than any event that comes before the answer.
  let heard = false
  const unsubscribe = source.onRaidStateChanged((state) => {
    heard = true
    follow(state)
  })
  source.getRaidState().then((state) => { if (!heard) follow(state) }, () => {})
  return () => {
    stopped = true
    unsubscribe()
  }
}
