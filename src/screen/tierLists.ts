import type { GearStats, Item, RaidMode } from '../domain/types'
import { bestSale, displayPrice } from '../domain/itemPrices'

/**
 * «Тир-листы» (TierListPanel.tsx): every category by price per inventory slot, ranked within the category (owner,
 * 01.11.2026: «по актуальным ценам… разделены по категориям»); body armor / armored rigs / helmets also by protection,
 * durability, coverage and mobility, headsets by hearing distance and clarity. Everything is computed
 * from the catalog of the mode the player chose (PvP, PvE and Season prices are never mixed) and the tarkov.dev item
 * stats (src/data/gearStats.ts); nothing is a hand-made ranking.
 */
export type Tier = 'S' | 'A' | 'B' | 'C' | 'D'
export const TIERS: readonly Tier[] = ['S', 'A', 'B', 'C', 'D']

export interface TierRow {
  item: Item
  tier: Tier
  /** Price lists: roubles per slot; gear stats: points 0–100. */
  score: number
  /** Price lists: the sale price; gear stats: the price to buy it (flea or trader). */
  price?: number
  gear?: GearStats
}

/** Points, the lower bound of S, A, B and C, for body armor and armored rigs; helmets and headsets have their own. */
export const ARMOR_STEPS: readonly number[] = [80, 70, 60, 50]
export const HELMET_STEPS: readonly number[] = [58, 54, 48, 42]
export const HEADSET_STEPS: readonly number[] = [16, 12, 8, 4]

export function tierOf(score: number, steps: readonly number[]): Tier {
  const index = steps.findIndex((step) => score >= step)
  return TIERS[index === -1 ? 4 : index]!
}

/** The categories a price-per-slot list is made for, each ranked on its own. */
export type PriceCategory = 'barter' | 'valuables' | 'keys' | 'meds' | 'injectors' | 'food' | 'weapons' | 'mods' | 'ammo'
  | 'plates' | 'armor' | 'rig' | 'helmet' | 'headphones' | 'backpacks' | 'containers'

/** Share of a category in S, A, B and C (the rest is D): the best 10 %, the next 20 %, 30 % and 25 %. */
export const SHARE_STEPS: readonly number[] = [0.1, 0.3, 0.6, 0.85]

export function inPriceCategory(item: Item, category: PriceCategory): boolean {
  const types = item.types ?? []
  const has = (type: string) => types.includes(type)
  if (has('preset')) return false
  // Dogtags: dozens of BEAR / USEC variants for a few hundred roubles each, sold only to traders; not loot to rank.
  if (has('barter') && /dogtag/.test(item.normalizedName ?? '')) return false
  switch (category) {
    case 'injectors': return has('injectors')
    case 'meds': return has('meds') && !has('injectors')
    case 'food': return has('provisions') && !has('meds')
    case 'keys': return has('keys')
    case 'valuables': return Boolean(item.valuable) && !has('keys')
    case 'barter': return has('barter') && !item.valuable && !has('keys')
    case 'weapons': return has('gun')
    case 'mods': return has('mods') && !has('armorPlate')
    case 'ammo': return has('ammo')
    case 'plates': return has('armorPlate')
    case 'armor': return has('armor') && !has('rig') && !has('helmet')
    case 'rig': return has('rig')
    case 'helmet': return has('helmet')
    case 'headphones': return has('headphones')
    case 'backpacks': return has('backpack')
    case 'containers': return has('container')
  }
}

/**
 * Roubles per slot: the best sale right now (the flea's lowest offer after its fee, or the trader that pays most) ÷
 * width × height. Ammo takes a whole stack in one cell, so a round's price is multiplied by the stack.
 */
export function pricePerSlot(item: Item, mode: RaidMode, stack = 1): { price: number; perSlot: number } | undefined {
  const sale = bestSale(item, mode)
  const slots = (item.width ?? 1) * (item.height ?? 1)
  if (!sale || sale.net <= 0 || slots <= 0) return undefined
  return { price: sale.net, perSlot: Math.round(sale.net * Math.max(1, stack) / slots) }
}

/** The tier of each value by how many of the category are worth more: equal values share a tier. */
export function shareTiers(values: readonly number[]): Tier[] {
  const sorted = [...values].sort((a, b) => b - a)
  return values.map((value) => {
    const above = sorted.findIndex((other) => other <= value)
    const share = sorted.length ? above / sorted.length : 0
    const index = SHARE_STEPS.findIndex((step) => share < step)
    return TIERS[index === -1 ? 4 : index]!
  })
}

/** A price-per-slot list of one category in one mode; `stacks` gives ammo its stack size when the catalog has none. */
export function slotTierRows(items: readonly Item[], mode: RaidMode, category: PriceCategory, stacks: ReadonlyMap<string, number> = new Map()): TierRow[] {
  const priced = items.filter((item) => inPriceCategory(item, category)).flatMap((item) => {
    const value = pricePerSlot(item, mode, category === 'ammo' ? item.stackSize ?? stacks.get(item.id) ?? 1 : 1)
    return value ? [{ item, score: value.perSlot, price: value.price }] : []
  })
  const tiers = shareTiers(priced.map((row) => row.score))
  return priced.map((row, index) => ({ ...row, tier: tiers[index]! })).sort((a, b) => b.score - a.score)
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
