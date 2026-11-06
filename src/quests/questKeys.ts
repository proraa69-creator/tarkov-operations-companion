import { useCallback, useSyncExternalStore } from 'react'
import type { Item, ModeProgress, Quest, RaidMode, TaskProgressStatus } from '../domain/types'
import { STORY_GUIDE_DATA } from '../data/storyChapterGuideData'
import { storyGuideChapterId } from '../data/storyChapterGuide'
import type { DeferredQuest, DeferredQuests } from '../progression/deferredQuests'
import { isLiveGameQuest, questFaction } from '../progression/questBasics'
import type { TaskAvailability } from '../progression/requirementEngine'

/**
 * «Ключи для квестов» (a player's proposal №52, owner 05.11.2026: «Сделай отдельный раздел ключей для квестов. Туда добавь все ключи,
 * которые требуются для всех квестов в игре»): every key a quest of this mode asks to bring, with all its quests. A quest done leaves
 * the key's list; the key stays until all its quests are done, then moves to «Больше не нужны», from where it can be taken out of the
 * game's favourites. A quest the player does not want to do is put aside (progression/deferredQuests.ts): it no longer holds its key.
 * The game's favourites cannot be read or set from here: «Отмечен в игре» is the player's own note, one list per mode.
 */
export interface QuestKeyUse {
  quest: Quest
  status?: TaskProgressStatus
  /** Where the quest needs this key. */
  mapIds: string[]
  /** Other keys that do the same for this objective: any one of them is enough. */
  alternatives: string[]
  entry?: DeferredQuest
}

export type QuestKeyState = 'needed' | 'deferred' | 'done'

export interface QuestKeyRow {
  item: Item
  state: QuestKeyState
  needed: QuestKeyUse[]
  deferred: QuestKeyUse[]
  done: QuestKeyUse[]
  mapIds: string[]
}

interface QuestKeyNeed { itemId: string; mapIds: string[]; alternatives: string[] }

/** More keys than this among a quest's required items: a hand-in of any key («Ключевой партнёр»: any of 214), which makes none of them a quest key. */
const ANY_KEY_LIST = 12

/** The keys of a trader quest: its requirements to bring a key, and the keys among its required items no requirement names. */
function traderQuestKeys(quest: Quest, items: ReadonlyMap<string, Item>): QuestKeyNeed[] {
  const needs = new Map<string, QuestKeyNeed>()
  const requirements = (quest.raidRequirements ?? []).filter((need) => need.purpose === 'key' && need.itemId && !need.optional)
  for (const need of requirements) {
    const own = needs.get(need.itemId) ?? { itemId: need.itemId, mapIds: [], alternatives: [] }
    own.mapIds = [...new Set([...own.mapIds, ...(need.mapIds ?? [])])]
    if ((need.alternatives ?? 1) > 1) {
      const others = requirements.filter((other) => other.itemId !== need.itemId && other.objectiveId === need.objectiveId).map((other) => other.itemId)
      own.alternatives = [...new Set([...own.alternatives, ...others])]
    }
    needs.set(need.itemId, own)
  }
  const optional = new Set((quest.raidRequirements ?? []).filter((need) => need.optional).map((need) => need.itemId))
  const listed = (quest.requiredItems ?? []).filter((itemId) => items.get(itemId)?.category === 'Ключ')
  for (const itemId of listed.length > ANY_KEY_LIST ? [] : listed) {
    if (needs.has(itemId) || optional.has(itemId)) continue
    needs.set(itemId, { itemId, mapIds: quest.mapIds ?? (quest.mapId ? [quest.mapId] : []), alternatives: [] })
  }
  return [...needs.values()]
}

/** The keys of a story chapter, from its guide: only real keys, not the tools and items it also lists. */
function storyQuestKeys(quest: Quest, items: ReadonlyMap<string, Item>): QuestKeyNeed[] {
  const chapter = storyGuideChapterId(quest)
  const data = STORY_GUIDE_DATA.find((entry) => entry.id === chapter)
  const needs = new Map<string, QuestKeyNeed>()
  for (const objective of data?.objectives ?? []) {
    for (const item of objective.items ?? []) {
      if (!item.id || item.role !== 'key' || items.get(item.id)?.category !== 'Ключ') continue
      const own = needs.get(item.id) ?? { itemId: item.id, mapIds: [], alternatives: [] }
      own.mapIds = [...new Set([...own.mapIds, ...(objective.maps ?? [])])]
      needs.set(item.id, own)
    }
  }
  return [...needs.values()]
}

const byName = (left: { quest: Quest }, right: { quest: Quest }) => left.quest.level - right.quest.level || left.quest.name.localeCompare(right.quest.name, 'ru')

