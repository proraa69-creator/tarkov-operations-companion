import { describe, expect, it } from 'vitest'
import { adaptAmmo, adaptMods, adaptWeapons } from '../arsenal/gunQueries'
import { ammoPayload, gunsPayload, modsPayload, upstreamGunItems } from '../arsenal/fixtures/gunFixture'
import type { GunPart } from '../arsenal/gunTypes'
import { adaptGraphqlBosses } from './bosses'
import { buildEconomySnapshot, buildLegacyAmmo, buildLegacyBosses, buildLegacyItems, buildLegacyTraders, normalizePriceHistory, type TarkovJsonBundle } from './tarkovJsonAdapters'

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
  maps: { data: { maps: { factory: { id: 'factory', bosses: [{ mob: 'boss' }] } }, mobs: { boss: { id: 'boss', name: 'Boss', normalizedName: 'boss', imagePortraitLink: 'https://assets.tarkov.dev/boss.webp', equipment: [{ attributes: [{ name: 'slot', value: 'FirstPrimaryWeapon' }], item: { id: gun, name: 'Gun', iconLink: 'https://assets.tarkov.dev/gun.webp', properties: { defaultPreset: { id: mod, iconLink: 'https://assets.tarkov.dev/preset.webp' } } } }] } } } },
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

  it('keeps boss equipment on the Raid OS image mirror', () => {
    const [boss] = buildLegacyBosses(bundle)
    const equipment = boss?.equipment as Array<{ item?: { iconLink?: string; properties?: { defaultPreset?: { iconLink?: string } } } }>
    expect(boss?.imagePortraitLink).toBeUndefined()
    expect(equipment[0]?.item?.iconLink).toBe(`https://raidos.app/v1/item-images/${gun}-icon.webp`)
    expect(equipment[0]?.item?.properties?.defaultPreset?.iconLink).toBe(`https://raidos.app/v1/item-images/${mod}-icon.webp`)
  })

  // As json.tarkov.dev writes them (checked on the live files, 11.10.2026): names are translation keys whose texts are in
  // items_<lang> / traders_<lang> — slots «MOD_STOCK», categories «<id> Name», traders «<id> Nickname» — and a boss's gear
  // is a list of item ids with `attributes: { slot }`.
  it('gives slots, weapon classes and traders their texts, and boss gear its items', () => {
    const stock = '56eabf3bd2720b75698b4569'
    const upstream: TarkovJsonBundle = {
      items: { data: { items: {
        [gun]: { id: gun, name: `${gun} Name`, shortName: `${gun} ShortName`, types: ['gun'], categories: ['rifle'], buyFromTrader: [{ trader, priceRUB: 22997, minTraderLevel: 3 }],
          properties: { propertiesType: 'ItemPropertiesWeapon', defaultPreset: 'preset', slots: [{ id: 's', nameId: 'mod_stock', name: 'MOD_STOCK', required: false, filters: { allowedItems: [stock] } }] } },
        [stock]: { id: stock, name: `${stock} Name`, shortName: `${stock} ShortName`, types: ['mods'], properties: { propertiesType: 'ItemPropertiesWeaponMod', ergonomics: 8, slots: [] } },
        preset: { id: 'preset', name: 'preset Name', types: ['preset'], containsItems: [{ item: gun, count: 1 }, { item: stock, count: 1 }], properties: { propertiesType: 'ItemPropertiesPreset' } },
      }, itemCategories: { rifle: { id: 'rifle', name: 'rifle Name', normalizedName: 'assault-rifle' } } } },
      names: { data: { [`${gun} Name`]: 'Штурмовая винтовка Colt M4A1', [`${gun} ShortName`]: 'M4A1', [`${stock} Name`]: 'Приклад MOE', MOD_STOCK: 'Приклад', 'rifle Name': 'Штурм. винтовка', [`${trader} Nickname`]: 'Механик' } },
      traders: { data: { [trader]: { id: trader, name: `${trader} Nickname`, normalizedName: 'mechanic' } } },
      barters: { data: [{ id: 'b', trader, minTraderLevel: 2, requiredItems: [{ item: stock, count: 1 }], offeredItem: { item: gun, count: 1 } }] },
      maps: { data: { maps: { lab: { id: 'lab', bosses: [{ mob: 'bossTagilla' }] } }, mobs: { bossTagilla: { id: 'bossTagilla', name: 'bossTagilla', normalizedName: 'tagilla', health: [{ id: 'Head', max: 100 }, { id: 'Chest', max: 320 }], equipment: [{ item: gun, count: 1, contains: [], attributes: { slot: 'FirstPrimaryWeapon' } }] } } } },
    }
    const [weapon] = adaptWeapons({ data: { items: buildLegacyItems(upstream) } })
    expect(weapon).toMatchObject({ name: 'Штурмовая винтовка Colt M4A1', weaponClass: 'assault-rifle', weaponClassName: 'Штурм. винтовка', slots: [{ nameId: 'mod_stock', name: 'Приклад', allowed: [stock] }] })
    expect(weapon?.offers).toEqual([expect.objectContaining({ vendor: 'mechanic', vendorName: 'Механик', minTraderLevel: 3 })])
    const economy = buildEconomySnapshot(upstream, 'pvp', 'ru')
    expect(economy.items[gun]?.buyFor).toEqual([expect.objectContaining({ source: 'Механик', traderId: trader, minTraderLevel: 3 })])
    expect(economy.barters[0]?.traderName).toBe('Механик')
    expect(buildLegacyTraders(upstream)[0]?.name).toBe('Механик')
    // The boss card's gear (src/data/bosses.ts): the weapon by its id, pictured by its default preset.
    expect(adaptGraphqlBosses({ data: { bosses: buildLegacyBosses(upstream) } })).toEqual([expect.objectContaining({
      key: 'tagilla', health: 420, gear: [{ slot: 'FirstPrimaryWeapon', name: 'M4A1', iconUrl: 'https://raidos.app/v1/item-images/preset-icon.webp' }],
    })])
  })

  // The arsenal fixture in json.tarkov.dev's form (the «Оружейник» end-to-end test serves it) reads back as its GraphQL form.
  it('reads the arsenal fixture’s JSON form back as its GraphQL form', () => {
    const upstream = upstreamGunItems()
    const traders = Object.fromEntries(['mechanic', 'peacekeeper', 'prapor', 'jaeger', 'skier'].map((key) => [`tr-${key}`, { id: `tr-${key}`, name: `tr-${key} Nickname`, normalizedName: key }]))
    const items = buildLegacyItems({ items: { data: { items: upstream.items, itemCategories: upstream.itemCategories } }, names: { data: upstream.names.ru }, traders: { data: traders } })
    const weapon = (entry: ReturnType<typeof adaptWeapons>[number]) => ({
      id: entry.id, name: entry.name, shortName: entry.shortName, weaponClass: entry.weaponClass, weaponClassName: entry.weaponClassName, caliber: entry.caliber,
      ergonomics: entry.ergonomics, recoilVertical: entry.recoilVertical, defaultAmmoId: entry.defaultAmmoId, slots: entry.slots, preset: entry.defaultPreset?.itemIds,
    })
    expect(adaptWeapons({ data: { items } }).map(weapon)).toEqual(adaptWeapons(gunsPayload('ru')).map(weapon))
    const traderOffers = (part?: GunPart) => part?.offers.filter((offer) => offer.vendor !== 'flea-market').map(({ vendor, priceRUB, minTraderLevel }) => ({ vendor, priceRUB, minTraderLevel }))
    const mods = adaptMods({ data: { items } })
    for (const [id, part] of adaptMods(modsPayload('ru'))) {
      expect(mods.get(id)).toMatchObject({ name: part.name, shortName: part.shortName, ergonomics: part.ergonomics, recoilModifier: part.recoilModifier, slots: part.slots, conflicts: part.conflicts, categoryIds: expect.arrayContaining(part.categoryIds ?? []) })
      expect(traderOffers(mods.get(id))).toEqual(traderOffers(part))
    }
    const round = ({ id, name, caliber, damage, penetration, armorDamage }: ReturnType<typeof adaptAmmo>[number]) => ({ id, name, caliber, damage, penetration, armorDamage })
    expect(adaptAmmo({ data: { ammo: buildLegacyAmmo({ items: { data: { items: upstream.items } }, names: { data: upstream.names.ru } }) } }).map(round)).toEqual(adaptAmmo(ammoPayload('ru')).map(round))
  })
})
