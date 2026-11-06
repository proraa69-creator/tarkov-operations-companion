import type { Item, ModeProgress, Quest, RaidMode, TaskProgressStatus } from '../domain/types'
import { STORY_GUIDE_DATA } from '../data/storyChapterGuideData'
import { storyGuideChapterId } from '../data/storyChapterGuide'
import type { DeferredQuest, DeferredQuests } from '../progression/deferredQuests'
import { isLiveGameQuest, questFaction } from '../progression/questBasics'
import type { TaskAvailability } from '../progression/requirementEngine'
import { usedQuestKeys, type ObjectiveMarks } from '../raidprep/objectives'

/**
 * «Ключи для квестов» (a player's proposal №52, owner 05.11.2026: «Сделай отдельный раздел ключей для квестов. Туда добавь все ключи,
 * которые требуются для всех квестов в игре»): every key a quest of this mode asks to bring, with all its quests. A quest done, or
 * with the objectives the key opens ticked (owner, 06.11.2026), leaves the key's list; the key stays until none is left, then moves to
 * «Больше не нужны», from where it can be taken out of the game's favourites. A quest the player does not want to do is put aside
 * (progression/deferredQuests.ts): it no longer holds its key.
 */
export interface QuestKeyUse {
  quest: Quest
  status?: TaskProgressStatus
  /** Where the quest needs this key. */
  mapIds: string[]
  /** Other keys that do the same for this objective: any one of them is enough. */
  alternatives: string[]
  entry?: DeferredQuest
  /** The objectives this key opens are ticked: the quest, still open, needs it no more. */
  used?: boolean
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
export function questKeyRows(quests: readonly Quest[], items: ReadonlyMap<string, Item>, progress: Pick<ModeProgress, 'faction'> & ObjectiveMarks,
  availability: ReadonlyMap<string, TaskAvailability>, deferred: DeferredQuests): QuestKeyRow[] {
  const uses = new Map<string, QuestKeyUse[]>()
  for (const quest of quests) {
    const story = quest.kind === 'story'
    if (!story && !isLiveGameQuest(quest)) continue
    const status = availability.get(quest.id)?.status ?? progress.taskProgress[quest.id]?.status
    if (status === 'failed') continue
    const faction = questFaction(quest.faction)
    if (faction && progress.faction !== 'unknown' && faction !== progress.faction) continue
    const used = usedQuestKeys(quest, progress)
    for (const need of story ? storyQuestKeys(quest, items) : traderQuestKeys(quest, items)) {
      if (!items.has(need.itemId)) continue
      const entry = deferred.get(quest.id)
      const list = uses.get(need.itemId) ?? []
      list.push({ quest, mapIds: need.mapIds, alternatives: need.alternatives, ...(status ? { status } : {}), ...(entry ? { entry } : {}), ...(used.has(need.itemId) ? { used: true } : {}) })
      uses.set(need.itemId, list)
    }
  }
  const rows = [...uses].map(([itemId, list]): QuestKeyRow => {
    const isDone = (use: QuestKeyUse) => use.status === 'completed' || Boolean(use.used)
    const done = list.filter(isDone).sort(byName)
    const open = list.filter((use) => !isDone(use))
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
