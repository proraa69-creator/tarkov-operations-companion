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
/** The objectives that get an item in a raid: one later on another map that deals with that item waits for them. */
const FINDS = new Set(['findItem', 'findQuestItem'])

function objectivesOnMap(quest: Quest, mapId: string): QuestObjective[] {
  const map = canonicalMapId(mapId)
  const details = quest.objectiveDetails ?? []
  const here = details.filter((objective) => (objective.mapIds ?? []).some((id) => canonicalMapId(id) === map))
  if (here.length) return here
  // «Любая карта»: the in-raid objectives that name no map count on every map.
  return details.filter((objective) => !objective.mapIds?.length && !OFF_MAP_TYPES.has(objective.type))
}

/**
 * Every objective of the quest on this map is done (false when the quest has no objectives there or is a story chapter). An
 * optional one holds nothing open («Финансовая пирамида»: one mark and nine optional finds), unless all of them are optional.
 */
export function mapObjectivesDone(quest: Quest, mapId: string, progress: ModeProgress): boolean {
  if (quest.kind === 'story' || quest.stages?.length) return false
  const objectives = objectivesOnMap(quest, mapId).filter((objective) => objective.id)
  const required = objectives.filter((objective) => !objective.optional)
  const needed = required.length ? required : objectives
  return needed.length > 0 && needed.every((objective) => objectiveDone(progress, quest.id, objective.id))
}

/**
 * The quest's objectives on this map wait for one before them on another map (report 165, owner 15.11.2026: «на таможне у него
 * надо забрать предмет, а потом в следующем рейде заложить его в лесу… пока он не выполнил цель на таможне и не поставил
 * галочку, у него не появляется вторая цель на лесу»): an objective here waits while an earlier objective not done, on another
 * map, deals with one of its items (found there, planted or handed over here). Objectives that share no item stay side by side,
 * as the game opens them («Потрошитель»: kills on Factory and on Lighthouse, either first). Only an objective that finds the
 * item holds the others back: «Что-то мне это напоминает...» plants a WI-FI camera on 8 maps, every one of them open at once,
 * and the plants on Streets held the other 7 maps' back, so the quest left their maps and their raid requirements (a player,
 * 19.11.2026: «не отображает в подготовке к рейду что нужно взять вифи камеры… и так же на карте его нет»). Optional ones hold
 * nothing; story chapters go by their stages instead. False when the quest has nothing to do here.
 */
export function mapObjectivesWaiting(quest: Quest, mapId: string, progress: ModeProgress): boolean {
  if (quest.kind === 'story' || quest.stages?.length) return false
  const map = canonicalMapId(mapId)
  const onThisMap = (objective: QuestObjective) => (objective.mapIds ?? []).some((id) => canonicalMapId(id) === map)
  const open = (quest.objectiveDetails ?? []).filter((objective) => objective.id && !objective.optional && !objectiveDone(progress, quest.id, objective.id))
  const here = open.filter(onThisMap)
  return here.length > 0 && here.every((objective) => {
    const items = new Set(objective.itemIds ?? [])
    return open.slice(0, open.indexOf(objective)).some((earlier) => FINDS.has(earlier.type) && Boolean(earlier.mapIds?.length) && !onThisMap(earlier)
      && (earlier.itemIds ?? []).some((id) => items.has(id)))
  })
}

/** The quest has nothing to do on this map now: its objectives here are done, or wait for one on another map first. */
export function mapObjectivesClosed(quest: Quest, mapId: string, progress: ModeProgress): boolean {
  return mapObjectivesDone(quest, mapId, progress) || mapObjectivesWaiting(quest, mapId, progress)
}

/** A quest point whose objective is done: hidden on the map. */
export function markerObjectiveDone(marker: Pick<MapMarker, 'questId' | 'objectiveId'>, progress: ModeProgress): boolean {
  return Boolean(marker.questId && marker.objectiveId && objectiveDone(progress, marker.questId, marker.objectiveId))
}
