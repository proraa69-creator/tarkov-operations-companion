import type { MinimapMarker } from './types'

/** Centre (Leaflet [z, x]) and zoom of the minimap the player left by hand, per map id. */
export interface SavedMinimapView {
  center: [number, number]
  zoom: number
}

/** The overlay window shares localStorage with the main window, so the key carries the feature name. */
export const MINIMAP_VIEW_KEY = 'raidos.minimap.views.v1'

function readAll(): Record<string, SavedMinimapView> {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(MINIMAP_VIEW_KEY) ?? '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, SavedMinimapView> : {}
  } catch {
    return {}
  }
}

const isView = (value: unknown): value is SavedMinimapView => {
  const view = value as SavedMinimapView | undefined
  return Boolean(view && Array.isArray(view.center) && view.center.length === 2 && view.center.every(Number.isFinite) && Number.isFinite(view.zoom))
}

export function readMinimapView(mapId: string): SavedMinimapView | null {
  const view = readAll()[mapId]
  return isView(view) ? { center: [view.center[0], view.center[1]], zoom: view.zoom } : null
}

export function saveMinimapView(mapId: string, view: SavedMinimapView) {
  if (!mapId || !isView(view)) return
  try {
    window.localStorage.setItem(MINIMAP_VIEW_KEY, JSON.stringify({ ...readAll(), [mapId]: { center: view.center, zoom: view.zoom } }))
  } catch {
    // Storage blocked or full: the view simply is not remembered.
  }
}

/**
 * Points closer than this (game metres, horizontally) can be one room. Tarkov rooms where an item spawns
 * on several shelves (a dorm room, an office, a shop on Interchange) are at most ~10–12 m across, while
 * separate rooms or buildings of one quest are usually farther apart; it is the largest distance between
 * any two points of a group, so a long row of rooms never chains into one group.
 */
export const ROOM_SPAN_M = 12
/**
 * Height difference still counted as one room. A storey in Tarkov is about 3–4 m, a shelf vs. the floor
 * of one room differs by up to ~2 m: 2.5 m keeps the floors apart. Ignored when a point has no height.
 */
export const ROOM_HEIGHT_M = 2.5

type QuestPoint = Pick<MinimapMarker, 'position' | 'height'>

function sameRoom(a: QuestPoint, b: QuestPoint) {
  const dz = a.position[0] - b.position[0]
  const dx = a.position[1] - b.position[1]
  if (Math.hypot(dx, dz) > ROOM_SPAN_M) return false
  return a.height == null || b.height == null || Math.abs(a.height - b.height) <= ROOM_HEIGHT_M
}

/** Groups points into rooms (each point joins the first group it is close to all members of); order kept. */
export function clusterPoints<T extends QuestPoint>(points: T[]): T[][] {
  const clusters: T[][] = []
  for (const point of points) {
    const cluster = clusters.find((members) => members.every((member) => sameRoom(point, member)))
    if (cluster) cluster.push(point)
    else clusters.push([point])
  }
  return clusters
}

export function questClusters(markers: MinimapMarker[], questId: string | null): MinimapMarker[][] {
  return questId ? clusterPoints(markers.filter((marker) => marker.questId === questId)) : []
}

/**
 * What the quest buttons show. `step` 0…n-1 is the n-th room of the quest, `step` n is the whole map;
 * `seq` changes on every press so the map moves even when the step repeats.
 */
export interface QuestCycle { questId: string | null; step: number; seq: number }

export const NO_QUEST: QuestCycle = { questId: null, step: 0, seq: 0 }

/** A press on a quest button: another quest starts at its first room, the same quest goes to the next one. */
export function pressQuest(cycle: QuestCycle, questId: string, clusterCount: number): QuestCycle {
  if (cycle.questId !== questId || clusterCount <= 0) return { questId, step: 0, seq: cycle.seq + 1 }
  return { questId, step: (cycle.step + 1) % (clusterCount + 1), seq: cycle.seq + 1 }
}

export function clearQuest(cycle: QuestCycle): QuestCycle {
  return { questId: null, step: 0, seq: cycle.seq + 1 }
}

export type QuestTarget = { kind: 'room'; points: Array<[number, number]> } | { kind: 'map' }

export function questTarget(clusters: MinimapMarker[][], step: number): QuestTarget | null {
  if (!clusters.length) return null
  const cluster = clusters[step]
  return cluster ? { kind: 'room', points: cluster.map((marker) => marker.position) } : { kind: 'map' }
}
