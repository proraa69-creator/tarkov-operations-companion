import type { GunPart } from '../arsenal/gunTypes'
import type { WeaponBuildRequirement } from '../domain/types'

/**
 * Who sells a part and from which loyalty level (`barter`: for items, not money; `questId`: only once that quest is done,
 * owner 16.11.2026, report 171).
 */
export interface PartSeller { trader: string; level: number; barter?: boolean; questId?: string }

/** A quest that opens an item at a trader (by the trader's key: prapor, mechanic…), from the catalog of the mode. */
export interface PartQuestUnlock { trader: string; level: number; questId: string; barter?: boolean }

/**
 * Sellers of each part of a Gunsmith build (owner, 11.10.2026: «на каждый модуль добавь у какого торговца продается и
 * какой уровень нужен»): the trader offers of tarkov.dev's mod data when it is loaded, and the task's build guide
 * (tarkov.help or the wiki), which also knows the barters. The lowest level first; the flea is not a trader here.
 * An offer that waits for a quest keeps it (`questId`); one at the same trader without a quest wins at the same level.
 * `unlocks`: what the catalog's quests open (src/data/questOfferUnlocks.ts), for the guide's sellers, which name no quest.
 */
export function partSellers(build: WeaponBuildRequirement, mods?: Map<string, GunPart>, unlocks?: ReadonlyMap<string, readonly PartQuestUnlock[]>): Map<string, PartSeller[]> {
  const result = new Map<string, PartSeller[]>()
  const add = (itemId: string, seller: PartSeller) => {
    if (seller.trader === 'flea-market') return
    const list = result.get(itemId) ?? []
    const same = list.find((entry) => entry.trader === seller.trader && Boolean(entry.barter) === Boolean(seller.barter))
    if (!same) list.push({ ...seller })
    else if (seller.level < same.level || (seller.level === same.level && same.questId && !seller.questId)) {
      same.level = seller.level
      if (seller.questId) same.questId = seller.questId
      else delete same.questId
    }
    result.set(itemId, list)
  }
  const ids = new Set([...build.partIds, ...(build.anyOfIds ?? []), ...(build.guide?.parts ?? []).flatMap((part) => (part.itemId ? [part.itemId] : []))])
  for (const id of ids) {
    for (const offer of mods?.get(id)?.offers ?? []) add(id, { trader: offer.vendor, level: offer.minTraderLevel ?? 1, ...(offer.taskUnlock ? { questId: offer.taskUnlock.id } : {}) })
  }
  for (const part of build.guide?.parts ?? []) {
    if (!part.itemId) continue
    for (const seller of part.sellers) {
      // A cash offer tarkov.dev already lists wins; the guide adds barters and traders tarkov.dev does not show.
      if (!seller.barter && result.get(part.itemId)?.some((entry) => entry.trader === seller.trader && !entry.barter)) continue
      const level = Math.max(1, seller.level)
      // The guide does not say a quest: the catalog does when one opens the item at that trader and level.
      const quest = unlocks?.get(part.itemId)?.find((unlock) => unlock.trader === seller.trader && unlock.level === level && Boolean(unlock.barter) === Boolean(seller.barter))
        ?? unlocks?.get(part.itemId)?.find((unlock) => unlock.trader === seller.trader && unlock.level === level)
      add(part.itemId, { trader: seller.trader, level, ...(seller.barter ? { barter: true } : {}), ...(quest ? { questId: quest.questId } : {}) })
    }
  }
  for (const list of result.values()) list.sort((a, b) => a.level - b.level || Number(Boolean(a.barter)) - Number(Boolean(b.barter)))
  return result
}
