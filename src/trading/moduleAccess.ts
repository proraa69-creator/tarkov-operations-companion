import type { TraderOffer } from '../domain/trading'
import type { TaskProgressStatus } from '../domain/types'

/**
 * Whether the player can buy a trader's offer of «Продажа модулей» now (owner, 19.11.2026: «цевье Magpul… открывается у торговца
 * механик 2 уровень. Но у меня в режиме сезонном механик 1 уровня… не должен предлагать эти предметы, потому что они
 * недоступны»): the trader's level the app holds for this mode — the player's own choice, else what the traders' screen showed,
 * else the lowest the estimate allows (gunsmith/traderLevels.ts `level`), never the highest the player's level could reach — and
 * the quest that opens the offer, done. A trader the app knows nothing of counts as open (the list is the server's).
 */
export function traderOfferOpen(
  offer: Pick<TraderOffer, 'traderId' | 'level' | 'questId'>,
  levels: ReadonlyArray<{ trader: { id: string }; level: number }>,
  statusOf: (questId: string) => TaskProgressStatus | undefined,
) {
  const info = levels.find((entry) => entry.trader.id === offer.traderId)
  if (info && offer.level > info.level) return false
  return !offer.questId || statusOf(offer.questId) === 'completed'
}
