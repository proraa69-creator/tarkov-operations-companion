import type { GearStats, Item, RaidMode } from '../domain/types'
import { displayPrice } from '../domain/itemPrices'
import type { AmmoStats } from '../arsenal/ammoSource'
import { usesDataGateway } from '../data/tarkovApi'

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
  /** Price lists: roubles per slot (weapons: the whole price); gear stats: points 0–100; ammo: penetration. */
  score: number
  /** Price lists: the price now (flea, else trader); gear stats: the price to buy it (flea or trader). */
  price?: number
  /** Where `price` comes from: the flea's lowest offer or, for what the flea does not sell, a trader. */
  priceKind?: 'flea' | 'trader'
  gear?: GearStats
  ammo?: AmmoStats
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
 * The price a list shows (owner, 02.11.2026: «цены на предметы не соответствуют барахолке, возьми цены актуальные»): the
 * flea's lowest offer now, as «Барахолка» shows it (displayPrice, not what is left after the fee); an item the flea does
 * not sell, the best trader. No offer at all (the handbook base price only): no price.
 */
export function marketPrice(item: Item, mode: RaidMode): { price: number; kind: 'flea' | 'trader' } | undefined {
  const price = displayPrice(item, mode)
  return price && price.kind !== 'base' && price.price > 0 ? { price: price.price, kind: price.kind } : undefined
}

/** Roubles per slot: the market price ÷ width × height. */
export function pricePerSlot(item: Item, mode: RaidMode): { price: number; perSlot: number; kind: 'flea' | 'trader' } | undefined {
  const market = marketPrice(item, mode)
  const slots = (item.width ?? 1) * (item.height ?? 1)
  if (!market || slots <= 0) return undefined
  return { ...market, perSlot: Math.round(market.price / slots) }
}

/**
 * Weapons by their whole price, not per slot (owner, 02.11.2026: «написано цена за слот, за какой слот? … просто пиши цену
 * оружия и все а по ним уже тир лист»): a gun's own item is its bare receiver, a cell or two, so per slot meant nothing.
 */
export const BY_WHOLE_PRICE: ReadonlySet<PriceCategory> = new Set(['weapons'])

/** Collectible figurines stay in the lists even without a picture (owner, 02.11.2026: «предметы без картинок … убери кроме фигурок»). */
export function isFigurine(item: Pick<Item, 'name' | 'normalizedName'>) {
  return /figurine/i.test(item.normalizedName ?? '') || /фигурк|статуэтк|figurine/i.test(item.name)
}

/** An item's icon on our server (tarkov.dev's in development). */
const iconPicture = (id: string) => usesDataGateway() ? `https://raidos.app/v1/item-images/${id}-icon.webp` : `https://assets.tarkov.dev/${id}-icon.webp`
/** An item's inventory picture on our server (tarkov.dev's own name in development). */
const gridPicture = (id: string) => usesDataGateway() ? `https://raidos.app/v1/item-images/${id}-grid.webp` : `https://assets.tarkov.dev/${id}-grid-image.webp`

/**
 * A tile's pictures, best first. A weapon is shown whole — its default preset's inventory picture — not its bare receiver
 * (owner, 02.11.2026: «показывай всегда полностью оружие, а не его кусок»; the stash does the same, HideoutStashPage.tsx).
 * A helmet with its visor on when the game has that preset (owner: «шлема S тира должны быть на картинке с забралом»).
 */
export function tilePictures(item: Pick<Item, 'id' | 'iconUrl' | 'presetImageUrl' | 'types'>, gear?: GearStats): string[] {
  // The preset's icon: the helmet with its visor, without the English name the grid picture has drawn on it.
  if (gear?.kind === 'helmet' && gear.presetId) return pictures([iconPicture(gear.presetId), item.iconUrl])
  const preset = item.types?.includes('gun') && item.presetImageUrl ? /([a-z0-9]{16,48})-(?:grid|512|icon|base)/.exec(item.presetImageUrl)?.[1] : undefined
  return pictures(preset ? [gridPicture(preset), item.presetImageUrl, item.iconUrl] : [item.iconUrl])
}

/** Real pictures only: tarkov.dev's «unknown item» placeholder (new event items: «Кровь», «Прекурсор») counts as none. */
const pictures = (urls: Array<string | undefined>) => [...new Set(urls.filter((url): url is string => Boolean(url) && !/unknown-item/i.test(url!)))]

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

/** A price list of one category in one mode: per slot, weapons by the whole price (BY_WHOLE_PRICE). */
export function slotTierRows(items: readonly Item[], mode: RaidMode, category: PriceCategory): TierRow[] {
  const whole = BY_WHOLE_PRICE.has(category)
  const priced = items.filter((item) => inPriceCategory(item, category)).flatMap((item) => {
    const value = pricePerSlot(item, mode)
    return value ? [{ item, score: whole ? value.price : value.perSlot, price: value.price, priceKind: value.kind }] : []
  })
  const tiers = shareTiers(priced.map((row) => row.score))
  return priced.map((row, index) => ({ ...row, tier: tiers[index]! })).sort((a, b) => b.score - a.score)
}

/** Penetration, the lower bound of S, A, B and C: the armor class a round still pierces (ballistics.ts effectiveArmorClass). */
export const AMMO_STEPS: readonly number[] = [60, 50, 40, 30]

