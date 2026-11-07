import { afterEach, describe, expect, it } from 'vitest'
import type { GearStats, Item, RaidMode } from '../domain/types'
import { gearStatsIndex, gearStatsOf, stackSizeIndex } from '../data/gearStats'
import { setDataRouteForTests } from '../data/tarkovApi'
import type { AmmoStats } from '../arsenal/ammoSource'
import { ammoTierRows, armorScore, ARMOR_STEPS, gearTierRows, headsetScore, helmetsBlocking, isFigurine, marketPrice, pricePerSlot, protectionLevel, shareTiers, slotTierRows, tierOf, tilePictures, foodStatsIndex, foodTierRows } from './tierLists'

const MATERIALS = { Aramid: { destructibility: 0.1875 }, Ceramic: { destructibility: 0.6 } }

function item(id: string, extra: Partial<Item> & { flea?: Partial<Record<RaidMode, number>> } = {}): Item {
  const { flea = {}, ...rest } = extra
  return {
    id, name: id, shortName: id, category: 'Бартер', description: '', width: 1, height: 1, types: ['barter'],
    prices: Object.entries(flea).map(([mode, price]) => ({ source: 'Барахолка', kind: 'flea' as const, mode: mode as RaidMode, price: price!, updatedAt: '' })),
    ...rest,
  }
}

