import { describe, expect, it } from 'vitest'
import type { MapMarker, MarkerLock } from '../domain/types'
import { buildKeyDoorIndex, isKeyItem, keyDoorFocusCard, keyDoorHref, keyDoorKindLabel, SAME_DOOR_METRES } from './keyDoors'
import { BLACK_KEYCARD_ID, CARDINAL_APARTMENT_KEY_ID, keyDoorExcluded, keyDoorPlace, USEC_COTTAGE_SECOND_SAFE_KEY_ID } from './keyDoorNames'
import { DORM_KEY_ID, FACTORY_KEY_ID, keyMaps, keyMarkers, NO_DOOR_KEY_ID, RED_CARD_ID, STORAGE_CARD_ID } from './__fixtures__/keyDoorsFixture'

/** A lock marker the way src/data/mapMarkerAdapter.ts adaptLocks makes it from a tarkov.dev lock at game x / y / z. */
const tarkovLock = (mapId: string, id: string, keyId: string, [x, y, z]: [number, number, number], floor?: string, kind: MarkerLock['kind'] = 'door'): MapMarker => ({
  id: `${mapId}-lock-${id}`,
  mapId,
  type: 'key',
  layerId: 'key',
  title: 'Дверь',
  description: '',
  position: [z, x],
  height: y,
  floor,
  lock: { keyId, keyName: '', kind },
  source: 'json.tarkov.dev/maps',
})

describe('key → doors index (data/keyDoors.ts)', () => {
  const index = buildKeyDoorIndex(keyMarkers, keyMaps)

  it('gives a key with one door exactly that door, with its map and floor', () => {
    expect(index.get(DORM_KEY_ID)).toEqual([expect.objectContaining({ markerId: 'customs-lock-dorm-206', mapId: 'customs', mapName: 'Таможня', floor: 'Основной', kind: 'door' })])
    expect(index.get(DORM_KEY_ID)?.[0]?.number).toBeUndefined()
  })

  it('lists every door of a key with several, main floor first, numbered per map', () => {
    const doors = index.get(FACTORY_KEY_ID)!.filter((door) => door.mapId === 'factory')
    expect(doors.map((door) => door.markerId)).toEqual(['factory-lock-cellar', 'factory-lock-gate-3', 'factory-lock-office'])
    expect(doors.map((door) => door.number)).toEqual([1, 2, 3])
    expect(doors[2]).toMatchObject({ floor: '2 этаж', rawFloor: '2 этаж' })
    expect(doors[0]?.rawFloor).toBeUndefined()
  })

  it('drops the Factory exit key\'s vehicle locks (the owner: it has five points, no vehicles)', () => {
    expect(index.get(FACTORY_KEY_ID)!.map((door) => [door.mapId, door.kind])).toEqual([['factory', 'door'], ['factory', 'door'], ['factory', 'door']])
  })

  it('has no entry for a key without a known door (loot markers are not doors)', () => {
    expect(index.has(NO_DOOR_KEY_ID)).toBe(false)
  })

  it('covers keycards like keys: a Labs card reader and a card with doors on two maps', () => {
    expect(index.get(RED_CARD_ID)).toEqual([expect.objectContaining({ mapId: 'the-lab', keycard: 'red', needsPower: true })])
    const storage = index.get(STORAGE_CARD_ID)!
    expect(storage.map((door) => [door.mapId, door.kind, door.floor])).toEqual([['factory', 'door', 'Тоннели'], ['customs', 'trunk', 'Основной']])
    expect(storage.every((door) => door.number === undefined)).toBe(true)
    expect(keyDoorKindLabel(storage[1]!)).toBe('Дверь машины')
  })

  it('links a door to the Maps page focus parameter', () => {
    expect(keyDoorHref({ mapId: 'factory', markerId: 'factory-lock-office' })).toBe('/maps/factory?lock=factory-lock-office')
  })

  it('treats keycards as keys (tarkov.dev type «keys»)', () => {
    expect(isKeyItem({ category: 'Ключ' })).toBe(true)
    expect(isKeyItem({ category: 'Бартер' })).toBe(false)
  })
})

