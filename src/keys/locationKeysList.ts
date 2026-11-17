import type { GameMap, Item } from '../domain/types'
import type { KeyDoor } from '../data/keyDoors'
import { canonicalMapId } from '../data/mapIds'

export interface LocationKey {
  keyId: string
  item?: Item
  /** The doors this key opens on this location. */
  doors: KeyDoor[]
}

/**
 * Every key and keycard that opens something on the location (report 186): from the doors index (src/data/keyDoors.ts), the
 * doors of that location only, named keys first by name, the ones the catalog does not know last.
 */
export function keysOfLocation(index: ReadonlyMap<string, KeyDoor[]>, mapId: string, items: ReadonlyMap<string, Item>): LocationKey[] {
  const location = canonicalMapId(mapId)
  const keys: LocationKey[] = []
  for (const [keyId, doors] of index) {
    const here = doors.filter((door) => door.mapId === location)
    if (here.length) keys.push({ keyId, item: items.get(keyId), doors: here })
  }
  return keys.sort((a, b) => Number(!a.item) - Number(!b.item) || (a.item?.name ?? a.keyId).localeCompare(b.item?.name ?? b.keyId, 'ru'))
}

/** The locations that have keys, in the catalog's order (the window's location switch). */
export function locationsWithKeys(index: ReadonlyMap<string, KeyDoor[]>, maps: readonly GameMap[]): GameMap[] {
  const withKeys = new Set<string>()
  for (const doors of index.values()) for (const door of doors) withKeys.add(door.mapId)
  const seen = new Set<string>()
  return maps.filter((map) => {
    const id = canonicalMapId(map.id)
    if (!withKeys.has(id) || seen.has(id)) return false
    seen.add(id)
    return true
  })
}

/** Where the window first stands: the right side, below the top bar, inside the screen. */
export function defaultKeysPosition(width: number, viewportWidth: number) {
  return { x: Math.max(12, viewportWidth - width - 24), y: 96 }
}

/** A dragged corner kept so the window's header stays on the screen. */
export function clampKeysPosition(position: { x: number; y: number }, size: { width: number; height: number }, viewport: { width: number; height: number }) {
  return {
    x: Math.round(Math.min(Math.max(position.x, 8 - size.width + 120), viewport.width - 120)),
    y: Math.round(Math.min(Math.max(position.y, 8), viewport.height - 48)),
  }
}

/** The address of the map showing a key's doors (MapsPage `?keyDoors=`), `door` flown to. */
export function keyDoorsHref(mapId: string, keyId: string, doorId?: string) {
  return `/maps/${encodeURIComponent(mapId)}?keyDoors=${encodeURIComponent(keyId)}${doorId ? `&door=${encodeURIComponent(doorId)}` : ''}`
}
