import type { GameMap, Item, KeycardColor, MapMarker, MarkerLock } from '../domain/types'
import { canonicalMapId } from './mapIds'
import { keyDoorPlace, type KeyDoorPlace } from './keyDoorNames'
import { floorLabel, mainFloor } from './mapProjection'

/**
 * «Показать дверь на карте» (owner, 15.10.2026): every key and keycard in «Барахолка» points at the doors it opens.
 * The doors are the locked-door markers the map already draws (tarkov.dev maps.json `locks`, src/data/mapMarkerAdapter.ts):
 * nothing here adds a position of its own.
 */
export interface KeyDoor {
  /** The map marker id, used as `?lock=` on the Maps page. */
  markerId: string
  mapId: string
  mapName: string
  /** Display floor («Основной», «2 этаж», …). */
  floor: string
  /** The marker's own floor, as the Maps page floor switch names it (undefined: the main level). */
  rawFloor?: string
  kind: NonNullable<MarkerLock['kind']>
  keycard?: KeycardColor
  needsPower?: boolean
  /** 1-based number among this key's unnamed doors on the same map, when there are several there. */
  number?: number
  /** The place, where the wiki names it (src/data/keyDoorNames.ts): «Подвалы (выход)», «Кабинет Круглова (R22)». */
  name?: { ru: string; en: string }
}

/**
 * Lock points of one key closer than this (horizontally, on one level) are one door: the same lock listed twice. Distinct
 * doors can be close: the Tarbank cash booths are 1.9 m apart, the Chekannaya 15 cells 2.9 m (EFT wiki).
 */
export const SAME_DOOR_METRES = 1.5
/** Lock points more than this apart in height are on different levels. */
const SAME_LEVEL_METRES = 2

/** Keys and keycards: tarkov.dev puts both in the `keys` item type («Ключ»). */
export function isKeyItem(item: Pick<Item, 'category'>) {
  return item.category === 'Ключ'
}

interface DoorPoint {
  door: KeyDoor
  /** Game x / z (the marker position is the Leaflet pair [z, x]) and height. */
  x: number
  z: number
  y?: number
  place?: KeyDoorPlace
  /** The point is on a map variant (Night Factory, The Lab (Dark), …), not the map itself. */
  variant: boolean
}

/**
 * Key / keycard item id → the doors it opens, from the loaded map markers. Keys with no known door are absent.
 * Every lock tarkov.dev attaches to a key counts (owner, 15.10.2026: the Factory exit key opens doors beyond Factory), with
 * three merges: a map variant is its map, the same lock point listed twice is one door, and the lock points of one place
 * the wiki names (src/data/keyDoorNames.ts: a room's door and its safe, a double door) are one entry.
 */
export function buildKeyDoorIndex(markers: MapMarker[], maps: GameMap[]): Map<string, KeyDoor[]> {
  const mapOrder = new Map(maps.map((map, index) => [map.id, index]))
  const mapById = new Map(maps.map((map) => [map.id, map]))
  const points = new Map<string, DoorPoint[]>()
  const seen = new Set<string>()
  for (const marker of markers) {
    const keyId = marker.lock?.keyId
    if (!keyId || marker.layerId !== 'key' || seen.has(marker.id)) continue
    const mapId = canonicalMapId(marker.mapId)
    const map = mapById.get(mapId)
    if (!map) continue
    const [z, x] = marker.position
    if (!Number.isFinite(x) || !Number.isFinite(z)) continue
    seen.add(marker.id)
    const base = mainFloor(map)
    const place = keyDoorPlace(keyId, mapId, x, z, marker.height)
    const door: KeyDoor = {
      markerId: marker.id,
      mapId,
      mapName: map.name,
      floor: floorLabel(marker, base),
      rawFloor: marker.floor && marker.floor !== base ? marker.floor : undefined,
      kind: marker.lock?.kind ?? 'door',
      keycard: marker.lock?.keycard,
      needsPower: marker.lock?.needsPower,
      ...(place ? { name: { ru: place.ru, en: place.en } } : {}),
    }
    const point: DoorPoint = { door, x, z, y: marker.height, place, variant: marker.mapId !== mapId }
    const list = points.get(keyId)
    if (list) list.push(point)
    else points.set(keyId, [point])
  }
  const index = new Map<string, KeyDoor[]>()
  for (const [keyId, list] of points) {
    // The map's own markers first: a merged door opens the map on one of them (MapsPage `?lock=`).
    list.sort((a, b) => Number(a.variant) - Number(b.variant) || a.door.markerId.localeCompare(b.door.markerId))
    const kept: DoorPoint[] = []
    for (const point of list) {
      if (kept.some((other) => sameDoor(point, other))) continue
      kept.push(point)
    }
    const doors = kept.map((point) => point.door)
    // Maps where the key opens a door (its home: Factory for the exit key) before maps with only vehicle locks.
    const doorMaps = new Set(doors.filter((door) => door.kind === 'door').map((door) => door.mapId))
    doors.sort((a, b) => Number(!doorMaps.has(a.mapId)) - Number(!doorMaps.has(b.mapId)) || (mapOrder.get(a.mapId) ?? 99) - (mapOrder.get(b.mapId) ?? 99) || Number(Boolean(a.rawFloor)) - Number(Boolean(b.rawFloor)) || a.floor.localeCompare(b.floor) || Number(!a.name) - Number(!b.name) || a.markerId.localeCompare(b.markerId))
    // Doors without a name are numbered per map when there are several there.
    const perMap = new Map<string, number>()
    for (const door of doors) if (!door.name) perMap.set(door.mapId, (perMap.get(door.mapId) ?? 0) + 1)
    const counters = new Map<string, number>()
    for (const door of doors) {
      if (door.name || (perMap.get(door.mapId) ?? 0) < 2) continue
      const next = (counters.get(door.mapId) ?? 0) + 1
      counters.set(door.mapId, next)
      door.number = next
    }
    index.set(keyId, doors)
  }
  return index
}

function sameDoor(a: DoorPoint, b: DoorPoint) {
  if (a.door.mapId !== b.door.mapId) return false
  if (a.place || b.place) return a.place === b.place
  const sameLevel = a.y != null && b.y != null ? Math.abs(a.y - b.y) <= SAME_LEVEL_METRES : a.door.rawFloor === b.door.rawFloor
  return sameLevel && Math.hypot(a.x - b.x, a.z - b.z) <= SAME_DOOR_METRES
}

/** The Maps page focused on one door: its map, its floor and the marker selected (MapsPage `?lock=`). */
export function keyDoorHref(door: Pick<KeyDoor, 'mapId' | 'markerId'>) {
  return `/maps/${encodeURIComponent(door.mapId)}?lock=${encodeURIComponent(door.markerId)}`
}

/** Russian kind label (translated by uiText): «Дверь», «Дверь машины», «Контейнер». */
export function keyDoorKindLabel(door: Pick<KeyDoor, 'kind'>) {
  if (door.kind === 'trunk') return 'Дверь машины'
  if (door.kind === 'container') return 'Запертый контейнер'
  return 'Дверь'
}
