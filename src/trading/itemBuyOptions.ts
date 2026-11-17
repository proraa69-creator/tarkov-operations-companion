import type { EconomyItem, EconomySnapshot, TaskRef } from '../data/economyApi'
import { cheapestBuy, fleaPrice, type PriceContext } from '../domain/economy'

/**
 * «Купить» in an item's card (report 187, 17.11.2026: «у предмета не только цену продажи, но и цену покупки. Если это нечто
 * недоступное или бартерное — показывать условия разблокировки и/или цену предметов для бартера»): every way to get one
 * now in the mode of the snapshot — a trader's cash offer, the flea market, a barter with what it asks at today's prices —
 * and whether the player can use it already (loyalty, the quest that opens it, the flea's level).
 */
export interface BuyAccess {
  /** The player's loyalty per trader id in this mode; a trader not in it counts as reached. */
  loyalty: ReadonlyMap<string, number>
  playerLevel: number
  /** The mode has a flea market, and the character's level that opens it. */
  fleaEnabled: boolean
  fleaLevel: number
  /** Whether a quest is done; unknown → the offer counts as open. */
  taskDone?: (taskId: string) => boolean
}

/** Why an offer is not open yet: a loyalty level, a quest, the flea's level. */
export interface BuyLock { level?: number; task?: TaskRef; playerLevel?: number }

export interface TraderBuy { kind: 'trader'; traderId?: string; traderName: string; level: number; price: number; buyLimit?: number; task?: TaskRef; lock?: BuyLock }
export interface FleaBuy { kind: 'flea'; price: number; average: boolean; lock?: BuyLock }
export interface BarterPartPrice { itemId: string; name: string; iconUrl?: string; count: number; total: number | null }
export interface BarterBuy { kind: 'barter'; id: string; traderId: string; traderName: string; level: number; gives: number; parts: BarterPartPrice[]; total: number | null; buyLimit?: number; task?: TaskRef; lock?: BuyLock }

export interface ItemBuyOptions {
  traders: TraderBuy[]
  flea?: FleaBuy
  /** Banned from the flea market in this mode. */
  noFlea: boolean
  barters: BarterBuy[]
}

function lockOf(traderId: string | undefined, level: number | undefined, task: TaskRef | undefined, access: BuyAccess): BuyLock | undefined {
  const own = traderId ? access.loyalty.get(traderId) : undefined
  const needLevel = level && own !== undefined && own < level ? level : undefined
  const needTask = task && access.taskDone && !access.taskDone(task.id) ? task : undefined
  return needLevel || needTask ? { ...(needLevel ? { level: needLevel } : {}), ...(needTask ? { task: needTask } : {}) } : undefined
}

/** The ways to get `itemId`, open ones first, each kind by price. Nothing for an item the snapshot does not know. */
export function itemBuyOptions(itemId: string, snapshot: EconomySnapshot, access: BuyAccess): ItemBuyOptions {
  const item: EconomyItem | undefined = snapshot.items[itemId]
  const fleaOpen = access.fleaEnabled && snapshot.flea.enabled && access.playerLevel >= access.fleaLevel
  // the parts of a barter at the cheapest price the player can pay now (the flea from its level, the traders he has reached)
  const context: PriceContext = {
    fleaEnabled: fleaOpen,
    feeOptions: { offerFeeRate: snapshot.flea.offerFeeRate, requirementFeeRate: snapshot.flea.requirementFeeRate },
    traderLevels: Object.fromEntries(access.loyalty),
    defaultTraderLevel: 4,
  }
  const open = (row: { lock?: BuyLock }) => Number(Boolean(row.lock))

  const traders: TraderBuy[] = (item?.buyFor ?? []).filter((offer) => offer.kind === 'trader' && offer.price > 0).map((offer) => {
    const level = offer.minTraderLevel ?? 1
    const lock = lockOf(offer.traderId, level, offer.taskUnlock, access)
    return { kind: 'trader' as const, ...(offer.traderId ? { traderId: offer.traderId } : {}), traderName: offer.source, level, price: offer.price,
      ...(offer.buyLimit ? { buyLimit: offer.buyLimit } : {}), ...(offer.taskUnlock ? { task: offer.taskUnlock } : {}), ...(lock ? { lock } : {}) }
  }).sort((a, b) => open(a) - open(b) || a.price - b.price)

  const noFlea = Boolean(item?.noFlea) || !access.fleaEnabled || !snapshot.flea.enabled
  const fleaValue = item && !noFlea ? fleaPrice(item) : undefined
  const flea: FleaBuy | undefined = fleaValue ? {
    kind: 'flea', price: fleaValue, average: item!.lastLowPrice === undefined,
    ...(access.playerLevel < access.fleaLevel ? { lock: { playerLevel: access.fleaLevel } } : {}),
  } : undefined

  const barters: BarterBuy[] = snapshot.barters.flatMap((barter) => {
    const reward = barter.rewardItems.find((entry) => entry.itemId === itemId)
    if (!reward) return []
    const parts = barter.requiredItems.map(({ itemId: partId, count }) => {
      const part = snapshot.items[partId]
      const choice = cheapestBuy(part, context)
      return { itemId: partId, name: part?.name ?? partId, ...(part?.iconUrl ? { iconUrl: part.iconUrl } : {}), count, total: choice ? Math.round(choice.unitPrice * count) : null }
    })
    const total = parts.every((part) => part.total !== null) ? parts.reduce((sum, part) => sum + (part.total ?? 0), 0) : null
    const lock = lockOf(barter.traderId, barter.level, barter.taskUnlock, access)
    return [{ kind: 'barter' as const, id: barter.id, traderId: barter.traderId, traderName: barter.traderName, level: barter.level, gives: reward.count, parts, total,
      ...(barter.buyLimit ? { buyLimit: barter.buyLimit } : {}), ...(barter.taskUnlock ? { task: barter.taskUnlock } : {}), ...(lock ? { lock } : {}) }]
  }).sort((a, b) => open(a) - open(b) || (a.total ?? Infinity) - (b.total ?? Infinity))

  return { traders, ...(flea ? { flea } : {}), noFlea, barters }
}
