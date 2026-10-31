import { describe, expect, it } from 'vitest'
import type { GearStats, Item, RaidMode } from '../domain/types'
import { gearStatsIndex, gearStatsOf, stackSizeIndex } from '../data/gearStats'
import { armorScore, ARMOR_STEPS, gearTierRows, headsetScore, helmetsBlocking, pricePerSlot, shareTiers, slotTierRows, tierOf } from './tierLists'

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

  it('counts a whole stack of ammo in one cell', () => {
    const round = item('m995', { types: ['ammo'], flea: { pvp: 900 }, stackSize: 60 })
    expect(slotTierRows([round], 'pvp', 'ammo')[0]!.score).toBe(54_000)
    expect(slotTierRows([{ ...round, stackSize: undefined }], 'pvp', 'ammo', new Map([['m995', 50]]))[0]!.score).toBe(45_000)
  })

  it('puts a score on the step itself into that tier', () => {
    expect(tierOf(ARMOR_STEPS[0]!, ARMOR_STEPS)).toBe('S')
    expect(tierOf(ARMOR_STEPS[3]! - 1, ARMOR_STEPS)).toBe('D')
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
  const index = gearStatsIndex({ items: Object.fromEntries([zhuk, module3m, rig, plainRig, carrier, kiver, comtac6, gssh, tep].map((entry) => [entry.id, entry])), armorMaterials: MATERIALS })

  it('reads the stats the tiers need from the items file', () => {
    expect(index.get('zhuk')).toMatchObject({ kind: 'armor', armorClass: 6, durability: 305, destructibility: 0.1875, zones: 12 })
    expect(index.get('avs')?.kind).toBe('rig')
    expect(index.has('idea')).toBe(false)
    expect(index.get('slick')?.kind).toBe('rig')
    expect(index.get('kiver')).toMatchObject({ kind: 'helmet', deafening: 'High', blocksHeadset: false })
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

  it('prefers the catalog’s own stats and keeps each list to its kind', () => {
    const own: GearStats = { kind: 'armor', armorClass: 2, durability: 10, zones: 1 }
    expect(gearTierRows([item('zhuk', { gear: own })], 'pvp', 'armor', index)[0]!.score).toBe(armorScore(own))
    expect(gearTierRows([item('avs'), item('zhuk')], 'pvp', 'rig', index).map((row) => row.item.id)).toEqual(['avs'])
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