/** Every key of every quest of this mode. Failed quests and quests of the other faction hold no key. */
export function questKeyRows(quests: readonly Quest[], items: ReadonlyMap<string, Item>, progress: Pick<ModeProgress, 'taskProgress' | 'faction'>,
  availability: ReadonlyMap<string, TaskAvailability>, deferred: DeferredQuests): QuestKeyRow[] {
  const uses = new Map<string, QuestKeyUse[]>()
  for (const quest of quests) {
    const story = quest.kind === 'story'
    if (!story && !isLiveGameQuest(quest)) continue
    const status = availability.get(quest.id)?.status ?? progress.taskProgress[quest.id]?.status
    if (status === 'failed') continue
    const faction = questFaction(quest.faction)
    if (faction && progress.faction !== 'unknown' && faction !== progress.faction) continue
    for (const need of story ? storyQuestKeys(quest, items) : traderQuestKeys(quest, items)) {
      if (!items.has(need.itemId)) continue
      const entry = deferred.get(quest.id)
      const list = uses.get(need.itemId) ?? []
      list.push({ quest, mapIds: need.mapIds, alternatives: need.alternatives, ...(status ? { status } : {}), ...(entry ? { entry } : {}) })
      uses.set(need.itemId, list)
    }
  }
  const rows = [...uses].map(([itemId, list]): QuestKeyRow => {
    const done = list.filter((use) => use.status === 'completed').sort(byName)
    const open = list.filter((use) => use.status !== 'completed')
    const deferredUses = open.filter((use) => use.entry).sort(byName)
    const needed = open.filter((use) => !use.entry).sort((left, right) => Number(right.status === 'active') - Number(left.status === 'active') || byName(left, right))
    return {
      item: items.get(itemId)!,
      state: needed.length ? 'needed' : deferredUses.length ? 'deferred' : 'done',
      needed, deferred: deferredUses, done,
      mapIds: [...new Set((needed.length ? needed : deferredUses.length ? deferredUses : done).flatMap((use) => use.mapIds))],
    }
  })
  return rows.sort((left, right) => Number(right.needed.some((use) => use.status === 'active')) - Number(left.needed.some((use) => use.status === 'active'))
    || left.item.name.localeCompare(right.item.name, 'ru'))
}

const MARKS_PREFIX = 'raidos-quest-key-marks-v1:'
const MARKS_EVENT = 'raidos-quest-key-marks-changed'
const NONE: ReadonlySet<string> = new Set()
const snapshots = new Map<string, { raw: string | null; marks: ReadonlySet<string> }>()
const marksKey = (profileId: string, mode: RaidMode) => `${MARKS_PREFIX}${profileId}:${mode}`

function readMarks(profileId: string, mode: RaidMode): ReadonlySet<string> {
  const key = marksKey(profileId, mode)
  let raw: string | null = null
  try { raw = localStorage.getItem(key) } catch { /* storage unavailable */ }
  const kept = snapshots.get(key)
  if (kept && kept.raw === raw) return kept.marks
  let marks = NONE
  try {
    const stored: unknown = raw ? JSON.parse(raw) : null
    if (Array.isArray(stored)) marks = new Set(stored.filter((id): id is string => typeof id === 'string'))
  } catch { /* a damaged value reads as nothing marked */ }
  snapshots.set(key, { raw, marks })
  return marks
}

/** «Отмечен в игре», or not. */
export function setQuestKeyMark(profileId: string, mode: RaidMode, itemId: string, on: boolean) {
  const marks = new Set(readMarks(profileId, mode))
  if (on) marks.add(itemId)
  else marks.delete(itemId)
  try {
    if (marks.size) localStorage.setItem(marksKey(profileId, mode), JSON.stringify([...marks]))
    else localStorage.removeItem(marksKey(profileId, mode))
  } catch { /* storage unavailable */ }
  window.dispatchEvent(new Event(MARKS_EVENT))
}

/** A reset of the mode: a new character, the game's favourites start empty. */
export function clearQuestKeyMarks(profileId: string, mode: RaidMode) {
  try { localStorage.removeItem(marksKey(profileId, mode)) } catch { /* storage unavailable */ }
  window.dispatchEvent(new Event(MARKS_EVENT))
}

/** «Удалить все данные». */
export function clearAllQuestKeyMarks() {
  try {
    const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
    for (const key of keys) if (key?.startsWith(MARKS_PREFIX)) localStorage.removeItem(key)
  } catch { /* storage unavailable */ }
  window.dispatchEvent(new Event(MARKS_EVENT))
}

function subscribe(listener: () => void) {
  const onStorage = (event: StorageEvent) => { if (event.key === null || event.key.startsWith(MARKS_PREFIX)) listener() }
  window.addEventListener(MARKS_EVENT, listener)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(MARKS_EVENT, listener)
    window.removeEventListener('storage', onStorage)
  }
}

export function useQuestKeyMarks(profileId: string, mode: RaidMode) {
  const read = useCallback(() => readMarks(profileId, mode), [profileId, mode])
  return useSyncExternalStore(subscribe, read, () => NONE)
}
