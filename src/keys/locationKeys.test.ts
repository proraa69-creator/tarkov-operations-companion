import { beforeEach, describe, expect, it } from 'vitest'
import type { GameMap, Item } from '../domain/types'
import type { KeyDoor } from '../data/keyDoors'
import { clampKeysPosition, defaultKeysPosition, keyDoorsHref, keysOfLocation, locationsWithKeys } from './locationKeysList'
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

  it('where it was dragged is remembered', () => {
    locationKeys.move({ x: 40, y: 120 })
    expect(JSON.parse(localStorage.getItem('raidos-location-keys-position-v1')!)).toEqual({ x: 40, y: 120 })
  })
})