/** Grenades, flares and rockets of every kind (owner, 02.11.2026: «убери из листа гранаты всех видов»). */
const NOT_ROUNDS = /^Caliber(40x46|40mmRU|30x29|26x75)$/
const NOT_ROUND_NAME = /гранат|grenade|сигнальн|осветительн|flare|ракет|rocket/i

/**
 * Ammo by penetration, as the «Баллистика» table rates it (owner, 02.11.2026: «тир лист патронов, сделай на основе таблицы
 * патронов. в s листе должны быть лучшие патроны по пробитию … в тир листе патронов убери цену»): S pierces class 6
 * (60 and more), A class 5, B class 4, C class 3, D the rest; in a tier more penetration first, then more damage.
 */
export function ammoTierRows(rounds: readonly AmmoStats[]): TierRow[] {
  return rounds
    .filter((round) => !NOT_ROUNDS.test(round.caliber) && !NOT_ROUND_NAME.test(`${round.name} ${round.shortName}`))
    .map((round) => ({
      item: { id: round.id, name: round.name, shortName: round.shortName, category: 'Боеприпас' as const, description: '', prices: [], types: ['ammo'], ...(round.iconUrl ? { iconUrl: round.iconUrl } : {}) },
      tier: tierOf(round.penetration, AMMO_STEPS),
      score: round.penetration,
      ammo: round,
    }))
    .sort((a, b) => b.score - a.score || b.ammo.damage * (b.ammo.projectileCount ?? 1) - a.ammo.damage * (a.ammo.projectileCount ?? 1))
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

export type GearGroup = 'armor' | 'rig' | 'plate' | 'helmet' | 'headphones' | 'backpack'

const buyPrice = (item: Item, mode: RaidMode) => displayPrice(item, mode)?.price

/**
 * The lists by protection level (owner, 02.11.2026): body armor by the class of its plates («тир лист бронежилетов - убери
 * цены и делай лист по уровню бронеплит s лист это 6 уровень»), armored rigs the same («разгрузки, так же»), armor plates
 * by their own class: S class 6, A 5, B 4, C 3, D the rest. Helmets with their visor («тир S шлема 5-6 уровень, тир A
 * шлема 4 уровень»): S 5–6, A 4, B 3, C 2, D 1. In a level, the points (armorScore) decide. Backpacks by their cells
 * («Тир лист рюкзаков составь по количеству ячеек … а цены убери»): S 40 and more, A 35, B 30, C 20, D fewer.
 */
export const LEVEL_GROUPS: ReadonlySet<GearGroup> = new Set(['armor', 'rig', 'plate', 'helmet', 'backpack'])
export const PLATE_CLASS_STEPS: readonly number[] = [6, 5, 4, 3]
export const HELMET_LEVEL_STEPS: readonly number[] = [5, 4, 3, 2]
export const BACKPACK_STEPS: readonly number[] = [40, 35, 30, 20]

/** The level a protection list ranks by: a helmet with its visor (the higher of the two), the rest by their class. */
export function protectionLevel(gear: GearStats) {
  return gear.kind === 'helmet' ? Math.max(gear.armorClass ?? 0, gear.faceClass ?? 0) : gear.armorClass ?? 0
}

/** What a level list ranks by: a backpack's cells, else the protection level. */
export function gearLevel(gear: GearStats) {
  return gear.kind === 'backpack' ? gear.capacity ?? 0 : protectionLevel(gear)
}

const LEVEL_STEPS: Partial<Record<GearGroup, readonly number[]>> = { helmet: HELMET_LEVEL_STEPS, backpack: BACKPACK_STEPS }

export function gearTierRows(items: readonly Item[], mode: RaidMode, group: GearGroup, stats: ReadonlyMap<string, GearStats>): TierRow[] {
  const byLevel = LEVEL_GROUPS.has(group)
  return items.flatMap((item) => {
    // The items file's stats when the panel read it (the catalog lacked them or had them without the visors), else the catalog's.
    const gear = stats.get(item.id) ?? item.gear
    if (gear?.kind !== group) return []
    const score = group === 'headphones' ? headsetScore(gear) : group === 'backpack' ? -mobilityPenalty(gear) - (item.weight ?? 0) : armorScore(gear, item.weight)
    const tier = byLevel ? tierOf(gearLevel(gear), LEVEL_STEPS[group] ?? PLATE_CLASS_STEPS) : tierOf(score, HEADSET_STEPS)
    return [{ item, tier, score, price: buyPrice(item, mode), gear }]
  }).sort((a, b) => (byLevel ? gearLevel(b.gear) - gearLevel(a.gear) || (b.gear.faceClass ?? 0) - (a.gear.faceClass ?? 0) : 0)
    || b.score - a.score || (a.price ?? Infinity) - (b.price ?? Infinity))
}

/** Helmets a headset cannot be worn with (its own conflicts, and helmets that take no headset at all). */
export function helmetsBlocking(headset: GearStats, helmets: readonly TierRow[]): number {
  const conflicts = new Set(headset.conflictingIds ?? [])
  return helmets.filter((row) => conflicts.has(row.item.id) || row.gear?.blocksHeadset).length
}
