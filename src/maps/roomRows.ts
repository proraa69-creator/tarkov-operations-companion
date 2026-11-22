import { useMemo } from 'react'
import { Crosshair, KeyRound, Tag, TriangleAlert } from 'lucide-react'
import type { GameMap, MapMarker } from '../domain/types'
import { LAB_KEYCARD_ROOMS, labyrinthTraps, lockOf } from '../data/mapRoomSigns'
import { shopSignsOf } from '../data/interchangeShopSigns'
import { fireSectorsOf } from '../data/fireSectors'
import type { RoomLayerId } from './roomLayers'

/** Report №110: a colour nothing else on the maps has (red is mines and traps, yellow and brown the roads), dashed. */
export const FIRE_SECTOR_COLOR = '#e040fb'

/** The rows of the left menu for a map: also what «Показать все» / «Скрыть все» switch there (report 181). */
export function useRoomRows(map: GameMap, markers: readonly MapMarker[]) {
  return useMemo(() => {
    const doors = markers.filter((marker) => marker.layerId === 'key' && marker.lock && (marker.lock.kind ?? 'door') === 'door')
    const plain = doors.filter((marker) => !(map.id === 'the-lab' && LAB_KEYCARD_ROOMS.some((room) => room.locks.includes(lockOf(marker)))))
    const named = new Set(plain.map((marker) => `${marker.lock?.keyId ?? marker.id}|${marker.floor ?? ''}`))
    const list: Array<{ id: RoomLayerId; label: string; count: number; icon: typeof KeyRound; color: string }> = []
    if (map.id === 'the-lab') list.push({ id: 'keycard', label: 'Комнаты через ключ-карты', count: LAB_KEYCARD_ROOMS.length, icon: KeyRound, color: '#e5484d' })
    const traps = labyrinthTraps(map, markers).length
    if (traps) list.push({ id: 'traps', label: 'Ловушки и комнаты', count: traps, icon: TriangleAlert, color: '#ff2d2d' })
    if (named.size) list.push({ id: 'signs', label: 'Названия комнат', count: named.size, icon: Tag, color: '#f1e7c9' })
    // Owner, 06.11.2026: «добавь кнопку… Добавь снизу в самом низу отключение этих названий. Также и название комнат».
    const places = new Set((map.layers ?? []).flatMap((layer) => shopSignsOf(map.id, layer.svgLayer ?? layer.name)).map((sign) => sign.name)).size
    if (places) list.push({ id: 'places', label: 'Названия мест', count: places, icon: Tag, color: '#e9e5d3' })
    // Report №110: «кнопку «Включить-выключить» в разделе карты, так же, как и название магазинов».
    const fire = fireSectorsOf(map.id).length
    if (fire) list.push({ id: 'fire', label: 'Сектора обстрела', count: fire, icon: Crosshair, color: FIRE_SECTOR_COLOR })
    return list
  }, [map, markers])
}

