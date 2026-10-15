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
