import type { GameMap, Item, KeycardColor, MapMarker, MarkerLock } from '../domain/types'
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
  /** 1-based number among this key's doors on the same map, when there are several there. */
  number?: number
}

/** The Factory emergency exit key. */
export const FACTORY_EXIT_KEY_ID = '5448ba0b4bdc2d02308b456c'

/**
 * tarkov.dev lists the Factory emergency exit key on locks of other maps too (Lighthouse, Streets, Shoreline, Ground
 * Zero): it is the game's default key id of door objects with no real key, not doors this key opens. Only its Factory
 * doors count.
 */
const KEY_MAPS_ONLY: Record<string, string[]> = {
  [FACTORY_EXIT_KEY_ID]: ['factory'],
}

/** Keys and keycards: tarkov.dev puts both in the `keys` item type («Ключ»). */
export function isKeyItem(item: Pick<Item, 'category'>) {
  return item.category === 'Ключ'
}

/** Key / keycard item id → the doors it opens, from the loaded map markers. Keys with no known door are absent. */
export function buildKeyDoorIndex(markers: MapMarker[], maps: GameMap[]): Map<string, KeyDoor[]> {
  const mapOrder = new Map(maps.map((map, index) => [map.id, index]))
  const mapById = new Map(maps.map((map) => [map.id, map]))
  const index = new Map<string, KeyDoor[]>()
  const seen = new Set<string>()
  for (const marker of markers) {
    const keyId = marker.lock?.keyId
    if (!keyId || marker.layerId !== 'key' || seen.has(marker.id)) continue
    const map = mapById.get(marker.mapId)
    if (!map) continue
    const onlyMaps = KEY_MAPS_ONLY[keyId]
    if (onlyMaps && !onlyMaps.includes(marker.mapId)) continue
    if (!Number.isFinite(marker.position[0]) || !Number.isFinite(marker.position[1])) continue
    seen.add(marker.id)
    const base = mainFloor(map)
    const door: KeyDoor = {
      markerId: marker.id,
      mapId: marker.mapId,
      mapName: map.name,
      floor: floorLabel(marker, base),
      rawFloor: marker.floor && marker.floor !== base ? marker.floor : undefined,
      kind: marker.lock?.kind ?? 'door',
      keycard: marker.lock?.keycard,
      needsPower: marker.lock?.needsPower,
    }
    const list = index.get(keyId)
    if (list) list.push(door)
    else index.set(keyId, [door])
  }
  for (const doors of index.values()) {
    doors.sort((a, b) => (mapOrder.get(a.mapId) ?? 99) - (mapOrder.get(b.mapId) ?? 99) || Number(Boolean(a.rawFloor)) - Number(Boolean(b.rawFloor)) || a.floor.localeCompare(b.floor) || a.markerId.localeCompare(b.markerId))
    const perMap = new Map<string, number>()
    for (const door of doors) perMap.set(door.mapId, (perMap.get(door.mapId) ?? 0) + 1)
    const counters = new Map<string, number>()
    for (const door of doors) {
      if ((perMap.get(door.mapId) ?? 0) < 2) continue
      const next = (counters.get(door.mapId) ?? 0) + 1
      counters.set(door.mapId, next)
      door.number = next
    }
  }
  return index
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
