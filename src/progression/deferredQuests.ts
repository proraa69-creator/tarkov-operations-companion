/**
 * «Отложенные квесты» (owner, 03.11.2026: «редко можно достать нужные квестовые ключи сразу… отметить в интерфейсе на
 * разделе с картой какие задания в этом рейде мной выполняться не будут, что бы не мозолили глаза их метки»): a right
 * click on a quest in «Квесты на карте» or on its point → «Добавить в отложенные». The quest leaves the list and its
 * points leave the map until the player returns it in «Отложенные квесты» (components/DeferredQuests.tsx). Only a note,
 * like «Сделал в этом рейде» (progression/questChecks.ts): it never touches the quest's progress.
 *
 * On the Overview a right click on an item of «Требования рейда» or on the gear of «Сбор на рейд» puts its quests aside for
 * a while (owner, 03.11.2026: «нажать на любой предмет ПКМ и отложить квест не открывая и не запоминая каждый квест…
 * функцию выбора, на время или до достижения уровня»; components/QuestDeferDialog.tsx): for 1–7 days, or until this
 * mode's character reaches a level. Such a quest comes back by itself then (useDeferredQuests).
 *
 * Kept on this device per profile and mode (PvP, PvE and Season apart) as `{ questId: deferredAt (ms) }`, or
 * `{ questId: { at, until?, level? } }` with a term. No raid clears them: only «Вернуть», the term or «Удалить все данные».
 */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { GameMap, Item, Quest, RaidMode } from '../domain/types'
import type { AppLocale } from '../i18n/LocaleProvider'
import { clearAllAutoFavorites, releaseAutoFavorites } from './autoFavorites'
import { questMapsLabel } from './questLocation'

const KEY_PREFIX = 'tarkov-deferred-quests-v1:'
const EVENT = 'tarkov-deferred-quests-changed'
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * How a quest was put aside: when (ms), and the term it comes back at by itself — a time (`until`, ms) or a level of this
 * mode's character (`level`). Neither: it waits for «Вернуть».
 */
export interface DeferredQuest { at: number; until?: number; level?: number }

/** Quest id → how the player put it aside. */
export type DeferredQuests = ReadonlyMap<string, DeferredQuest>

/** «По времени»: whole days; «До уровня»: the character level. */
export type DeferTerm = { days: number } | { level: number }

const NONE: DeferredQuests = new Map()
const snapshots = new Map<string, { raw: string | null; deferred: DeferredQuests }>()

export function deferredQuestsKey(profileId: string, mode: RaidMode) {
  return `${KEY_PREFIX}${profileId}:${mode}`
}

