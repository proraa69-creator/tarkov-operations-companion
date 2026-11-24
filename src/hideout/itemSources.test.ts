import { describe, expect, it } from 'vitest'
import type { Barter, Craft } from '../data/economyApi'
import { circleRows } from './cultistCircle'
import { itemSources, sourceOpen } from './itemSources'

const craft = (id: string, stationName: string, level: number, required: Array<[string, number]>, reward: Array<[string, number]>): Craft => ({
  id, stationId: `station-${stationName}`, stationName, level, duration: 3600,
  requiredItems: required.map(([itemId, count]) => ({ itemId, count })), rewardItems: reward.map(([itemId, count]) => ({ itemId, count })),
})
const barter = (id: string, traderName: string, level: number, required: Array<[string, number]>, reward: Array<[string, number]>): Barter => ({
  id, traderId: `trader-${traderName}`, traderName, level,
  requiredItems: required.map(([itemId, count]) => ({ itemId, count })), rewardItems: reward.map(([itemId, count]) => ({ itemId, count })),
})

describe('где взять предмет', () => {
  const snapshot = {
    crafts: [
      craft('c1', 'Верстак', 2, [['bolts', 2]], [['wire', 1]]),
      craft('c2', 'Санузел', 1, [['water', 1]], [['wire', 2]]),
      craft('c3', 'Верстак', 1, [['bolts', 1]], [['nuts', 1]]),
      // a refill takes the item in and gives it back: no way to get it
      craft('c4', 'Генератор', 1, [['wire', 1], ['fuel', 1]], [['wire', 1]]),
    ],
    barters: [
      barter('b1', 'Механик', 3, [['gpu', 1]], [['wire', 5]]),
      barter('b2', 'Прапор', 1, [['nuts', 1]], [['wire', 1]]),
    ],
  }

  it('lists crafts by station and level, then barters by trader level', () => {
    const sources = itemSources('wire', snapshot, [])
    expect(sources.map((source) => source.key)).toEqual(['craft:c1', 'craft:c2', 'barter:b2', 'barter:b1'])
    expect(sources.find((source) => source.key === 'craft:c2')?.count).toBe(2)
  })

  it('finds the cultist circle exchanges that give the item, surely or by chance', () => {
    // Soap → Awl; Tagilla figurine → one of the welding masks by chance
    const awl = itemSources('62a0a098de7ac8199358053b', undefined)
    expect(awl).toHaveLength(1)
    expect(awl[0]).toMatchObject({ kind: 'circle', count: 1, maybe: false })
    const mask = itemSources('60a7ad3a0c5cb24b0134664a', undefined)
    expect(mask.some((source) => source.kind === 'circle' && source.maybe)).toBe(true)
  })

  it('skips an exchange that only gives the item back', () => {
    // Mazoni golden dumbbell → Mazoni golden dumbbell
    expect(itemSources('6937edb912d456a817083e82', undefined, circleRows())).toEqual([])
  })

  it('a craft is open from its module level, the circle once it is built', () => {
    const [first] = itemSources('wire', snapshot, [])
    expect(sourceOpen(first!, { 'station-Верстак': 1 })).toBe(false)
    expect(sourceOpen(first!, { 'station-Верстак': 2 })).toBe(true)
    const [circle] = itemSources('62a0a098de7ac8199358053b', undefined)
    expect(sourceOpen(circle!, {}, 'circle')).toBe(false)
    expect(sourceOpen(circle!, { circle: 1 }, 'circle')).toBe(true)
  })
})
