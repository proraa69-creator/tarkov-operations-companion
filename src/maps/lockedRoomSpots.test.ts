import { describe, expect, it } from 'vitest'
import type { MapMarker } from '../domain/types'
import type { LockedRoom } from '../data/mapRoomSigns'
import { behindLockedDoor } from '../data/mapRoomSigns'
import { floorsFromNeighbours, mapKnowsFloors, mergeRoomKeySpots, mergeSpotHeaps } from './lockedRoomSpots'

const room: LockedRoom = { x0: 0, x1: 10, z0: 0, z1: 10, floor: 'Основной', keyId: 'k-room', height: 5 }
const key = (id: string, x: number, z: number, keyIds: string[], height = 5): MapMarker => ({
  id, mapId: 'customs', type: 'cache', layerId: 'loot.key', title: keyIds[0]!, description: '', position: [z, x], itemId: keyIds[0], keyIds, height,
})

describe('a locked room (owner, 11.11.2026: «сделай один спавн… и напиши несколько точек спавна в этой комнате»)', () => {
  it('its key spots become one point with every key and the number of spots; others stay', () => {
    const worth = (id: string) => ({ marked: 3, b: 2, a: 1 } as Record<string, number>)[id] ?? 0
    const out = mergeRoomKeySpots([key('s1', 2, 2, ['a']), key('s2', 5, 5, ['marked']), key('s3', 8, 8, ['a', 'b']), key('out', 30, 30, ['a'])], [room], 'Основной', worth)
    expect(out.map((marker) => marker.id)).toEqual(['s1', 'out'])
    expect(out[0]).toMatchObject({ roomSpots: 3, keyIds: ['marked', 'b', 'a'], itemId: 'marked', keyCount: 3, title: 'Ключи: 3' })
  })

  it('a spot a storey above or below the door is not in the room, whatever the floor names say', () => {
    expect(behindLockedDoor([room], [5, 5], 'Основной', 5.5)).toBe(true)
    expect(behindLockedDoor([room], [5, 5], 'Основной', 8.6)).toBe(false)
    expect(behindLockedDoor([room], [5, 5], 'Основной', 1.6)).toBe(false)
    const out = mergeRoomKeySpots([key('s1', 2, 2, ['a']), key('up', 5, 5, ['b'], 8.6)], [room], 'Основной')
    expect(out.map((marker) => marker.roomSpots ?? 1)).toEqual([1, 1])
  })
})

describe('floors where the map tells none (Lighthouse, Woods: «указывай этажи всех предметов на карте»)', () => {
  const at = (id: string, x: number, height: number): MapMarker => ({ id, mapId: 'lighthouse', type: 'cache', layerId: 'loot.container', title: '', description: '', position: [0, x], height })
  it('a point a storey or two above the ground around it is upstairs; the ground and far points say nothing', () => {
    const floors = floorsFromNeighbours([at('ground', 0, 10), at('second', 4, 13.3), at('third', 6, 16.5), at('far', 200, 30)])
    expect(floors.get('second')).toBe('2 этаж')
    expect(floors.get('third')).toBe('3 этаж')
    expect(floors.has('ground')).toBe(false)
    expect(floors.has('far')).toBe(false)
  })

  it('only maps whose layers say nothing of heights', () => {
    expect(mapKnowsFloors({ layers: [{ name: 'Основной' }, { name: '2 этаж' }] as never })).toBe(false)
    expect(mapKnowsFloors({ layers: [{ name: '2 этаж', heightRange: [10, 15] }] as never })).toBe(true)
  })
})

describe('a heap of spots seen from afar (owner, 11.11.2026: «при отдалении показывается одна… приближаешь… несколько»)', () => {
  it('keys lying close together on one floor are one point with every key; far or another storey stay apart', () => {
    const spots = [key('a', 100, 100, ['k1']), key('b', 103, 101, ['k2']), key('c', 107, 103, ['k1']), key('far', 140, 100, ['k3']), key('up', 101, 100, ['k4'], 9)]
    const out = mergeSpotHeaps(spots, 'Основной')
    expect(out.map((marker) => marker.id)).toEqual(['a', 'far', 'up'])
    expect(out[0]).toMatchObject({ roomSpots: 3, keyIds: ['k1', 'k2'], keyCount: 2 })
    expect(out[1]!.roomSpots).toBeUndefined()
  })

  it('an item heap is one item only; a point merged by its locked room stays', () => {
    const item = (id: string, x: number, itemId: string): MapMarker => ({ id, mapId: 'customs', type: 'cache', layerId: 'loot.valuable', title: itemId, description: '', position: [0, x], itemId })
    const out = mergeSpotHeaps([item('a', 0, 'gpu'), item('b', 2, 'gpu'), item('c', 4, 'ledx'), { ...key('room', 1, 0, ['k1']), roomSpots: 4 }, key('near', 2, 1, ['k2'])], 'Основной')
    expect(out.map((marker) => marker.id)).toEqual(['a', 'c', 'room', 'near'])
    expect(out[0]!.roomSpots).toBe(2)
  })
})
