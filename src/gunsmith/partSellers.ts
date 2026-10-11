import type { GunPart } from '../arsenal/gunTypes'
import type { WeaponBuildRequirement } from '../domain/types'

/** Who sells a part and from which loyalty level (`barter`: for items, not money). */
export interface PartSeller { trader: string; level: number; barter?: boolean }

/**
 * Sellers of each part of a Gunsmith build (owner, 11.10.2026: «на каждый модуль добавь у какого торговца продается и
 * какой уровень нужен»): the trader offers of tarkov.dev's mod data when it is loaded, and the wiki table of the task
 * (src/data/wikiGunsmith.ts), which also knows the barters. The lowest level first; the flea is not a trader here.
 */
export function partSellers(build: WeaponBuildRequirement, mods?: Map<string, GunPart>): Map<string, PartSeller[]> {
  const result = new Map<string, PartSeller[]>()
  const add = (itemId: string, seller: PartSeller) => {
    if (seller.trader === 'flea-market') return
    const list = result.get(itemId) ?? []
    const same = list.find((entry) => entry.trader === seller.trader && Boolean(entry.barter) === Boolean(seller.barter))
    if (same) same.level = Math.min(same.level, seller.level)
    else list.push({ ...seller })
    result.set(itemId, list)
  }
  const ids = new Set([...build.partIds, ...(build.anyOfIds ?? []), ...(build.wikiParts ?? []).flatMap((part) => (part.itemId ? [part.itemId] : []))])
  for (const id of ids) {
    for (const offer of mods?.get(id)?.offers ?? []) add(id, { trader: offer.vendor, level: offer.minTraderLevel ?? 1 })
  }
  for (const part of build.wikiParts ?? []) {
    if (!part.itemId) continue
    for (const seller of part.sellers) {
      // A cash offer tarkov.dev already lists wins; the wiki adds barters and traders tarkov.dev does not show.
      if (!seller.barter && result.get(part.itemId)?.some((entry) => entry.trader === seller.trader && !entry.barter)) continue
      add(part.itemId, { trader: seller.trader, level: Math.max(1, seller.level), ...(seller.barter ? { barter: true } : {}) })
    }
  }
  for (const list of result.values()) list.sort((a, b) => a.level - b.level || Number(Boolean(a.barter)) - Number(Boolean(b.barter)))
  return result
}
