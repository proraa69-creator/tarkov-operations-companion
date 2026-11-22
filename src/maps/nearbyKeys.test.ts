import { beforeEach, describe, expect, it } from 'vitest'
import type { MapMarker, Quest } from '../domain/types'
import { closeNearbyKeys, nearbyKeys, nearbyKeysClosedFor, nearbyKeysOn, setNearbyKeysOn } from './nearbyKeys'

const point = (id: string, z: number, x: number, patch: Partial<MapMarker> = {}) => ({ id, mapId: 'customs', type: 'cache', title: '', description: '', position: [z, x], ...patch }) as MapMarker
const quest = { id: 'q', name: 'Квест' } as Quest
const needed = new Map([['dorm-114', { quests: [quest] }]])

describe('«Ключи рядом» (owner, 19.11.2026)', () => {
  beforeEach(() => localStorage.clear())

  it('the spawns of a needed key within 50 m of a current quest point, on its storey; the far and the not needed are left out', () => {
    const spots = [
      point('near', 0, 30, { layerId: 'loot.key', keyIds: ['dorm-114', 'other'] }),
      point('far', 0, 200, { layerId: 'loot.key', keyIds: ['dorm-114'] }),
      point('above', 0, 10, { layerId: 'loot.key', keyIds: ['dorm-114'], height: 20 }),
      point('unneeded', 0, 5, { layerId: 'loot.key', keyIds: ['other'] }),
    ]
    const quests = [point('qp', 0, 0, { type: 'quest', questId: 'q', height: 1 })]
    const found = nearbyKeys(spots, quests, needed)
    expect(found).toHaveLength(1)
    expect(found[0]!.keyId).toBe('dorm-114')
    expect(found[0]!.spots.map((spot) => spot.id)).toEqual(['near'])
    expect(found[0]!.quests).toEqual([quest])
  })

  it('on by default; «Закрыть» ends it for that raid only', () => {
    expect(nearbyKeysOn()).toBe(true)
    setNearbyKeysOn(false)
    expect(nearbyKeysOn()).toBe(false)
    closeNearbyKeys(1234)
    expect(nearbyKeysClosedFor()).toBe(1234)
  })
})
