/**
 * Objectives ticked by hand (owner, 17.10.2026: «нажимаешь на галочку — отмечается, что это условие выполнено»):
 * a done objective's points leave the map, and a quest whose objectives on one map are all done leaves that map's
 * «Текущие задания» on the Overview. The quest itself stays current until the game (logs) completes it, so its
 * objectives on other maps keep showing there.
 */
import type { MapMarker, ModeProgress, Quest, QuestObjective } from '../domain/types'
import { canonicalMapId } from '../data/mapIds'
import { objectiveDone } from '../raidprep/objectives'

/** Done at the trader or in the menu: they never make a quest belong to a map. */
const OFF_MAP_TYPES = new Set(['giveItem', 'giveQuestItem', 'traderLevel', 'traderStanding', 'skill', 'buildWeapon', 'taskStatus', 'sellItem', 'experience'])

function objectivesOnMap(quest: Quest, mapId: string): QuestObjective[] {
  const map = canonicalMapId(mapId)
  const details = quest.objectiveDetails ?? []
  const here = details.filter((objective) => (objective.mapIds ?? []).some((id) => canonicalMapId(id) === map))
  if (here.length) return here
  // «Любая карта»: the in-raid objectives that name no map count on every map.
  return details.filter((objective) => !objective.mapIds?.length && !OFF_MAP_TYPES.has(objective.type))
}

/** Every objective of the quest on this map is done (false when the quest has no objectives there or is a story chapter). */
export function mapObjectivesDone(quest: Quest, mapId: string, progress: ModeProgress): boolean {
  if (quest.kind === 'story' || quest.stages?.length) return false
  const objectives = objectivesOnMap(quest, mapId).filter((objective) => objective.id)
  return objectives.length > 0 && objectives.every((objective) => objectiveDone(progress, quest.id, objective.id))
}

/** A quest point whose objective is done: hidden on the map. */
export function markerObjectiveDone(marker: Pick<MapMarker, 'questId' | 'objectiveId'>, progress: ModeProgress): boolean {
  return Boolean(marker.questId && marker.objectiveId && objectiveDone(progress, marker.questId, marker.objectiveId))
}
