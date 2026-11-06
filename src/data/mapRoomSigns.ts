import type { GameMap, Item, MapMarker } from '../domain/types'
import { mainFloor } from './mapProjection'
import generatedBoxes from './keyRoomBoxes.json'
import tracedBoxes from './keyRoomTraced.json'

/**
 * What the maps say about their rooms (owner, 06.11.2026). The key's short name in a small frame inside each locked room, as
 * Развязка's shop signs, its letters smaller the longer the name («если название короткое, дело короткое. Если название
 * длинное, делай шрифт поменьше… внутри каждой комнаты»). The Lab's rooms behind a coloured card are outlined in its colour
 * with a light tint («не прям яркий насыщенный цвет… какой ключ карты открывается, такой и цвет… только цветных карт»). The
 * Labyrinth's traps are outlined red and its five spawn rooms numbered beside them.
 *
 * Where: src/data/keyRoomTraced.json, each door's room read by eye off the floor's render and every floor of the scheme (owner,
 * 06.11.2026: «Да, расставь»); it also holds a door's own place where the script below had taken a gap between walls for a
 * room. Then src/data/keyRoomBoxes.json (`node scripts/key-room-boxes.mjs`, which does not touch the first). The Lab and the
 * Labyrinth have no scheme, their rooms below are traced over the render's walls. A door with none has its sign at the door:
 * no picture shows its room (Icebreaker's doors do not even meet its decks' pictures).
 */
export type RoomBox = readonly [x: number, z: number, w: number, h: number]
export type CardColour = 'red' | 'green' | 'blue' | 'violet' | 'yellow' | 'black'

export const CARD_COLOURS: Record<CardColour, { line: string; plate: string; letters: string }> = {
  red: { line: '#e5484d', plate: '#b3262b', letters: '#ffffff' },
  green: { line: '#46b96b', plate: '#1f7a3e', letters: '#ffffff' },
  blue: { line: '#3f8cff', plate: '#1f5fc4', letters: '#ffffff' },
  violet: { line: '#a56bf2', plate: '#6d3bb8', letters: '#ffffff' },
  yellow: { line: '#f2c230', plate: '#e0b020', letters: '#1a1400' },
  black: { line: '#0a0a0a', plate: '#0a0a0a', letters: '#ffffff' },
}

export interface KeycardRoom {
  card: CardColour
  /** The locks of its doors: the floor comes from them. */
  locks: readonly string[]
  /** Its walls, in game metres. */
  x: readonly [number, number]
  z: readonly [number, number]
  /** Instead of the key's short name. */
  sign?: string
}

export const LAB_KEYCARD_ROOMS: readonly KeycardRoom[] = [
  { card: 'black', locks: ['e36b7350a3badbd5c6723420914340c37dc250d8', 'faa074330943d9f367963db13f6ebaa4d08dff4f'], x: [-269.5, -250.2], z: [-371.8, -358.6] },
  { card: 'black', locks: ['577b9b90d0f1d11d15817ab2114deefb6307f964', '6b9c65d4d24e1df1f5df7cf787875741de5aa980'], x: [-133, -128.9], z: [-351.1, -347.2] },
  { card: 'red', locks: ['035905a190db56d233238cdd56c01cd8f79ed0c0'], x: [-257, -250.2], z: [-328.4, -320.6] },
  { card: 'violet', locks: ['8b40ef064ab348da611f5f26e4bdf2d90a963cea'], x: [-269.3, -262.3], z: [-323.7, -316] },
  { card: 'yellow', locks: ['ecb5504f3bfbb161c114e263611c30bf89b8a0c2'], x: [-221.2, -211.4], z: [-382.8, -376.8] },
  { card: 'green', locks: ['05963f7358b42b260526df45e60b5755d09c0366'], x: [-139.9, -134.1], z: [-353, -347.2] },
  { card: 'blue', locks: ['2e653b6dd3ae2033cd93efc74c338f2a30ce9ebb'], x: [-125.5, -121.2], z: [-406.4, -400.3] },
  { card: 'blue', locks: ['da8237013a32b58c270653afb9a43f3175816920'], x: [-134.9, -128.1], z: [-339.7, -334.6], sign: 'Синяя маркировка' },
]

