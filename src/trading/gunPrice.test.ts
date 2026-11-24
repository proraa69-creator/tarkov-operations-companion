import { describe, expect, it } from 'vitest'
import type { PurchaseAccess } from '../arsenal/buildStats'
import type { GunOffer } from '../arsenal/gunTypes'
import { gunPriceChoice } from './gunPrice'
import type { BarterBuy, ItemBuyOptions } from './itemBuyOptions'

const flea = (price: number): GunOffer => ({ vendor: 'flea-market', vendorName: 'Барахолка', priceRUB: price })
const trader = (price: number, level: number): GunOffer => ({ vendor: 'mechanic', vendorName: 'Механик', priceRUB: price, minTraderLevel: level })
const barter = (total: number | null, extra: Partial<BarterBuy> = {}): BarterBuy => ({ kind: 'barter', id: 'b', traderId: 'skier', traderName: 'Лыжник', level: 2, gives: 1, parts: [], total, ...extra })
const options = (barters: BarterBuy[]): ItemBuyOptions => ({ traders: [], noFlea: false, barters })
const open: PurchaseAccess = { traderLevel: 1, flea: true, playerLevel: 30, traderLevels: { mechanic: 2 } }

describe('«Цена оружия» in the gun builder (owner, 17.11.2026)', () => {
  it('the cheapest way this player can use: the flea, a trader, an open barter at today\'s prices', () => {
    expect(gunPriceChoice({ offers: [flea(90_000), trader(80_000, 2)], noFlea: false }, open, [])).toEqual({ kind: 'trader', price: 80_000, traderName: 'Механик', level: 2 })
    expect(gunPriceChoice({ offers: [flea(90_000), trader(80_000, 3)], noFlea: false }, open, [])).toEqual({ kind: 'flea', price: 90_000 })
    expect(gunPriceChoice({ offers: [flea(90_000)], noFlea: false }, open, [options([barter(70_000)])])).toEqual({ kind: 'barter', price: 70_000, traderName: 'Лыжник', level: 2 })
  })

  it('a barter still locked or with a part nobody sells does not count; nothing open: the gun is not available', () => {
    const closed = [options([barter(10_000, { lock: { level: 3 } }), barter(null)])]
    expect(gunPriceChoice({ offers: [], noFlea: true }, open, closed)).toEqual({ kind: 'none' })
    // below the flea's level the flea offer is not this player's
    expect(gunPriceChoice({ offers: [flea(90_000)], noFlea: false }, { ...open, flea: false }, [])).toEqual({ kind: 'none' })
  })
})

describe('«Цена оружия»: the default preset sold by a trader', () => {
  it('an open cash offer of the preset counts like the gun’s own', () => {
    const preset: ItemBuyOptions = { traders: [{ kind: 'trader', traderId: 'skier', traderName: 'Лыжник', level: 4, price: 228_214 }], noFlea: false, barters: [] }
    expect(gunPriceChoice({ offers: [], noFlea: true }, open, [preset])).toEqual({ kind: 'trader', price: 228_214, traderName: 'Лыжник', level: 4 })
    const locked: ItemBuyOptions = { ...preset, traders: [{ ...preset.traders[0]!, lock: { task: { id: 'q', name: 'q' } } }] }
    expect(gunPriceChoice({ offers: [], noFlea: true }, open, [locked])).toEqual({ kind: 'none' })
  })
})
