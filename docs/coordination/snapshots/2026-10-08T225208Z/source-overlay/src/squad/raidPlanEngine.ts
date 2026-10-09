/**
 * Pre-raid planner for a squad or a group of friends (one mode): which map gives the group the most to do, and in
 * which order to walk the objectives on the chosen map. Objectives are identified by tarkov.dev objectiveId (map
 * markers carry it); a member's finished objectives (objective-level progress, when synced) are left out.
 */
import type { MapMarker, Quest } from '../domain/types'
import { orderRoute } from '../raidprep/route'
import { doneObjectives, questMapIdsForSquad, questMembers, type SquadMemberQuests } from './squadOverview'

/** A quest active for two or more members counts this much more per objective. */
export const SHARED_WEIGHT = 1.5

export interface MapRank { mapId: string; score: number; objectives: number; quests: number; sharedQuests: number }
export interface ObjectivePoint { objectiveId: string; position: [number, number]; markerId: string; title: string }
export interface PlanStep { questId: string; objectiveId: string; label: string; position: [number, number]; markerId: string; memberIds: string[] }
export interface PlanQuest { questId: string; memberIds: string[]; anyMap: boolean }
export interface MapPlan { mapId: string; steps: PlanStep[]; unplaced: PlanQuest[] }

function markersByQuest(markers: MapMarker[]) {
  const result = new Map<string, MapMarker[]>()
  for (const marker of markers) {
    if (!marker.questId || marker.approximate || !Number.isFinite(marker.position?.[0]) || !Number.isFinite(marker.position?.[1])) continue
    const list = result.get(marker.questId) ?? []
    list.push(marker)
    result.set(marker.questId, list)
  }
  return result
}

/** One point per objective of the quest on this map (the first marker of each objective). */
export function objectivePointsOnMap(questMarkers: MapMarker[] | undefined, mapId: string): ObjectivePoint[] {
  const points = new Map<string, ObjectivePoint>()
  for (const marker of questMarkers ?? []) {
    if (marker.mapId !== mapId) continue
    const objectiveId = marker.objectiveId ?? marker.id
    if (!points.has(objectiveId)) points.set(objectiveId, { objectiveId, position: marker.position, markerId: marker.id, title: marker.title })
  }
  return [...points.values()]
}

/** Maps ranked by the group's remaining objectives there; shared quests weigh SHARED_WEIGHT per objective. */
export function rankMaps(members: SquadMemberQuests[], quests: Quest[], markers: MapMarker[]): MapRank[] {
  const questsById = new Map(quests.map((quest) => [quest.id, quest]))
  const byQuest = markersByQuest(markers)
  const membersById = new Map(members.map((member) => [member.memberId, member]))
  const ranks = new Map<string, MapRank>()
  for (const [questId, memberIds] of questMembers(members)) {
    const quest = questsById.get(questId)
    if (!quest || quest.anyMap) continue
    const weight = memberIds.length >= 2 ? SHARED_WEIGHT : 1
    for (const mapId of questMapIdsForSquad(quest)) {
      const points = objectivePointsOnMap(byQuest.get(questId), mapId)
      let objectives = 0
      for (const memberId of memberIds) {
        const done = doneObjectives(membersById.get(memberId) ?? { objectives: {} }, questId)
        // A quest of this map without known points (kill, survive…) still counts as one thing to do there.
        objectives += points.length ? points.filter((point) => !done.has(point.objectiveId)).length : 1
      }
      if (!objectives) continue
      const rank = ranks.get(mapId) ?? { mapId, score: 0, objectives: 0, quests: 0, sharedQuests: 0 }
      rank.score += objectives * weight
      rank.objectives += objectives
      rank.quests += 1
      if (memberIds.length >= 2) rank.sharedQuests += 1
      ranks.set(mapId, rank)
    }
  }
  return [...ranks.values()].sort((a, b) => b.score - a.score || b.sharedQuests - a.sharedQuests || a.mapId.localeCompare(b.mapId))
}

/** Objective text for a marker's objective (structured objective first, then the quest's objective list); otherwise the marker title. */
function objectiveLabel(quest: Quest, point: ObjectivePoint) {
  const detail = quest.objectiveDetails?.find((entry) => entry.id === point.objectiveId)
  if (detail?.description) return detail.description
  const index = quest.objectiveIds?.indexOf(point.objectiveId) ?? -1
  if (index >= 0 && quest.objectiveIds?.length === quest.objectives.length && quest.objectives[index]) return quest.objectives[index]
  return point.title || quest.name
}

/**
 * The plan for one map: every remaining objective point of the group's active quests, with who needs it, ordered as
 * a short route (raidprep/route.ts) that starts at the point most members need. Quests without points on this map (and quests
 * for any map) are listed separately.
 */
export function planMapRoute(members: SquadMemberQuests[], quests: Quest[], markers: MapMarker[], mapId: string): MapPlan {
  const questsById = new Map(quests.map((quest) => [quest.id, quest]))
  const byQuest = markersByQuest(markers)
  const membersById = new Map(members.map((member) => [member.memberId, member]))
  const steps: PlanStep[] = []
  const unplaced: PlanQuest[] = []
  for (const [questId, memberIds] of questMembers(members)) {
    const quest = questsById.get(questId)
    if (!quest) continue
    if (quest.anyMap) { unplaced.push({ questId, memberIds, anyMap: true }); continue }
    if (!questMapIdsForSquad(quest).includes(mapId)) continue
    const points = objectivePointsOnMap(byQuest.get(questId), mapId)
    if (!points.length) { unplaced.push({ questId, memberIds, anyMap: false }); continue }
    for (const point of points) {
      const who = memberIds.filter((memberId) => !doneObjectives(membersById.get(memberId) ?? { objectives: {} }, questId).has(point.objectiveId))
      if (who.length) steps.push({ questId, objectiveId: point.objectiveId, label: objectiveLabel(quest, point), position: point.position, markerId: point.markerId, memberIds: who })
    }
  }
  let start = 0
  steps.forEach((step, index) => { if (step.memberIds.length > steps[start].memberIds.length) start = index })
  unplaced.sort((a, b) => Number(a.anyMap) - Number(b.anyMap) || b.memberIds.length - a.memberIds.length || a.questId.localeCompare(b.questId))
  return { mapId, steps: orderSteps(steps, start), unplaced }
}

/**
 * Route order of the steps: the start step first, the rest ordered from it by the raid briefing's route optimiser
 * (raidprep/route.ts: nearest neighbour plus 2-opt), so the squad plan and the solo route walk maps the same way.
 */
function orderSteps(steps: PlanStep[], start: number): PlanStep[] {
  const first = steps[start]
  if (!first) return []
  const rest = steps.filter((_, index) => index !== start)
  const ordered = orderRoute(first.position, rest.map((step, index) => ({ id: String(index), group: String(index), position: step.position, title: step.label })))
  return [first, ...ordered.map((target) => rest[Number(target.id)])]
}
