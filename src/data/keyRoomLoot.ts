import type { GameMap, MapMarker, MarkerLayerId } from '../domain/types'
import { lockedRooms, lockedRoomsAt } from './mapRoomSigns'
import { mainFloor } from './mapProjection'

/** The map points a room can hold: loot, containers, documents, keys (the padlock layers of the Maps page, report №114). */
const ROOM_LAYERS: ReadonlySet<MarkerLayerId> = new Set<MarkerLayerId>(['loot.guaranteed', 'loot.valuable', 'loot.medical', 'loot.provision', 'loot.technical', 'loot.container', 'loot.documents', 'loot.key', 'loot.weapon'])

const layerOf = (marker: MapMarker): MarkerLayerId | undefined => marker.layerId ?? (marker.type === 'cache' ? 'loot.container' : undefined)

export interface KeyRoomLoot {
  /** Whether a room of the key's doors is known at all (a door with no room box says nothing of what is behind it). */
  known: boolean
  /** The items that may spawn there: each with the number of spots it may lie at. */
  items: Array<{ itemId: string; spots: number }>
  /** The containers (a safe, a weapon box…) by their name, how many. */
  containers: Array<{ name: string; count: number }>
}

/**
 * What lies behind a key's doors (owner, 18.11.2026: «должен писаться спаун предметов… то, что спаунится в комнате, что
 * открывает этот ключ»): the map points inside the rooms its doors lock (src/data/mapRoomSigns.ts lockedRooms, the same rooms
 * the Maps page puts its padlocks on), on every map the key opens a door on. Loose loot and key spots give their items, a
 * container its name.
 */
export function keyRoomLoot(keyId: string, markers: readonly MapMarker[], maps: readonly GameMap[]): KeyRoomLoot {
  const mapIds = new Set(markers.filter((marker) => marker.layerId === 'key' && marker.lock?.keyId === keyId).map((marker) => marker.mapId))
  const inside = new Map<string, MapMarker>()
  let known = false
  for (const mapId of mapIds) {
    const map = maps.find((entry) => entry.id === mapId)
    if (!map) continue
    const points = markers.filter((marker) => marker.mapId === mapId)
    const rooms = lockedRooms(map, points).filter((room) => room.keyId === keyId)
    if (!rooms.length) continue
    known = true
    const main = mainFloor(map)
    for (const point of points) {
      const layer = layerOf(point)
      if (!layer || !ROOM_LAYERS.has(layer)) continue
      if (lockedRoomsAt(rooms, point.position, point.floor ?? main, point.height).length) inside.set(point.id, point)
    }
  }
  const spots = new Map<string, number>()
  const containers = new Map<string, number>()
  for (const point of inside.values()) {
    const ids = [...new Set([...(point.lootIds ?? []), ...(point.keyIds ?? []), ...(!point.lootIds?.length && !point.keyIds?.length && point.itemId ? [point.itemId] : [])])]
    if (ids.length) for (const id of ids) spots.set(id, (spots.get(id) ?? 0) + 1)
    else if (point.title) containers.set(point.title, (containers.get(point.title) ?? 0) + 1)
  }
  return {
    known,
    items: [...spots].map(([itemId, count]) => ({ itemId, spots: count })),
    containers: [...containers].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ru')),
  }
}
