import { allMarkerLayers } from '../domain/mapLayers'
import type { MarkerLayerId } from '../domain/types'
import type { RoomLayerId } from './roomLayers'

/**
 * «Показать все» / «Скрыть все» of «Точки на карте» (report 181: «Убирать визуальный шум одной кнопкой»). «Скрыть все» takes
 * every row of that list off the map — the points' layers, the room names, traps and fire sectors, «Места устранения»,
 * «Нужные ключи» — and keeps the player's own choice; «Показать все» brings back that choice, not every layer there is (owner,
 * 17.11.2026: «"Показать все" он показывает только те, которые выбраны были»). The player's position, the opened quest's own
 * points and the drawings are not rows there and stay. Kept on this device for every map, like the rows themselves.
 */
export type LayerChoice = {
  hiddenMarkers: readonly MarkerLayerId[]
  hiddenKinds: readonly string[]
  hiddenRooms: readonly RoomLayerId[]
  killZones: boolean
  neededKeys: boolean
}

/** The rows this map lists: the buttons judge by them whether everything is already shown or hidden. */
export type ListedRows = { markers: readonly MarkerLayerId[]; rooms: readonly RoomLayerId[]; killZones: boolean; neededKeys: boolean }

export const ALL_ROOM_LAYERS: readonly RoomLayerId[] = ['keycard', 'traps', 'signs', 'places', 'fire']

export function everythingHidden(listed: ListedRows, choice: LayerChoice) {
  return listed.markers.every((id) => choice.hiddenMarkers.includes(id))
    && listed.rooms.every((id) => choice.hiddenRooms.includes(id))
    && (!listed.killZones || !choice.killZones)
    && (!listed.neededKeys || !choice.neededKeys)
}

/**
 * The player's choice kept by «Скрыть все» back on the map. A row he turned on by hand since stays on.
 */
export function shownAgain(kept: LayerChoice, now: LayerChoice): LayerChoice {
  return {
    hiddenMarkers: kept.hiddenMarkers.filter((id) => now.hiddenMarkers.includes(id)),
    hiddenKinds: [...kept.hiddenKinds],
    hiddenRooms: kept.hiddenRooms.filter((id) => now.hiddenRooms.includes(id)),
    killZones: kept.killZones || now.killZones,
    neededKeys: kept.neededKeys || now.neededKeys,
  }
}

/** Everything off, every map; the kinds of containers are kept for when their layer comes back. */
export function hideAll(choice: LayerChoice): LayerChoice {
  return { ...choice, hiddenMarkers: [...allMarkerLayers], hiddenRooms: [...ALL_ROOM_LAYERS], killZones: false, neededKeys: false }
}

const KEY = 'raidos-map-layers-before-all-v1'

/** The player's choice kept by «Скрыть все» until «Показать все» (also after a restart). */
export function readLayersBefore(): LayerChoice | null {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    if (!stored || typeof stored !== 'object') return null
    const value = stored as Partial<LayerChoice>
    const list = <T,>(entry: unknown) => (Array.isArray(entry) ? entry.filter((id): id is T => typeof id === 'string') : [])
    return {
      hiddenMarkers: list<MarkerLayerId>(value.hiddenMarkers).filter((id) => allMarkerLayers.includes(id)),
      hiddenKinds: list<string>(value.hiddenKinds),
      hiddenRooms: list<RoomLayerId>(value.hiddenRooms).filter((id) => ALL_ROOM_LAYERS.includes(id)),
      killZones: value.killZones !== false,
      neededKeys: value.neededKeys === true,
    }
  } catch { return null }
}

export function keepLayersBefore(choice: LayerChoice | null) {
  try {
    if (choice) localStorage.setItem(KEY, JSON.stringify(choice))
    else localStorage.removeItem(KEY)
  } catch { /* storage unavailable: kept in memory until the app closes */ }
}

export function sameChoice(a: LayerChoice, b: LayerChoice) {
  const same = <T,>(x: readonly T[], y: readonly T[]) => x.length === y.length && x.every((id) => y.includes(id))
  return same(a.hiddenMarkers, b.hiddenMarkers) && same(a.hiddenKinds, b.hiddenKinds) && same(a.hiddenRooms, b.hiddenRooms)
    && a.killZones === b.killZones && a.neededKeys === b.neededKeys
}