describe('tier lists: price per slot by category', () => {
  it('divides the sale price by the slots and keeps the modes apart', () => {
    const ledx = item('ledx', { flea: { pvp: 900_000, pve: 300_000 } })
    const tank = item('tank', { width: 2, height: 2, flea: { pvp: 200_000 } })
    expect(pricePerSlot(tank, 'pvp')?.perSlot).toBe(50_000)
    expect(pricePerSlot(tank, 'pve')).toBeUndefined()
    expect(slotTierRows([ledx, tank], 'pvp', 'barter').map((row) => row.item.id)).toEqual(['ledx', 'tank'])
    expect(slotTierRows([ledx, tank], 'pve', 'barter').map((row) => row.item.id)).toEqual(['ledx'])
  })

  it('ranks within the category: the best 10 % S … the last 15 % D, equal prices share a tier', () => {
    expect(shareTiers([100, 90, 80, 70, 60, 50, 40, 30, 20, 10]).join('')).toBe('SAABBBCCCD')
    expect(shareTiers([5, 5, 5])).toEqual(['S', 'S', 'S'])
    const rows = slotTierRows(Array.from({ length: 10 }, (_, index) => item(`b${index}`, { flea: { pvp: (index + 1) * 1000 } })), 'pvp', 'barter')
    expect(rows.map((row) => row.tier).join('')).toBe('SAABBBCCCD')
  })

  it('puts every item into its own category', () => {
    const items = [
      item('etg', { types: ['injectors', 'meds', 'provisions'], flea: { pvp: 45_000 } }),
      item('salewa', { types: ['meds', 'provisions'], flea: { pvp: 20_000 } }),
      item('tushonka', { types: ['provisions'], flea: { pvp: 10_000 } }),
      item('key', { types: ['keys'], flea: { pvp: 30_000 } }),
      item('chain', { types: ['barter'], valuable: true, flea: { pvp: 40_000 } }),
      item('bolts', { types: ['barter'], flea: { pvp: 9_000 } }),
      item('tag', { types: ['barter', 'noFlea'], normalizedName: 'dogtag-bear', flea: { pvp: 535 } }),
      item('m4', { types: ['gun', 'wearable'], width: 4, height: 2, flea: { pvp: 40_000 } }),
      item('m4-preset', { types: ['preset'], flea: { pvp: 90_000 } }),
      item('grip', { types: ['mods', 'pistolGrip'], flea: { pvp: 5_000 } }),
      item('plate', { types: ['armorPlate', 'mods'], flea: { pvp: 60_000 } }),
      item('helmet', { types: ['helmet', 'wearable'], flea: { pvp: 50_000 } }),
      item('pack', { types: ['backpack', 'wearable'], width: 5, height: 6, flea: { pvp: 60_000 } }),
    ]
    const ids = (category: Parameters<typeof slotTierRows>[2]) => slotTierRows(items, 'pvp', category).map((row) => row.item.id)
    expect(ids('injectors')).toEqual(['etg'])
    expect(ids('meds')).toEqual(['salewa'])
    expect(ids('food')).toEqual(['tushonka'])
    expect(ids('keys')).toEqual(['key'])
    expect(ids('valuables')).toEqual(['chain'])
    expect(ids('barter')).toEqual(['bolts'])
    expect(ids('weapons')).toEqual(['m4'])
    expect(ids('mods')).toEqual(['grip'])
    expect(ids('plates')).toEqual(['plate'])
    expect(ids('helmet')).toEqual(['helmet'])
    expect(ids('backpacks')).toEqual(['pack'])
  })

  it('shows the flea listing price, not what is left after the fee (owner, 02.11.2026: «цены … не соответствуют барахолке»)', () => {
    const t7 = item('t7', { types: ['mods'], width: 2, height: 1, basePrice: 20_000, flea: { pvp: 900_000 } })
    expect(marketPrice(t7, 'pvp')).toEqual({ price: 900_000, kind: 'flea' })
    expect(slotTierRows([t7], 'pvp', 'mods')[0]).toMatchObject({ price: 900_000, score: 450_000, priceKind: 'flea' })
    const banned = item('ledx', { prices: [{ source: 'Терапевт', kind: 'trader', mode: 'pvp', price: 300_000, updatedAt: '' }] })
    expect(marketPrice(banned, 'pvp')).toEqual({ price: 300_000, kind: 'trader' })
  })

  it('ranks weapons by their whole price, not per slot (owner: «просто пиши цену оружия и все»)', () => {
    const axmc = item('axmc', { types: ['gun'], width: 1, height: 1, flea: { pvp: 360_000 } })
    const m4 = item('m4', { types: ['gun'], width: 4, height: 2, flea: { pvp: 400_000 } })
    expect(slotTierRows([axmc, m4], 'pvp', 'weapons').map((row) => [row.item.id, row.score])).toEqual([['m4', 400_000], ['axmc', 360_000]])
  })

  // Owner, 04.11.2026: «почему в списке тир листа шлемов, картинка бронежилета?» — tarkov.dev's file under the preset's made-up
  // id is a vest; the helmet with its visor has a name of its own in the catalog. Our server keeps it under the preset's id.
  describe('a helmet with its visor', () => {
    const PRESET = '707265736574000000000004'
    const altyn = item('5aa7e276e5b5b000171d0647', { iconUrl: 'https://assets.tarkov.dev/5aa7e276e5b5b000171d0647-icon.webp' })
    const gear: GearStats = { kind: 'helmet', presetId: PRESET }
    const presetIcon = 'https://assets.tarkov.dev/altynfaceshield000000001-icon.webp'
    afterEach(() => setDataRouteForTests(null))

    it('takes the catalog\'s address of the preset\'s icon at tarkov.dev, never one made from its id', () => {
      setDataRouteForTests('direct')
      expect(tilePictures(altyn, gear, presetIcon)).toEqual([presetIcon, altyn.iconUrl])
      // a preset the catalog does not know: the helmet itself
      expect(tilePictures(altyn, gear)).toEqual([altyn.iconUrl])
    })

    it('asks our server by the preset\'s id', () => {
      setDataRouteForTests('gateway')
      expect(tilePictures(altyn, gear, presetIcon)).toEqual([`https://raidos.app/v1/item-images/${PRESET}-icon.webp`, altyn.iconUrl])
    })
  })

  it('shows a weapon whole and keeps figurines (owner: «показывай всегда полностью оружие», «кроме фигурок»)', () => {
    const gun = item('627e14b21713922ded6f2c15', { types: ['gun'], iconUrl: 'https://raidos.app/v1/item-images/627e14b21713922ded6f2c15-icon.webp', presetImageUrl: 'https://assets.tarkov.dev/62973e474bb5ab23071c2a70-512.webp' })
    expect(tilePictures(gun)[0]).toMatch(/62973e474bb5ab23071c2a70-grid/)
    expect(tilePictures(gun).at(-1)).toBe(gun.iconUrl)
    expect(tilePictures(item('bolts'))).toEqual([])
    expect(tilePictures(item('blood', { iconUrl: 'https://assets.tarkov.dev/unknown-item-icon.jpg' }))).toEqual([])
    expect(isFigurine({ name: 'Статуэтка коня', normalizedName: 'horse-figurine' })).toBe(true)
    expect(isFigurine({ name: 'Фигурка бойца BEAR' })).toBe(true)
    expect(isFigurine({ name: 'Болты', normalizedName: 'bolts' })).toBe(false)
  })

  it('ranks ammo by penetration like the «Баллистика» table, no grenades, no price (owner, 02.11.2026)', () => {
    const round = (id: string, penetration: number, extra: Partial<AmmoStats> = {}): AmmoStats => ({ id, name: id, shortName: id, caliber: 'Caliber556x45NATO', damage: 40, penetration, price: 999, ...extra })
    const rows = ammoTierRows([round('m855', 31), round('m995', 53), round('ssa', 62), round('ap20', 62, { damage: 50 }), round('ps', 22),
      round('vog', 2, { caliber: 'Caliber40x46' }), round('flare', 0, { name: 'Сигнальный патрон' })])
    expect(rows.map((row) => [row.item.id, row.tier])).toEqual([['ap20', 'S'], ['ssa', 'S'], ['m995', 'A'], ['m855', 'C'], ['ps', 'D']])
    expect(rows.every((row) => row.price === undefined)).toBe(true)
  })

  it('puts a score on the step itself into that tier', () => {
    expect(tierOf(ARMOR_STEPS[0]!, ARMOR_STEPS)).toBe('S')
    expect(tierOf(ARMOR_STEPS[3]! - 1, ARMOR_STEPS)).toBe('D')
  })
})

