import { describe, expect, it } from 'vitest'
import type { EconomyItem, EconomySnapshot } from '../data/economyApi'
import { itemBuyOptions, type BuyAccess } from './itemBuyOptions'

const item = (id: string, extra: Partial<EconomyItem> = {}): EconomyItem => ({ id, name: id, shortName: id, basePrice: 1000, noFlea: false, buyFor: [], sellFor: [], ...extra })
const snapshot = (items: EconomyItem[], barters: EconomySnapshot['barters'] = []): EconomySnapshot => ({
  mode: 'seasonal', items: Object.fromEntries(items.map((entry) => [entry.id, entry])), barters, crafts: [],
  flea: { enabled: true, offerFeeRate: 0.03, requirementFeeRate: 0.03 }, loadedAt: '2026-11-17T00:00:00.000Z',
})
const access = (extra: Partial<BuyAccess> = {}): BuyAccess => ({ loyalty: new Map([['skier', 3], ['mechanic', 4]]), playerLevel: 30, fleaEnabled: true, fleaLevel: 15, ...extra })

describe('report 187: how to get an item now — traders, the flea, barters at today\'s prices', () => {
  it('a trader\'s offer the player has not reached says what is missing; open ones first, cheapest first', () => {
    const gun = item('mk47', {
      noFlea: true,
      buyFor: [
        { source: 'Лыжник', traderId: 'skier', kind: 'trader', price: 90_000, minTraderLevel: 4, taskUnlock: { id: 'night-walk', name: 'Ночная прогулка' } },
        { source: 'Механик', traderId: 'mechanic', kind: 'trader', price: 120_000, minTraderLevel: 3 },
      ],
    })
    const result = itemBuyOptions('mk47', snapshot([gun]), access({ taskDone: () => false }))
    expect(result.traders.map((offer) => [offer.traderName, offer.lock ?? null])).toEqual([
      ['Механик', null],
      ['Лыжник', { level: 4, task: { id: 'night-walk', name: 'Ночная прогулка' } }],
    ])
    // banned from the flea: no flea row, said so
    expect(result.flea).toBeUndefined()
    expect(result.noFlea).toBe(true)
  })

  it('the flea from the character\'s level; a barter with each part\'s price and the total', () => {
    const key = item('key', { lastLowPrice: 50_000 })
    const bolts = item('bolts', { lastLowPrice: 4_000 })
    const tape = item('tape', { buyFor: [{ source: 'Механик', traderId: 'mechanic', kind: 'trader', price: 7_000, minTraderLevel: 1 }] })
    const barter = { id: 'b1', traderId: 'mechanic', traderName: 'Механик', level: 2, requiredItems: [{ itemId: 'bolts', count: 3 }, { itemId: 'tape', count: 1 }], rewardItems: [{ itemId: 'key', count: 1 }] }
    const low = itemBuyOptions('key', snapshot([key, bolts, tape], [barter]), access({ playerLevel: 10 }))
    expect(low.flea).toEqual({ kind: 'flea', price: 50_000, average: false, lock: { playerLevel: 15 } })
    // below the flea's level the parts come from the traders only: bolts have no trader offer
    expect(low.barters[0]!.parts.map((part) => part.total)).toEqual([null, 7_000])
    expect(low.barters[0]!.total).toBeNull()
    const high = itemBuyOptions('key', snapshot([key, bolts, tape], [barter]), access())
    expect(high.flea!.lock).toBeUndefined()
    expect(high.barters[0]!.parts.map((part) => part.total)).toEqual([12_000, 7_000])
    expect(high.barters[0]!.total).toBe(19_000)
    expect(high.barters[0]!.lock).toBeUndefined()
  })

  it('each barter part says whether it is on the flea for this player: open, from its own level, or not sold there', () => {
    // the key to room 114 of the dorm: peroxide, saline and a medical kit, each on the flea from level 20
    const key = item('dorm-114')
    const peroxide = item('peroxide', { lastLowPrice: 20_000, fleaLevel: 20 })
    const saline = item('saline', { lastLowPrice: 15_000 })
    const bitcoin = item('bitcoin', { lastLowPrice: 500_000, noFlea: true })
    const barter = { id: 'b114', traderId: 'therapist', traderName: 'Терапевт', level: 2, requiredItems: [{ itemId: 'peroxide', count: 1 }, { itemId: 'saline', count: 1 }, { itemId: 'bitcoin', count: 1 }], rewardItems: [{ itemId: 'dorm-114', count: 1 }] }
    const at18 = itemBuyOptions('dorm-114', snapshot([key, peroxide, saline, bitcoin], [barter]), access({ playerLevel: 18 }))
    expect(at18.barters[0]!.parts.map((part) => part.flea)).toEqual([{ state: 'locked', level: 20 }, { state: 'open' }, { state: 'none' }])
    // a part locked on the flea has no flea price yet
    expect(at18.barters[0]!.parts[0]!.total).toBeNull()
    const at20 = itemBuyOptions('dorm-114', snapshot([key, peroxide, saline, bitcoin], [barter]), access({ playerLevel: 20 }))
    expect(at20.barters[0]!.parts.map((part) => part.flea.state)).toEqual(['open', 'open', 'none'])
    // the item's own flea level counts for the item too
    expect(itemBuyOptions('peroxide', snapshot([peroxide]), access({ playerLevel: 18 })).flea!.lock).toEqual({ playerLevel: 20 })
    // a mode without the flea: nothing is sold there
    expect(itemBuyOptions('dorm-114', snapshot([key, peroxide, saline, bitcoin], [barter]), access({ fleaEnabled: false })).barters[0]!.parts.every((part) => part.flea.state === 'none')).toBe(true)
  })

  it('an item nobody sells: nothing', () => {
    const result = itemBuyOptions('quest-item', snapshot([item('quest-item', { noFlea: true })]), access())
    expect([result.traders.length, result.flea, result.barters.length]).toEqual([0, undefined, 0])
  })
})
