/**
 * «Отложенные квесты» (owner, 03.11.2026: «редко можно достать нужные квестовые ключи сразу… отметить в интерфейсе на
 * разделе с картой какие задания в этом рейде мной выполняться не будут, что бы не мозолили глаза их метки»): a right
 * click on a quest in «Квесты на карте» or on its point → «Добавить в отложенные». The quest leaves the list and its
 * points leave the map until the player returns it in «Отложенные квесты» (components/DeferredQuests.tsx). Only a note,
 * like «Сделал в этом рейде» (progression/questChecks.ts): it never touches the quest's progress.
 *
 * On the Overview a right click on an item of «Требования рейда» or on the gear of «Сбор на рейд» puts its quests aside for
 * a while (owner, 03.11.2026: «нажать на любой предмет ПКМ и отложить квест не открывая и не запоминая каждый квест…
 * функцию выбора, на время или до достижения уровня»; components/QuestDeferDialog.tsx): for 1–7 days, until this
 * mode's character reaches a level, or until a trader's loyalty in this mode reaches the level that sells the item (the
 * levels of «Торговцы», gunsmith/traderLevels.ts). Such a quest comes back by itself then (useDeferredQuests).
 *
 * Kept per profile and mode (PvP, PvE and Season apart) as `{ questId: deferredAt (ms) }`, or
 * `{ questId: { at, until?, level?, loyalty? } }` with a term. No raid clears them: only «Вернуть», the term, a reset of the
 * mode («Престиж +», «Вайп», «Сброс», a new nickname: clearDeferredQuests) or «Удалить все данные».
 *
 * One list on every device of the account (owner, 04.11.2026; a player's report: «все равно показывается даже с учетом того
 * что на ПК они закрыты»): the device's copy goes through the server (sync/serverSync.ts syncDeferredQuests, POST
 * /v1/me/deferred-quests/:mode), the newest per quest wins. So a return is kept too (`returned`, in a key of its own), or
 * another device would bring the quest back; so is the mode's last reset (`floor`), older than which nothing counts.
 */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { GameMap, Item, Quest, RaidMode } from '../domain/types'
import type { AppLocale } from '../i18n/LocaleProvider'
import { uiText } from '../i18n/renderText'
import { clearAllAutoFavorites, releaseAbandonedAutoFavorites, releaseAutoFavorites } from './autoFavorites'
import { questMapsLabel } from './questLocation'

const KEY_PREFIX = 'tarkov-deferred-quests-v1:'
const SYNC_PREFIX = 'tarkov-deferred-sync-v1:'
const EVENT = 'tarkov-deferred-quests-changed'
/** Fired on this window when the list of quests put aside changes. */
export const DEFERRED_QUESTS_EVENT = EVENT
const DAY_MS = 24 * 60 * 60 * 1000

/** A trader's loyalty level in this mode; `trader`: the name, for the term's text. */
export interface LoyaltyTerm { traderId: string; trader: string; level: number }

/**
 * How a quest was put aside: when (ms), and the term it comes back at by itself — a time (`until`, ms), a level of this
 * mode's character (`level`) or a trader's loyalty (`loyalty`). None: it waits for «Вернуть».
 */
export interface DeferredQuest { at: number; until?: number; level?: number; loyalty?: LoyaltyTerm }

/** Quest id → how the player put it aside. */
export type DeferredQuests = ReadonlyMap<string, DeferredQuest>

/** One quest as the account's devices exchange it (the server keeps the newest per quest): times as ISO 8601. */
export interface DeferredSyncEntry {
  taskId: string
  status: 'deferred' | 'returned'
  at: string
  until?: string
  level?: number
  loyalty?: LoyaltyTerm
}

/** «По времени»: whole days; «До уровня»: the character level, or a trader's loyalty. */
export type DeferTerm = { days: number } | { level: number } | { loyalty: LoyaltyTerm }

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

function parseLoyalty(value: unknown): LoyaltyTerm | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const { traderId, trader, level } = value as Record<string, unknown>
  if (typeof traderId !== 'string' || !traderId || !finite(level) || level < 1) return undefined
  return { traderId, trader: typeof trader === 'string' ? trader.slice(0, 60) : '', level: Math.round(level) }
}

