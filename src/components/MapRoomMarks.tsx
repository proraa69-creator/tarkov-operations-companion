import { useMemo } from 'react'
import { Polygon, Tooltip } from 'react-leaflet'
import { KeyRound, Tag, TriangleAlert } from 'lucide-react'
import type { GameMap, Item, MapMarker } from '../domain/types'
import { uiText } from '../i18n/renderText'
import { useLocale } from '../i18n/LocaleProvider'
import { CARD_COLOURS, keycardRooms, keyRoomSigns, LAB_KEYCARD_ROOMS, labyrinthRoomSigns, labyrinthTraps, lockOf, type RoomSign } from '../data/mapRoomSigns'
import { toggleRoomLayer, useHiddenRoomLayers, type RoomLayerId } from '../maps/roomLayers'
import { SignOverlay } from './ShopSigns'

const TRAP_STYLE = { color: '#ff2d2d', weight: 2, fillColor: '#ff2d2d', fillOpacity: 0.16 }

const roomLabel = (locale: string) => (number: number) => (locale === 'en' ? `Room ${number}` : `Комната ${number}`)

/** A sign in the frame of Развязка's shops (ShopSigns). */
function RoomPlate({ sign }: { sign: RoomSign }) {
  const plate = useMemo(() => ({ name: sign.id, floor: 'First_Floor' as const, sign: sign.text, x: sign.x, z: sign.z, w: sign.w, h: sign.h, bg: sign.bg, fg: sign.fg, font: 'rounded' as const }), [sign])
  return <SignOverlay sign={plate} />
}

/**
 * The rooms over the map (data/mapRoomSigns.ts): keys' short names in frames, the Lab's rooms in their card's colour, the
 * Labyrinth's traps in red and its numbered rooms. Under the markers, never taking a click.
 */
export function MapRoomMarks({ map, floor, markers, items }: { map: GameMap; floor: string; markers: readonly MapMarker[]; items: ReadonlyMap<string, Item> }) {
  const { locale } = useLocale()
  const hidden = useHiddenRoomLayers()
  const traps = useMemo(() => labyrinthTraps(map, markers), [map, markers])
  const rooms = useMemo(() => keycardRooms(map, markers, floor), [map, markers, floor])
  const signs = useMemo(() => keyRoomSigns(map, markers, items, floor), [map, markers, items, floor])
  const roomSigns = useMemo(() => labyrinthRoomSigns(map, roomLabel(locale)), [map, locale])
  return <>
    {!hidden.has('traps') && traps.map((marker) => <Polygon key={marker.id} positions={marker.outline!} pathOptions={TRAP_STYLE} interactive={false} />)}
    {!hidden.has('keycard') && rooms.map((room) => {
      const colour = CARD_COLOURS[room.card]
      // Over the room or its name: the key that opens it (owner, 06.11.2026: «появляется картинка и надпись ключа, который нужен»).
      const keyId = markers.find((marker) => marker.layerId === 'key' && room.locks.includes(lockOf(marker)))?.lock?.keyId
      const key = keyId ? items.get(keyId) : undefined
      return <Polygon key={room.locks[0]} positions={[[room.z[0], room.x[0]], [room.z[1], room.x[0]], [room.z[1], room.x[1]], [room.z[0], room.x[1]]]} pathOptions={{ color: colour.line, weight: 2.5, fillColor: colour.line, fillOpacity: room.card === 'black' ? 0.32 : 0.17 }}>{key && <Tooltip sticky direction="top" className="room-key-tip">{key.iconUrl && <img src={key.iconUrl} alt="" />}<strong>{uiText(key.name)}</strong></Tooltip>}</Polygon>
    })}
    {signs.filter((sign) => !hidden.has(sign.card ? 'keycard' : 'signs')).map((sign) => <RoomPlate key={sign.id} sign={sign} />)}
    {!hidden.has('traps') && roomSigns.map((sign) => <RoomPlate key={sign.id} sign={sign} />)}
  </>
}

/** The left menu's buttons for them; a map without such rooms has no row. */
export function MapRoomButtons({ map, markers }: { map: GameMap; markers: readonly MapMarker[] }) {
  const hidden = useHiddenRoomLayers()
  const rows = useMemo(() => {
    const doors = markers.filter((marker) => marker.layerId === 'key' && marker.lock && (marker.lock.kind ?? 'door') === 'door')
    const plain = doors.filter((marker) => !(map.id === 'the-lab' && LAB_KEYCARD_ROOMS.some((room) => room.locks.includes(lockOf(marker)))))
    const named = new Set(plain.map((marker) => `${marker.lock?.keyId ?? marker.id}|${marker.floor ?? ''}`))
    const list: Array<{ id: RoomLayerId; label: string; count: number; icon: typeof KeyRound; color: string }> = []
    if (map.id === 'the-lab') list.push({ id: 'keycard', label: 'Комнаты через ключ-карты', count: LAB_KEYCARD_ROOMS.length, icon: KeyRound, color: '#e5484d' })
    const traps = labyrinthTraps(map, markers).length
    if (traps) list.push({ id: 'traps', label: 'Ловушки и комнаты', count: traps, icon: TriangleAlert, color: '#ff2d2d' })
    if (named.size) list.push({ id: 'signs', label: 'Названия комнат', count: named.size, icon: Tag, color: '#f1e7c9' })
    return list
  }, [map, markers])
  if (!rows.length) return null
  return <div className="map-layer-group">
    <div className="map-side-title">{uiText('Комнаты')}</div>
    {rows.map(({ id, label, count, icon: Icon, color }) => <button key={id} type="button" className={`layer-button ${hidden.has(id) ? '' : 'active'}`} onClick={() => toggleRoomLayer(id)}>
      <Icon size={16} color={color} aria-hidden="true" />
      <span>{uiText(label)}</span>
      <small>{uiText(count)}</small>
    </button>)}
  </div>
}
