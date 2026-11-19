import { describe, expect, it } from 'vitest'
import type { Item, RaidMode } from '../domain/types'
import { dearLoot } from './retinueLoot'

function item(id: string, types: string[], flea: Partial<Record<RaidMode, number>>): Item {
  return {
    id, name: id, shortName: id, category: 'Бартер', description: '', width: 1, height: 1, types,
    prices: Object.entries(flea).map(([mode, price]) => ({ source: 'Барахолка', kind: 'flea' as const, mode: mode as RaidMode, price: price!, updatedAt: '' })),
  }
}

/** Ten barter items 1 000 … 10 000 ₽ (S: the dearest, A: the next two), three stims and a round. */
const BARTER = Array.from({ length: 10 }, (_, at) => item(`b${at + 1}`, ['barter'], { pvp: (at + 1) * 1000, pve: (10 - at) * 1000 }))
const STIMS = [item('etg', ['injectors', 'meds'], { pvp: 90_000 }), item('propital', ['injectors', 'meds'], { pvp: 50_000 }), item('morphine', ['injectors', 'meds'], { pvp: 10_000 })]
const ROUND = item('m995', ['ammo'], { pvp: 1_500 })
const ITEMS = [...BARTER, ...STIMS, ROUND]
const INDEX = new Map(ITEMS.map((entry) => [entry.id, entry]))

describe('«Может выпасть» of the retinue: the dear ones only (owner, 20.11.2026)', () => {
  it('keeps tier S and A of each category, the dearest first, and drops the rest', () => {
    const ids = dearLoot(ITEMS, INDEX, 'pvp', ['b1', 'b10', 'b9', 'b8', 'b5', 'morphine', 'etg']).map((entry) => entry.id)
    // barter: b10 is S, b9 and b8 are A, b5 and b1 cheap; stims: of three, eTG-c is S, morphine the cheapest
    expect(ids).toEqual(['etg', 'b10', 'b9', 'b8'])
  })

  it('ranks by the prices of the mode on screen: PvE\'s dearest barter is PvP\'s cheapest', () => {
    expect(dearLoot(ITEMS, INDEX, 'pve', ['b1', 'b10']).map((entry) => entry.id)).toEqual(['b1'])
    expect(dearLoot(ITEMS, INDEX, 'pvp', ['b1', 'b10']).map((entry) => entry.id)).toEqual(['b10'])
  })

  it('leaves out rounds (they are on the guns), unknown ids and repeats', () => {
    expect(dearLoot(ITEMS, INDEX, 'pvp', ['m995', 'nothing', 'etg', 'etg']).map((entry) => entry.id)).toEqual(['etg'])
  })
})
