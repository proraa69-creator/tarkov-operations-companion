/**
 * «Отложенные квесты» (owner, 03.11.2026: «редко можно достать нужные квестовые ключи сразу… отметить в интерфейсе на
 * разделе с картой какие задания в этом рейде мной выполняться не будут, что бы не мозолили глаза их метки»): a right
 * click on a quest in «Квесты на карте» or on its point → «Добавить в отложенные». The quest leaves the list and its
 * points leave the map until the player returns it in «Отложенные квесты» (components/DeferredQuests.tsx). Only a note,
 * like «Сделал в этом рейде» (progression/questChecks.ts): it never touches the quest's progress.
 *
 * Kept on this device per profile and mode (PvP, PvE and Season apart) as `{ questId: deferredAt (ms) }`. No raid clears
 * them: only «Вернуть» or «Удалить все данные».
 */
import { useCallback, useSyncExternalStore } from 'react'
import type { GameMap, Item, Quest, RaidMode } from '../domain/types'
import { questMapsLabel } from './questLocation'

const KEY_PREFIX = 'tarkov-deferred-quests-v1:'
const EVENT = 'tarkov-deferred-quests-changed'

/** Quest id → when the player put it aside (ms). */
export type DeferredQuests = ReadonlyMap<string, number>

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

function parseDeferred(raw: string | null): DeferredQuests {
  if (!raw) return NONE
  try {
    const stored: unknown = JSON.parse(raw)
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return NONE
    const deferred = new Map<string, number>()
    for (const [questId, at] of Object.entries(stored)) if (typeof at === 'number' && Number.isFinite(at)) deferred.set(questId, at)
    return deferred
  } catch {
    // A damaged value reads as nothing deferred; the next change writes a clean one.
    return NONE
  }
}

function writeDeferred(profileId: string, mode: RaidMode, deferred: DeferredQuests) {
  const key = deferredQuestsKey(profileId, mode)
  try {
    if (deferred.size) localStorage.setItem(key, JSON.stringify(Object.fromEntries(deferred)))
    else localStorage.removeItem(key)
  } catch { /* storage unavailable */ }
  window.dispatchEvent(new Event(EVENT))
}

/** «Добавить в отложенные». */
export function deferQuest(profileId: string, mode: RaidMode, questId: string, now = Date.now()) {
  const deferred = readDeferredQuests(profileId, mode)
  if (!deferred.has(questId)) writeDeferred(profileId, mode, new Map([...deferred, [questId, now]]))
}

/** «Вернуть»: the ticked quests go back to «Квесты на карте» and their points to the map. */
export function restoreDeferredQuests(profileId: string, mode: RaidMode, questIds: Iterable<string>) {
  const deferred = new Map(readDeferredQuests(profileId, mode))
  let changed = false
  for (const questId of questIds) changed = deferred.delete(questId) || changed
  if (changed) writeDeferred(profileId, mode, deferred)
}

/** «Удалить все данные»: the deferred quests of every profile and mode. */
export function clearAllDeferredQuests() {
  try {
    const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
    for (const key of keys) if (key?.startsWith(KEY_PREFIX)) localStorage.removeItem(key)
  } catch { /* storage unavailable */ }
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

export function useDeferredQuests(profileId: string, mode: RaidMode): DeferredQuests {
  const read = useCallback(() => readDeferredQuests(profileId, mode), [profileId, mode])
  return useSyncExternalStore(subscribe, read, () => NONE)
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

/** A row of «Отложенные квесты»: the quest, «торговец · карты», what it needs in the raid. */
export interface DeferredQuestRow { quest: Quest; detail: string; items: Item[] }

/**
 * The rows of «Отложенные квесты» from the current quests (only those still taken count: a quest done since is not
 * listed), the ones `first` picks (the quests of the open map) on top, then the newest put aside.
 */
export function deferredQuestRows(currentQuests: readonly Quest[], deferred: DeferredQuests, options: { maps: Array<Pick<GameMap, 'id' | 'name'>>; itemsById: ReadonlyMap<string, Item>; first?: (quest: Quest) => boolean }): DeferredQuestRow[] {
  if (!deferred.size) return []
  const rank = (quest: Quest) => (options.first?.(quest) ? 0 : 1)
  return currentQuests
    .filter((quest) => deferred.has(quest.id))
    .sort((left, right) => rank(left) - rank(right) || (deferred.get(right.id) ?? 0) - (deferred.get(left.id) ?? 0))
    .map((quest) => ({
      quest,
      detail: `${quest.trader} · ${quest.anyMap ? 'Любая карта' : questMapsLabel(quest, options.maps) || 'У торговца'}`,
      items: questRaidItems(quest, options.itemsById),
    }))
}
