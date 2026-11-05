/**
 * What «Предметы в избранное» (progression/questDeferral.ts) put into «Избранное», and for which quests put aside (owner,
 * 03.11.2026: «когда убираешь квест из отложенных, предметы добавленые в избранное должны удаляться»). Kept on this device
 * per profile — «Избранное» is one list for every mode of a profile — as each item it added with the quests
 * (`mode:questId`) that keep it there. A quest that comes back (by «Вернуть», its time or its level) lets go of its items;
 * an item no quest keeps any more is taken out of «Избранное» (state/AppState.tsx, at its next look). Only the feature's
 * own: an item the player had starred before, or stars or unstars himself later, is his and stays as he leaves it.
 */
import type { RaidMode } from '../domain/types'

const KEY_PREFIX = 'raidos-auto-favorites-v1:'
/** Fired on this window when items wait to be taken out of «Избранное». */
export const AUTO_FAVORITES_EVENT = 'raidos-auto-favorites-changed'

interface Stored {
  /** Item id → the quests put aside that keep it in «Избранное» (`mode:questId`). */
  items: Record<string, string[]>
  /** Items no quest keeps any more, to be taken out of «Избранное». */
  remove: string[]
}

const keyOf = (profileId: string) => `${KEY_PREFIX}${profileId}`
const ownerOf = (mode: RaidMode, questId: string) => `${mode}:${questId}`
const strings = (value: unknown) => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [])

function read(profileId: string): Stored {
  try {
    const stored = JSON.parse(localStorage.getItem(keyOf(profileId)) ?? 'null') as Partial<Stored> | null
    const items: Record<string, string[]> = {}
    for (const [itemId, owners] of Object.entries(stored?.items ?? {})) if (strings(owners).length) items[itemId] = strings(owners)
    return { items, remove: strings(stored?.remove) }
  } catch {
    // A damaged value reads as nothing added: nothing is ever taken out by mistake.
    return { items: {}, remove: [] }
  }
}

function write(profileId: string, stored: Stored, announce = true) {
  try {
    if (Object.keys(stored.items).length || stored.remove.length) localStorage.setItem(keyOf(profileId), JSON.stringify(stored))
    else localStorage.removeItem(keyOf(profileId))
  } catch { /* storage unavailable */ }
  if (announce) window.dispatchEvent(new Event(AUTO_FAVORITES_EVENT))
}

/**
 * Quests put aside, with the items each needs. `added`: what the feature put into «Избранное» now — those items are kept
 * by every quest here that needs them; an item it added earlier gets these quests too. Anything else (the player's own
 * favourite) is not the feature's and is left out.
 */
export function recordAutoFavorites(profileId: string, quests: ReadonlyArray<{ mode: RaidMode; questId: string; itemIds: readonly string[] }>, added: readonly string[]) {
  const stored = read(profileId)
  const fresh = new Set(added)
  let changed = false
  for (const { mode, questId, itemIds } of quests) {
    for (const itemId of itemIds) {
      const owners = stored.items[itemId]
      if (!owners && !fresh.has(itemId)) continue
      const owner = ownerOf(mode, questId)
      if (owners?.includes(owner)) continue
      stored.items[itemId] = [...(owners ?? []), owner]
      changed = true
    }
  }
  // An item waiting to be taken out stays after all once a quest keeps it again.
  const remove = stored.remove.filter((itemId) => !stored.items[itemId])
  if (changed || remove.length !== stored.remove.length) write(profileId, { items: stored.items, remove })
}

/** Quests back from «Отложенные квесты» in this mode: the items none of the others keep wait to leave «Избранное». */
export function releaseAutoFavorites(profileId: string, mode: RaidMode, questIds: Iterable<string>) {
  const gone = new Set([...questIds].map((questId) => ownerOf(mode, questId)))
  if (!gone.size) return
  const stored = read(profileId)
  const remove = [...stored.remove]
  let changed = false
  for (const [itemId, owners] of Object.entries(stored.items)) {
    const left = owners.filter((owner) => !gone.has(owner))
    if (left.length === owners.length) continue
    changed = true
    if (left.length) stored.items[itemId] = left
    else {
      delete stored.items[itemId]
      if (!remove.includes(itemId)) remove.push(itemId)
    }
  }
  if (changed) write(profileId, { items: stored.items, remove })
}

/** The items to take out of «Избранное» now; they are no longer waiting after this. */
export function takeAutoFavoriteRemovals(profileId: string): string[] {
  const stored = read(profileId)
  if (!stored.remove.length) return []
  write(profileId, { items: stored.items, remove: [] }, false)
  return stored.remove
}

/** The player starred or unstarred the item himself: it is his from now on, never taken out by the feature. */
export function forgetAutoFavorite(profileId: string, itemId: string) {
  const stored = read(profileId)
  if (!stored.items[itemId] && !stored.remove.includes(itemId)) return
  delete stored.items[itemId]
  write(profileId, { items: stored.items, remove: stored.remove.filter((id) => id !== itemId) }, false)
}

/** The items the feature keeps in «Избранное» for a profile now. */
export function autoFavoriteIds(profileId: string): string[] {
  return Object.keys(read(profileId).items)
}

/** «Престиж +», «Вайп», «Сброс»: «Избранное» is emptied, so nothing is left to keep or to take out of it. */
export function clearAutoFavorites(profileId: string) {
  try { localStorage.removeItem(keyOf(profileId)) } catch { /* storage unavailable */ }
}

/** «Удалить все данные»: every profile's. */
export function clearAllAutoFavorites() {
  try {
    const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
    for (const key of keys) if (key?.startsWith(KEY_PREFIX)) localStorage.removeItem(key)
  } catch { /* storage unavailable */ }
}