/** Rooms of the maps without a scheme: x, z of the room's middle, its size along x and along z. */
const TRACED_BOXES: Readonly<Record<string, RoomBox>> = {
  // The Lab
  ead614596fd574cca7efcb7ab67adce6b93f7f29: [-163.5, -343, 3, 10],
  '9b5b989dece7e75befe2cb87c1973f04b7553fae': [-163.5, -343, 3, 10],
  ec956305ecff4a40051d641ec96eecfcf30c930e: [-182.8, -315, 5, 13],
  '96da8622c621cb42229d48719286ce1d746033f9': [-182.8, -315, 5, 13],
  '85649a6a48ae3581ed2cc8fcef95e49cf31ed137': [-137.8, -336, 3.5, 7],
  '2154804303b2611819f44d335a087e3e16d935ed': [-251.8, -324.5, 2, 7],
  c52d804746ec12f539fb4a82896bb38e1d2e2659: [-118.6, -442.6, 3.5, 4.6],
  // The Labyrinth
  c1ec873492a50d011b97c98a059a89d738de1ea9: [-33, 56, 4, 4.4],
  f0b63254cfb40d739513b50d6f5dbb4d580f4e1d: [-28.3, -16.8, 2.6, 3.4],
  a3a3cfa109fc2d2aba173a93bf9c821b5bf52067: [19, 64.4, 6, 2.8],
  d9452431e4aa4cf172ab609882a6e05b33fb219c: [9.2, -14.2, 5, 5],
  '6dde753409af0c33d44af2b9bc5e520ec1315466': [20.5, 6.5, 4, 4.8],
  d48743aa37e85b14c584abf10b3e23098663cb3c: [-10.4, 41.8, 2.4, 3.8],
  '770de2b5241855010fe4b361f1943debe09a97e4': [9.6, 4, 5, 5.6],
}

/** The Labyrinth's spawn rooms, numbered as the game's guides do: 1 the toxic pool, 2 steam, 3 fire, 4 shotguns, 5 the toxic puddle. */
export const LABYRINTH_ROOMS: ReadonlyArray<{ number: number; x: number; z: number }> = [
  { number: 1, x: -47.6, z: 63 },
  { number: 2, x: 5, z: -26.6 },
  { number: 3, x: -41, z: -23.4 },
  { number: 4, x: 26.6, z: 53.6 },
  { number: 5, x: 46, z: 42 },
]

/** The letters' frame on the screen, in metres: a large room makes a sign only so much larger. */
const PLATE_HEIGHT = 1.2
const PLATE_HEIGHT_LARGE = 2.4
const ROOM_PLATE_HEIGHT = 2.2
const FIT = 0.9

export interface RoomSign {
  id: string
  text: string
  x: number
  z: number
  w: number
  h: number
  bg: string
  fg: string
  /** Part of a room behind a coloured card: goes with their button. */
  card?: CardColour
}

const screenTall = (map: Pick<GameMap, 'coordinateRotation'>) => (map.coordinateRotation ?? 0) % 180 !== 0

/** A sign's box inside a room: as wide as the room lets it, one line high. On a map turned a quarter, x runs up the screen. */
function fitted(map: Pick<GameMap, 'coordinateRotation'>, [x, z, w, h]: RoomBox, height?: number) {
  const tall = screenTall(map)
  const line = height ?? Math.min(PLATE_HEIGHT_LARGE, Math.max(PLATE_HEIGHT, (tall ? w : h) * 0.3))
  return tall
    ? { x, z, w: Math.min(line, w * FIT), h: h * FIT }
    : { x, z, w: w * FIT, h: Math.min(line, h * FIT) }
}

const DOOR_BOX: readonly [number, number] = [4.6, 4.6]
const PLAIN = { bg: '#141a1c', fg: '#f1e7c9' }

/** A door's marker is `<map>-lock-<lock id>` (mapMarkerAdapter.ts). */
export const lockOf = (marker: Pick<MapMarker, 'id'>) => marker.id.replace(/^.*lock-/, '')
const boxes = generatedBoxes as unknown as Readonly<Record<string, RoomBox>>
const traced = tracedBoxes as unknown as Readonly<Record<string, RoomBox>>

