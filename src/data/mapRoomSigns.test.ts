import { describe, expect, it } from 'vitest'
import type { GameMap, MapMarker } from '../domain/types'
import { catalogForWire, catalogFromWire } from './catalogWire'
import { adaptLiveMapMarkers } from './mapMarkerAdapter'
import { CARD_COLOURS, keycardRooms, keyRoomSigns, LAB_KEYCARD_ROOMS, labyrinthRoomSigns, labyrinthTraps } from './mapRoomSigns'
import boxes from './keyRoomBoxes.json'

const door = (id: string, keyId: string, position: [number, number], floor?: string, keyName = keyId): MapMarker => ({
  id: `the-map-lock-${id}`, mapId: 'm', type: 'key', layerId: 'key', title: 'Дверь', description: '', position, ...(floor ? { floor } : {}),
  lock: { keyId, keyName, kind: 'door' },
}) as MapMarker
const lab = { id: 'the-lab', name: 'Лаборатория', coordinateRotation: 270, layers: [{ name: 'Основной' }, { name: '2 уровень' }], floors: ['Основной', '2 уровень'] } as unknown as GameMap
const customs = { id: 'customs', name: 'Таможня', coordinateRotation: 180, floors: ['Основной'] } as unknown as GameMap
const items = new Map([['card-red', { shortName: 'Красная' }], ['dorm', { shortName: 'Общ 206' }], ['other', { shortName: 'Другой' }]])

describe('the keys’ signs in their rooms', () => {
  it('stand in the room the scheme draws, one line high, not at the door', () => {
    const lock = Object.keys(boxes)[0]
    const [x, z, w] = (boxes as unknown as Record<string, number[]>)[lock]
    const [sign] = keyRoomSigns(customs, [door(lock, 'dorm', [0, 0])], items, 'Основной')
    expect(sign).toMatchObject({ text: 'Общ 206', x, z })
    expect(sign.h).toBeLessThanOrEqual(1.2)
    expect(sign.w).toBeLessThanOrEqual(w)
  })

  it('a door no room is known for has its sign at the door', () => {
    const [sign] = keyRoomSigns(customs, [door('nowhere', 'dorm', [12, 34])], items, 'Основной')
    expect(sign).toMatchObject({ x: 34, z: 12 })
  })

  it('only on the door’s own floor', () => {
    const marker = door('nowhere', 'dorm', [12, 34], '2 этаж')
    expect(keyRoomSigns(customs, [marker], items, 'Основной')).toEqual([])
    expect(keyRoomSigns(customs, [marker], items, '2 этаж')).toHaveLength(1)
  })

  it('two doors of one room and key are one sign; two keys of one room stand apart', () => {
    const [room] = LAB_KEYCARD_ROOMS.filter((entry) => entry.locks.length === 2)
    const twoDoors = room.locks.map((lock) => door(lock, 'card-red', [0, 0]))
    expect(keyRoomSigns(lab, twoDoors, items, 'Основной')).toHaveLength(1)
    const lockId = Object.keys(boxes)[0]
    const shared = [door(lockId, 'dorm', [0, 0]), { ...door(lockId, 'other', [0, 0]), id: `the-map-lock-${lockId}` }]
    const [one, other] = keyRoomSigns(customs, shared, items, 'Основной')
    expect(Math.abs(one.z - other.z)).toBeGreaterThanOrEqual(1.2)
    expect(one.x).toBe(other.x)
  })

  it('takes no trunk or container', () => {
    const trunk = { ...door('t', 'dorm', [0, 0]), lock: { keyId: 'dorm', keyName: 'dorm', kind: 'trunk' } } as MapMarker
    expect(keyRoomSigns(customs, [trunk], items, 'Основной')).toEqual([])
  })
})

describe('the Lab’s rooms behind a coloured card', () => {
  const red = LAB_KEYCARD_ROOMS.find((room) => room.card === 'red')!

  it('are outlined on the floor of their door, in the card’s colour', () => {
    const marker = door(red.locks[0], 'card-red', [0, 0], '2 уровень')
    expect(keycardRooms(lab, [marker], '2 уровень')).toEqual([red])
    expect(keycardRooms(lab, [marker], 'Основной')).toEqual([])
    expect(keyRoomSigns(lab, [marker], items, '2 уровень')[0]).toMatchObject({ text: 'Красная', card: 'red', bg: CARD_COLOURS.red.plate })
  })

  it('every colour has its room; no other map has them', () => {
    expect(new Set(LAB_KEYCARD_ROOMS.map((room) => room.card))).toEqual(new Set(['red', 'green', 'blue', 'violet', 'yellow', 'black']))
    expect(keycardRooms(customs, [door(red.locks[0], 'card-red', [0, 0])], 'Основной')).toEqual([])
  })

  it('a door there is a colour’s only by its own lock: another door of the Lab has a plain sign', () => {
    const [sign] = keyRoomSigns(lab, [door('plain', 'other', [10, 20])], items, 'Основной')
    expect(sign.card).toBeUndefined()
  })
})

