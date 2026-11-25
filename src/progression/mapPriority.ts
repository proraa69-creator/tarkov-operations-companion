/**
 * How many current quests a map has (Overview «Приоритет карт», «Текущие задания» of the chosen map, «Брифинг рейда»).
 *
 * Reports 165 and 230 (a player, 25.11.2026: «у меня всего 1 квест на маяке, но он показывает что у меня там якобы 13… Надо
 * переработать систему выбора приоритета карт и сделать фильтр для выбора карт с устранениями или с обычными»). One quest is
 * one on a map, and only while it has something left to do there: an objective on that map not ticked done and not waiting for
 * one on another map. A map the quest lists without an objective on it (the map a transit leads to, «Новые маршруты» → Streets)
 * or a quest whose objectives there are all done or only handed over at a trader does not count. A quest whose work left on the
 * map is kills only is an «Устранения» one, any other a «Задания» one: the strip counts either or both.
 */
import type { ModeProgress, Quest } from '../domain/types'
import { canonicalMapId } from '../data/mapIds'
import { openObjectivesOnMap } from './mapObjectives'
import { questAppliesToMap } from './questLocation'
import { currentStoryStageIndex } from './requirementEngine'

export type MapWorkKind = 'tasks' | 'kills'
export type MapWorkFilter = 'all' | MapWorkKind
export interface MapWorkCounts { tasks: number; kills: number }

/** What the quest has left to do on this map now: kills only, other work, or nothing (null). */
export function questWorkOnMap(quest: Quest, mapId: string, progress: ModeProgress): MapWorkKind | null {
  // A story chapter goes by its current stage's maps.
  if (quest.kind === 'story' || quest.stages?.length) return questAppliesToMap(quest, mapId, currentStoryStageIndex(quest, progress)) ? 'tasks' : null
  // «Любая карта» quests have their own place under the list, on no map's count.
  if (quest.anyMap) return null
  const details = quest.objectiveDetails ?? []
  if (!details.length) return questAppliesToMap(quest, mapId) ? 'tasks' : null
  const map = canonicalMapId(mapId)
  const named = details.some((objective) => (objective.mapIds ?? []).some((id) => canonicalMapId(id) === map))
  if (!named && !questAppliesToMap(quest, mapId)) return null
  const open = openObjectivesOnMap(quest, mapId, progress)
  if (!open.length) return null
  return open.every((objective) => objective.type === 'shoot') ? 'kills' : 'tasks'
}

/** The quests with work left on this map, each once, by kind. */
export function mapWorkCounts(quests: readonly Quest[], mapId: string, progress: ModeProgress): MapWorkCounts {
  const counts: MapWorkCounts = { tasks: 0, kills: 0 }
  const seen = new Set<string>()
  for (const quest of quests) {
    if (seen.has(quest.id)) continue
    const kind = questWorkOnMap(quest, mapId, progress)
    if (!kind) continue
    seen.add(quest.id)
    counts[kind] += 1
  }
  return counts
}

export function filteredCount(counts: MapWorkCounts, filter: MapWorkFilter) {
  return filter === 'all' ? counts.tasks + counts.kills : counts[filter]
}
