import { describe, expect, it } from 'vitest'
import { aggregateRaidNeeds, formatItemCountLabel } from './raidNeeds'

describe('aggregateRaidNeeds', () => {
  it('merges identical items into one row with a total count', () => {
    const rows = aggregateRaidNeeds([
      { itemId: 'ms2000', count: 1, purpose: 'mark', questName: 'БП Топливо' },
      { itemId: 'ms2000', count: 1, purpose: 'mark', questName: 'БП Топливо' },
      { itemId: 'ms2000', count: 1, purpose: 'mark', questName: 'БП Топливо' },
      { itemId: 'ms2000', count: 1, purpose: 'mark', questName: 'БП Топливо' },
      { itemId: 'propane', count: 1, purpose: 'place', questName: 'Газовые баллоны' },
      { itemId: 'propane', count: 1, purpose: 'place', questName: 'Газовые баллоны' },
    ])

    expect(rows).toEqual([
      {
        itemId: 'ms2000',
        count: 4,
        lines: [{ purpose: 'mark', count: 4, questNames: ['БП Топливо'] }],
        fromRaidListOnly: false,
      },
      {
        itemId: 'propane',
        count: 2,
        lines: [{ purpose: 'place', count: 2, questNames: ['Газовые баллоны'] }],
        fromRaidListOnly: false,
      },
    ])
    expect(formatItemCountLabel('Маркер MS2000', 4)).toBe('Маркер MS2000 ×4')
    expect(formatItemCountLabel('Баллон пропана', 2)).toBe('Баллон пропана ×2')
  })

  it('keeps manually added raid-list items without quest lines', () => {
    expect(aggregateRaidNeeds([], ['salewa'])).toEqual([
      { itemId: 'salewa', count: 1, lines: [], fromRaidListOnly: true },
    ])
  })
})