/** The signs of a floor: one per room and key; keys that share a room stand one above the other. */
export function keyRoomSigns(map: GameMap, markers: readonly MapMarker[], items: ReadonlyMap<string, Pick<Item, 'shortName'>>, floor: string): RoomSign[] {
  const main = mainFloor(map)
  const signs: RoomSign[] = []
  const seen = new Set<string>()
  for (const marker of markers) {
    if (marker.layerId !== 'key' || !marker.lock || (marker.lock.kind ?? 'door') !== 'door') continue
    if ((marker.floor ?? main) !== floor) continue
    const lock = lockOf(marker)
    const room = map.id === 'the-lab' ? LAB_KEYCARD_ROOMS.find((entry) => entry.locks.includes(lock)) : undefined
    const text = room?.sign ?? (marker.lock.keyId ? items.get(marker.lock.keyId)?.shortName : undefined) ?? marker.lock.keyName
    if (!text) continue
    const box: RoomBox = room
      ? [(room.x[0] + room.x[1]) / 2, (room.z[0] + room.z[1]) / 2, Math.abs(room.x[1] - room.x[0]), Math.abs(room.z[1] - room.z[0])]
      : TRACED_BOXES[lock] ?? traced[lock] ?? boxes[lock] ?? [marker.position[1], marker.position[0], DOOR_BOX[0], DOOR_BOX[1]]
    const key = `${text}|${Math.round(box[0])}|${Math.round(box[1])}`
    if (seen.has(key)) continue
    seen.add(key)
    const colour = room ? CARD_COLOURS[room.card] : undefined
    signs.push({ id: marker.id, text, ...fitted(map, box), bg: colour?.plate ?? PLAIN.bg, fg: colour?.letters ?? PLAIN.fg, ...(room ? { card: room.card } : {}) })
  }
  return standApart(map, signs)
}

/** Two keys of one room would lie on each other: one above the other instead. */
function standApart(map: Pick<GameMap, 'coordinateRotation'>, signs: RoomSign[]) {
  const places = new Map<string, RoomSign[]>()
  for (const sign of signs) {
    const place = `${sign.x.toFixed(1)}|${sign.z.toFixed(1)}`
    places.set(place, [...(places.get(place) ?? []), sign])
  }
  return [...places.values()].flatMap((group) => group.map((sign, index) => {
    if (group.length === 1) return sign
    const step = (index - (group.length - 1) / 2) * PLATE_HEIGHT * 1.15
    return screenTall(map) ? { ...sign, x: sign.x + step } : { ...sign, z: sign.z + step }
  }))
}

/** The Labyrinth's room numbers, beside each room. */
export function labyrinthRoomSigns(map: Pick<GameMap, 'id' | 'coordinateRotation'>, label: (number: number) => string): RoomSign[] {
  if (map.id !== 'the-labyrinth') return []
  return LABYRINTH_ROOMS.map((room) => ({
    id: `labyrinth-room-${room.number}`,
    text: label(room.number),
    ...fitted(map, [room.x, room.z, ROOM_PLATE_HEIGHT / FIT, 11], ROOM_PLATE_HEIGHT),
    bg: '#8e1f24',
    fg: '#ffffff',
  }))
}

/** A zone wider than this is no trap: the data also has one under the whole maze, below its floor. */
const TRAP_MAX_SIDE_M = 15

function zoneFits(outline: ReadonlyArray<readonly [number, number]>) {
  const side = (axis: 0 | 1) => Math.max(...outline.map((point) => point[axis])) - Math.min(...outline.map((point) => point[axis]))
  return side(0) <= TRAP_MAX_SIDE_M && side(1) <= TRAP_MAX_SIDE_M
}

/** The Labyrinth's traps: their zones as the game's data draws them. */
export function labyrinthTraps(map: Pick<GameMap, 'id'>, markers: readonly MapMarker[]) {
  if (map.id !== 'the-labyrinth') return []
  return markers.filter((marker) => marker.layerId === 'hazard' && (marker.outline?.length ?? 0) >= 3 && zoneFits(marker.outline!))
}

/** The Lab's rooms of a floor that a coloured card opens, each with its colour. */
export function keycardRooms(map: GameMap, markers: readonly MapMarker[], floor: string) {
  if (map.id !== 'the-lab') return []
  const main = mainFloor(map)
  const floorOf = new Map(markers.filter((marker) => marker.layerId === 'key').map((marker) => [lockOf(marker), marker.floor ?? main]))
  return LAB_KEYCARD_ROOMS.filter((room) => room.locks.some((lock) => floorOf.get(lock) === floor))
}
