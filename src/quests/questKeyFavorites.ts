import { useCallback, useSyncExternalStore } from 'react'
import type { RaidMode } from '../domain/types'
import type { QuestKeyRow } from './questKeys'

/**
 * «Избранные ключи» of «Ключи для квестов» (owner, 06.11.2026: «сделай не галочку, а избранное, звездочку. Эта звездочка избранного
 * не должна добавлять в избранное на обзоре… на барахолку, туда не надо добавлять. Оно должно добавляться именно в ключи для
 * квестов»). The player's own list of the keys they hold in the game's favourites, which cannot be read or set from here.
 *
 * One list per profile and mode (PvP, PvE, Season apart), on this device, and nothing else: never `favoriteItemIds`, the list of
 * the Overview and the market. The storage key is the one of the former tick «Отмечен в игре» (taken off in 0.6.0.264, brought
 * back as this star): what was ticked then comes back starred.
 *
 * The reminder (owner, 06.11.2026: «если в "Больше не нужны" оказывается 10 и больше ключей которые до сей пор отмечены в избранном
 * ключей, отправлять уведомление, что их надо снять. По умолчанию это уведомление выключено»): the switch is kept on this device for
 * all modes, as the notifications of «Торговля»; the time of the last message per profile and mode (QuestKeysReminder.tsx).
 */
const FAVORITES_PREFIX = 'raidos-quest-key-marks-v1:'
const EVENT = 'raidos-quest-key-favorites-changed'
const REMINDER_KEY = 'raidos-quest-key-reminder-v1'
const TOLD_KEY = 'raidos-quest-key-reminded-v1'

/** From this many starred keys that are no longer needed the reminder comes. */
export const QUEST_KEY_REMINDER_AT = 10
/** The same message at most once a day, while there are that many: a key left starred must not nag at every start. */
export const QUEST_KEY_REMIND_AGAIN_MS = 24 * 60 * 60_000

const NONE: ReadonlySet<string> = new Set()
const snapshots = new Map<string, { raw: string | null; favorites: ReadonlySet<string> }>()

export const questKeyFavoritesKey = (profileId: string, mode: RaidMode) => `${FAVORITES_PREFIX}${profileId}:${mode}`
const toldId = (profileId: string, mode: RaidMode) => `${profileId}:${mode}`

function changed() {
  window.dispatchEvent(new Event(EVENT))
}

function subscribe(listener: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === REMINDER_KEY || event.key.startsWith(FAVORITES_PREFIX)) listener()
  }
  window.addEventListener(EVENT, listener)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(EVENT, listener)
    window.removeEventListener('storage', onStorage)
  }
}

export function readQuestKeyFavorites(profileId: string, mode: RaidMode): ReadonlySet<string> {
  const key = questKeyFavoritesKey(profileId, mode)
  let raw: string | null = null
  try { raw = localStorage.getItem(key) } catch { /* storage unavailable */ }
  // useSyncExternalStore needs a stable snapshot: parse only when the stored text changed.
  const kept = snapshots.get(key)
  if (kept && kept.raw === raw) return kept.favorites
  let favorites = NONE
  try {
    const stored: unknown = raw ? JSON.parse(raw) : null
    if (Array.isArray(stored)) favorites = new Set(stored.filter((id): id is string => typeof id === 'string'))
  } catch { /* a damaged value reads as nothing starred */ }
  snapshots.set(key, { raw, favorites })
  return favorites
}

export function setQuestKeyFavorite(profileId: string, mode: RaidMode, itemId: string, on: boolean) {
  const favorites = new Set(readQuestKeyFavorites(profileId, mode))
  if (on) favorites.add(itemId)
  else favorites.delete(itemId)
  try {
    if (favorites.size) localStorage.setItem(questKeyFavoritesKey(profileId, mode), JSON.stringify([...favorites]))
    else localStorage.removeItem(questKeyFavoritesKey(profileId, mode))
  } catch { /* storage unavailable */ }
  changed()
}

export function useQuestKeyFavorites(profileId: string, mode: RaidMode) {
  const read = useCallback(() => readQuestKeyFavorites(profileId, mode), [profileId, mode])
  return useSyncExternalStore(subscribe, read, () => NONE)
}

/** A reset of the mode: a new character, the game's favourites start empty. */
export function clearQuestKeyFavorites(profileId: string, mode: RaidMode) {
  try {
    localStorage.removeItem(questKeyFavoritesKey(profileId, mode))
    const told = readTold()
    delete told[toldId(profileId, mode)]
    localStorage.setItem(TOLD_KEY, JSON.stringify(told))
  } catch { /* storage unavailable */ }
  changed()
}

/** «Удалить все данные». */
export function clearAllQuestKeyFavorites() {
  try {
    const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
    for (const key of keys) if (key?.startsWith(FAVORITES_PREFIX)) localStorage.removeItem(key)
    localStorage.removeItem(REMINDER_KEY)
    localStorage.removeItem(TOLD_KEY)
  } catch { /* storage unavailable */ }
  changed()
}

/** Off until the player presses «Включить уведомления». */
export function readQuestKeyReminder() {
  try { return localStorage.getItem(REMINDER_KEY) === 'on' } catch { return false }
}

/** Turned on, the message comes at once if it is due, even if it was given today: the press has to show what it does. */
export function writeQuestKeyReminder(on: boolean) {
  try {
    if (on) {
      localStorage.setItem(REMINDER_KEY, 'on')
      localStorage.removeItem(TOLD_KEY)
    } else localStorage.removeItem(REMINDER_KEY)
  } catch { /* storage unavailable */ }
  changed()
}

export const useQuestKeyReminder = () => useSyncExternalStore(subscribe, readQuestKeyReminder, () => false)

function readTold(): Record<string, number> {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(TOLD_KEY) ?? '{}')
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {}
    return Object.fromEntries(Object.entries(stored).filter((entry): entry is [string, number] => typeof entry[1] === 'number'))
  } catch { return {} }
}

export const questKeysToldAt = (profileId: string, mode: RaidMode): number | undefined => readTold()[toldId(profileId, mode)]

export function rememberQuestKeysTold(profileId: string, mode: RaidMode, at: number) {
  try { localStorage.setItem(TOLD_KEY, JSON.stringify({ ...readTold(), [toldId(profileId, mode)]: at })) } catch { /* storage unavailable */ }
}

/** The starred keys that are under «Больше не нужны». */
export function staleFavoriteKeys(rows: readonly Pick<QuestKeyRow, 'item' | 'state'>[], favorites: ReadonlySet<string>) {
  return rows.filter((row) => row.state === 'done' && favorites.has(row.item.id)).length
}

export function questKeyReminderDue(staleCount: number, toldAt: number | undefined, now: number) {
  return staleCount >= QUEST_KEY_REMINDER_AT && (toldAt === undefined || now - toldAt >= QUEST_KEY_REMIND_AGAIN_MS)
}
