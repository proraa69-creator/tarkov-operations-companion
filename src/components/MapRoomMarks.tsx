import { useMemo, useState } from 'react'
import { Polygon, Popup, Tooltip } from 'react-leaflet'
import { Crosshair, KeyRound, Tag, TriangleAlert } from 'lucide-react'
import type { GameMap, Item, MapMarker } from '../domain/types'
import { uiText } from '../i18n/renderText'
import { useLocale } from '../i18n/LocaleProvider'
import { CARD_COLOURS, keycardRooms, keyRoomSigns, LAB_KEYCARD_ROOMS, labyrinthRoomSigns, labyrinthTraps, lockOf, type RoomSign } from '../data/mapRoomSigns'
import { toggleRoomLayer, useHiddenRoomLayers, type RoomLayerId } from '../maps/roomLayers'
import { SignOverlay } from './ShopSigns'
import { shopSignsOf } from '../data/interchangeShopSigns'
import { FIRE_SECTOR_TEXT, fireSectorsOf, type FireSector } from '../data/fireSectors'

const TRAP_STYLE = { color: '#ff2d2d', weight: 2, fillColor: '#ff2d2d', fillOpacity: 0.16 }
/** Report №110: a colour nothing else on the maps has (red is mines and traps, yellow and brown the roads), dashed. */
export const FIRE_SECTOR_COLOR = '#e040fb'
const FIRE_STYLE = { color: FIRE_SECTOR_COLOR, weight: 2.5, dashArray: '8 6', fillColor: FIRE_SECTOR_COLOR, fillOpacity: 0.1 }
const FIRE_LIT_STYLE = { ...FIRE_STYLE, weight: 3.5, fillOpacity: 0.35 }

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
  const fire = useMemo(() => fireSectorsOf(map.id), [map.id])
  // the sector pressed lights up while its caption is open (owner: «подсвечивался… только когда нажимаешь»)
  const [litSector, setLitSector] = useState<string | null>(null)
  return <>
    {!hidden.has('fire') && fire.map((sector) => <Polygon key={sector.id} positions={sector.outline.map(([x, z]) => [z, x] as [number, number])} pathOptions={sector.id === litSector ? FIRE_LIT_STYLE : FIRE_STYLE} eventHandlers={{ popupopen: () => setLitSector(sector.id), popupclose: () => setLitSector((lit) => lit === sector.id ? null : lit) }}>
      <Popup className="map-fire-popup" closeButton={false}><FireSectorCard kind={sector.kind} items={items} /></Popup>
    </Polygon>)}
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

/** A fire sector's card: what it is, when they shoot and, for Lighthouse's bridge, the transmitter that lets you cross. */
function FireSectorCard({ kind, items }: { kind: FireSector['kind']; items: ReadonlyMap<string, Item> }) {
  const text = FIRE_SECTOR_TEXT[kind]
  const item = text.itemId ? items.get(text.itemId) : undefined
  return <div className="map-fire-card">
    <strong>{uiText(text.title)}</strong>
    {text.lines.map((line) => <p key={line}>{uiText(line)}</p>)}
    {item && <div className="map-fire-item">{item.iconUrl && <img src={item.iconUrl} alt="" />}<span>{uiText(item.name)}</span></div>}
  </div>
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
    // Owner, 06.11.2026: «добавь кнопку… Добавь снизу в самом низу отключение этих названий. Также и название комнат».
    const places = new Set((map.layers ?? []).flatMap((layer) => shopSignsOf(map.id, layer.svgLayer ?? layer.name)).map((sign) => sign.name)).size
    if (places) list.push({ id: 'places', label: 'Названия мест', count: places, icon: Tag, color: '#e9e5d3' })
    // Report №110: «кнопку «Включить-выключить» в разделе карты, так же, как и название магазинов».
    const fire = fireSectorsOf(map.id).length
    if (fire) list.push({ id: 'fire', label: 'Сектора обстрела', count: fire, icon: Crosshair, color: FIRE_SECTOR_COLOR })
    return list
  }, [map, markers])
  if (!rows.length) return null
  return <div className="map-layer-group">
    <div className="map-side-title">{uiText(rows.some((row) => row.id === 'fire') ? 'На карте' : 'Названия')}</div>
    {rows.map(({ id, label, count, icon: Icon, color }) => <button key={id} type="button" className={`layer-button ${hidden.has(id) ? '' : 'active'}`} onClick={() => toggleRoomLayer(id)}>
      <Icon size={16} color={color} aria-hidden="true" />
      <span>{uiText(label)}</span>
      <small>{uiText(count)}</small>
    </button>)}
  </div>
}