describe('the Labyrinth', () => {
  const labyrinth = { id: 'the-labyrinth', coordinateRotation: 270 } as GameMap

  it('numbers its five spawn rooms, on no other map', () => {
    expect(labyrinthRoomSigns(labyrinth, (n) => `Комната ${n}`).map((sign) => sign.text)).toEqual(['Комната 1', 'Комната 2', 'Комната 3', 'Комната 4', 'Комната 5'])
    expect(labyrinthRoomSigns(customs, (n) => `${n}`)).toEqual([])
  })

  it('outlines only what has a zone', () => {
    const zone = { id: 'a', layerId: 'hazard', outline: [[0, 0], [0, 1], [1, 1]] } as MapMarker
    const point = { id: 'b', layerId: 'hazard' } as MapMarker
    const underTheMaze = { id: 'c', layerId: 'hazard', outline: [[-8, -30], [51, -30], [51, 24]] } as MapMarker
    expect(labyrinthTraps(labyrinth, [zone, point, underTheMaze])).toEqual([zone])
    expect(labyrinthTraps(customs, [zone])).toEqual([])
  })

  it('zones that share one id all stay', () => {
    const hazard = (x: number) => ({ id: 'same', position: { x, y: 0, z: 0 }, outline: [{ x, z: 0 }, { x: x + 1, z: 0 }, { x, z: 1 }] })
    const markers = adaptLiveMapMarkers({ maps: { a: { normalizedName: 'the-labyrinth', hazards: [hazard(1), hazard(5)] } } }, {}, context)
    expect(markers.filter((marker) => marker.layerId === 'hazard')).toHaveLength(2)
  })

  const context = {
    maps: [{ id: 'the-labyrinth', name: 'Лабиринт', transform: [1, 0, 1, 0], bounds: [[0, 0], [1, 1]] }, { id: 'customs', name: 'Таможня', transform: [1, 0, 1, 0], bounds: [[0, 0], [1, 1]] }] as unknown as GameMap[],
    mapNameByApiId: new Map(),
    quests: [],
    items: new Map([
      ['67ab3d4b83869afd170fdd3f', { id: '67ab3d4b83869afd170fdd3f', name: 'Газовый резак', shortName: 'BBQ-S43', types: ['keys'] }],
      ['679baa2c61f588ae2b062a24', { id: '679baa2c61f588ae2b062a24', name: 'Ключ 01', shortName: 'Ключ 01', types: ['keys'] }],
    ]),
  } as unknown as Parameters<typeof adaptLiveMapMarkers>[2]
  const loot = [{ position: { x: 1, y: 0, z: 2 }, items: ['67ab3d4b83869afd170fdd3f', '679baa2c61f588ae2b062a24', 'junk'] }]

  it('each spot of each key and tool is its own point, on no other map', () => {
    const markers = adaptLiveMapMarkers({ maps: { a: { normalizedName: 'the-labyrinth', lootLoose: loot }, b: { normalizedName: 'customs', lootLoose: loot } } }, {}, context)
    const route = markers.filter((marker) => marker.layerId === 'loot.key')
    expect(route.map((marker) => marker.title).sort()).toEqual(['Газовый резак', 'Ключ 01'])
    expect(route.every((marker) => marker.mapId === 'the-labyrinth')).toBe(true)
  })

  it('reaches an older app on a layer it knows and comes back', () => {
    const marker = { id: 'r', mapId: 'the-labyrinth', type: 'cache', layerId: 'loot.key', title: 'Ключ 01', description: '', position: [0, 0] } as MapMarker
    const dataset = { maps: [], markers: [marker], quests: [], items: [], hideout: [], traders: [] } as unknown as Parameters<typeof catalogForWire>[0]
    const wire = catalogForWire(dataset)
    expect(wire.markers[0]).toMatchObject({ layerId: 'loot.technical', wireLayer: 'loot.key' })
    expect(catalogFromWire(wire).markers[0].layerId).toBe('loot.key')
  })
})