/** A stored entry: the time alone (put aside till «Вернуть»), or the time with its term. */
function parseEntry(value: unknown): DeferredQuest | undefined {
  if (finite(value)) return { at: value }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const { at, until, level, loyalty } = value as Record<string, unknown>
  if (!finite(at)) return undefined
  const trader = parseLoyalty(loyalty)
  return { at, ...(finite(until) ? { until } : {}), ...(finite(level) && level >= 1 ? { level: Math.round(level) } : {}), ...(trader ? { loyalty: trader } : {}) }
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
  const stored = Object.fromEntries([...deferred].map(([questId, entry]) => [questId, entry.until === undefined && entry.level === undefined && entry.loyalty === undefined ? entry.at : entry]))
  try {
    if (deferred.size) localStorage.setItem(key, JSON.stringify(stored))
    else localStorage.removeItem(key)
  } catch { /* storage unavailable */ }
  window.dispatchEvent(new Event(EVENT))
}

/** What syncing needs besides the list: the quests returned on this device or another (id → ms), the mode's last reset (ms). */
interface SyncNotes { returned: Record<string, number>; floor?: number }

const syncKey = (profileId: string, mode: RaidMode) => `${SYNC_PREFIX}${profileId}:${mode}`

function readSyncNotes(profileId: string, mode: RaidMode): SyncNotes {
  try {
    const stored = JSON.parse(localStorage.getItem(syncKey(profileId, mode)) ?? 'null') as Partial<SyncNotes> | null
    const returned = Object.fromEntries(Object.entries(stored?.returned ?? {}).filter((entry): entry is [string, number] => finite(entry[1])))
    return { returned, ...(finite(stored?.floor) ? { floor: stored.floor } : {}) }
  } catch {
    return { returned: {} }
  }
}

function writeSyncNotes(profileId: string, mode: RaidMode, notes: SyncNotes) {
  try {
    if (Object.keys(notes.returned).length || notes.floor !== undefined) localStorage.setItem(syncKey(profileId, mode), JSON.stringify(notes))
    else localStorage.removeItem(syncKey(profileId, mode))
  } catch { /* storage unavailable */ }
}

/** «Бессрочно»: till «Вернуть». A quest put aside for a term loses the term. */
export function deferQuest(profileId: string, mode: RaidMode, questId: string, now = Date.now()) {
  const deferred = readDeferredQuests(profileId, mode)
  const entry = deferred.get(questId)
  if (entry && entry.until === undefined && entry.level === undefined && entry.loyalty === undefined) return
  writeDeferred(profileId, mode, new Map([...deferred, [questId, { at: now }]]))
}

/**
 * «Отложить квест» on the Overview: these quests aside for whole days, until this mode's character reaches the level, or
 * until the trader's loyalty does. A quest already put aside takes the new term.
 */
export function deferQuests(profileId: string, mode: RaidMode, questIds: Iterable<string>, term: DeferTerm, now = Date.now()) {
  const entry: DeferredQuest = 'days' in term
    ? { at: now, until: now + Math.max(1, Math.round(term.days)) * DAY_MS }
    : 'loyalty' in term
      ? { at: now, loyalty: { ...term.loyalty, level: Math.max(2, Math.round(term.loyalty.level)) } }
      : { at: now, level: Math.max(2, Math.round(term.level)) }
  const deferred = new Map(readDeferredQuests(profileId, mode))
  let changed = false
  for (const questId of questIds) { deferred.set(questId, entry); changed = true }
  if (changed) writeDeferred(profileId, mode, deferred)
}

/**
 * The term came: its time passed, the character has the level, or the trader has the loyalty (`loyalty`: this mode's
 * levels by trader id, as «Торговцы» shows them; a trader it does not know keeps the quest aside).
 */
export function deferralDue(entry: DeferredQuest, now: number, playerLevel: number, loyalty?: ReadonlyMap<string, number>) {
  return (entry.until !== undefined && now >= entry.until) || (entry.level !== undefined && playerLevel >= entry.level)
    || (entry.loyalty !== undefined && (loyalty?.get(entry.loyalty.traderId) ?? 0) >= entry.loyalty.level)
}

