/**
 * The normalized `quest_map_points` view (docs/quest-sync-spec.md): one row per map point of a quest objective,
 * in game coordinates, keyed by task id + objective id. Route planning, the raid briefing and squad features read
 * quest locations through `questMapPoints()` only — never from the map markers (those are projected for Leaflet).
 *
 * Rows come from the catalog's objective zones (tarkov.dev `zones`) and quest-item spawn points, with the user's
 * map-point corrections from the override layer laid over them.
 */
import { markerFloor } from '../data/mapProjection'
import type { GameMap, Quest, RaidMode } from '../domain/types'
import type { QuestOverride } from './questOverrides'

export interface QuestMapPoint {
  pointId: string
  taskId: string
  objectiveId: string
  mapId: string
  /** Game coordinates (x east-west, y height, z north-south), as tarkov.dev gives them. */
  position: { x: number; y?: number; z: number }
  outline?: Array<{ x: number; y?: number; z: number }>
  top?: number
  bottom?: number
  /** Floor / level name of the map layer the point falls on, when the map has layers. */
  floorHint?: string
  /** Objective text (display only). */
  label: string
  /** 'zone' = the objective is done inside this area; 'item' = one possible spawn of the quest item. */
  kind: 'zone' | 'item'
  /** 0…1. A zone 0.9; one of N item spawns 1/N; the user's own point 1. */
  confidence: number
  source: 'tarkov.dev' | 'user'
}

export interface QuestMapPointOptions {
  /** Only these tasks (e.g. the current ones). */
  taskIds?: Iterable<string>
  mapId?: string
  /** Maps with layers, for `floorHint`. */
  maps?: GameMap[]
  /** User corrections from the override layer (`useQuestOverrides`). */
  overrides?: QuestOverride[]
  /** Overrides of other modes are ignored. */
  mode?: RaidMode
}

const ZONE_CONFIDENCE = 0.9

/** Quest map points for other features (route, briefing, squad). */
export function questMapPoints(quests: Quest[], options: QuestMapPointOptions = {}): QuestMapPoint[] {
  const wanted = options.taskIds ? new Set(options.taskIds) : undefined
  const maps = new Map((options.maps ?? []).map((map) => [map.id, map]))
  const overrides = (options.overrides ?? []).filter((override) => !options.mode || override.mode === 'all' || override.mode === options.mode)
  const hidden = new Set(overrides.filter((override) => (override.kind === 'hide-point' || override.kind === 'map-point') && override.pointId).map((override) => override.pointId!))
  const points: QuestMapPoint[] = []

  for (const quest of quests) {
    if (wanted && !wanted.has(quest.id)) continue
    for (const objective of quest.objectiveDetails ?? []) {
      const label = objective.description || quest.name
      ;(objective.zones ?? []).forEach((zone, index) => {
        const pointId = `${quest.id}:${objective.id}:${zone.id ?? `z${index}`}`
        if (hidden.has(pointId)) return
        points.push({
          pointId,
          taskId: quest.id,
          objectiveId: objective.id,
          mapId: zone.mapId,
          position: { ...zone.position },
          ...(zone.outline ? { outline: zone.outline.map((entry) => ({ ...entry })) } : {}),
          ...(zone.top !== undefined ? { top: zone.top } : {}),
          ...(zone.bottom !== undefined ? { bottom: zone.bottom } : {}),
          ...floor(maps.get(zone.mapId), zone.position, zone.top, zone.bottom),
          label,
          kind: 'zone',
          confidence: ZONE_CONFIDENCE,
          source: 'tarkov.dev',
        })
      })
      const spots = objective.itemSpots ?? []
      const perMap = new Map<string, number>()
      for (const spot of spots) perMap.set(spot.mapId, (perMap.get(spot.mapId) ?? 0) + 1)
      spots.forEach((spot, index) => {
        const pointId = `${quest.id}:${objective.id}:i${index}`
        if (hidden.has(pointId)) return
        points.push({
          pointId,
          taskId: quest.id,
          objectiveId: objective.id,
          mapId: spot.mapId,
          position: spot.y === undefined ? { x: spot.x, z: spot.z } : { x: spot.x, y: spot.y, z: spot.z },
          ...floor(maps.get(spot.mapId), spot),
          label,
          kind: 'item',
          confidence: round(1 / (perMap.get(spot.mapId) ?? 1)),
          source: 'tarkov.dev',
        })
      })
    }
  }

  for (const override of overrides) {
    if (override.kind !== 'map-point' || !override.point || (wanted && !wanted.has(override.taskId))) continue
    const quest = quests.find((entry) => entry.id === override.taskId)
    const objective = quest?.objectiveDetails?.find((entry) => entry.id === override.objectiveId)
    const { mapId, x, y, z } = override.point
    points.push({
      pointId: `user:${override.id}`,
      taskId: override.taskId,
      objectiveId: override.objectiveId ?? '',
      mapId,
      position: y === undefined ? { x, z } : { x, y, z },
      ...(override.point.floorHint ? { floorHint: override.point.floorHint } : floor(maps.get(mapId), override.point)),
      label: override.point.label || objective?.description || quest?.name || override.taskId,
      kind: 'zone',
      confidence: 1,
      source: 'user',
    })
  }

  return options.mapId ? points.filter((point) => point.mapId === options.mapId) : points
}

function floor(map: GameMap | undefined, position: { x: number; y?: number; z: number }, top?: number, bottom?: number): { floorHint?: string } {
  if (!map?.layers?.length) return {}
  const range: [number, number] | undefined = top !== undefined && bottom !== undefined ? [Math.min(top, bottom), Math.max(top, bottom)] : undefined
  // markerFloor takes the game point as [z, x] (the map's lat/lng order).
  const name = markerFloor(map, range, [position.z, position.x], position.y)
  return name ? { floorHint: name } : {}
}

function round(value: number) {
  return Math.round(value * 100) / 100
}
