import type { GearStats, Item, RaidMode } from '../domain/types'
import { bestSale, displayPrice } from '../domain/itemPrices'

/**
 * «Тир-листы» (TierListPanel.tsx): loot and injectors by price per inventory slot, body armor / armored rigs / helmets
 * by protection, durability, coverage and mobility, headsets by hearing distance and clarity. Everything is computed
 * from the catalog of the mode the player chose (PvP, PvE and Season prices are never mixed) and the tarkov.dev item
 * stats (src/data/gearStats.ts); nothing is a hand-made ranking.
 */
export type Tier = 'S' | 'A' | 'B' | 'C' | 'D'
export const TIERS: readonly Tier[] = ['S', 'A', 'B', 'C', 'D']

export interface TierRow {
  item: Item
  tier: Tier
  /** Loot: roubles per slot; gear: points 0–100. */
  score: number
  /** Loot: the sale price; gear: the cheapest price to buy it (flea or trader). */
  price?: number
  gear?: GearStats
}

/** Roubles per slot, the lower bound of S, A, B and C (below C is D). */
export const SLOT_PRICE_STEPS: readonly number[] = [100_000, 40_000, 20_000, 10_000]
/** Points, the lower bound of S, A, B and C, for body armor and armored rigs; helmets and headsets have their own. */
export const ARMOR_STEPS: readonly number[] = [80, 70, 60, 50]
export const HELMET_STEPS: readonly number[] = [58, 54, 48, 42]
export const HEADSET_STEPS: readonly number[] = [16, 12, 8, 4]

export function tierOf(score: number, steps: readonly number[]): Tier {
  const index = steps.findIndex((step) => score >= step)
  return TIERS[index === -1 ? 4 : index]!
}

export type LootGroup = 'all' | 'barter' | 'meds' | 'keys'

const isInjector = (item: Item) => Boolean(item.types?.includes('injectors'))
/** What a player puts in the backpack to sell: no guns, gear, mods, ammo or containers. */
const LOOT_EXCLUDED = ['gun', 'preset', 'mods', 'ammo', 'ammoBox', 'wearable', 'armorPlate', 'grenade', 'container', 'backpack', 'rig', 'markedOnly', 'poster']
function inLootGroup(item: Item, group: LootGroup) {
  const types = item.types ?? []
  if (isInjector(item) || types.some((type) => LOOT_EXCLUDED.includes(type))) return false
  const key = types.includes('keys')
  if (group === 'keys') return key
  if (group === 'meds') return !key && (types.includes('meds') || types.includes('provisions'))
  if (group === 'barter') return !key && !types.includes('meds') && !types.includes('provisions')
  return true
}

/** Roubles per slot: the best sale (flea after its fee, or the trader that pays most) ÷ width × height. */
export function pricePerSlot(item: Item, mode: RaidMode): { price: number; perSlot: number } | undefined {
  const sale = bestSale(item, mode)
  const slots = (item.width ?? 1) * (item.height ?? 1)
  if (!sale || sale.net <= 0 || slots <= 0) return undefined
  return { price: sale.net, perSlot: Math.round(sale.net / slots) }
}

export function slotTierRows(items: readonly Item[], mode: RaidMode, filter: 'injectors' | LootGroup): TierRow[] {
  return items
    .filter((item) => filter === 'injectors' ? isInjector(item) : inLootGroup(item, filter))
    .flatMap((item) => {
      const value = pricePerSlot(item, mode)
      return value ? [{ item, tier: tierOf(value.perSlot, SLOT_PRICE_STEPS), score: value.perSlot, price: value.price }] : []
    })
    .sort((a, b) => b.score - a.score)
}

/** Durability that lasts: points ÷ how fast the material wears (tarkov.dev `destructibility`, aramid 0.1875 … ceramic 0.6). */
export function effectiveDurability(gear: GearStats) {
  return (gear.durability ?? 0) / (gear.destructibility || 0.5)
}

/** Movement speed + ergonomics + turn penalties, in percent (positive). */
export function mobilityPenalty(gear: GearStats) {
  return Math.round((Math.abs(gear.speedPenalty ?? 0) + Math.abs(gear.ergoPenalty ?? 0) + Math.abs(gear.turnPenalty ?? 0)) * 1000) / 10
}

const DEAFENING_PENALTY: Record<NonNullable<GearStats['deafening']>, number> = { None: 0, Low: 4, Medium: 8, High: 12 }

/**
 * Points 0–100, as the community weighs armor (class first, then durability that lasts, coverage, then how much it
 * slows you down): class up to 45, effective durability up to 15, hit zones up to 10, mobility up to 25, weight up to 5.
 * Helmets: their durability and zones are smaller (caps 400 and 6), and muffled sound (−4 … −12) and a helmet that
 * does not take a headset (−5) count against it.
 */
export function armorScore(gear: GearStats, weight = 0): number {
  const helmet = gear.kind === 'helmet'
  const durabilityCap = helmet ? 400 : 2000
  const zonesCap = helmet ? 6 : 15
  const protection = ((gear.armorClass ?? 1) - 1) / 5 * 45 + Math.min(effectiveDurability(gear), durabilityCap) / durabilityCap * 15
  const coverage = Math.min(gear.zones ?? 0, zonesCap) / zonesCap * 10
  const mobility = Math.max(0, 25 - mobilityPenalty(gear) * 1.2)
  const lightness = Math.max(0, 5 - weight / (helmet ? 0.4 : 2))
  let score = protection + coverage + mobility + lightness
  if (helmet) score -= (gear.deafening ? DEAFENING_PENALTY[gear.deafening] : 0) + (gear.blocksHeadset ? 5 : 0)
  return Math.round(score)
}

/**
 * Headsets: hearing distance first (`distanceModifier` 1.135 → +13.5 points), then clarity — every 0.01 of
 * distortion below 0.18 adds half a point (ComTac VI: 13.5 + 5 = 18.5; GSSh-01: 0 + 1.5). A headset with no
 * compressor gain hardly amplifies (Peltor TEP-300) and scores no distance.
 */
export function headsetScore(gear: GearStats): number {
  const range = gear.compressorGain === 0 ? 0 : Math.max(0, ((gear.distanceModifier ?? 1) - 1) * 100)
  const clarity = Math.max(0, (0.18 - (gear.distortion ?? 0.18)) * 50)
  return Math.round((range + clarity) * 10) / 10
}

export type GearGroup = 'armor' | 'rig' | 'helmet' | 'headphones'

const buyPrice = (item: Item, mode: RaidMode) => displayPrice(item, mode)?.price

export function gearTierRows(items: readonly Item[], mode: RaidMode, group: GearGroup, stats: ReadonlyMap<string, GearStats>): TierRow[] {
  return items.flatMap((item) => {
    const gear = item.gear ?? stats.get(item.id)
    if (gear?.kind !== group) return []
    const score = group === 'headphones' ? headsetScore(gear) : armorScore(gear, item.weight)
    const steps = group === 'headphones' ? HEADSET_STEPS : group === 'helmet' ? HELMET_STEPS : ARMOR_STEPS
    return [{ item, tier: tierOf(score, steps), score, price: buyPrice(item, mode), gear }]
  }).sort((a, b) => b.score - a.score || (a.price ?? Infinity) - (b.price ?? Infinity))
}

/** Helmets a headset cannot be worn with (its own conflicts, and helmets that take no headset at all). */
export function helmetsBlocking(headset: GearStats, helmets: readonly TierRow[]): number {
  const conflicts = new Set(headset.conflictingIds ?? [])
  return helmets.filter((row) => conflicts.has(row.item.id) || row.gear?.blocksHeadset).length
}
