import type { Item, ModeProgress, Quest, RaidMode } from '../domain/types'
import type { ItemOverlayInfo, QuestNeed } from './types'
import type { KeepBadge } from '../raidprep/keepList'
import { fleaQuote, isAveragePrice, quoteKind } from '../domain/itemPrices'

const PURPOSE: Record<string, string> = {
  handover: 'сдать',
  find: 'найти',
  bring: 'принести',
  place: 'заложить',
  mark: 'отметить',
  key: 'ключ',
}

const COLLECTOR = /коллекционер|collector/i

/** What the player still needs this item for: open quests, Kappa, and what it sells for. */
export function describeItem(item: Item, quests: Quest[], progress: Pick<ModeProgress, 'taskProgress'>, mode?: RaidMode, keep?: KeepBadge): ItemOverlayInfo {
  const needs: QuestNeed[] = []
  for (const quest of quests) {
    const status = progress.taskProgress[quest.id]?.status
    if (status === 'completed' || status === 'failed') continue
    const requirements = quest.raidRequirements?.filter((requirement) => requirement.itemId === item.id) ?? []
    if (!requirements.length && !quest.requiredItems?.includes(item.id)) continue
    const count = requirements.reduce((sum, requirement) => sum + (requirement.count || 1), 0) || 1
    needs.push({
      questId: quest.id,
      name: quest.name,
      trader: quest.trader,
      count,
      kappa: quest.kappa,
      purpose: PURPOSE[requirements[0]?.purpose ?? ''] ?? 'нужен',
    })
  }
  needs.sort((a, b) => Number(progress.taskProgress[b.questId]?.status === 'active') - Number(progress.taskProgress[a.questId]?.status === 'active') || Number(b.kappa) - Number(a.kappa))

  const traderQuotes = item.prices.filter((quote) => quoteKind(quote) === 'trader' && quote.price > 0 && (!mode || !quote.mode || quote.mode === mode))
  const bestTrader = traderQuotes.sort((a, b) => b.price - a.price)[0]
  // The flea price of the selected mode only; an item whose flea quote belongs to another mode shows none.
  const flea = mode ? fleaQuote(item, mode) : undefined
  const hasFleaQuotes = item.prices.some((quote) => quoteKind(quote) === 'flea')
  const fleaPrice = flea ? flea.price : mode && hasFleaQuotes ? undefined : item.fleaPrice
  const fleaAverage = flea ? isAveragePrice(flea) : fleaPrice !== undefined && item.fleaPriceBasis === 'avg-24h'

  return {
    state: 'found',
    itemId: item.id,
    name: item.name,
    shortName: item.shortName,
    iconUrl: item.types?.includes('gun') && item.presetImageUrl ? item.presetImageUrl : item.iconUrl,
    ...(item.types?.includes('gun') && item.presetImageUrl ? { weaponPreset: true } : {}),
    fleaPrice,
    ...(fleaAverage ? { fleaAverage: true } : {}),
    bestTrader: bestTrader ? { name: bestTrader.source, price: bestTrader.price } : undefined,
    quests: needs,
    kappa: needs.some((need) => need.kappa),
    collector: needs.some((need) => COLLECTOR.test(need.name)),
    ...(keep ? { keep } : {}),
  }
}
