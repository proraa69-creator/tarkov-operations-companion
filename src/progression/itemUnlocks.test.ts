import { describe, expect, it } from 'vitest'
import type { Trader } from '../domain/types'
import { parseItemUnlocks, unlockSources } from './itemUnlocks'

// The shape of json.tarkov.dev `regular/items` and `regular/barters` (ids of the live data, 03.11.2026).
const MECHANIC = '5a7c2eca46aef81a7ca2145d'
const PRAPOR = '54cb50c76803fa8b248b4571'
const RAGMAN = '5ac3b934156ae10c4430e83c'
const JAEGER = '5c0647fdd443bc2504c2d371'
const CAMERA = '5b4391a586f7745321235ab2'
const items = {
  data: {
    fleaMarket: { minPlayerLevel: 15, enabled: true },
    items: [
      // flea from the market's level; Mechanic sells it at loyalty 1 after a quest, and barters it at 1 without one
      { id: CAMERA, types: ['barter', 'specialSlot'], minLevelForFlea: 0, buyFromTrader: [{ trader: MECHANIC, priceRUB: 63211, minTraderLevel: 1, taskUnlock: '5b47926a86f7747ccc057c15' }] },
      // its own flea level; two traders
      { id: 'scope', types: ['mods'], minLevelForFlea: 25, buyFromTrader: [{ trader: PRAPOR, minTraderLevel: 3, taskUnlock: null }, { trader: RAGMAN, minTraderLevel: 2 }] },
      // banned on the flea and sold by no one
      { id: 'banned', types: ['noFlea'], minLevelForFlea: 0, buyFromTrader: [] },
      // a trader the catalog does not know
      { id: 'stranger', types: [], minLevelForFlea: 20, buyFromTrader: [{ trader: 'unknown-trader', minTraderLevel: 1 }] },
      // a gun is sold as its default preset (the VPO-215 «Горностай»: Jaeger at loyalty 1)
      { id: 'vpo-215', types: ['gun', 'wearable'], minLevelForFlea: 20, buyFromTrader: [], properties: { defaultPreset: 'vpo-215-preset' } },
      { id: 'vpo-215-preset', types: ['preset'], minLevelForFlea: 20, buyFromTrader: [{ trader: JAEGER, minTraderLevel: 1, taskUnlock: null }] },
    ],
  },
}
const barters = { data: { barters: [{ id: 'b1', trader: MECHANIC, taskUnlock: null, minTraderLevel: 1, requiredItems: [], offeredItem: { item: CAMERA, count: 1 } }] } }
const trader = (id: string, name: string, levelPlayerLevels: number[]): Trader => ({ id, name, role: '', loyalty: 4, accent: '', levelPlayerLevels })
const traders = [trader(PRAPOR, 'Прапор', [0, 6, 21, 36]), trader(MECHANIC, 'Механик', [1, 12, 26, 40]), trader(RAGMAN, 'Барахольщик', [1, 12, 27, 42]), trader(JAEGER, 'Егерь', [1, 9, 17, 33])]

describe('Where an item opens, for «До уровня»', () => {
  it('reads the flea levels, the trader offers and the barters of a mode', () => {
    const unlocks = parseItemUnlocks(items, barters, 'pvp')
    expect(unlocks.flea).toEqual({ enabled: true, level: 15 })
    expect(unlocks.items.get(CAMERA)).toEqual({
      noFlea: false,
      offers: [{ traderId: MECHANIC, loyalty: 1, questId: '5b47926a86f7747ccc057c15' }, { traderId: MECHANIC, loyalty: 1, barter: true }],
    })
    expect(unlocks.items.get('scope')).toMatchObject({ fleaLevel: 25, noFlea: false })
    expect(unlocks.items.get('banned')).toEqual({ noFlea: true, offers: [] })
  })

  it('lists the flea market and each trader\'s easiest way with the character level it needs, lowest first', () => {
    const unlocks = parseItemUnlocks(items, barters, 'pvp')
    // Mechanic: the barter at loyalty 1 needs no quest, so it is the way shown
    expect(unlockSources(CAMERA, unlocks, traders)).toEqual([
      { key: `trader:${MECHANIC}`, kind: 'trader', trader: { id: MECHANIC, name: 'Механик' }, loyalty: 1, level: 1, barter: true },
      { key: 'flea', kind: 'flea', level: 15 },
    ])
    expect(unlockSources('scope', unlocks, traders).map(({ key, level, loyalty }) => [key, level, loyalty])).toEqual([
      [`trader:${RAGMAN}`, 12, 2], [`trader:${PRAPOR}`, 21, 3], ['flea', 25, undefined],
    ])
    expect(unlockSources('banned', unlocks, traders)).toEqual([])
    expect(unlockSources('stranger', unlocks, traders)).toEqual([{ key: 'flea', kind: 'flea', level: 20 }])
    expect(unlockSources('not-in-file', unlocks, traders)).toEqual([])
    // the gun takes its preset's offers, and keeps its own flea level
    expect(unlockSources('vpo-215', unlocks, traders)).toEqual([
      { key: `trader:${JAEGER}`, kind: 'trader', trader: { id: JAEGER, name: 'Егерь' }, loyalty: 1, level: 1 },
      { key: 'flea', kind: 'flea', level: 20 },
    ])
  })

  it('a quest that opens the offer is named when no other way of that trader needs none; a closed flea is no way', () => {
    const closed = parseItemUnlocks({ data: { ...items.data, fleaMarket: { minPlayerLevel: 15, enabled: false } } }, undefined, 'pve')
    expect(closed.mode).toBe('pve')
    expect(unlockSources(CAMERA, closed, traders)).toEqual([
      { key: `trader:${MECHANIC}`, kind: 'trader', trader: { id: MECHANIC, name: 'Механик' }, loyalty: 1, level: 1, questId: '5b47926a86f7747ccc057c15' },
    ])
  })
})
