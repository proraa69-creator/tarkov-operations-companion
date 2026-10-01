import type { Item, MapMarker, ModeProgress, Quest } from '../domain/types'
import { currentStoryStageIndex, isCurrentTrackedQuest, isStoryQuest } from '../progression/requirementEngine'
import { questAppliesToMap } from '../progression/questLocation'
import { objectiveDone } from './objectives'

export interface BriefingObjective {
  id: string
  /** tarkov.dev objective type (visit, mark, plantItem, shoot, giveItem…); empty when unknown. */
  type: string
  description: string
  count?: number
  optional?: boolean
}

export interface BriefingQuest {
  quest: Quest
  /** What to do on this map (descriptions of `points` + `checklist`). */
  objectives: string[]
  /** Objectives with zones on this map: they are map points (and route steps). */
  points: BriefingObjective[]
  /** Objectives without a map point: kill, hand over, skill, … — synced by quest state or ticked by the player. */
  checklist: BriefingObjective[]
  anyMap: boolean
}

export interface BriefingTraderGroup {
  trader: string
  quests: BriefingQuest[]
}

export interface BriefingItem {
  itemId: string
  item?: Item
  count: number
  foundInRaid: boolean
  questNames: string[]
}

export interface RaidBriefing {
  mapId: string
  groups: BriefingTraderGroup[]
  questCount: number
  /** Items the quests want found on this map (find / hand over objectives tied to the map). */
  find: BriefingItem[]
  /** Items to take into the raid: plant, mark, bring. */
  bring: BriefingItem[]
  /** Keys the quests need on this map (tarkov.dev `neededKeys` and locked quest points). */
  keys: BriefingItem[]
}

export interface BriefingInput {
  mapId: string
  quests: Quest[]
  items: Item[]
  markers: MapMarker[]
  progress: ModeProgress
}

/** The current (accepted) quests of this mode that have something to do on the map, grouped by trader. */
export function buildRaidBriefing({ mapId, quests, items, markers, progress }: BriefingInput): RaidBriefing {
  const byId = new Map(items.map((item) => [item.id, item]))
  const current = quests.filter((quest) => isCurrentTrackedQuest(quest, progress))
    .filter((quest) => questAppliesToMap(quest, mapId, currentStoryStageIndex(quest, progress)))

  const entries: BriefingQuest[] = current.map((quest) => {
    const objectives = objectivesOnMap(quest, mapId, progress)
    const points = objectives.filter((objective) => objective.zoneBound)
    const checklist = objectives.filter((objective) => !objective.zoneBound)
    const strip = (objective: BriefingObjective): BriefingObjective => ({ id: objective.id, type: objective.type, description: objective.description, count: objective.count, optional: objective.optional })
    return { quest, objectives: objectives.map((objective) => objective.description), points: points.map(strip), checklist: checklist.map(strip), anyMap: Boolean(quest.anyMap) }
  })
  const groups = new Map<string, BriefingQuest[]>()
  for (const entry of entries) {
    const list = groups.get(entry.quest.trader) ?? []
    list.push(entry)
    groups.set(entry.quest.trader, list)
  }
  const groupRows = [...groups.entries()].map(([trader, list]) => ({
    trader,
    // Quests of this map first, «any map» ones after; then by level.
    quests: list.sort((a, b) => Number(a.anyMap) - Number(b.anyMap) || a.quest.level - b.quest.level || a.quest.name.localeCompare(b.quest.name, 'ru')),
  })).sort((a, b) => b.quests.filter((entry) => !entry.anyMap).length - a.quests.filter((entry) => !entry.anyMap).length || a.trader.localeCompare(b.trader, 'ru'))

  const find = new ItemTally(byId)
  const bring = new ItemTally(byId)
  const keys = new ItemTally(byId)
  for (const quest of current) {
    if (isStoryQuest(quest)) continue
    for (const requirement of quest.raidRequirements ?? []) {
      const here = requirement.mapIds.includes(mapId)
      const anywhere = !requirement.mapIds.length
      if ((requirement.alternatives ?? 1) > 1 && requirement.purpose !== 'key') continue
      if (requirement.purpose === 'find' && here) find.add(requirement.itemId, requirement.count, Boolean(requirement.foundInRaid), quest.name)
      else if (['place', 'mark', 'bring'].includes(requirement.purpose) && (here || anywhere)) bring.add(requirement.itemId, requirement.count, false, quest.name)
      else if (requirement.purpose === 'key' && (here || (anywhere && !quest.anyMap))) keys.add(requirement.itemId, 1, false, quest.name, true)
    }
  }
  const currentIds = new Map(current.map((quest) => [quest.id, quest]))
  for (const marker of markers) {
    if (marker.mapId !== mapId || !marker.lock?.keyId || !marker.questId) continue
    const quest = currentIds.get(marker.questId)
    if (quest) keys.add(marker.lock.keyId, 1, false, quest.name, true)
  }

  return { mapId, groups: groupRows, questCount: current.length, find: find.rows(), bring: bring.rows(), keys: keys.rows() }
}

function objectivesOnMap(quest: Quest, mapId: string, progress: ModeProgress): Array<BriefingObjective & { zoneBound?: boolean }> {
  if (isStoryQuest(quest) && quest.stages?.length) {
    const stage = quest.stages[Math.min(currentStoryStageIndex(quest, progress), quest.stages.length - 1)]
    return stage ? [{ id: stage.id, type: '', description: stage.title, zoneBound: Boolean(stage.points?.some((point) => point.mapId === mapId)) }] : []
  }
  if (quest.objectiveDetails?.length) {
    const onMap = quest.objectiveDetails.filter((objective) => (!objective.mapIds?.length || objective.mapIds.includes(mapId)) && !objectiveDone(progress, quest.id, objective.id))
    if (onMap.length) {
      return onMap.map((objective) => ({
        id: objective.id,
        type: objective.type,
        description: objective.optional ? `${objective.description} (необязательно)` : objective.description,
        count: objective.count && objective.count > 1 ? objective.count : undefined,
        optional: objective.optional,
        // A zone of an objective on another map is not a point here.
        zoneBound: Boolean(objective.zoneBound && (!objective.mapIds?.length || objective.mapIds.includes(mapId))),
      }))
    }
  }
  return (quest.objectives.length ? quest.objectives : [quest.description]).map((description, index) => ({ id: `${quest.id}:${index}`, type: '', description }))
}

class ItemTally {
  private entries = new Map<string, BriefingItem>()
  constructor(private readonly items: Map<string, Item>) {}
  add(itemId: string, count: number, foundInRaid: boolean, questName: string, once = false) {
    if (!itemId) return
    const entry = this.entries.get(itemId) ?? { itemId, item: this.items.get(itemId), count: 0, foundInRaid: false, questNames: [] }
    // A key opens the door for every quest at once: one is enough.
    entry.count = once ? 1 : entry.count + Math.max(1, Math.round(count) || 1)
    entry.foundInRaid ||= foundInRaid
    if (!entry.questNames.includes(questName)) entry.questNames.push(questName)
    this.entries.set(itemId, entry)
  }
  rows() {
    return [...this.entries.values()].sort((a, b) => (a.item?.name ?? a.itemId).localeCompare(b.item?.name ?? b.itemId, 'ru'))
  }
}