describe('«Еда и напитки»: the price per energy and per water', () => {
  const food = (id: string, price: number) => item(id, { types: ['provisions'], flea: { pvp: price } })
  const stats = new Map([
    ['tin', { energy: 50, hydration: -5 }], // gives energy, takes water
    ['bar', { energy: 20, hydration: 0 }],
    ['juice', { energy: 10, hydration: 40 }],
    ['water', { energy: 0, hydration: 60 }],
    ['salt', { energy: -10, hydration: 30 }],
  ])
  const items = [food('tin', 5000), food('bar', 4000), food('juice', 8000), food('water', 6000), food('salt', 100), food('unknown', 100)]

  it('lists only what gives this and takes nothing, the cheapest per point first', () => {
    const rows = foodTierRows(items, 'pvp', 'energy', stats)
    expect(rows.map((row) => row.item.id)).toEqual(['bar', 'juice'])
    expect(rows.map((row) => row.score)).toEqual([200, 800])
    expect(rows[0]!.tier).toBe('S')
    expect(rows[0]!.food).toEqual({ energy: 20, hydration: 0 })
  })

  it('and the same for water: what gives both stands in both lists', () => {
    const rows = foodTierRows(items, 'pvp', 'hydration', stats)
    expect(rows.map((row) => row.item.id)).toEqual(['water', 'juice'])
    expect(rows.map((row) => row.score)).toEqual([100, 200])
  })

  it('reads the energy and water of the items file', () => {
    const index = foodStatsIndex({ items: { a: { id: 'a', properties: { energy: 50, hydration: -5 } }, b: { id: 'b', properties: { class: 3 } } } })
    expect(index.get('a')).toEqual({ energy: 50, hydration: -5 })
    expect(index.has('b')).toBe(false)
  })
})