export function readDeferredQuests(profileId: string, mode: RaidMode): DeferredQuests {
  const key = deferredQuestsKey(profileId, mode)
  let raw: string | null = null
  try { raw = localStorage.getItem(key) } catch { /* storage unavailable */ }
  // useSyncExternalStore needs a stable snapshot: parse only when the stored text changed.
  const cached = snapshots.get(key)
  if (cached && cached.raw === raw) return cached.deferred
  const deferred = parseDeferred(raw)
  snapshots.set(key, { raw, deferred })
  return deferred
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

/** A stored entry: the time alone (put aside till «Вернуть»), or the time with its term. */
function parseEntry(value: unknown): DeferredQuest | undefined {
  if (finite(value)) return { at: value }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const { at, until, level } = value as Record<string, unknown>
  if (!finite(at)) return undefined
  return { at, ...(finite(until) ? { until } : {}), ...(finite(level) && level >= 1 ? { level: Math.round(level) } : {}) }
}

function parseDeferred(raw: string | null): DeferredQuests {
  if (!raw) return NONE
  try {
    const stored: unknown = JSON.parse(raw)
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return NONE
    const deferred = new Map<string, DeferredQuest>()
    for (const [questId, value] of Object.entries(stored)) {
      const entry = parseEntry(value)
      if (entry) deferred.set(questId, entry)
    }
    return deferred
  } catch {
    // A damaged value reads as nothing deferred; the next change writes a clean one.
    return NONE
  }
}

function writeDeferred(profileId: string, mode: RaidMode, deferred: DeferredQuests) {
  const key = deferredQuestsKey(profileId, mode)
  // Without a term an entry stays the bare time, as the app wrote it before terms.
  const stored = Object.fromEntries([...deferred].map(([questId, entry]) => [questId, entry.until === undefined && entry.level === undefined ? entry.at : entry]))
  try {
    if (deferred.size) localStorage.setItem(key, JSON.stringify(stored))
    else localStorage.removeItem(key)
  } catch { /* storage unavailable */ }
  window.dispatchEvent(new Event(EVENT))
}

/** «Добавить в отложенные»: till «Вернуть». */
export function deferQuest(profileId: string, mode: RaidMode, questId: string, now = Date.now()) {
  const deferred = readDeferredQuests(profileId, mode)
  if (!deferred.has(questId)) writeDeferred(profileId, mode, new Map([...deferred, [questId, { at: now }]]))
}

/**
 * «Отложить квест» on the Overview: these quests aside for whole days, or until this mode's character reaches the level.
 * A quest already put aside takes the new term.
 */
export function deferQuests(profileId: string, mode: RaidMode, questIds: Iterable<string>, term: DeferTerm, now = Date.now()) {
  const entry: DeferredQuest = 'days' in term
    ? { at: now, until: now + Math.max(1, Math.round(term.days)) * DAY_MS }
    : { at: now, level: Math.max(2, Math.round(term.level)) }
  const deferred = new Map(readDeferredQuests(profileId, mode))
  let changed = false
  for (const questId of questIds) { deferred.set(questId, entry); changed = true }
  if (changed) writeDeferred(profileId, mode, deferred)
}

/** The term came: its time passed, or the character has the level. */
export function deferralDue(entry: DeferredQuest, now: number, playerLevel: number) {
  return (entry.until !== undefined && now >= entry.until) || (entry.level !== undefined && playerLevel >= entry.level)
}

/**
 * The term in a few words: «до 20 уровня», «до 5 нояб., 14:30» (in the app's language); nothing for a quest put aside
 * till «Вернуть».
 */
export function deferralTermText(entry: DeferredQuest | undefined, locale: AppLocale) {
  if (entry?.level !== undefined) return locale === 'en' ? `until level ${entry.level}` : `до ${entry.level} уровня`
  if (entry?.until !== undefined) {
    const when = new Date(entry.until).toLocaleString(locale, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
    return locale === 'en' ? `until ${when}` : `до ${when}`
  }
  return ''
}

/**
 * «Вернуть», or a term that came (useDeferredQuests): the quests go back to «Квесты на карте» and their points to the map;
 * the items «Предметы в избранное» added for them and no other quest keeps leave «Избранное» (progression/autoFavorites.ts).
 */
export function restoreDeferredQuests(profileId: string, mode: RaidMode, questIds: Iterable<string>) {
  const deferred = new Map(readDeferredQuests(profileId, mode))
  const returned: string[] = []
  for (const questId of questIds) if (deferred.delete(questId)) returned.push(questId)
  if (!returned.length) return
  writeDeferred(profileId, mode, deferred)
  releaseAutoFavorites(profileId, mode, returned)
}

/** «Удалить все данные»: the deferred quests of every profile and mode, and what they put into «Избранное». */
export function clearAllDeferredQuests() {
  try {
    const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
    for (const key of keys) if (key?.startsWith(KEY_PREFIX)) localStorage.removeItem(key)
  } catch { /* storage unavailable */ }
  clearAllAutoFavorites()
  window.dispatchEvent(new Event(EVENT))
}

function subscribe(listener: () => void) {
  // Another window of the app (or a browser tab) changed them; `key` is null when the whole storage was cleared.
  const onStorage = (event: StorageEvent) => { if (event.key === null || event.key.startsWith(KEY_PREFIX)) listener() }
  window.addEventListener(EVENT, listener)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(EVENT, listener)
    window.removeEventListener('storage', onStorage)
  }
}

/**
 * The quests of this profile and mode still put aside. A term that came brings its quest back by itself: at its time, or
 * once `playerLevel` — the level of this mode the app knows (the game's screen or Tarkov.dev, raised by the quests turned
 * in since; 1 while it knows none) — reaches it. Back at once in every list, and for good: it leaves the store, so a lower
 * level later (a prestige) never puts it aside again.
 */
export function useDeferredQuests(profileId: string, mode: RaidMode, playerLevel: number): DeferredQuests {
  const read = useCallback(() => readDeferredQuests(profileId, mode), [profileId, mode])
  const stored = useSyncExternalStore(subscribe, read, () => NONE)
  const [now, setNow] = useState(() => Date.now())
  const due = useMemo(() => [...stored].flatMap(([questId, entry]) => (deferralDue(entry, now, playerLevel) ? [questId] : [])), [stored, now, playerLevel])
  // The next time a term comes, the list is read again.
  const next = useMemo(() => Math.min(...[...stored.values()].flatMap((entry) => (entry.until !== undefined && entry.until > now ? [entry.until] : []))), [stored, now])
  useEffect(() => {
    if (!Number.isFinite(next)) return
    // setTimeout holds at most ~24.8 days; a longer wait is cut and simply looks again then.
    const timer = window.setTimeout(() => setNow(Date.now()), Math.min(Math.max(0, next - Date.now()) + 50, 2 ** 31 - 1))
    return () => window.clearTimeout(timer)
  }, [next])
  useEffect(() => {
    if (due.length) restoreDeferredQuests(profileId, mode, due)
  }, [due, profileId, mode])
  return useMemo(() => (due.length ? new Map([...stored].filter(([questId]) => !due.includes(questId))) : stored), [due, stored])
}

/** What has to be taken into the raid: a key, an item to place, a marker, something to carry out with. */
const RAID_PURPOSES = new Set(['key', 'place', 'mark', 'bring'])

/**
 * The items a quest needs in the raid, keys first, for its row in «Отложенные квесты» (owner, 03.11.2026: «если для
 * квеста требуется какой то предмет и у человека нету его… вместо ключа там будет картинка предмета и ее название»):
 * its keys (tarkov.dev's keys of the quest and its objectives, Quest.raidRequirements, and the keys among its required
 * items no requirement names), then what it places, marks or brings. Items the catalog does not know are left out.
 */
export function questRaidItems(quest: Quest, itemsById: ReadonlyMap<string, Item>): Item[] {
  const needs = (quest.raidRequirements ?? []).filter((need) => RAID_PURPOSES.has(need.purpose))
  const keys = [
    ...needs.filter((need) => need.purpose === 'key').map((need) => need.itemId),
    ...(quest.requiredItems ?? []).filter((itemId) => itemsById.get(itemId)?.category === 'Ключ'),
  ]
  const others = needs.filter((need) => need.purpose !== 'key').map((need) => need.itemId)
  return [...new Set([...keys, ...others])].map((itemId) => itemsById.get(itemId)).filter((item): item is Item => Boolean(item))
}

/** A row of «Отложенные квесты»: the quest, «торговец · карты», what it needs in the raid, how it was put aside. */
export interface DeferredQuestRow { quest: Quest; detail: string; items: Item[]; entry?: DeferredQuest }

/**
 * The rows of «Отложенные квесты» from the current quests (only those still taken count: a quest done since is not
 * listed), the ones `first` picks (the quests of the open map) on top, then the newest put aside.
 */
export function deferredQuestRows(currentQuests: readonly Quest[], deferred: DeferredQuests, options: { maps: Array<Pick<GameMap, 'id' | 'name'>>; itemsById: ReadonlyMap<string, Item>; first?: (quest: Quest) => boolean }): DeferredQuestRow[] {
  if (!deferred.size) return []
  const rank = (quest: Quest) => (options.first?.(quest) ? 0 : 1)
  return currentQuests
    .filter((quest) => deferred.has(quest.id))
    .sort((left, right) => rank(left) - rank(right) || (deferred.get(right.id)?.at ?? 0) - (deferred.get(left.id)?.at ?? 0))
    .map((quest) => ({
      quest,
      detail: `${quest.trader} · ${quest.anyMap ? 'Любая карта' : questMapsLabel(quest, options.maps) || 'У торговца'}`,
      items: questRaidItems(quest, options.itemsById),
      entry: deferred.get(quest.id),
    }))
}
