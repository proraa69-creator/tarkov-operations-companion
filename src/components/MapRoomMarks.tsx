import { useMemo, useState } from 'react'
import { Polygon, Popup, Tooltip } from 'react-leaflet'
import type { GameMap, Item, MapMarker } from '../domain/types'
import { uiText } from '../i18n/renderText'
import { useLocale } from '../i18n/LocaleProvider'
import { CARD_COLOURS, keycardRooms, keyRoomSigns, labyrinthRoomSigns, labyrinthTraps, lockOf, type RoomSign } from '../data/mapRoomSigns'
import { toggleRoomLayer, useHiddenRoomLayers } from '../maps/roomLayers'
import { FIRE_SECTOR_COLOR, useRoomRows } from '../maps/roomRows'
import { SignOverlay } from './ShopSigns'
import { FIRE_SECTOR_TEXT, fireSectorsOf, type FireSector } from '../data/fireSectors'

const TRAP_STYLE = { color: '#ff2d2d', weight: 2, fillColor: '#ff2d2d', fillOpacity: 0.16 }
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
  const rows = useRoomRows(map, markers)
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
