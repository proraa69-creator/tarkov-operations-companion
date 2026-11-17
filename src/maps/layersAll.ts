import { allMarkerLayers } from '../domain/mapLayers'
import type { MarkerLayerId } from '../domain/types'
import type { RoomLayerId } from './roomLayers'

/**
 * «Показать все» / «Скрыть все» of «Точки на карте» (report 181: «Убирать визуальный шум одной кнопкой»). They switch every
 * row of that list: the points' layers, the room names, traps and fire sectors, «Места устранения» and «Нужные ключи». The
 * player's position, the opened quest's own points and the drawings are not rows there and stay. Like the rows themselves the
 * switches are kept on this device for every map; «Вернуть» brings back the player's own choice from before.
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

export function everythingShown(listed: ListedRows, choice: LayerChoice) {
  return listed.markers.every((id) => !choice.hiddenMarkers.includes(id))
    && (!listed.markers.includes('loot.container') || !choice.hiddenKinds.length)
    && listed.rooms.every((id) => !choice.hiddenRooms.includes(id))
    && (!listed.killZones || choice.killZones)
}

export function everythingHidden(listed: ListedRows, choice: LayerChoice) {
  return listed.markers.every((id) => choice.hiddenMarkers.includes(id))
    && listed.rooms.every((id) => choice.hiddenRooms.includes(id))
    && (!listed.killZones || !choice.killZones)
    && (!listed.neededKeys || !choice.neededKeys)
}

/** Everything on, every map: «Нужные ключи» is left as it was — with the keys' layer on it adds nothing. */
export function showAll(choice: LayerChoice): LayerChoice {
  return { ...choice, hiddenMarkers: [], hiddenKinds: [], hiddenRooms: [], killZones: true }
}

/** Everything off, every map; the kinds of containers are kept for when their layer comes back. */
export function hideAll(choice: LayerChoice): LayerChoice {
  return { ...choice, hiddenMarkers: [...allMarkerLayers], hiddenRooms: [...ALL_ROOM_LAYERS], killZones: false, neededKeys: false }
}

const KEY = 'raidos-map-layers-before-all-v1'

/** The choice from before the last «Показать все» / «Скрыть все». */
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
  } catch { /* storage unavailable: no way back after a restart */ }
}

export function sameChoice(a: LayerChoice, b: LayerChoice) {
  const same = <T,>(x: readonly T[], y: readonly T[]) => x.length === y.length && x.every((id) => y.includes(id))
  return same(a.hiddenMarkers, b.hiddenMarkers) && same(a.hiddenKinds, b.hiddenKinds) && same(a.hiddenRooms, b.hiddenRooms)
    && a.killZones === b.killZones && a.neededKeys === b.neededKeys
}
