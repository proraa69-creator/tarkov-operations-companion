import { beforeEach, describe, expect, it } from 'vitest'
import type { GameMap, Item, RaidMode } from '../domain/types'
import type { KeyDoor } from '../data/keyDoors'
import { byTier, clampKeysPosition, defaultKeysPosition, keyDoorsHref, keyTiers, keysOfLocation, locationsWithKeys, shortRoubles } from './locationKeysList'
import { locationKeys } from './locationKeysStore'

const door = (markerId: string, mapId: string): KeyDoor => ({ markerId, mapId, mapName: mapId, floor: 'Основной', kind: 'door' })
const item = (id: string, name: string) => ({ id, name, shortName: name }) as Item

describe('report 186: the location\'s keys', () => {
  const index = new Map<string, KeyDoor[]>([
    ['factory-exit', [door('a', 'factory'), door('b', 'customs'), door('c', 'customs')]],
    ['dorm', [door('d', 'customs')]],
    ['unknown', [door('e', 'customs')]],
    ['labs-red', [door('f', 'the-lab')]],
  ])
  const items = new Map([['factory-exit', item('factory-exit', 'Завод')], ['dorm', item('dorm', 'Общага')], ['labs-red', item('labs-red', 'Красная')]])

  it('every key that opens something there, with its doors there only; named first by name', () => {
    const keys = keysOfLocation(index, 'customs', items)
    expect(keys.map((entry) => entry.keyId)).toEqual(['factory-exit', 'dorm', 'unknown'])
    expect(keys.find((entry) => entry.keyId === 'factory-exit')!.doors.map((entry) => entry.markerId)).toEqual(['b', 'c'])
    // a map variant counts as its map
    expect(keysOfLocation(index, 'night-factory', items).map((entry) => entry.keyId)).toEqual(['factory-exit'])
  })

  it('the location switch lists the maps that have keys, once each, in the catalog order', () => {
    const maps = ['customs', 'woods', 'factory', 'night-factory', 'the-lab'].map((id) => ({ id, name: id }) as GameMap)
    expect(locationsWithKeys(index, maps).map((map) => map.id)).toEqual(['customs', 'factory', 'the-lab'])
  })

  it('the window stays on the screen; the map address lights a key\'s doors', () => {
    expect(defaultKeysPosition(392, 1400)).toEqual({ x: 984, y: 96 })
    expect(clampKeysPosition({ x: -2000, y: -50 }, { width: 392, height: 420 }, { width: 1024, height: 768 })).toEqual({ x: -264, y: 8 })
    expect(clampKeysPosition({ x: 5000, y: 5000 }, { width: 392, height: 420 }, { width: 1024, height: 768 })).toEqual({ x: 904, y: 720 })
    expect(keyDoorsHref('customs', 'k 1', 'door-2')).toBe('/maps/customs?keyDoors=k%201&door=door-2')
  })
})

describe('report 186: one window for every «Ключи» button', () => {
  beforeEach(() => locationKeys.reset())

  it('a button opens it on its location; the same button again closes it; another location switches it', () => {
    locationKeys.toggle('customs')
    expect(locationKeys.get()).toMatchObject({ open: true, mapId: 'customs' })
    locationKeys.toggle('woods')
    expect(locationKeys.get()).toMatchObject({ open: true, mapId: 'woods' })
    locationKeys.focus('key', 'woods')
    locationKeys.toggle('woods')
    expect(locationKeys.get()).toMatchObject({ open: false, focus: null })
  })

  it('follows the map page\'s map without a picker (owner, 19.11.2026); a key\'s doors stay open on their map', () => {
    locationKeys.toggle('customs')
    locationKeys.followMap('woods')
    expect(locationKeys.get()).toMatchObject({ open: true, mapId: 'woods' })
    locationKeys.focus('key', 'reserve')
    locationKeys.followMap('reserve')
    expect(locationKeys.get()).toMatchObject({ mapId: 'reserve', focus: { keyId: 'key', mapId: 'reserve' } })
  })

  it('where it was dragged is remembered', () => {
    locationKeys.move({ x: 40, y: 120 })
    expect(JSON.parse(localStorage.getItem('raidos-location-keys-position-v1')!)).toEqual({ x: 40, y: 120 })
  })
})

describe('the location keys: price and tier-list letter (owner, 18.11.2026)', () => {
  const key = (id: string, prices: Partial<Record<RaidMode, number>>) => ({
    id, name: id, shortName: id, types: ['keys'], width: 1, height: 1,
    prices: Object.entries(prices).map(([mode, price]) => ({ source: 'Барахолка', kind: 'flea' as const, mode: mode as RaidMode, price: price!, updatedAt: '' })),
  }) as Item

  it('as «Тир-листы» → «Ключи» rank them in the chosen mode; a key without a price has neither', () => {
    const items = [
      ...Array.from({ length: 9 }, (_, at) => key(`k${at}`, { pvp: 10_000 + at * 1000, pve: 50_000 - at * 1000 })),
      key('red', { pvp: 9_000_000, pve: 1_000 }),
      key('unsold', {}),
      { id: 'ammo', name: 'ammo', types: ['ammo'], prices: [{ source: 'Барахолка', kind: 'flea', mode: 'pvp', price: 99_000_000, updatedAt: '' }] } as Item,
    ]
    const pvp = keyTiers(items, 'pvp')
    expect(pvp.get('red')).toEqual({ tier: 'S', price: 9_000_000 })
    expect(pvp.get('k0')!.tier).toBe('D')
    expect(pvp.has('unsold')).toBe(false)
    expect(pvp.has('ammo')).toBe(false)
    expect(keyTiers(items, 'pve').get('red')).toEqual({ tier: 'D', price: 1_000 })
  })

  it('a short price for the card', () => {
    expect(shortRoubles(8_500, 'ru')).toBe('8 500 ₽')
    expect(shortRoubles(85_400, 'ru')).toBe('85 тыс ₽')
    expect(shortRoubles(1_240_000, 'ru')).toBe('1,2 млн ₽')
    expect(shortRoubles(15_000_000, 'ru')).toBe('15 млн ₽')
    expect(shortRoubles(999_700, 'ru')).toBe('1 млн ₽')
    expect(shortRoubles(85_400, 'en')).toBe('85K ₽')
    expect(shortRoubles(1_240_000, 'en')).toBe('1.2M ₽')
    expect(shortRoubles(8_500, 'en')).toBe('8,500 ₽')
  })
})

describe('the location keys window lists the best keys first (owner, 19.11.2026)', () => {
  it('S, A… D by the tier list, the dearest first in a letter, the unpriced last in their order', () => {
    const keys = ['d', 'noprice1', 'a-cheap', 's', 'a-dear', 'noprice2'].map((keyId) => ({ keyId }))
    const tiers = new Map([['d', { tier: 'D' as const, price: 1 }], ['a-cheap', { tier: 'A' as const, price: 10 }], ['s', { tier: 'S' as const, price: 5 }], ['a-dear', { tier: 'A' as const, price: 99 }]])
    expect(byTier(keys, tiers).map((key) => key.keyId)).toEqual(['s', 'a-dear', 'a-cheap', 'd', 'noprice1', 'noprice2'])
  })
})