/**
 * The term in a few words: «до 20 уровня», «до лояльности 2 · Терапевт», «до 5 нояб., 14:30» (in the app's language);
 * nothing for a quest put aside till «Вернуть».
 */
export function deferralTermText(entry: DeferredQuest | undefined, locale: AppLocale) {
  if (entry?.level !== undefined) return locale === 'en' ? `until level ${entry.level}` : `до ${entry.level} уровня`
  if (entry?.loyalty !== undefined) {
    const { trader, level } = entry.loyalty
    return locale === 'en' ? `until ${uiText(trader)} loyalty ${level}` : `до лояльности ${level} · ${trader}`
  }
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
export function restoreDeferredQuests(profileId: string, mode: RaidMode, questIds: Iterable<string>, now = Date.now()) {
  const deferred = new Map(readDeferredQuests(profileId, mode))
  const returned: string[] = []
  for (const questId of questIds) if (deferred.delete(questId)) returned.push(questId)
  if (!returned.length) return
  // Told to the other devices, or they would bring it back.
  const notes = readSyncNotes(profileId, mode)
  for (const questId of returned) notes.returned[questId] = now
  writeSyncNotes(profileId, mode, notes)
  writeDeferred(profileId, mode, deferred)
  releaseAutoFavorites(profileId, mode, returned)
}

/**
 * A quest done while put aside has no row in «Отложенные квесты», so nobody could return it and it kept its items in
 * «Избранное» for good (a player's report, 05.11.2026: «квест с 114 ключом я уже выполнил, из квестов он пропал, а ключ всё
 * ещё висит в избранных»). It leaves the list, and every mode's list is checked: «Избранное» is one for all of them.
 */
export function settleDeferredQuests(profileId: string, isDone: (mode: RaidMode, questId: string) => boolean) {
  for (const mode of ['pvp', 'pve', 'seasonal'] as const) {
    const done = [...readDeferredQuests(profileId, mode).keys()].filter((questId) => isDone(mode, questId))
    if (done.length) restoreDeferredQuests(profileId, mode, done)
  }
  releaseAbandonedAutoFavorites(profileId, (mode, questId) => readDeferredQuests(profileId, mode).has(questId))
}

/**
 * A reset of the mode («Престиж +», «Вайп», «Сброс», a new nickname; state/modeReset.ts): nothing is put aside any more, and
 * what another device still holds from before `at` does not come back. The server's list goes with its reset route.
 */
export function clearDeferredQuests(profileId: string, mode: RaidMode, at = Date.now()) {
  const questIds = [...readDeferredQuests(profileId, mode).keys()]
  writeSyncNotes(profileId, mode, { returned: {}, floor: at })
  if (!questIds.length) return
  writeDeferred(profileId, mode, NONE)
  releaseAutoFavorites(profileId, mode, questIds)
}

const isoOf = (ms: number) => {
  const date = new Date(ms)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

/** What this device knows of the mode, for the server: every quest put aside and every return. */
export function deferredSyncEntries(profileId: string, mode: RaidMode): DeferredSyncEntry[] {
  const deferred = readDeferredQuests(profileId, mode)
  const entries = [...deferred].flatMap(([taskId, entry]): DeferredSyncEntry[] => {
    const at = isoOf(entry.at)
    const until = entry.until === undefined ? undefined : isoOf(entry.until)
    if (!at) return []
    return [{
      taskId, status: 'deferred', at,
      ...(until ? { until } : {}),
      ...(entry.level !== undefined ? { level: entry.level } : {}),
      ...(entry.loyalty ? { loyalty: { ...entry.loyalty, trader: entry.loyalty.trader.slice(0, 60) } } : {}),
    }]
  })
  for (const [taskId, time] of Object.entries(readSyncNotes(profileId, mode).returned)) {
    const at = isoOf(time)
    if (at && !deferred.has(taskId)) entries.push({ taskId, status: 'returned', at })
  }
  return entries
}

/**
 * The server's list of the mode: per quest the newer of it and this device's own choice wins, a quest another device
 * returned leaves here (with what it kept in «Избранное»), and nothing older than the mode's last reset stays.
 */
export function applyRemoteDeferredQuests(profileId: string, mode: RaidMode, remote: readonly DeferredSyncEntry[], resetAt?: string) {
  const deferred = new Map(readDeferredQuests(profileId, mode))
  const notes = readSyncNotes(profileId, mode)
  const told = resetAt ? Date.parse(resetAt) : NaN
  const floor = Math.max(notes.floor ?? 0, Number.isNaN(told) ? 0 : told)
  const gone: string[] = []
  let changed = false
  for (const [questId, entry] of deferred) {
    if (entry.at >= floor) continue
    deferred.delete(questId)
    gone.push(questId)
    changed = true
  }
  for (const [questId, at] of Object.entries(notes.returned)) if (at < floor) delete notes.returned[questId]
  for (const quest of remote) {
    const at = Date.parse(quest.at)
    if (Number.isNaN(at) || at < floor) continue
    const own = deferred.get(quest.taskId)
    if (at <= Math.max(own?.at ?? 0, notes.returned[quest.taskId] ?? 0)) continue
    if (quest.status === 'returned') {
      notes.returned[quest.taskId] = at
      if (deferred.delete(quest.taskId)) { gone.push(quest.taskId); changed = true }
      continue
    }
    const until = quest.until ? Date.parse(quest.until) : NaN
    deferred.set(quest.taskId, {
      at,
      ...(Number.isNaN(until) ? {} : { until }),
      ...(quest.level !== undefined ? { level: quest.level } : {}),
      ...(quest.loyalty ? { loyalty: quest.loyalty } : {}),
    })
    delete notes.returned[quest.taskId]
    changed = true
  }
  writeSyncNotes(profileId, mode, { returned: notes.returned, ...(floor ? { floor } : {}) })
  if (changed) writeDeferred(profileId, mode, deferred)
  if (gone.length) releaseAutoFavorites(profileId, mode, gone)
}

/** «Удалить все данные»: the deferred quests of every profile and mode, and what they put into «Избранное». */
export function clearAllDeferredQuests() {
  try {
    const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
    for (const key of keys) if (key?.startsWith(KEY_PREFIX) || key?.startsWith(SYNC_PREFIX)) localStorage.removeItem(key)
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
 * The quests of this profile and mode still put aside. A term that came brings its quest back by itself: at its time, once
 * `playerLevel` — the level of this mode the app knows (the game's screen or Tarkov.dev, raised by the quests turned in
 * since; 1 while it knows none) — reaches it, or once the trader's level in `loyalty` (gunsmith/useGunsmithAccess.ts
 * useTraderLoyalty) does. Back at once in every list, and for good: it leaves the store, so a lower level later (a
 * prestige) never puts it aside again.
 */
export function useDeferredQuests(profileId: string, mode: RaidMode, playerLevel: number, loyalty?: ReadonlyMap<string, number>): DeferredQuests {
  const read = useCallback(() => readDeferredQuests(profileId, mode), [profileId, mode])
  const stored = useSyncExternalStore(subscribe, read, () => NONE)
  const [now, setNow] = useState(() => Date.now())
  const due = useMemo(() => [...stored].flatMap(([questId, entry]) => (deferralDue(entry, now, playerLevel, loyalty) ? [questId] : [])), [stored, now, playerLevel, loyalty])
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
const RAID_PURPOSES = new Set(['key', 'place', 'mark', 'bring', 'signal', 'use'])

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

/** A row of «Отложенные квесты»: the quest, its maps, «торговец · карты», what it needs in the raid, how it was put aside. */
export interface DeferredQuestRow { quest: Quest; place: string; detail: string; items: Item[]; entry?: DeferredQuest }

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
    .map((quest) => {
      const place = quest.anyMap ? 'Любая карта' : questMapsLabel(quest, options.maps) || 'У торговца'
      return { quest, place, detail: `${quest.trader} · ${place}`, items: questRaidItems(quest, options.itemsById), entry: deferred.get(quest.id) }
    })
}
