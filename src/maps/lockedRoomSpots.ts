/**
 * Points in locked rooms and the floors of every point (owner, 11.11.2026: «в комнате если есть много точек спавна ключа, сделай
 * один спавн… и напиши несколько точек спавна в этой комнате… покажи в самом верху какой ключ требуется для входа в комнату, это
 * нужно сделать для всех предметов которые находятся за закрытой дверью, проверяй этажи спавна предметов и всех контейнеров, что
 * бы правильно понимать на каком этаже предмет и не путать за закрытой он дверью или нет»; «указывай этажи всех предметов на
 * карте»).
 */
import type { GameMap, MapMarker } from '../domain/types'
import { lockedRoomsAt, type LockedRoom } from '../data/mapRoomSigns'

/**
 * The key spots of one locked room become one point, the room's first spot: every key that may lie anywhere in it, and how many
 * spots there are (`roomSpots`). Spots outside locked rooms stay as they are.
 */
export function mergeRoomKeySpots(markers: readonly MapMarker[], rooms: readonly LockedRoom[], baseFloor: string, worth: (id: string) => number = () => 0): MapMarker[] {
  if (!rooms.length) return [...markers]
  const groups = new Map<LockedRoom, MapMarker[]>()
  const roomOf = new Map<MapMarker, LockedRoom>()
  for (const marker of markers) {
    if (marker.layerId !== 'loot.key') continue
    const room = lockedRoomsAt(rooms, marker.position, marker.floor ?? baseFloor, marker.height)[0]
    if (!room) continue
    roomOf.set(marker, room)
    groups.set(room, [...(groups.get(room) ?? []), marker])
  }
  const merged = new Map<LockedRoom, MapMarker>()
  for (const [room, spots] of groups) {
    if (spots.length < 2) continue
    const first = spots[0]!
    const keyIds = [...new Set(spots.flatMap((spot) => spot.keyIds ?? (spot.itemId ? [spot.itemId] : [])))].sort((a, b) => worth(b) - worth(a))
    const photos = spots.flatMap((spot) => spot.spotPhotos ?? [])
    merged.set(room, {
      ...first,
      itemId: keyIds[0] ?? first.itemId,
      keyIds,
      ...(keyIds.length > 1 ? { keyCount: keyIds.length, title: `Ключи: ${keyIds.length}` } : { title: first.title }),
      roomSpots: spots.length,
      ...(photos.length ? { spotPhotos: photos } : {}),
    })
  }
  const out: MapMarker[] = []
  for (const marker of markers) {
    const room = roomOf.get(marker)
    const one = room ? merged.get(room) : undefined
    if (!one) { out.push(marker); continue }
    if (groups.get(room!)![0] === marker) out.push(one)
  }
  return out
}

/** Whether the map's floor layers tell anything by height (Lighthouse and Woods have names only). */
export function mapKnowsFloors(map: Pick<GameMap, 'layers'>) {
  return Boolean(map.layers?.some((layer) => layer.heightRange || layer.extents?.length))
}

/** One storey, in game metres; a point this much above the ground around it is upstairs. */
const STOREY_M = 3.2
const UPSTAIRS_FROM_M = 2.6
/** Neighbours within this many metres give the ground under a point. */
const AROUND_M = 10

/**
 * For a map whose layers say nothing of heights: each point's floor from the points around it — the lowest of them within AROUND_M
 * (and no more than four storeys down, so a cellar under the house is not its ground) is the ground; a point a storey or more above
 * it is on «2 этаж», «3 этаж»… Points on the ground get nothing (their floor is the main one).
 */
export function floorsFromNeighbours(markers: readonly MapMarker[]): Map<string, string> {
  const placed = markers.filter((marker) => typeof marker.height === 'number')
  const cell = AROUND_M
  const grid = new Map<string, MapMarker[]>()
  const keyOf = (x: number, z: number) => `${Math.floor(x / cell)}:${Math.floor(z / cell)}`
  for (const marker of placed) {
    const key = keyOf(marker.position[1], marker.position[0])
    grid.set(key, [...(grid.get(key) ?? []), marker])
  }
  const floors = new Map<string, string>()
  for (const marker of placed) {
    const [z, x] = marker.position
    const h = marker.height!
    let ground = h
    const cx = Math.floor(x / cell), cz = Math.floor(z / cell)
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dz = -1; dz <= 1; dz += 1) {
        for (const other of grid.get(`${cx + dx}:${cz + dz}`) ?? []) {
          const oh = other.height!
          if (oh < ground && oh >= h - STOREY_M * 4 && Math.hypot(other.position[1] - x, other.position[0] - z) <= AROUND_M) ground = oh
        }
      }
    }
    const up = h - ground
    const storeys = Math.max(1, Math.round(up / STOREY_M))
    // Higher than a fourth floor is a hillside, not a house.
    if (up >= UPSTAIRS_FROM_M && storeys <= 3) floors.set(marker.id, `${1 + storeys} этаж`)
  }
  return floors
}
