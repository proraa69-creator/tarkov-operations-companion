import type { GameMap, MapMarker, ModeProgress, Quest } from '../domain/types'
import { currentStoryStageIndex, isCurrentTrackedQuest, isStoryQuest } from '../progression/requirementEngine'
import { questAppliesToMap } from '../progression/questLocation'
import { mapObjectivesClosed, markerObjectiveDone } from '../progression/mapObjectives'
import { placeLocation, toWorld, type WorldPlacement, type WorldPoint } from './worldMap'

export interface WorldQuestPoint {
  marker: MapMarker
  quest: Quest
  mapId: string
  world: WorldPoint
  /** The quest on its location's map, on this point's objective (as «Обзор» opens it). */
  href: string
}

export interface WorldQuestInput {
  quests: readonly Quest[]
  markers: readonly MapMarker[]
  maps: readonly GameMap[]
  progress: ModeProgress
  /** «Сделал в этом рейде» of this profile and mode: their points leave the map, as on «Карты». */
  checked: { has: (questId: string) => boolean }
  /** «Отложенные квесты»: their points leave the map, as on «Карты». */
  deferred: { has: (questId: string) => boolean }
  placements?: ReadonlyMap<string, WorldPlacement>
}

/** Points the map draws for a quest: not the «somewhere on the map» stand-ins. */
const plotted = (marker: MapMarker) => marker.source !== 'quest-fallback' && marker.source !== 'quest-any-map' && marker.source !== 'quest-info'
const questPoint = (marker: MapMarker) => marker.type === 'quest' || marker.layerId === 'quest.zone' || marker.layerId === 'quest.item'

export function worldPlacements(maps: readonly GameMap[]): Map<string, WorldPlacement> {
  const placements = new Map<string, WorldPlacement>()
  for (const map of maps) {
    const placement = placeLocation(map)
    if (placement) placements.set(map.id, placement)
  }
  return placements
}

/** The quest's link onto its location's map, focused on the objective (DashboardPage questOnMap). */
export function questMapHref(quest: Quest, mapId: string, progress: ModeProgress, objectiveId?: string) {
  const stage = isStoryQuest(quest) ? `&stage=${currentStoryStageIndex(quest, progress)}` : ''
  const objective = objectiveId ? `&objective=${encodeURIComponent(objectiveId)}` : ''
  return `/maps/${mapId}?quest=${encodeURIComponent(quest.id)}${stage}${objective}`
}

/**
 * The current quests' points of every location, as «Карты» shows them on each location's map: the tracked quests of this
 * mode, not checked for this raid nor put aside, their current story stage, objectives not done, on the canvas through
 * their location's placement.
 */
export function worldQuestPoints({ quests, markers, maps, progress, checked, deferred, placements = worldPlacements(maps) }: WorldQuestInput): WorldQuestPoint[] {
  const mapsById = new Map(maps.map((map) => [map.id, map]))
  const current = new Map<string, { quest: Quest; stage: number }>()
  for (const quest of quests) {
    if (!isCurrentTrackedQuest(quest, progress) || checked.has(quest.id) || deferred.has(quest.id)) continue
    current.set(quest.id, { quest, stage: currentStoryStageIndex(quest, progress) })
  }
  const doneOn = new Map<string, boolean>()
  const points: WorldQuestPoint[] = []
  for (const marker of markers) {
    const entry = marker.questId ? current.get(marker.questId) : undefined
    if (!entry || !questPoint(marker) || !plotted(marker)) continue
    const { quest, stage } = entry
    if (marker.stageIndex != null && marker.stageIndex !== stage) continue
    if (markerObjectiveDone(marker, progress) || !questAppliesToMap(quest, marker.mapId, stage)) continue
    const doneKey = `${quest.id}|${marker.mapId}`
    if (!doneOn.has(doneKey)) doneOn.set(doneKey, mapObjectivesClosed(quest, marker.mapId, progress))
    if (doneOn.get(doneKey)) continue
    const map = mapsById.get(marker.mapId)
    const placement = placements.get(marker.mapId)
    if (!map || !placement) continue
    points.push({ marker, quest, mapId: marker.mapId, world: toWorld(placement, map, marker.position), href: questMapHref(quest, marker.mapId, progress, marker.objectiveId) })
  }
  return points
}
