/**
 * «Условия квестов» on the Overview (owner, 15.10.2026: «при выборе карты у нас будет информация о квестах в этом блоке,
 * квесты которые выполняются на нескольких картах или конкретной карты, например квест работа для патриота… указываются
 * условия убийства из оружия либо если требуется маска или конкретная одежда»). It replaces the «Прогресс» counter.
 *
 * Which quests: those with a kill objective that asks for a weapon, weapon parts or gear (src/data/objectiveConditions.ts)
 * and can be done on the raid plan's map — an objective of that map, of several maps among them, or of any map. The
 * player's current quests of the mode first; only when there are none, the quests available now. Never a completed,
 * failed or locked one. Statuses come from the quest-state engine's read side (src/quests/questReadModel.ts).
 */
import type { Quest, QuestObjective } from '../domain/types'
import { hasGearConditions } from '../data/objectiveConditions'
import { isLiveGameQuest } from '../progression/questBasics'
import type { TaskAvailability } from '../progression/requirementEngine'

export interface ConditionQuest {
  quest: Quest
  /** The quest's objectives with gear conditions that can be done on the map, in the quest's order. */
  objectives: QuestObjective[]
}

export interface MapConditionQuests {
  /** `active`: the player's current quests; `available`: none is current, these can be taken now; `none`: nothing fits. */
  tier: 'active' | 'available' | 'none'
  quests: ConditionQuest[]
}

/** The objective can be done on the map: it names that map among its maps, or names none (any map). */
export function objectiveOnMap(objective: Pick<QuestObjective, 'mapIds'>, mapId: string) {
  return !objective.mapIds?.length || objective.mapIds.includes(mapId)
}

/** The quest's objectives with gear conditions (any map). */
export function gearObjectives(quest: Pick<Quest, 'objectiveDetails'>): QuestObjective[] {
  return (quest.objectiveDetails ?? []).filter((objective) => hasGearConditions(objective.conditions))
}

/** The quest's objectives with gear conditions that can be done on the map. */
export function gearObjectivesOnMap(quest: Pick<Quest, 'objectiveDetails'>, mapId: string): QuestObjective[] {
  return gearObjectives(quest).filter((objective) => objectiveOnMap(objective, mapId))
}

/**
 * The quest is one «Сбор на рейд» can show on the map: a weapon, weapon parts, gear to wear or not to wear for an
 * objective of that map (or of any map). Such quests get their own section «С условиями на снаряжение» at the bottom of
 * «Текущие задания» (Overview) and «Квесты на карте» (Maps), owner 15.10.2026: «что бы не путаться в квестах».
 */
export function hasGearOnMap(quest: Pick<Quest, 'objectiveDetails'>, mapId: string): boolean {
  return gearObjectivesOnMap(quest, mapId).length > 0
}

/** One line of «Требования рейда» from a gear condition (src/shared/raidNeeds.ts reads it). */
export interface GearRaidRequirement {
  itemId: string
  count: number
  purpose: 'bring' | 'wear'
  questName: string
  /** Items of one weapon list or one set of options share it, so the panel makes them one «любой из» line. */
  objectiveId?: string
  alternatives?: number
}

/**
 * What a gear condition asks to take into the raid, for «Требования рейда»: the weapon (any one of the list: one line
 * with the others in its card), the parts and the gear to wear (one option: each item; several: one «любой из» line).
 * Gear not to wear is nothing to take. An item the quest already lists to bring (a pinned correction) is not repeated.
 */
export function gearRaidRequirements(quest: Pick<Quest, 'name' | 'objectiveDetails' | 'raidRequirements'>, mapId: string): GearRaidRequirement[] {
  const already = new Set((quest.raidRequirements ?? []).filter((requirement) => requirement.purpose === 'bring').map((requirement) => requirement.itemId))
  const lines: GearRaidRequirement[] = []
  const seen = new Set<string>()
  const add = (line: GearRaidRequirement) => {
    if (already.has(line.itemId) || seen.has(`${line.purpose}:${line.itemId}`)) return
    seen.add(`${line.purpose}:${line.itemId}`)
    lines.push(line)
  }
  const anyOf = (ids: string[], purpose: GearRaidRequirement['purpose'], group: string) => {
    const distinct = [...new Set(ids)].filter((id) => !already.has(id))
    for (const itemId of distinct) add({ itemId, count: 1, purpose, questName: quest.name, ...(distinct.length > 1 ? { objectiveId: group, alternatives: distinct.length } : {}) })
  }
  for (const objective of gearObjectivesOnMap(quest, mapId)) {
    const conditions = objective.conditions!
    if (conditions.weapons?.length) anyOf(conditions.weapons.map((ref) => ref.id), 'bring', `${objective.id}#weapon`)
    for (const [field, purpose] of [['mods', 'bring'], ['wearing', 'wear']] as const) {
      const options = conditions[field] ?? []
      if (options.length === 1) for (const ref of options[0]) add({ itemId: ref.id, count: 1, purpose, questName: quest.name })
      else if (options.length > 1) anyOf(options.flat().map((ref) => ref.id), purpose, `${objective.id}#${field}`)
    }
  }
  return lines
}

export function conditionQuestsForMap(quests: readonly Quest[], availability: Map<string, TaskAvailability>, mapId: string): MapConditionQuests {
  const active: ConditionQuest[] = []
  const available: ConditionQuest[] = []
  for (const quest of quests) {
    if (!isLiveGameQuest(quest)) continue
    const status = availability.get(quest.id)?.status
    if (status !== 'active' && status !== 'available') continue
    const objectives = gearObjectivesOnMap(quest, mapId)
    if (!objectives.length) continue
    ;(status === 'active' ? active : available).push({ quest, objectives })
  }
  const byLevel = (a: ConditionQuest, b: ConditionQuest) => a.quest.level - b.quest.level || a.quest.name.localeCompare(b.quest.name)
  if (active.length) return { tier: 'active', quests: active.sort(byLevel) }
  if (available.length) return { tier: 'available', quests: available.sort(byLevel) }
  return { tier: 'none', quests: [] }
}

/** One value per app start: the pick is random, yet the same for the same map and quests until the app starts again. */
const SESSION_SEED = Math.random().toString(36).slice(2)

/** FNV-1a: a small, even hash of a string. */
function hash(value: string) {
  let result = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index)
    result = Math.imul(result, 0x01000193)
  }
  return result >>> 0
}

/**
 * The quest shown in the card: one of `ids` picked at random, stable while the key (mode and map) and the quest set stay
 * the same — no new pick on a re-render or a price refresh; another map or the next app start picks again.
 */
export function stablePick(ids: readonly string[], key: string, seed: string = SESSION_SEED): string | undefined {
  if (!ids.length) return undefined
  const sorted = [...ids].sort()
  return sorted[hash(`${seed}|${key}|${sorted.join(',')}`) % sorted.length]
}
