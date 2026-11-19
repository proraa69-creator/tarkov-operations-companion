import type { Item, RaidMode } from '../domain/types'
import { displayPrice } from '../domain/itemPrices'
import { itemPriceCategory, slotTierRows, type PriceCategory, type Tier } from '../screen/tierLists'

/** Only these are dear enough to name (owner, 20.11.2026: «если с них падают дорогие предметы, то показывай»). */
const DEAR: ReadonlySet<Tier> = new Set(['S', 'A'])

/**
 * «Может выпасть» of the retinue: of what a guard may carry (bossRetinue.json `loot`), only what is tier S or A of its category in
 * this mode, by the price per slot the item card's tier letter uses (tierLists.ts itemTier; the interface names no tier); rounds
 * are on the guns already. The dearest first. Each category is ranked once for all the ids asked about.
 */
export function dearLoot(items: readonly Item[], index: ReadonlyMap<string, Item>, mode: RaidMode, ids: readonly string[]): Item[] {
  const tiers = new Map<PriceCategory, Map<string, Tier>>()
  const tierOf = (item: Item, category: PriceCategory) => {
    let ranked = tiers.get(category)
    if (!ranked) {
      ranked = new Map(slotTierRows(items, mode, category).map((row) => [row.item.id, row.tier]))
      tiers.set(category, ranked)
    }
    return ranked.get(item.id)
  }
  const price = (item: Item) => displayPrice(item, mode)?.price ?? 0
  const dear = [...new Set(ids)].flatMap((id) => {
    const item = index.get(id)
    const category = item ? itemPriceCategory(item) : undefined
    if (!item || !category || category === 'ammo') return []
    const tier = tierOf(item, category)
    return tier && DEAR.has(tier) ? [item] : []
  })
  return dear.sort((a, b) => price(b) - price(a) || a.name.localeCompare(b.name, 'ru'))
}