// The real tarkov.dev lock points (json.tarkov.dev/regular/maps, 15.10.2026) and what the EFT wiki says they are.
describe('key → doors on the real tarkov.dev locks', () => {
  // TerraGroup Labs keycard (Black): two lock points in G12 (level 1) and two in Kruglov's office R22 (level 2); the
  // Cardinal apartment key's two doors on Streets (the apartment and its bedroom, where the black card's safe panel is).
  const black = [
    tarkovLock('streets-of-tarkov', 'cardinal-b', CARDINAL_APARTMENT_KEY_ID, [121.5, 5.8, -35]),
    tarkovLock('streets-of-tarkov', 'cardinal-a', CARDINAL_APARTMENT_KEY_ID, [106.8, 5.8, -24.2]),
    tarkovLock('the-lab', 'e36b7350a3', BLACK_KEYCARD_ID, [-268.85, 5.47, -372.5], '2-й этаж'),
    tarkovLock('the-lab', 'faa0743309', BLACK_KEYCARD_ID, [-261.39, 5.16, -372.85], '2-й этаж'),
    tarkovLock('the-lab', '577b9b90d0', BLACK_KEYCARD_ID, [-128.79, 1.41, -349.92], '1-й этаж'),
    tarkovLock('the-lab', '6b9c65d4d2', BLACK_KEYCARD_ID, [-132.89, 1.41, -348.72], '1-й этаж'),
  ]
  // The Factory exit key: its 3 Factory doors, the same 3 on Night Factory, truck cabs on other maps, and the two Customs
  // guard-building doors adaptLocks adds from the 29.09.2026 feed (KEY_DOOR_EXTRA_LOCKS).
  const factoryDoors: Array<[string, [number, number, number], string]> = [
    ['2170d1b52a', [-19.08, 1.45, -48.57], 'Основной'],
    ['d6cacb05b0', [66.83, -1.61, -29.32], 'Тоннели'],
    ['aa4ebab35c', [29.12, 9.08, 36.52], '3 этаж'],
  ]
  const exit = [
    ...factoryDoors.map(([id, point, floor]) => tarkovLock('factory', id, FACTORY_KEY_ID, point, floor)),
    ...factoryDoors.map(([id, point, floor]) => tarkovLock('night-factory', `night-${id}`, FACTORY_KEY_ID, point, floor)),
    tarkovLock('lighthouse', 'e284f216ff', FACTORY_KEY_ID, [1.62, 7.94, -167.82], undefined, 'trunk'),
    tarkovLock('streets-of-tarkov', '7e18802b9a', FACTORY_KEY_ID, [98.78, 3.8, 332.94], undefined, 'trunk'),
    tarkovLock('streets-of-tarkov', '2581751119', FACTORY_KEY_ID, [100.59, 3.62, 337.27], undefined, 'trunk'),
    tarkovLock('ground-zero', 'bdc5163b7f', FACTORY_KEY_ID, [80.03, 15.74, 147.8], undefined, 'trunk'),
    tarkovLock('ground-zero-21', '51cb257bca', FACTORY_KEY_ID, [80.03, 15.74, 147.8], undefined, 'trunk'),
    tarkovLock('customs', '2e9c51a0f9edec820a4b1e7fd616b5a55d5e95e5', FACTORY_KEY_ID, [356.97995, 2.139563, -8.04321]),
    tarkovLock('customs', 'ac28b0e35e05bf59e86bd23e39cb471a9ceec5b3', FACTORY_KEY_ID, [356.052551, 2.34000254, -14.5693521]),
  ]
  const index = buildKeyDoorIndex([...black, ...exit], keyMaps)

  it('shows exactly the black keycard\'s three points: the Cardinal apartment safe on Streets and the two G12 doors on The Lab', () => {
    const doors = index.get(BLACK_KEYCARD_ID)!
    expect(doors.map((door) => [door.mapId, door.rawFloor, door.name?.ru, door.name?.en]).sort()).toEqual([
      ['streets-of-tarkov', undefined, 'Квартира «Кардинал» — сейф (панель ключ-карты)', 'Cardinal apartment — safe (keycard panel)'],
      ['the-lab', '1-й этаж', 'Зона экспериментов (G12) — дверь 1', 'Experiment area (G12) — door 1'],
      ['the-lab', '1-й этаж', 'Зона экспериментов (G12) — дверь 2', 'Experiment area (G12) — door 2'],
    ])
    // Kruglov's office R22 is not the black card's (the owner): no level-2 point.
    expect(doors.some((door) => door.rawFloor === '2-й этаж')).toBe(false)
    expect(keyDoorExcluded(BLACK_KEYCARD_ID, 'the-lab', -268.85, -372.5, 5.47)).toBe(true)
    // Each G12 door opens the map on its own lock point; named doors need no number.
    expect(doors.filter((door) => door.mapId === 'the-lab').map((door) => door.markerId).sort()).toEqual(['the-lab-lock-577b9b90d0', 'the-lab-lock-6b9c65d4d2'])
    expect(doors.every((door) => door.number === undefined)).toBe(true)
  })

  it('places the Cardinal safe panel on the Cardinal apartment key\'s lock, with the painting hint, and names it on the map card', () => {
    const safe = index.get(BLACK_KEYCARD_ID)!.find((door) => door.mapId === 'streets-of-tarkov')!
    expect(safe).toMatchObject({ markerId: 'streets-of-tarkov-lock-cardinal-a', kind: 'door', viaOf: BLACK_KEYCARD_ID })
    expect(safe.hint?.ru).toBe('Квартира «Кардинал»: сдвиньте картину — за ней панель ключ-карты и сейф')
    expect(safe.hint?.en).toBe('Cardinal apartment: move the painting — the keycard panel and safe are behind it')
    expect(keyDoorHref(safe)).toBe(`/maps/streets-of-tarkov?lock=streets-of-tarkov-lock-cardinal-a&key=${BLACK_KEYCARD_ID}`)
    // The Cardinal key keeps its own two doors.
    expect(index.get(CARDINAL_APARTMENT_KEY_ID)).toHaveLength(2)
    // The Maps page card of the focused marker: the black card's place and hint, only with its `?key=`.
    const marker = black[1]!
    expect(keyDoorFocusCard(marker, BLACK_KEYCARD_ID, 'en')).toMatchObject({ title: 'Cardinal apartment — safe (keycard panel)', description: 'Cardinal apartment: move the painting — the keycard panel and safe are behind it' })
    expect(keyDoorFocusCard(marker, BLACK_KEYCARD_ID, 'ru').title).toBe('Квартира «Кардинал» — сейф (панель ключ-карты)')
    expect(keyDoorFocusCard(marker, null, 'ru')).toBe(marker)
    expect(keyDoorFocusCard(black[3]!, BLACK_KEYCARD_ID, 'ru')).toBe(black[3])
  })

  it('shows exactly the Factory exit key\'s five points: three Factory doors and the Customs guard building\'s two', () => {
    const doors = index.get(FACTORY_KEY_ID)!
    expect(doors.map((door) => [door.mapId, door.name?.ru, door.name?.en]).sort()).toEqual([
      ['customs', 'Здание охраны — дверь 1', 'Guard building — door 1'],
      ['customs', 'Здание охраны — дверь 2', 'Guard building — door 2'],
      ['factory', 'Вход в подвалы', 'Cellars entrance'],
      ['factory', 'Запасной выход медицинской палатки', 'Med tent emergency exit'],
      ['factory', 'Запертая комната', 'Locked room'],
    ])
    expect(doors.every((door) => door.kind === 'door' && door.number === undefined)).toBe(true)
    expect(doors.find((door) => door.name?.ru === 'Здание охраны — дверь 2')?.markerId).toBe('customs-lock-ac28b0e35e05bf59e86bd23e39cb471a9ceec5b3')
  })

  it('merges map variants: Night Factory and Ground Zero 21+ add no door, and the door opens the map\'s own marker', () => {
    const doors = index.get(FACTORY_KEY_ID)!
    expect(doors.some((door) => door.markerId.startsWith('night-factory') || door.markerId.startsWith('ground-zero-21'))).toBe(false)
    expect(doors.find((door) => door.name?.ru === 'Вход в подвалы')?.markerId).toBe('factory-lock-d6cacb05b0')
    const gz = buildKeyDoorIndex([
      tarkovLock('ground-zero-21', 'gz21', 'gz-key', [80.03, 15.74, 147.8]),
      tarkovLock('ground-zero', 'gz', 'gz-key', [80.03, 15.74, 147.8]),
    ], keyMaps).get('gz-key')!
    expect(gz.map((door) => [door.mapId, door.markerId])).toEqual([['ground-zero', 'ground-zero-lock-gz']])
    // A lock known only on a variant is still the map's door.
    const dark = buildKeyDoorIndex([tarkovLock('the-lab-dark', 'dark', RED_CARD_ID, [-257.22, 5.25, -322.93])], keyMaps)
    expect(dark.get(RED_CARD_ID)).toEqual([expect.objectContaining({ mapId: 'the-lab', mapName: 'Лаборатория', markerId: 'the-lab-dark-lock-dark' })])
  })

  it('de-duplicates the same lock point listed twice, but keeps close distinct doors and other levels apart', () => {
    const key = 'dedupe-key'
    const doors = buildKeyDoorIndex([
      tarkovLock('streets-of-tarkov', 'a', key, [10, 3, 10]),
      tarkovLock('streets-of-tarkov', 'a-again', key, [10.4, 3.1, 10.3]),
      // The Tarbank cash booths are 1.9 m apart: two doors.
      tarkovLock('streets-of-tarkov', 'b', key, [11.9, 3, 10]),
      // Straight above, one level up: another door.
      tarkovLock('streets-of-tarkov', 'c', key, [10, 6.5, 10]),
    ], keyMaps).get(key)!
    expect(SAME_DOOR_METRES).toBeLessThan(1.9)
    expect(doors.map((door) => door.markerId)).toEqual(['streets-of-tarkov-lock-a', 'streets-of-tarkov-lock-b', 'streets-of-tarkov-lock-c'])
  })

  it('names a place only for its own key, map and level', () => {
    expect(keyDoorPlace(BLACK_KEYCARD_ID, 'the-lab', -128.79, -349.92, 1.41)?.ru).toBe('Зона экспериментов (G12) — дверь 1')
    expect(keyDoorPlace(BLACK_KEYCARD_ID, 'the-lab', -132.89, -348.72, 1.41)?.ru).toBe('Зона экспериментов (G12) — дверь 2')
    expect(keyDoorPlace(BLACK_KEYCARD_ID, 'the-lab', -128.79, -349.92, 5.2)).toBeUndefined()
    expect(keyDoorPlace(RED_CARD_ID, 'the-lab', -128.79, -349.92, 1.41)).toBeUndefined()
    expect(keyDoorPlace(USEC_COTTAGE_SECOND_SAFE_KEY_ID, 'lighthouse', -81.35, -57.37, 22.33)?.ru).toBe('Сейф в синем шале')
  })
})
