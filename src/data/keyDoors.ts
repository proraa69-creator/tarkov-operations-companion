import type { GameMap, Item, KeycardColor, MapMarker, MarkerLock } from '../domain/types'
import { canonicalMapId } from './mapIds'
import { KEY_DOORS_VIA, keyDoorExcluded, keyDoorPlace, type KeyDoorPlace } from './keyDoorNames'
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
  /** How to reach the lock, for a curated lock (KEY_DOORS_VIA): «сдвиньте картину…». */
  hint?: { ru: string; en: string }
  /** The key, when the door is a curated lock shown on another key's lock marker (MapsPage `?key=` names it on the card). */
  viaOf?: string
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
 * the wiki names (src/data/keyDoorNames.ts: a room's door and its safe, a double door) are one entry. keyDoorNames.ts also
 * drops lock points a key does not open (KEY_DOOR_EXCLUSIONS) and adds the ones tarkov.dev lacks (KEY_DOORS_VIA).
 */
export function buildKeyDoorIndex(markers: MapMarker[], maps: GameMap[]): Map<string, KeyDoor[]> {
  const mapOrder = new Map(maps.map((map, index) => [map.id, index]))
  const mapById = new Map(maps.map((map) => [map.id, map]))
  const points = new Map<string, DoorPoint[]>()
  const add = (keyId: string, point: DoorPoint) => {
    const list = points.get(keyId)
    if (list) list.push(point)
    else points.set(keyId, [point])
  }
  const seen = new Set<string>()
  const lockMarkers: MapMarker[] = []
  for (const marker of markers) {
    const keyId = marker.lock?.keyId
    if (!keyId || marker.layerId !== 'key' || seen.has(marker.id)) continue
    seen.add(marker.id)
    lockMarkers.push(marker)
    const point = doorPoint(marker, keyId, mapById)
    if (point) add(keyId, point)
  }
  // Curated locks tarkov.dev lacks, shown on the lock of the key that leads there (src/data/keyDoorNames.ts KEY_DOORS_VIA).
  for (const via of KEY_DOORS_VIA) {
    const anchor = lockMarkers
      .filter((marker) => marker.lock?.keyId === via.viaKeyId && canonicalMapId(marker.mapId) === via.mapId)
      .sort((a, b) => Number(a.mapId !== via.mapId) - Number(b.mapId !== via.mapId) || a.id.localeCompare(b.id))[0]
    if (!anchor) continue
    const point = doorPoint(anchor, via.keyId, mapById, via)
    if (point) add(via.keyId, { ...point, door: { ...point.door, kind: 'door', keycard: undefined, needsPower: undefined, hint: via.hint, viaOf: via.keyId } })
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

/** One lock point of a key as a door; `named` gives it a curated place instead of the one at its position. */
function doorPoint(marker: MapMarker, keyId: string, mapById: Map<string, GameMap>, named?: { ru: string; en: string }): DoorPoint | undefined {
  const mapId = canonicalMapId(marker.mapId)
  const map = mapById.get(mapId)
  if (!map) return undefined
  const [z, x] = marker.position
  if (!Number.isFinite(x) || !Number.isFinite(z)) return undefined
  if (!named && keyDoorExcluded(keyId, mapId, x, z, marker.height, marker.lock?.kind)) return undefined
  const base = mainFloor(map)
  const place: KeyDoorPlace | undefined = named
    ? { keyId, mapId, x, y: marker.height ?? 0, z, radius: 0, ru: named.ru, en: named.en }
    : keyDoorPlace(keyId, mapId, x, z, marker.height)
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
  return { door, x, z, y: marker.height, place, variant: marker.mapId !== mapId }
}

function sameDoor(a: DoorPoint, b: DoorPoint) {
  if (a.door.mapId !== b.door.mapId) return false
  if (a.place || b.place) return a.place === b.place
  const sameLevel = a.y != null && b.y != null ? Math.abs(a.y - b.y) <= SAME_LEVEL_METRES : a.door.rawFloor === b.door.rawFloor
  return sameLevel && Math.hypot(a.x - b.x, a.z - b.z) <= SAME_DOOR_METRES
}

/** The Maps page focused on one door: its map, its floor and the marker selected (MapsPage `?lock=`). */
export function keyDoorHref(door: Pick<KeyDoor, 'mapId' | 'markerId' | 'viaOf'>) {
  return `/maps/${encodeURIComponent(door.mapId)}?lock=${encodeURIComponent(door.markerId)}${door.viaOf ? `&key=${encodeURIComponent(door.viaOf)}` : ''}`
}

/**
 * The Maps page card of a focused lock (`?lock=` and `?key=`): a curated lock shown on another key's lock marker (the
 * black keycard's safe panel on the Cardinal apartment door) gets its own name and hint; any other marker is unchanged.
 */
export function keyDoorFocusCard(marker: MapMarker, keyId: string | null, locale: 'ru' | 'en'): MapMarker {
  if (!keyId) return marker
  const via = KEY_DOORS_VIA.find((entry) => entry.keyId === keyId && entry.viaKeyId === marker.lock?.keyId && entry.mapId === canonicalMapId(marker.mapId))
  if (!via) return marker
  return { ...marker, title: locale === 'en' ? via.en : via.ru, description: via.hint ? (locale === 'en' ? via.hint.en : via.hint.ru) : '' }
}

/** Russian kind label (translated by uiText): «Дверь», «Дверь машины», «Контейнер». */
export function keyDoorKindLabel(door: Pick<KeyDoor, 'kind'>) {
  if (door.kind === 'trunk') return 'Дверь машины'
  if (door.kind === 'container') return 'Запертый контейнер'
  return 'Дверь'
}
