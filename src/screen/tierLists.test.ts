import { describe, expect, it } from 'vitest'
import type { GearStats, Item, RaidMode } from '../domain/types'
import { gearStatsIndex, gearStatsOf } from '../data/gearStats'
import { armorScore, gearTierRows, headsetScore, helmetsBlocking, pricePerSlot, slotTierRows, tierOf, SLOT_PRICE_STEPS } from './tierLists'

const MATERIALS = { Aramid: { destructibility: 0.1875 }, Ceramic: { destructibility: 0.6 } }

function item(id: string, extra: Partial<Item> & { flea?: Partial<Record<RaidMode, number>> } = {}): Item {
  const { flea = {}, ...rest } = extra
  return {
    id, name: id, shortName: id, category: 'Бартер', description: '', width: 1, height: 1, types: ['barter'],
    prices: Object.entries(flea).map(([mode, price]) => ({ source: 'Барахолка', kind: 'flea' as const, mode: mode as RaidMode, price: price!, updatedAt: '' })),
    ...rest,
  }
}

describe('tier lists: price per slot', () => {
  it('divides the sale price by the slots and keeps the modes apart', () => {
    const rifle = item('ledx', { flea: { pvp: 900_000, pve: 300_000 } })
    const tank = item('tank', { width: 2, height: 2, flea: { pvp: 200_000 } })
    expect(pricePerSlot(tank, 'pvp')?.perSlot).toBe(50_000)
    expect(pricePerSlot(tank, 'pve')).toBeUndefined()
    const pvp = slotTierRows([rifle, tank], 'pvp', 'all')
    expect(pvp.map((row) => [row.item.id, row.tier])).toEqual([['ledx', 'S'], ['tank', 'A']])
    expect(slotTierRows([rifle, tank], 'pve', 'all').map((row) => row.item.id)).toEqual(['ledx'])
  })

  it('lists injectors on their own and keeps gear out of the loot', () => {
    const stim = item('etg', { types: ['injectors', 'meds', 'provisions'], flea: { pvp: 45_000 } })
    const helmet = item('helmet', { types: ['helmet', 'wearable'], flea: { pvp: 500_000 } })
    const key = item('key', { types: ['keys'], flea: { pvp: 30_000 } })
    expect(slotTierRows([stim, helmet, key], 'pvp', 'all').map((row) => row.item.id)).toEqual(['key'])
    expect(slotTierRows([stim, helmet, key], 'pvp', 'barter')).toEqual([])
    expect(slotTierRows([stim, helmet, key], 'pvp', 'injectors').map((row) => [row.item.id, row.tier])).toEqual([['etg', 'A']])
  })

  it('puts a score on the step itself into that tier', () => {
    expect(tierOf(SLOT_PRICE_STEPS[0]!, SLOT_PRICE_STEPS)).toBe('S')
    expect(tierOf(SLOT_PRICE_STEPS[3]! - 1, SLOT_PRICE_STEPS)).toBe('D')
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
