/**
 * «Квесты» next to «Убежище» (owner, 28.10.2026: «у нас есть убежище, а есть предметы по квестам… открывается такое же
 * окно с квестами… с предметами для недоступных и будущих квестов. А те, которые уже выполнены, предметы нужно
 * убрать… он уйдёт вниз в собранные»): every item the quests of this mode ask for, in the shape of the hideout's list
 * (hideout/hideoutNeeds.ts) so the same stash shows it.
 *
 * Per quest the count of raidprep/keepList.ts questItemNeeds (find and hand over of one item are one need; items to plant
 * or mark are added; an objective accepting a large set of items is skipped), plus each key the quest asks to bring (one
 * per quest), as the quest trackers count them. A completed quest's items count as collected: they move to «Собрано»
 * with the pieces the player marked; failed quests and quests of the other faction are left out.
 */
import type { ModeProgress, Quest } from '../domain/types'
import type { TaskAvailability } from '../progression/requirementEngine'
import { isLiveGameQuest, questFaction } from '../progression/questBasics'
import { questItemNeeds } from '../raidprep/keepList'
import { DOLLARS, EUROS, ROUBLES, type HideoutNeed, type HideoutNeeds } from '../hideout/hideoutNeeds'

const MONEY = new Set([ROUBLES, DOLLARS, EUROS])

/** One quest that needs the item: `stationId` / `stationName` are the quest's (the hideout's shape), `level` its level. */
export interface QuestNeedUse { stationId: string; stationName: string; level: number; count: number; foundInRaid: boolean; trader: string; done: boolean; key?: boolean }

export type QuestNeed = Omit<HideoutNeed, 'uses'> & { uses: QuestNeedUse[]; key: boolean }

export interface QuestNeeds extends Omit<HideoutNeeds, 'items'> { items: QuestNeed[] }

export function questNeeds(quests: Quest[], progress: Pick<ModeProgress, 'taskProgress' | 'faction'>, availability: Map<string, TaskAvailability>,
  marked: ReadonlyMap<string, number>, onlyTrader?: string): QuestNeeds {
  const byItem = new Map<string, QuestNeedUse[]>()
  const add = (itemId: string, use: QuestNeedUse) => {
    if (MONEY.has(itemId)) return
    const uses = byItem.get(itemId) ?? []
    uses.push(use)
    byItem.set(itemId, uses)
  }
  for (const quest of quests) {
    if (!isLiveGameQuest(quest) || quest.kind === 'story') continue
    if (onlyTrader && quest.trader !== onlyTrader) continue
    const status = availability.get(quest.id)?.status ?? progress.taskProgress[quest.id]?.status
    if (status === 'failed') continue
    const faction = questFaction(quest.faction)
    if (faction && progress.faction !== 'unknown' && faction !== progress.faction) continue
    const done = status === 'completed'
    const base = { stationId: quest.id, stationName: quest.name, level: quest.level, trader: quest.trader, done }
    for (const [itemId, need] of questItemNeeds(quest)) add(itemId, { ...base, count: need.count, foundInRaid: need.foundInRaid })
    const keys = new Set((quest.raidRequirements ?? []).filter((requirement) => requirement.purpose === 'key' && requirement.itemId && !requirement.optional).map((requirement) => requirement.itemId))
    for (const itemId of keys) if (!byItem.get(itemId)?.some((use) => use.stationId === quest.id)) add(itemId, { ...base, count: 1, foundInRaid: false, key: true })
  }
  const items = [...byItem].map(([itemId, uses]): QuestNeed => {
    const total = uses.reduce((sum, use) => sum + use.count, 0)
    const completed = uses.filter((use) => use.done).reduce((sum, use) => sum + use.count, 0)
    const found = Math.min(total, completed + Math.max(0, marked.get(itemId) ?? 0))
    const open = uses.filter((use) => !use.done)
    return {
      itemId, total, found, remaining: total - found,
      foundInRaid: open.some((use) => use.foundInRaid),
      key: uses.every((use) => use.key),
      uses: uses.sort((a, b) => Number(a.done) - Number(b.done) || a.level - b.level || a.stationName.localeCompare(b.stationName, 'ru')),
    }
  })
  return {
    items,
    money: { roubles: 0, dollars: 0, euros: 0 },
    remaining: items.reduce((sum, item) => sum + item.remaining, 0),
    total: items.reduce((sum, item) => sum + item.total, 0),
  }
}
