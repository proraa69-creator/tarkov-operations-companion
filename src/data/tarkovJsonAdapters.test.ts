import { describe, expect, it } from 'vitest'
import { adaptAmmo, adaptMods, adaptWeapons } from '../arsenal/gunQueries'
import { buildEconomySnapshot, buildLegacyAmmo, buildLegacyItems, normalizePriceHistory, type TarkovJsonBundle } from './tarkovJsonAdapters'

const gun = '5447a9cd4bdc2dbd208b4567'
const mod = '55d4b9964bdc2d1d4e8b456e'
const ammo = '54527ac44bdc2d36668b4567'
const trader = '5a7c2eca46aef81a7ca2145d'

const bundle: TarkovJsonBundle = {
  items: { data: { items: {
    [gun]: { id: gun, name: 'Gun Name', shortName: 'Gun', types: ['gun'], categories: ['weapon'], lastLowPrice: 100, properties: { propertiesType: 'ItemPropertiesWeapon', caliber: 'Caliber556x45NATO', fireRate: 800, recoilVertical: 100, recoilHorizontal: 200, defaultAmmo: ammo, slots: [{ id: 'slot', nameId: 'mod_grip', required: true, filters: { allowedItems: [mod] } }] }, buyFromTrader: [{ trader, priceRUB: 90, minTraderLevel: 2 }] },
    [mod]: { id: mod, name: 'Grip Name', shortName: 'Grip', types: ['mods'], properties: { propertiesType: 'ItemPropertiesWeaponMod', ergonomics: 5, slots: [] } },
    [ammo]: { id: ammo, name: 'Ammo Name', shortName: 'Ammo', types: ['ammo'], properties: { propertiesType: 'ItemPropertiesAmmo', caliber: 'Caliber556x45NATO', damage: 49, penetrationPower: 44, armorDamage: 52, projectileCount: 1 } },
  }, itemCategories: { weapon: { id: 'weapon', name: 'Weapon', normalizedName: 'weapon' } }, fleaMarket: { enabled: true, sellOfferFeeRate: 0.05, sellRequirementFeeRate: 0.05 } } },
  names: { data: { [`${gun} Name`]: 'Автомат', [`${gun} ShortName`]: 'АВТ', [`${mod} Name`]: 'Рукоять', [`${ammo} Name`]: 'Патрон' } },
  traders: { data: { traders: { [trader]: { id: trader, name: 'Механик', normalizedName: 'mechanic' } } } },
  barters: { data: [{ id: 'b', trader, minTraderLevel: 2, requiredItems: [{ item: mod, count: 2 }], offeredItem: { item: gun, count: 1 } }] },
  crafts: { data: [{ id: 'c', station: 'workbench', level: 2, duration: 60, requiredItems: [{ item: mod, count: 1 }], productItem: { item: ammo, count: 2 } }] },
  prices: { mode: 'regular', items: { [gun]: { lastLowPrice: 777 }, [ammo]: { lastLowPrice: 333 } }, fleaMarket: { enabled: true } },
}

describe('Tarkov JSON adapters', () => {
  it('builds the released weapon, mod and ammo shapes', () => {
    const items = buildLegacyItems(bundle)
    expect(adaptWeapons({ data: { items } })[0]).toMatchObject({ id: gun, name: 'Автомат', defaultAmmoId: ammo, slots: [{ allowed: [mod] }] })
    expect(adaptWeapons({ data: { items } })[0]?.offers[0]).toMatchObject({ vendor: 'flea-market', priceRUB: 777 })
    expect(adaptMods({ data: { items } }).get(mod)).toMatchObject({ name: 'Рукоять', ergonomics: 5 })
    expect(adaptAmmo({ data: { ammo: buildLegacyAmmo(bundle) } })[0]).toMatchObject({ id: ammo, damage: 49, penetration: 44 })
  })

  it('builds economy with minute prices and local item images', () => {
    const result = buildEconomySnapshot(bundle, 'pvp', 'ru', '2026-10-12T00:00:00.000Z')
    expect(result).toMatchObject({ mode: 'pvp', items: { [gun]: { name: 'Автомат', lastLowPrice: 777, iconUrl: `https://raidos.app/v1/item-images/${gun}-icon.webp` } } })
    expect(result.items[gun]?.buyFor).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'flea', price: 777 }), expect.objectContaining({ traderId: trader, minTraderLevel: 2 })]))
    expect([result.barters.length, result.crafts.length]).toEqual([1, 1])
  })

  it('does not overlay a price generation from another mode', () => {
    expect(buildEconomySnapshot(bundle, 'pve', 'ru').items[gun]?.lastLowPrice).toBe(100)
  })

  it('normalizes and sorts stored history', () => {
    expect(normalizePriceHistory({ data: { prices: [{ timestamp: 2, price: 20 }, { timestamp: 1, price: 10 }, { timestamp: 3, price: 0 }] } })).toEqual([{ timestamp: 1, price: 10, priceMin: undefined }, { timestamp: 2, price: 20, priceMin: undefined }])
  })
})
