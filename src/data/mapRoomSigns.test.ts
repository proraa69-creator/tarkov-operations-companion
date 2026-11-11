import { describe, expect, it } from 'vitest'
import type { GameMap, MapMarker } from '../domain/types'
import { catalogForWire, catalogFromWire } from './catalogWire'
import { adaptLiveMapMarkers } from './mapMarkerAdapter'
import { CARD_COLOURS, keycardRooms, keyRoomSigns, LAB_KEYCARD_ROOMS, labyrinthRoomSigns, labyrinthTraps, lockedRooms, behindLockedDoor } from './mapRoomSigns'
import { maps } from './demo'
import boxes from './keyRoomBoxes.json'
import traced from './keyRoomTraced.json'

const door = (id: string, keyId: string, position: [number, number], floor?: string, keyName = keyId): MapMarker => ({
  id: `the-map-lock-${id}`, mapId: 'm', type: 'key', layerId: 'key', title: 'Дверь', description: '', position, ...(floor ? { floor } : {}),
  lock: { keyId, keyName, kind: 'door' },
}) as MapMarker
const lab = { id: 'the-lab', name: 'Лаборатория', coordinateRotation: 270, layers: [{ name: 'Основной' }, { name: '2 уровень' }], floors: ['Основной', '2 уровень'] } as unknown as GameMap
const customs = { id: 'customs', name: 'Таможня', coordinateRotation: 180, floors: ['Основной'] } as unknown as GameMap
const items = new Map([['card-red', { shortName: 'Красная' }], ['dorm', { shortName: 'Общ 206' }], ['other', { shortName: 'Другой' }]])

/** A room only the script found. */
const scriptOnly = Object.keys(boxes).find((id) => !(id in traced))!

describe('the keys’ signs in their rooms', () => {
  it('stand in the room the scheme draws, one line high, not at the door', () => {
    const lock = scriptOnly
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
    const lockId = scriptOnly
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

describe('the rooms read off the maps by eye', () => {
  const rooms = traced as unknown as Record<string, [number, number, number, number]>
  const shoreline = { id: 'shoreline', name: 'Берег', coordinateRotation: 180, floors: ['Основной'] } as unknown as GameMap
  const terminal = { id: 'terminal', name: 'Терминал', coordinateRotation: 180, floors: ['Основной'] } as unknown as GameMap

  /** One door of each map, as the game's data places it: x, z. */
  const DOORS: Array<[string, string, number, number]> = [
    ['Резерв, РБ-АМ', '62cc55867226a4055f8967b6853af07f03e848d5', -133.29, -16.09],
    ['Улицы, Conc 63', '06ebd4258d81fab855fdec734d6cb68269e5a015', 268.49, 387.51],
    ['Завод, Полихим', '0b8dbbc9604c2f03ae8bff8a5e0a8e62d2e3d7c5', -20.43, 44.06],
    ['Развязка, МЧС', 'b59cc5fead6703e80ced71ac31efbe1ef9ecc104', 6.73, -107.3],
    ['Лабиринт, Ключ 02', '8a40f5cb87ed310b3e05c109f3e320d37668049f', -2.48, -34.2],
    ['Берег, ГЭС', 'dbda19cd349f8cd5ba9533b97ec16146e8377b05', -220.3, 185.9],
  ]

  it('every room has a real place and size', () => {
    expect(Object.keys(rooms).length).toBeGreaterThan(100)
    for (const [id, box] of Object.entries(rooms)) {
      expect(id).toMatch(/^[0-9a-f]{40}$/)
      expect(box).toHaveLength(4)
      for (const value of box) expect(Number.isFinite(value)).toBe(true)
      expect(box[2]).toBeGreaterThan(0)
      expect(box[3]).toBeGreaterThan(0)
      expect(Math.max(box[2], box[3])).toBeLessThanOrEqual(15)
    }
  })

  it('a room lies by its door', () => {
    const known = DOORS.filter(([, id]) => rooms[id])
    expect(known).toHaveLength(DOORS.length)
    for (const [name, id, x, z] of known) {
      const [roomX, roomZ] = rooms[id]
      expect(Math.hypot(roomX - x, roomZ - z), name).toBeLessThanOrEqual(25)
    }
  })

  it('wins over what the script found: a gap between walls is no room, the sign stands at the door', () => {
    const pier = '3794a6287b0992d93e5fbea87759eaa199727b41'
    const script = (boxes as unknown as Record<string, number[]>)[pier]
    expect(script).toBeDefined()
    const [sign] = keyRoomSigns(terminal, [door(pier, 'dorm', [340.9, -258.8])], items, 'Основной')
    expect(sign).toMatchObject({ x: -258.8, z: 340.9 })
    expect(sign.x).not.toBe(script[0])
  })

  it('two doors of one room are one sign', () => {
    const left = 'b8f4f05e066da9acea198b23ed9ef135a8fedbea'
    const right = '7ac6ed812ba47bd9f90cb5cbe5b8b72fb7d5d976'
    expect(rooms[left]).toEqual(rooms[right])
    const signs = keyRoomSigns(customs, [door(left, 'dorm', [231.5, 67]), door(right, 'dorm', [231.5, 68.9])], items, 'Основной')
    expect(signs).toHaveLength(1)
    expect(signs[0]).toMatchObject({ x: rooms[left][0], z: rooms[left][1] })
  })

  it('a narrow room’s sign stays inside its walls', () => {
    const narrow = Object.entries(rooms).find(([, box]) => box[2] <= 3)!
    const [sign] = keyRoomSigns(shoreline, [door(narrow[0], 'dorm', [0, 0])], items, 'Основной')
    expect(sign.w).toBeLessThanOrEqual(narrow[1][2])
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
    // the feed's spots (the players' key spots with photos are static data of their own maps)
    const route = markers.filter((marker) => marker.layerId === 'loot.key' && marker.source !== 'raidos')
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

describe('items behind a locked door (report №114)', () => {
  const customs = maps.find((map) => map.id === 'customs')!
  const door = { id: 'customs-lock-123d3867c7b9125c01cd2c17e0c1cec6497f04d2', mapId: 'customs', type: 'key', layerId: 'key', title: 'Дверь', description: '', position: [165, 180] as [number, number], floor: '2 этаж', lock: { kind: 'door' as const, keyId: 'k', keyName: 'Ключ' } } as unknown as MapMarker
  const rooms = lockedRooms(customs, [door])

  it('takes the door\'s room box on its floor', () => {
    expect(rooms).toHaveLength(1)
    expect(rooms[0]).toMatchObject({ x0: 181.7 - 2.8, x1: 181.7 + 2.8, z0: 165.4 - 3, z1: 165.4 + 3, floor: '2 этаж' })
  })

  it('marks a point inside the room on that floor only', () => {
    expect(behindLockedDoor(rooms, [165.4, 181.7], '2 этаж')).toBe(true)
    expect(behindLockedDoor(rooms, [165.4, 181.7], 'Основной')).toBe(false)
    expect(behindLockedDoor(rooms, [175, 181.7], '2 этаж')).toBe(false)
  })
})
