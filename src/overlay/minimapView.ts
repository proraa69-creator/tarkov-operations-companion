import type { MinimapMarker, MinimapPayload } from './types'

/**
 * A Leaflet position on the minimap: [lat, lng] = [z, x] in game metres. Unity is Y-up, so a game point's y is its
 * height and is never part of the map position (see gameLatLng).
 */
export type LatLngPair = [number, number]
/** South-west and north-east corners, Leaflet order. */
export type LatLngBox = [LatLngPair, LatLngPair]

/** Leaflet position of a game point (a screenshot position, a spawn): the map is drawn from above, lat = z, lng = x. */
export function gameLatLng(point: { x: number; z: number }): LatLngPair {
  return [point.z, point.x]
}

export function isLatLng(value: unknown): value is LatLngPair {
  return Array.isArray(value) && value.length >= 2 && Number.isFinite(value[0]) && Number.isFinite(value[1])
}

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

/** The stops of a quest: its points on this map grouped by room. Points without a usable position are left out. */
export function questClusters(markers: MinimapMarker[], questId: string | null): MinimapMarker[][] {
  return questId ? clusterPoints(markers.filter((marker) => marker.questId === questId && isLatLng(marker.position))) : []
}

/**
 * The smallest box a stop or the overview is shown with (game metres). A single point then still gets a finite zoom
 * with the room around it in view, and a box is never empty (an empty box gives Leaflet an infinite zoom).
 */
export const STOP_MIN_SPAN_M = 24

/** The box around the points ([[south, west], [north, east]]), at least `minSpan` metres across; null without a usable point. */
export function pointsBounds(points: readonly unknown[], minSpan = 0): LatLngBox | null {
  const valid = points.filter(isLatLng)
  if (!valid.length) return null
  let south = Infinity, west = Infinity, north = -Infinity, east = -Infinity
  for (const [lat, lng] of valid) {
    south = Math.min(south, lat); north = Math.max(north, lat)
    west = Math.min(west, lng); east = Math.max(east, lng)
  }
  const span = Number.isFinite(minSpan) ? Math.max(0, minSpan) : 0
  const growLat = Math.max(0, span - (north - south)) / 2
  const growLng = Math.max(0, span - (east - west)) / 2
  return [[south - growLat, west - growLng], [north + growLat, east + growLng]]
}

/**
 * What the quest buttons show. `step` 0…n-1 is the n-th stop (room) of the quest, `step` n is the overview with all
 * of the quest's points; `seq` changes on every press so the map moves even when the step repeats.
 */
export interface QuestCycle { questId: string | null; step: number; seq: number }

export const NO_QUEST: QuestCycle = { questId: null, step: 0, seq: 0 }

/** A step kept from before the quest's points changed (a new payload) still names a stop or the overview. */
function normalStep(step: number, stopCount: number) {
  const states = stopCount + 1
  return Number.isInteger(step) ? ((step % states) + states) % states : 0
}

/**
 * A press on a quest button: another quest starts at its first stop; the same quest goes to its next stop, after the
 * last one to the overview, then to the first stop again. One stop: the stop and the overview take turns.
 */
export function pressQuest(cycle: QuestCycle, questId: string, stopCount: number): QuestCycle {
  if (cycle.questId !== questId || stopCount <= 0) return { questId, step: 0, seq: cycle.seq + 1 }
  return { questId, step: (normalStep(cycle.step, stopCount) + 1) % (stopCount + 1), seq: cycle.seq + 1 }
}

export function clearQuest(cycle: QuestCycle): QuestCycle {
  return { questId: null, step: 0, seq: cycle.seq + 1 }
}

export type QuestTarget =
  /** One stop: the room's points, `index` of `count`. */
  | { kind: 'stop'; index: number; count: number; points: LatLngPair[]; bounds: LatLngBox }
  /**
   * After the last stop: every point of the quest. `wholeMap`: the quest has a single stop, so the overview is the
   * whole map (fitting that one room again would look as if nothing happened).
   */
  | { kind: 'overview'; count: number; points: LatLngPair[]; bounds: LatLngBox; wholeMap: boolean }

/** Where the map goes for this step of the cycle; null for a quest without points on this map. Bounds are never NaN. */
export function questTarget(clusters: MinimapMarker[][], step: number): QuestTarget | null {
  const count = clusters.length
  if (!count) return null
  const index = normalStep(step, count)
  if (index < count) {
    const points = clusters[index]!.map((marker) => marker.position).filter(isLatLng)
    const bounds = pointsBounds(points, STOP_MIN_SPAN_M)
    return bounds ? { kind: 'stop', index, count, points, bounds } : null
  }
  const points = clusters.flat().map((marker) => marker.position).filter(isLatLng)
  const bounds = pointsBounds(points, STOP_MIN_SPAN_M)
  return bounds ? { kind: 'overview', count, points, bounds, wholeMap: count === 1 } : null
}

/** «Точка 2 из 3» on a stop of a quest with several, «Все точки задания» / «Вся карта» on the overview. */
export function questStepLabel(target: QuestTarget | null): string {
  if (!target) return ''
  if (target.kind === 'overview') return target.wholeMap ? 'Вся карта' : 'Все точки задания'
  return target.count > 1 ? `Точка ${target.index + 1} из ${target.count}` : ''
}

/** `next` when its content differs from `previous`, otherwise the old object (same content, same identity). */
function keepUnchanged<T>(previous: T, next: T): T {
  if (previous === next) return next
  try {
    return JSON.stringify(previous) === JSON.stringify(next) ? previous : next
  } catch {
    return next
  }
}

/**
 * The minimap payload arrives as a fresh structured clone every time the main process sends it (every open, and before
 * this fix after every settings change too). Parts that did not change keep their old objects, so the map is not rebuilt
 * for nothing: new `map.layers` made the SVG scheme («Схема», the default view) parse and draw itself again, and every
 * marker was moved again.
 */
export function stablePayload(previous: MinimapPayload | null, next: MinimapPayload): MinimapPayload {
  if (!previous || previous.state !== 'ready' || next.state !== 'ready' || previous.map.id !== next.map.id) return next
  return {
    ...next,
    map: keepUnchanged(previous.map, next.map),
    markers: keepUnchanged(previous.markers, next.markers),
    quests: keepUnchanged(previous.quests, next.quests),
  }
}
