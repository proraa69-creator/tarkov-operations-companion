/**
 * «Найти» beside «Пометить» or «Заложить» (owner, 04.11.2026: «если человек нажимает "Цель выполнена", например, пометить
 * банкомат, то и найти первый банкомат на улице тоже закрывается. Так как он один»; «Именно которая рядом с этой задачей»).
 * The list's order does not tell: in «Финансовая пирамида» the mark comes first and its find third, among nine finds. The
 * points do: the find is the nearest one, at the same spot. Where a side has no point on the map, the find right before it
 * in the list, unless the words say another («первый» beside «второй»). An objective with points all over the map («один из
 * особых грузов») has no one find.
 */
import type { MapMarker, Quest, QuestObjective } from '../domain/types'
import { canonicalMapId } from '../data/mapIds'
import { questObjectiveDefs, type ObjectiveDef } from './objectiveProgress'

const PLACED = new Set(['mark', 'plantItem', 'plantQuestItem'])
/** Map units (about metres): a find at most this far from the mark stands at the same place. */
export const SAME_PLACE = 30
const ORDINAL = /перв|втор|трет|четв|пят|шест|first|second|third|fourth|fifth|sixth/i
/** Not a place on the map: «somewhere here» entries of a quest. */
const NOT_A_PLACE = new Set(['quest-fallback', 'quest-any-map', 'quest-info'])

type Point = Pick<MapMarker, 'position'>
const apart = (a: Point, b: Point) => Math.hypot(a.position[0] - b.position[0], a.position[1] - b.position[1])
const ordinal = (text: string) => ORDINAL.exec(text)?.[0].toLowerCase()

function pointsOf(markers: readonly MapMarker[], questId: string, objectiveId: string) {
  return markers.filter((marker) => marker.questId === questId && marker.objectiveId === objectiveId && !marker.approximate
    && !NOT_A_PLACE.has(marker.source ?? '') && marker.position?.length === 2)
}

/** The id of the find that goes with this mark or plant: closed with it, once there it is the same place. */
export function pairedFindObjective(quest: Pick<Quest, 'id' | 'objectiveDetails'>, objectiveId: string, markers: readonly MapMarker[]): string | undefined {
  const details = quest.objectiveDetails ?? []
  const at = details.findIndex((objective) => objective.id === objectiveId)
  const placed = details[at]
  if (!placed || !PLACED.has(placed.type)) return undefined
  const maps = new Set((placed.mapIds ?? []).map(canonicalMapId))
  const finds = details.filter((objective) => objective.type === 'visit' && (objective.mapIds ?? []).some((id) => maps.has(canonicalMapId(id))))
  const own = pointsOf(markers, quest.id, placed.id)
  if (own.some((point) => own.some((other) => apart(point, other) > SAME_PLACE))) return undefined
  const measured = own.length ? finds.flatMap((find: QuestObjective) => {
    const points = pointsOf(markers, quest.id, find.id)
    return points.length ? [{ find, distance: Math.min(...own.flatMap((point) => points.map((other) => apart(point, other)))) }] : []
  }) : []
  if (measured.length) {
    const nearest = measured.reduce((best, entry) => entry.distance < best.distance ? entry : best)
    return nearest.distance <= SAME_PLACE ? nearest.find.id : undefined
  }
  const word = ordinal(placed.description)
  if (word) return finds.find((find) => ordinal(find.description) === word)?.id
  const previous = details[at - 1]
  return previous && finds.includes(previous) && !ordinal(previous.description) ? previous.id : undefined
}

/** The find's definition, to tick it with the same value source as any other objective. */
export function pairedFindDef(quest: Quest, objectiveId: string, markers: readonly MapMarker[]): ObjectiveDef | undefined {
  const id = pairedFindObjective(quest, objectiveId, markers)
  return id ? questObjectiveDefs(quest).find((def) => def.id === id) : undefined
}
