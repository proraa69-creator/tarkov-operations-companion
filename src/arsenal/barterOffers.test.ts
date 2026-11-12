// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { buildLegacyItems, type TarkovJsonBundle } from '../data/tarkovJsonAdapters'
import { cheapestOffer, unlockHint } from './buildStats'
import { adaptMods } from './gunQueries'
import type { GunPart } from './gunTypes'

// The IRBIS-GUN grips (owner, 12.11.2026): no flea, no trader for money, only Ref's barter for GP coins.
const grip = '6984b690b457c5047e0c01fa'
const coin = '5d235b4d86f7742e017bc88a'
const bolt = 'bolt00000000000000000001'
const ref = '6617beeaa9cfa777ca915b7c'
const mechanic = '5a7c2eca46aef81a7ca2145d'

const bundle: TarkovJsonBundle = {
  mode: 'pvp',
  items: { data: { items: {
    [grip]: { id: grip, types: ['mods', 'noFlea'], basePrice: 8750, properties: { propertiesType: 'ItemPropertiesWeaponMod', ergonomics: 12, slots: [] } },
    [coin]: { id: coin, types: ['barter', 'noFlea'], basePrice: 7500 },
    [bolt]: { id: bolt, types: ['barter'], basePrice: 1000, buyFromTrader: [{ trader: mechanic, priceRUB: 2000, minTraderLevel: 1 }] },
  } } },
  names: { data: { [`${grip} Name`]: 'Тактическая рукоятка IRBIS-GUN «30AL»', [`${grip} ShortName`]: '30AL', [`${coin} Name`]: 'GP-монета', [`${coin} ShortName`]: 'GP', [`${bolt} ShortName`]: 'Болты' } },
  traders: { data: { traders: {
    [ref]: { id: ref, name: 'Реф', normalizedName: 'ref' },
    [mechanic]: { id: mechanic, name: 'Механик', normalizedName: 'mechanic' },
  } } },
  barters: { data: [
    { id: 'a', trader: ref, minTraderLevel: 2, taskUnlock: null, requiredItems: [{ item: coin, count: 4.99 }], offeredItem: { item: grip, count: 1 } },
    // a barter for something the catalogue does not know is left out
    { id: 'b', trader: ref, minTraderLevel: 1, requiredItems: [{ item: 'unknown00000000000000000', count: 1 }], offeredItem: { item: bolt, count: 1 } },
  ] },
}

const gripPart = () => adaptMods({ data: { items: buildLegacyItems(bundle) } }).get(grip)!

describe('traders\' barters in the gun builder (src/data/tarkovJsonAdapters.ts withBarterOffers, gunQueries adaptBarters)', () => {
  it('a part only a barter gets carries it, priced by what it takes (GP coins at their base price)', () => {
    const part = gripPart()
    expect(part.offers).toEqual([])
    expect(part.barters).toEqual([expect.objectContaining({
      vendor: 'ref', vendorName: 'Реф', minTraderLevel: 2, traderId: ref, priceRUB: Math.round(4.99 * 7500),
      barter: [{ id: coin, name: 'GP-монета', shortName: 'GP', iconLink: expect.stringContaining(coin), count: 4.99 }],
    })])
    expect(adaptMods({ data: { items: buildLegacyItems(bundle) } }).get(bolt)?.barters).toBeUndefined()
  })

  it('a barter makes the part one to get once the loyalty is reached, and says the loyalty before', () => {
    const part = gripPart()
    expect(cheapestOffer(part, { traderLevel: 2, flea: true })).toMatchObject({ vendor: 'ref', barter: [expect.objectContaining({ id: coin })] })
    expect(cheapestOffer(part, { traderLevel: 1, flea: true })).toBeUndefined()
    expect(unlockHint(part, { traderLevel: 1, flea: true })).toEqual({ kind: 'trader', vendorName: 'Реф', level: 2 })
    expect(unlockHint(part, { traderLevel: 2, flea: true })).toBeUndefined()
  })

  it('money comes first: a barter counts only when nobody sells the part for money', () => {
    const part = gripPart()
    const sold: GunPart = { ...part, offers: [{ vendor: 'mechanic', vendorName: 'Механик', priceRUB: 90_000, minTraderLevel: 1 }] }
    expect(cheapestOffer(sold, { traderLevel: 4, flea: true })).toMatchObject({ vendor: 'mechanic', priceRUB: 90_000 })
    expect(cheapestOffer({ ...sold, offers: [{ ...sold.offers[0]!, minTraderLevel: 4 }] }, { traderLevel: 2, flea: true })).toMatchObject({ vendor: 'ref' })
  })

  it('without the barters file nothing changes', () => {
    const items = buildLegacyItems({ ...bundle, barters: undefined })
    expect(items.some((item) => 'barterFor' in item)).toBe(false)
  })
})
