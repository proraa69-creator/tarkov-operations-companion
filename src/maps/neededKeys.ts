import { useSyncExternalStore } from 'react'
import type { Item, MapMarker, Quest } from '../domain/types'
import { storyStageKeyId, type QuestKeyRow } from '../quests/questKeys'

/**
 * «Нужные ключи» on the map (reports №112 and №113, owner 09.11.2026: «ключей, которых нет в схроне… будет кнопка «Нужные
 * ключи»… места спавна ключей, которых не хватает в схроне, которые будут нужны для квестов… для текущих квестов. И должны
 * показываться отложенные квесты, в которых нет нужных ключей»): the keys a quest open now (taken or available) or put aside asks
 * for, that the player does not have (`ownedKeys`, «Ключи в схроне») — nor any key that does the same.
 */
export interface NeededKey { item: Item; quests: Quest[] }

const isCurrent = (status: string | undefined) => status === 'active' || status === 'available'

export function neededKeysOf(rows: readonly QuestKeyRow[], owned: { has(id: string): boolean }): Map<string, NeededKey> {
  const needed = new Map<string, NeededKey>()
  for (const row of rows) {
    if (owned.has(row.item.id)) continue
    const uses = [...row.needed.filter((use) => isCurrent(use.status)), ...row.deferred]
      .filter((use) => !use.alternatives.some((id) => owned.has(id)))
    if (uses.length) needed.set(row.item.id, { item: row.item, quests: uses.map((use) => use.quest) })
  }
  return needed
}

/** The keys a key point may hold: every key of a loose spot, or the one item of a «один из N» spot. */
export function keysOfPoint(marker: Pick<MapMarker, 'keyIds' | 'itemId'>): readonly string[] {
  return marker.keyIds ?? (marker.itemId ? [marker.itemId] : [])
}

/** A quest's key on this map, with the objectives it is for (none: every point of the quest). */
export interface QuestKeyOnMap { item: Item; objectiveIds?: readonly string[] }

/** Each quest's keys on this map, for its points' cards: a quest's key of another map is not shown here. */
export function questKeysOnMap(rows: readonly QuestKeyRow[], mapId: string): Map<string, QuestKeyOnMap[]> {
  const byQuest = new Map<string, QuestKeyOnMap[]>()
  for (const row of rows) {
    for (const use of [...row.needed, ...row.deferred]) {
      if (use.mapIds.length && !use.mapIds.includes(mapId)) continue
      const list = byQuest.get(use.quest.id) ?? []
      if (!list.some((key) => key.item.id === row.item.id)) list.push({ item: row.item, ...(use.objectiveIds?.length ? { objectiveIds: use.objectiveIds } : {}) })
      byQuest.set(use.quest.id, list)
    }
  }
  return byQuest
}

/** The objective a quest point is for, as its quest's keys name it: a story point's stage stands for its objective. */
export function pointObjectiveId(marker: Pick<MapMarker, 'questId' | 'objectiveId' | 'stageIndex'>): string | undefined {
  if (marker.objectiveId) return marker.objectiveId
  return marker.questId && marker.stageIndex !== undefined ? storyStageKeyId(marker.questId, marker.stageIndex) : undefined
}

/**
 * The keys a quest point's card names: its own objective's and the whole quest's (owner, 20.11.2026: «нужен только ключ на
 * западное крыло чтобы пометить генератор, но когда наводишь на восточное крыло тоже показывает эти же ключи от западного»).
 * A point that names no objective shows them all.
 */
export function questKeysOfPoint(keys: readonly QuestKeyOnMap[] | undefined, objectiveId: string | undefined): Item[] | undefined {
  const shown = (keys ?? []).filter((key) => !objectiveId || !key.objectiveIds || key.objectiveIds.includes(objectiveId)).map((key) => key.item)
  return shown.length ? shown : undefined
}

const KEY = 'raidos-map-needed-keys-only'
const EVENT = 'raidos-map-needed-keys-changed'

function read() {
  try { return localStorage.getItem(KEY) === 'on' } catch { return false }
}

export function setNeededKeysOnly(on: boolean) {
  try {
    if (on) localStorage.setItem(KEY, 'on')
    else localStorage.removeItem(KEY)
  } catch { /* storage unavailable */ }
  window.dispatchEvent(new Event(EVENT))
}

function subscribe(listener: () => void) {
  window.addEventListener(EVENT, listener)
  window.addEventListener('storage', listener)
  return () => {
    window.removeEventListener(EVENT, listener)
    window.removeEventListener('storage', listener)
  }
}

/** The switch, off until the player turns it on; kept on this device. */
export function useNeededKeysOnly() {
  return useSyncExternalStore(subscribe, read, () => false)
}
