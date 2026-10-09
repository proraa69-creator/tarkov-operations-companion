import type { GameMap, MapFloorExtent, MapFloorLayer, MapMarker } from '../domain/types'

export const MAIN_FLOOR = 'Основной'

export interface GamePosition {
  x?: unknown
  y?: unknown
  z?: unknown
}

export function positionToLatLng(position: GamePosition | undefined): [number, number] | undefined {
  const x = number(position?.x)
  const z = number(position?.z)
  return Number.isFinite(x) && Number.isFinite(z) ? [z, x] : undefined
}

export function outlineToLatLng(outline: unknown): Array<[number, number]> | undefined {
  if (!Array.isArray(outline)) return undefined
  const points = outline.map((point) => positionToLatLng(point as GamePosition)).filter((point): point is [number, number] => Boolean(point))
  return points.length >= 3 ? points : undefined
}

/**
 * The marker point, placed like tarkov.dev does: at the feed's `position` (the gate, the door, the quest spot);
 * the outline centre is only a fallback. Outline centres drifted far from the real point: Labs «Parking Gate»
 * 23 m out into the parking lot, «Hangar Gate» 27 m, Woods «Ice Cream Cones» bunker zone 448 m off the map.
 */
export function markerPosition(position: GamePosition | undefined, outline: unknown): [number, number] | undefined {
  return positionToLatLng(position) ?? polygonCenter(outlineToLatLng(outline))
}

export function heightRange(top: unknown, bottom: unknown): [number, number] | undefined {
  const parsedTop = number(top)
  const parsedBottom = number(bottom)
  if (!Number.isFinite(parsedTop) || !Number.isFinite(parsedBottom)) return undefined
  return [Math.min(parsedTop, parsedBottom), Math.max(parsedTop, parsedBottom)]
}

export function pointHeight(position: GamePosition | undefined, range?: [number, number]): number | undefined {
  const y = number(position?.y)
  if (Number.isFinite(y)) return y
  return range ? (range[0] + range[1]) / 2 : undefined
}

/** The floor that is rendered as the general map (outdoor level). */
export function mainFloor(map: Pick<GameMap, 'floors' | 'layers'>): string {
  const main = map.layers?.find(isMainLayer)?.name
  if (main) return main
  if (map.floors?.includes(MAIN_FLOOR)) return MAIN_FLOOR
  return map.floors?.[0] ?? MAIN_FLOOR
}

/**
 * Picks the floor for a point like tarkov.dev does: a floor layer applies when the point height is
 * inside one of its extents and (if the extent is limited to buildings) the x/z point is inside those bounds.
 * `position` is the Leaflet pair [z, x].
 */
export function markerFloor(
  map: GameMap,
  range: [number, number] | undefined,
  position?: [number, number],
  height?: number,
): string | undefined {
  const fallback = map.layers?.length || map.floors?.length ? mainFloor(map) : undefined
  const h = height ?? (range ? (range[0] + range[1]) / 2 : undefined)
  if (h == null || !map.layers?.length) return fallback
  for (const layer of map.layers) {
    if (isMainLayer(layer)) continue
    if (layer.extents?.length) {
      if (layer.extents.some((extent) => between(h, extent.height) && (!extent.bounds?.length || !position || extent.bounds.some((box) => insideBox(position, box))))) {
        return layer.name
      }
      continue
    }
    if (layer.heightRange && (range ? rangesOverlap(range, layer.heightRange) : between(h, layer.heightRange))) return layer.name
  }
  return fallback
}

/**
 * The floor the player stands on, from the screenshot position (Unity is Y-up: `y` is the height). Picked the way
 * tarkov.dev picks its player marker's floor: the first floor whose height extent holds `y` — the top excluded, so a
 * point exactly at the border belongs to the floor above — and, for an extent limited to buildings, whose box holds
 * the x/z point; otherwise the main level. Undefined when the map has no floor heights (the offline catalog): then
 * the shown floor is left alone.
 */
export function playerFloor(map: Pick<GameMap, 'floors' | 'layers'>, position: { x: number; y: number; z: number }): string | undefined {
  const { x, y, z } = position
  if (![x, y, z].every(Number.isFinite)) return undefined
  const floors = (map.layers ?? []).filter((layer) => !isMainLayer(layer) && floorExtents(layer).length)
  if (!floors.length) return undefined
  const point: [number, number] = [z, x]
  const floor = floors.find((layer) => floorExtents(layer).some((extent) => (
    belowTop(y, extent.height) && (!extent.bounds?.length || extent.bounds.some((box) => insideBox(point, box)))
  )))
  return floor?.name ?? mainFloor(map)
}