describe('tier lists: armor and headsets', () => {
  // Shapes from json.tarkov.dev regular/items (01.11.2026).
  const zhuk = { id: 'zhuk', types: ['armor', 'wearable'], properties: { class: 6, durability: 305, material: 'Aramid', zones: Array(12).fill('z'), speedPenalty: -0.01, ergoPenalty: -0.01, turnPenalty: 0 } }
  const module3m = { id: 'module', types: ['armor', 'wearable'], properties: { class: 2, durability: 80, material: 'Aramid', zones: Array(6).fill('z'), speedPenalty: 0, ergoPenalty: -0.02, turnPenalty: 0 } }
  const rig = { id: 'avs', types: ['armor', 'rig', 'wearable'], properties: { class: 4, durability: 212, material: 'Aramid', zones: Array(6).fill('z'), speedPenalty: -0.02, ergoPenalty: 0, turnPenalty: 0 } }
  const plainRig = { id: 'idea', types: ['rig', 'wearable'], properties: { class: 0, capacity: 8 } }
  const carrier = { id: 'slick', types: ['rig', 'wearable'], properties: { class: 6, durability: 200, material: 'Aramid', zones: ['a'] } }
  const kiver = { id: 'kiver', types: ['helmet', 'wearable'], properties: { class: 3, durability: 63, material: 'Aramid', zones: Array(3).fill('z'), deafening: 'High', blocksHeadset: false, speedPenalty: 0, ergoPenalty: -0.01, turnPenalty: -0.01 } }
  const comtac6 = { id: 'comtac6', types: ['headphones', 'wearable'], conflictingItems: ['kiver'], properties: { propertiesType: 'ItemPropertiesHeadphone', distanceModifier: 1.135, distortion: 0.08, ambientVolume: -50, compressorGain: 3, compressorThreshold: -24 } }
  const gssh = { id: 'gssh', types: ['headphones', 'wearable'], properties: { propertiesType: 'ItemPropertiesHeadphone', distanceModifier: 1, distortion: 0.15, ambientVolume: -50, compressorGain: 3 } }
  const tep = { id: 'tep', types: ['headphones', 'wearable'], properties: { propertiesType: 'ItemPropertiesHeadphone', distanceModifier: 1.2, distortion: 0.18, compressorGain: 0 } }
  // Helmets with their visors (owner, 02.11.2026: «маска 1щ … должна быть с забралом и в тир листе S»).
  const face = ['Collider Type HeadCommon', 'Collider Type Eyes', 'Collider Type Jaw']
  const head = ['Collider Type ParietalHead', 'Collider Type BackHead', 'Collider Type Ears']
  const maska = { id: 'maska', types: ['helmet', 'wearable'], properties: { class: 4, durability: 108, zones: head, deafening: 'High', slots: [{ filters: { allowedItems: ['maska-visor', 'slaap'] } }] } }
  const maskaVisor = { id: 'maska-visor', types: ['mods'], properties: { class: 6, durability: 50, zones: face } }
  const slaap = { id: 'slaap', types: ['armorPlate', 'mods'], properties: { class: 5, zones: ['Collider Type ParietalHead'] } }
  const zsh = { id: 'zsh', types: ['helmet', 'wearable'], properties: { class: 4, durability: 63, zones: head, slots: [{ filters: { allowedItems: ['zsh-visor'] } }] } }
  // The Russian catalog translates the zones (catalogSource.ts translateDeep): «Голова, Глаза».
  const zshVisor = { id: 'zsh-visor', types: ['mods'], properties: { class: 3, zones: ['Голова, Лицо', 'Голова, Глаза', 'Голова, Челюсти'] } }
  const ubey = { id: 'ubey', types: ['helmet', 'wearable'], properties: { class: 5, durability: 40, zones: [...head, 'Collider Type Eyes', 'Collider Type Jaw'] } }
  const plate = { id: 'sapi', types: ['armorPlate', 'wearable'], properties: { class: 6, durability: 60, material: 'Ceramic', zones: ['chest', 'back'] } }
  const pack6sh = { id: '6sh118', types: ['backpack', 'wearable'], properties: { capacity: 48, speedPenalty: -0.03 } }
  const t20 = { id: 't20', types: ['backpack', 'wearable'], properties: { capacity: 20 } }
  const scav = { id: 'scav', types: ['backpack', 'wearable'], properties: { capacity: 12 } }
  // The Altyn has the game's preset with its face shield on: its picture shows them together.
  const altyn = { id: 'altyn', types: ['helmet', 'wearable'], properties: { class: 5, durability: 81, zones: head, slots: [{ filters: { allowedItems: ['altyn-visor'] } }] } }
  const altynVisor = { id: 'altyn-visor', types: ['mods'], properties: { class: 5, zones: face } }
  const altynPreset = { id: 'altyn-preset', types: ['preset', 'noFlea'], properties: { baseItem: 'altyn' }, containsItems: [{ item: 'altyn', count: 1 }, { item: 'altyn-visor', count: 1 }] }
  const entries = [zhuk, module3m, rig, plainRig, carrier, kiver, comtac6, gssh, tep, maska, maskaVisor, slaap, zsh, zshVisor, ubey, plate, pack6sh, t20, scav, altyn, altynVisor, altynPreset]
  const index = gearStatsIndex({ items: Object.fromEntries(entries.map((entry) => [entry.id, entry])), armorMaterials: MATERIALS })

  it('reads the stats the tiers need from the items file', () => {
    expect(index.get('zhuk')).toMatchObject({ kind: 'armor', armorClass: 6, durability: 305, destructibility: 0.1875, zones: 12 })
    expect(index.get('avs')?.kind).toBe('rig')
    expect(index.has('idea')).toBe(false)
    expect(index.get('slick')?.kind).toBe('rig')
    expect(index.get('kiver')).toMatchObject({ kind: 'helmet', deafening: 'High', blocksHeadset: false, faceClass: 0 })
    expect(index.get('maska')).toMatchObject({ kind: 'helmet', armorClass: 4, faceClass: 6, visorId: 'maska-visor' })
    expect(index.get('ubey')).toMatchObject({ armorClass: 5, faceClass: 5 })
    expect(index.get('altyn')).toMatchObject({ faceClass: 5, visorId: 'altyn-visor', presetId: 'altyn-preset' })
    expect(index.get('maska')?.presetId).toBeUndefined()
    // Shown with the visor on (owner, 02.11.2026: «шлема S тира должны быть на картинке с забралом»).
    expect(tilePictures(item('altyn', { iconUrl: 'https://raidos.app/v1/item-images/altyn-icon.webp' }), index.get('altyn'), 'https://assets.tarkov.dev/altyn-preset-icon.webp')[0]).toMatch(/altyn-preset-icon/)
    expect(index.get('sapi')).toMatchObject({ kind: 'plate', armorClass: 6 })
    expect(index.get('6sh118')).toMatchObject({ kind: 'backpack', capacity: 48 })
    expect(index.get('comtac6')).toMatchObject({ kind: 'headphones', distanceModifier: 1.135, conflictingIds: ['kiver'] })
    expect(gearStatsOf({ types: ['barter'], properties: {} }, MATERIALS)).toBeUndefined()
    expect(stackSizeIndex({ items: { a: { id: 'a', stackMaxSize: 60 }, b: { id: 'b', stackMaxSize: 1 } } })).toEqual(new Map([['a', 60]]))
  })

  it('ranks class 6 with little penalty above class 2', () => {
    expect(armorScore(index.get('zhuk')!, 2.97)).toBeGreaterThanOrEqual(80)
    expect(armorScore(index.get('module')!, 6)).toBeLessThan(50)
    const rows = gearTierRows([item('module', { weight: 6 }), item('zhuk', { weight: 2.97 })], 'pvp', 'armor', index)
    expect(rows.map((row) => [row.item.id, row.tier])).toEqual([['zhuk', 'S'], ['module', 'D']])
  })

  it('takes the items file’s stats once read (the catalog’s may lack the visors), else the catalog’s; each list keeps to its kind', () => {
    const own: GearStats = { kind: 'armor', armorClass: 2, durability: 10, zones: 1 }
    expect(gearTierRows([item('own', { gear: own })], 'pvp', 'armor', index)[0]!.score).toBe(armorScore(own))
    const stale: GearStats = { kind: 'helmet', armorClass: 4, durability: 108 }
    expect(gearTierRows([item('maska', { gear: stale })], 'pvp', 'helmet', index)[0]!.tier).toBe('S')
    expect(gearTierRows([item('avs'), item('zhuk')], 'pvp', 'rig', index).map((row) => row.item.id)).toEqual(['avs'])
  })

  it('lists protection by level: armor, rigs and plates by class, helmets with their visor (owner, 02.11.2026)', () => {
    expect(gearTierRows([item('avs'), item('slick')], 'pvp', 'rig', index).map((row) => [row.item.id, row.tier])).toEqual([['slick', 'S'], ['avs', 'B']])
    expect(gearTierRows([item('sapi')], 'pvp', 'plate', index).map((row) => row.tier)).toEqual(['S'])
    expect(protectionLevel(index.get('maska')!)).toBe(6)
    const helmets = gearTierRows([item('kiver'), item('zsh'), item('ubey'), item('maska')], 'pvp', 'helmet', index)
    expect(helmets.map((row) => [row.item.id, row.tier])).toEqual([['maska', 'S'], ['ubey', 'S'], ['zsh', 'A'], ['kiver', 'B']])
  })

  it('lists backpacks by their cells (owner: «Тир лист рюкзаков составь по количеству ячеек»)', () => {
    const rows = gearTierRows([item('scav'), item('6sh118'), item('t20')], 'pvp', 'backpack', index)
    expect(rows.map((row) => [row.item.id, row.tier])).toEqual([['6sh118', 'S'], ['t20', 'C'], ['scav', 'D']])
  })

  it('rates headsets by hearing distance and clarity', () => {
    expect(headsetScore(index.get('comtac6')!)).toBe(18.5)
    expect(headsetScore(index.get('gssh')!)).toBe(1.5)
    expect(headsetScore(index.get('tep')!)).toBe(0)
    const helmets = gearTierRows([item('kiver')], 'pvp', 'helmet', index)
    expect(helmetsBlocking(index.get('comtac6')!, helmets)).toBe(1)
    expect(helmetsBlocking(index.get('gssh')!, helmets)).toBe(0)
  })
})
