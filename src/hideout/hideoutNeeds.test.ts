import { describe, expect, it } from 'vitest'
import type { HideoutStation } from '../domain/types'
import { DOLLARS, hideoutNeeds, ROUBLES } from './hideoutNeeds'

const station = (id: string, levels: Array<Array<[string, number, boolean?]>>): HideoutStation => ({
  id, name: id, level: 0, status: 'locked', requirements: [], bonus: '',
  levels: levels.map((items, index) => ({ level: index + 1, requirements: [], bonus: '', itemRequirements: items.map(([itemId, count, foundInRaid]) => ({ itemId, count, foundInRaid })) })),
})

describe('items the hideout still needs', () => {
  const stations = [
    station('generator', [[['bolts', 2]], [['bolts', 3], ['wires', 4, true], [ROUBLES, 50_000]]]),
    station('medstation', [[['bandage', 1], [DOLLARS, 200]]]),
  ]

  it('sums every level not built, money apart, minus what was found', () => {
    const needs = hideoutNeeds(stations, { generator: 1 }, new Map([['bolts', 1]]))
    expect(needs.items.map(({ itemId, total, found, remaining, foundInRaid }) => ({ itemId, total, found, remaining, foundInRaid }))).toEqual([
      { itemId: 'bolts', total: 3, found: 1, remaining: 2, foundInRaid: false },
      { itemId: 'wires', total: 4, found: 0, remaining: 4, foundInRaid: true },
      { itemId: 'bandage', total: 1, found: 0, remaining: 1, foundInRaid: false },
    ])
    expect(needs.money).toEqual({ roubles: 50_000, dollars: 200, euros: 0 })
    expect([needs.remaining, needs.total]).toEqual([7, 8])
  })

  it('one station only, and found never above what is needed', () => {
    const needs = hideoutNeeds(stations, {}, new Map([['bandage', 9]]), 'medstation')
    expect(needs.items).toHaveLength(1)
    expect(needs.items[0]).toMatchObject({ itemId: 'bandage', found: 1, remaining: 0 })
  })
  // owner, 07.11.2026: «под каждой картинкой сделай галочку… только предметы выбранных галочкой модулей»
  it('the ticked modules only', () => {
    const all = [...stations, station('library', [[['book', 2]]])]
    const needs = hideoutNeeds(all, {}, new Map(), { stations: new Set(['medstation', 'library']) })
    expect(needs.items.map((need) => need.itemId).sort()).toEqual(['bandage', 'book'])
    expect(hideoutNeeds(all, {}, new Map(), { stations: new Set() }).items).toHaveLength(4)
  })

  // owner, 07.11.2026: «я нажимаю правой кнопкой на биткоин-ферму второго уровня, и он мне показывает, что нужно для биткоин-фермы второго уровня. Только для нее»
  it('one level of one module, not the levels above it', () => {
    const second = hideoutNeeds(stations, { generator: 0 }, new Map([['bolts', 4]]), { level: { stationId: 'generator', level: 2 } })
    expect(second.items.map(({ itemId, total, found, remaining }) => ({ itemId, total, found, remaining }))).toEqual([
      { itemId: 'bolts', total: 3, found: 3, remaining: 0 },
      { itemId: 'wires', total: 4, found: 0, remaining: 4 },
    ])
    expect(second.money.roubles).toBe(50_000)
    const first = hideoutNeeds(stations, { generator: 0 }, new Map(), { level: { stationId: 'generator', level: 1 } })
    expect(first.items.map((need) => [need.itemId, need.total])).toEqual([['bolts', 2]])
    // the level wins over the ticks
    expect(hideoutNeeds(stations, {}, new Map(), { stations: new Set(['medstation']), level: { stationId: 'generator', level: 1 } }).items.map((need) => need.itemId)).toEqual(['bolts'])
  })
})
