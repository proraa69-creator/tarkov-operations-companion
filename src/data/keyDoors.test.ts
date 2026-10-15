import { describe, expect, it } from 'vitest'
import { buildKeyDoorIndex, isKeyItem, keyDoorHref, keyDoorKindLabel } from './keyDoors'
import { DORM_KEY_ID, FACTORY_KEY_ID, keyMaps, keyMarkers, NO_DOOR_KEY_ID, RED_CARD_ID, STORAGE_CARD_ID } from './__fixtures__/keyDoorsFixture'

describe('key → doors index (data/keyDoors.ts)', () => {
  const index = buildKeyDoorIndex(keyMarkers, keyMaps)

  it('gives a key with one door exactly that door, with its map and floor', () => {
    expect(index.get(DORM_KEY_ID)).toEqual([expect.objectContaining({ markerId: 'customs-lock-dorm-206', mapId: 'customs', mapName: 'Таможня', floor: 'Основной', kind: 'door' })])
    expect(index.get(DORM_KEY_ID)?.[0]?.number).toBeUndefined()
  })

  it('lists every door of a key with several, main floor first, numbered per map', () => {
    const doors = index.get(FACTORY_KEY_ID)!
    expect(doors.map((door) => door.markerId)).toEqual(['factory-lock-cellar', 'factory-lock-gate-3', 'factory-lock-office'])
    expect(doors.map((door) => door.number)).toEqual([1, 2, 3])
    expect(doors[2]).toMatchObject({ floor: '2 этаж', rawFloor: '2 этаж' })
    expect(doors[0]?.rawFloor).toBeUndefined()
  })

  it('drops the Factory exit key placeholder locks of other maps', () => {
    expect(index.get(FACTORY_KEY_ID)!.some((door) => door.mapId === 'lighthouse')).toBe(false)
  })

  it('has no entry for a key without a known door (loot markers are not doors)', () => {
    expect(index.has(NO_DOOR_KEY_ID)).toBe(false)
  })

  it('covers keycards like keys: a Labs card reader and a card with doors on two maps', () => {
    expect(index.get(RED_CARD_ID)).toEqual([expect.objectContaining({ mapId: 'the-lab', keycard: 'red', needsPower: true })])
    const storage = index.get(STORAGE_CARD_ID)!
    expect(storage.map((door) => [door.mapId, door.kind, door.floor])).toEqual([['customs', 'trunk', 'Основной'], ['factory', 'door', 'Тоннели']])
    expect(storage.every((door) => door.number === undefined)).toBe(true)
    expect(keyDoorKindLabel(storage[0]!)).toBe('Дверь машины')
  })

  it('links a door to the Maps page focus parameter', () => {
    expect(keyDoorHref({ mapId: 'factory', markerId: 'factory-lock-office' })).toBe('/maps/factory?lock=factory-lock-office')
  })

  it('treats keycards as keys (tarkov.dev type «keys»)', () => {
    expect(isKeyItem({ category: 'Ключ' })).toBe(true)
    expect(isKeyItem({ category: 'Бартер' })).toBe(false)
  })
})
