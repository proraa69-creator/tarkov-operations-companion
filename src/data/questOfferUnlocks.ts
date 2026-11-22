import type { Quest, QuestOfferUnlock } from '../domain/types'
import { tarkovRecords } from './tarkovJsonAdapters'

/**
 * What each quest opens at the traders (owner, 16.11.2026, report 171: «какие предметы, модули и патроны открывает этот
 * квест: что становится доступно у торговца после его выполнения»). Three places of the mode's files say it, and they do
 * not always agree, so all three are joined:
 *   - the quest's own rewards (`finishRewards.offerUnlock`: trader, loyalty level, item) — what the game lists;
 *   - the traders' offers for money that wait for a quest (`items[].buyFromTrader[].taskUnlock`);
 *   - the barters that wait for one (`barters[].taskUnlock`).
 * One row per item, trader and quest; a barter-only row says so. The files are those of one mode: PvP, PvE and Season
 * never mix (src/data/catalogSource.ts reads each mode on its own).
 */
export function questOfferUnlocks(tasksRoot: unknown, itemsRoot: unknown, bartersRoot?: unknown): Map<string, QuestOfferUnlock[]> {
  const rows = new Map<string, Map<string, QuestOfferUnlock & { cash?: boolean }>>()
  const add = (questId: string, itemId: string, traderId: string, level: number, kind: 'reward' | 'cash' | 'barter') => {
    if (!questId || !itemId || !traderId) return
    const byKey = rows.get(questId) ?? new Map<string, QuestOfferUnlock & { cash?: boolean }>()
    rows.set(questId, byKey)
    const key = `${itemId}|${traderId}`
    const row = byKey.get(key) ?? { itemId, traderId, level }
    row.level = Math.min(row.level, level)
    if (kind === 'cash') row.cash = true
    if (kind === 'barter') row.barter = true
    byKey.set(key, row)
  }
  for (const task of tarkovRecords(tasksRoot, 'tasks')) {
    const questId = text(task.id)
    for (const unlock of records(object(task.finishRewards).offerUnlock)) add(questId, ref(unlock.item), ref(unlock.trader), level(unlock.level), 'reward')
  }
  for (const item of tarkovRecords(itemsRoot, 'items')) {
    for (const offer of records(item.buyFromTrader)) {
      const questId = ref(offer.taskUnlock)
      if (questId) add(questId, text(item.id), ref(offer.trader), level(offer.minTraderLevel), 'cash')
    }
  }
  for (const barter of tarkovRecords(bartersRoot ?? [], 'barters')) {
    const questId = ref(barter.taskUnlock)
    if (questId) add(questId, ref(object(barter.offeredItem).item), ref(barter.trader), level(barter.minTraderLevel), 'barter')
  }
  const result = new Map<string, QuestOfferUnlock[]>()
  for (const [questId, byKey] of rows) {
    // For money wins: a barter mark only when the quest opens no purchase of the item at that trader.
    result.set(questId, [...byKey.values()].map(({ cash, barter, ...row }) => (barter && !cash ? { ...row, barter: true } : row))
      .sort((a, b) => a.level - b.level || a.traderId.localeCompare(b.traderId)))
  }
  return result
}

/** The quests with what each opens (only those that open anything get the field). */
export function withOfferUnlocks(quests: Quest[], unlocks: ReadonlyMap<string, QuestOfferUnlock[]>): Quest[] {
  if (!unlocks.size) return quests
  return quests.map((quest) => {
    const rows = unlocks.get(quest.id)
    return rows?.length ? { ...quest, offerUnlocks: rows } : quest
  })
}

type Json = Record<string, unknown>
function object(value: unknown): Json { return value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {} }
function records(value: unknown): Json[] { return Array.isArray(value) ? value.map(object) : [] }
function text(value: unknown) { return typeof value === 'string' ? value : '' }
/** An id given as a string or as `{ id }`. */
function ref(value: unknown) { return text(value) || text(object(value).id) }
function level(value: unknown) { return typeof value === 'number' && Number.isFinite(value) && value >= 1 ? Math.round(value) : 1 }