/**
 * Markers stay on the general map (labelled with their floor). Selecting a specific floor narrows the view
 * to that floor's points; quest points are always kept.
 */
export function markerVisibleOnFloor(marker: MapMarker, floor: string, main: string = MAIN_FLOOR) {
  if (marker.type === 'quest' || marker.layerId === 'quest.zone' || marker.layerId === 'quest.item') return true
  if (floor === main) return true
  return !marker.floor || marker.floor === floor
}

export function floorLabel(marker: Pick<MapMarker, 'floor'>, main: string = MAIN_FLOOR) {
  return !marker.floor || marker.floor === main ? MAIN_FLOOR : marker.floor
}

/** Short badge text for a marker icon, e.g. "2" for «2 этаж», "П" for «Подземный». */
export function floorBadge(floor: string | undefined, main: string = MAIN_FLOOR) {
  if (!floor || floor === main || floor === MAIN_FLOOR) return ''
  const digit = floor.match(/\d+/)?.[0]
  return digit ?? floor.trim().charAt(0).toUpperCase()
}

const FLOOR_NAMES: Record<string, string> = {
  underground: 'Подземный',
  tunnels: 'Тоннели',
  bunkers: 'Бункеры',
  garage: 'Гараж',
  'second level': '2 уровень',
  technical: 'Технический уровень',
  infirmary: 'Лазарет',
  helipad: 'Вертолётная площадка',
  'gym/canteen': 'Спортзал / столовая',
  'accommodation (lower)': 'Каюты (нижние)',
  'accommodation (mid)': 'Каюты (средние)',
  'accommodation (upper)': 'Каюты (верхние)',
  "officers' deck": 'Офицерская палуба',
  'stairs (blocked)': 'Лестница (закрыта)',
  bridge: 'Мостик',
  'bridge roof': 'Крыша мостика',
  'control room': 'Пост управления',
  'engine room': 'Машинное отделение',
  'engine room (upper)': 'Машинное отделение (верх)',
  'fuel pumps (lower)': 'Топливные насосы (низ)',
  'fuel pumps': 'Топливные насосы',
  'storage/security': 'Склад / охрана',
}

export function localizeFloorName(name: string) {
  const key = name.trim().toLowerCase()
  const ordinal = key.match(/^(\d+)(?:st|nd|rd|th)?\s*floor$/)
  if (ordinal) return `${ordinal[1]} этаж`
  return FLOOR_NAMES[key] ?? name
}

function isMainLayer(layer: MapFloorLayer) {
  return layer.id === 'main' || layer.name === MAIN_FLOOR
}

function insideBox(position: [number, number], box: [[number, number], [number, number]]) {
  const [z, x] = position
  const [[x1, z1], [x2, z2]] = box
  return x >= Math.min(x1, x2) && x <= Math.max(x1, x2) && z >= Math.min(z1, z2) && z <= Math.max(z1, z2)
}

function between(value: number, range: [number, number]) {
  return value >= Math.min(range[0], range[1]) && value <= Math.max(range[0], range[1])
}

/** Like `between`, without the top: tarkov.dev's `y >= height[0] && y < height[1]`. */
function belowTop(value: number, range: [number, number]) {
  return value >= Math.min(range[0], range[1]) && value < Math.max(range[0], range[1])
}

/** A floor's height extents; a floor with only a height range counts as one extent over the whole map. */
function floorExtents(layer: MapFloorLayer): MapFloorExtent[] {
  if (layer.extents?.length) return layer.extents
  return layer.heightRange ? [{ height: layer.heightRange }] : []
}

function polygonCenter(points: Array<[number, number]> | undefined): [number, number] | undefined {
  if (!points?.length) return undefined
  const lat = points.reduce((sum, point) => sum + point[0], 0) / points.length
  const lng = points.reduce((sum, point) => sum + point[1], 0) / points.length
  return [lat, lng]
}

function rangesOverlap(first: [number, number], second: [number, number]) {
  return first[0] <= second[1] && second[0] <= first[1]
}

function number(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : Number.parseFloat(String(value))
}
