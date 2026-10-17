import type { Quest, TaskProgressRecord } from '../domain/types'
import { isCompletionOnly, isLiveGameQuest, questFaction, questRequirements } from './questBasics'
import { TRACKED_SOURCES as TRACKED } from './questBasics'

/**
 * The chronology of a player's quests, anchored to what the game logs show (owner, 12.10.2026: «полную хронологию
 * выставить по уровням… которые находят логи, сопоставлять хронологию согласно им»).
 *
 * The game keeps its logs a few weeks, so a veteran's logs show the quests taken lately, not the ones finished long
 * ago. Since the 2026 versions a trader gives most tasks by lines with levels (src/data/questUnlock.ts): Therapist's first
 * line opens «Дефицит» at level 1, «Провизор» at level 2, «Осеннее недомогание» at level 4; the lines themselves follow
 * the loyalty levels (line 1 = LL1 … line 4 = LL4, tarkov.help). Against that grid:
 *
 * - `line`: a task taken at level 4 of a line shows the line reached 4: the line's tasks of levels 1–3 came before it and
 *   were given out long ago — probably completed. Its other level-4 tasks are open (not proven completed).
 * - `stage`: a task taken at a trader's loyalty stage (LL3: a line-3 task, a task that needs LL3) shows the trader's
 *   earlier stages (LL1, LL2) are behind the player — probably completed.
 * - `start`: the trader's first tasks (given in the first dialogue) are behind a player who has any later task of that trader.
 * - `chain`: what such a task needed first came before it too.
 *
 * Only when the logs do not hold the whole history (`historyBeforeLogs`: a taken quest needs one the logs never saw, or a
 * trader's quests are in the logs without the trader's first ones). A new account or a wipe is all in the logs: then a quest the
 * logs do not mention was simply not taken. Never for the «Оружейник» parts (logs only, src/progression/requirementEngine.ts),
 * a quest of the other faction, a quest above the player's level, or one that opens on another quest being taken or
 * failed (a branch: «Большой заказчик», «Простое любопытство»).
 */
export type ChronologyBasis = 'line' | 'stage' | 'start' | 'chain'

export interface ChronologyMark {
  basis: ChronologyBasis
  /** The quest from the logs (or proven by a chain from them) that dates this one. */
  anchorId: string
  /** `chain`: the probably completed quest that needs this one. */
  via?: string
}

export interface ChronologyResult {
  /** Quests the logs never mention that come before what they show: probably completed. */
  completed: Map<string, ChronologyMark>
  /** The level each line reached by the logs: the highest level a taken quest of it needed. */
  lineLevels: Map<string, { level: number; anchorId: string }>
  /** Each trader's loyalty stage by the logs: the highest stage among the trader's taken quests (chronologyStages). */
  traderStages: Map<string, { ll: number; anchorId: string }>
  /** The player's quests began before the oldest log. */
  historyBeforeLogs: boolean
  /** Each quest's loyalty stage, the stage of the trader's own quests it needs included (chronologyStage). */
  stages: Map<string, number>
  /** The character level the logs prove (a taken quest needs it), at least the profile's. */
  knownLevel: number
}

export interface ChronologyOptions {
  playerLevel: number
  faction: 'usec' | 'bear' | 'unknown'
  /** Never inferred («Оружейник» parts). */
  exclude?: ReadonlySet<string>
  /** The logs hold the whole history of the mode (a wipe or prestige was seen in them). */
  historyComplete?: boolean
}

const isTaken = (record?: TaskProgressRecord) => record?.status === 'active' || record?.status === 'completed' || record?.status === 'failed'

/** A quest's trader key: the game id when known, else the name. */
export const traderKeyOf = (quest: Pick<Quest, 'traderId' | 'trader'>) => quest.traderId ?? quest.trader

/**
 * The loyalty stage a quest belongs to: the loyalty its own trader asks for (tarkov.dev), its line's loyalty level, or
 * tarkov.help's loyalty level for it; undefined when nothing tells.
 */
export function questStage(quest: Pick<Quest, 'traderId' | 'traderLoyalty' | 'unlock' | 'helpView'>): number | undefined {
  const own = quest.traderLoyalty?.needed.filter((entry) => !quest.traderId || entry.traderId === quest.traderId).map((entry) => entry.level) ?? []
  const lines = quest.unlock?.lines?.map((line) => line.ll ?? 0) ?? []
  const stage = Math.max(0, ...own, ...lines, quest.helpView?.ll ?? 0)
  return stage || undefined
}

/**
 * Each quest's stage in its trader's chronology: its own (questStage) or that of the trader's quests it needs first,
 * whichever is later — «Врачебная тайна. Часть 3» says nothing itself, but it comes after part 2, an LL2 quest.
 */
export function chronologyStages(quests: Quest[]): Map<string, number> {
  const byId = new Map(quests.map((quest) => [quest.id, quest]))
  const stages = new Map<string, number>()
  const visiting = new Set<string>()
  const stageOf = (quest: Quest): number => {
    const known = stages.get(quest.id)
    if (known !== undefined) return known
    if (visiting.has(quest.id)) return 0
    visiting.add(quest.id)
    let stage = questStage(quest) ?? 0
    for (const requirement of questRequirements(quest)) {
      const previous = byId.get(requirement.taskId)
      if (previous && isCompletionOnly(requirement) && traderKeyOf(previous) === traderKeyOf(quest)) stage = Math.max(stage, stageOf(previous))
    }
    visiting.delete(quest.id)
    stages.set(quest.id, stage)
    return stage
  }
  for (const quest of quests) stageOf(quest)
  for (const [id, stage] of stages) if (!stage) stages.delete(id)
  return stages
}

/** Opens only on another quest being taken or failed: one side of a branch, never assumed done. */
const isBranch = (quest: Quest) => questRequirements(quest).some((requirement) => !requirement.allowedStatuses.includes('complete') && requirement.allowedStatuses.length > 0)

export function inferChronology(quests: Quest[], known: Record<string, TaskProgressRecord>, options: ChronologyOptions): ChronologyResult {
  const live = quests.filter((quest) => isLiveGameQuest(quest))
  const byId = new Map(live.map((quest) => [quest.id, quest]))
  const anchors = live.filter((quest) => isTaken(known[quest.id]))
  const tracked = (taskId: string) => TRACKED.has(known[taskId]?.source as TaskProgressRecord['source']) ? known[taskId] : undefined

  const stages = chronologyStages(live)
  const lineLevels = new Map<string, { level: number; anchorId: string }>()
  for (const quest of anchors) {
    for (const line of quest.unlock?.lines ?? []) {
      const current = lineLevels.get(line.id)
      if (!current || line.level > current.level) lineLevels.set(line.id, { level: line.level, anchorId: quest.id })
    }
  }
  // Traders with lines are the ones whose tasks follow loyalty stages (Fence, Ref, the BTR driver and Lightkeeper have none).
  const staged = new Set(live.filter((quest) => quest.unlock?.lines?.length).map(traderKeyOf))
  const traderStages = new Map<string, { ll: number; anchorId: string }>()
  for (const quest of anchors) {
    const trader = traderKeyOf(quest)
    const stage = stages.get(quest.id)
    if (!staged.has(trader) || !stage) continue
    const current = traderStages.get(trader)
    if (!current || stage > current.ll) traderStages.set(trader, { ll: stage, anchorId: quest.id })
  }

  const starters = new Map<string, Quest[]>()
  for (const quest of live) if (quest.unlock?.dialogue) starters.set(traderKeyOf(quest), [...(starters.get(traderKeyOf(quest)) ?? []), quest])
  const historyBeforeLogs = !options.historyComplete && (
    // a quest in the logs needs one the logs never saw
    live.some((quest) => (tracked(quest.id)?.status === 'active' || tracked(quest.id)?.status === 'completed')
      && questRequirements(quest).some((requirement) => isCompletionOnly(requirement) && byId.has(requirement.taskId) && !tracked(requirement.taskId)))
    // a trader's later quests are in the logs, the trader's first ones are not
    || [...starters].some(([trader, first]) => !first.some((quest) => tracked(quest.id))
      && live.some((quest) => traderKeyOf(quest) === trader && !quest.unlock?.dialogue && tracked(quest.id)))
  )

  const completed = new Map<string, ChronologyMark>()
  // the logs prove the character had the level of every quest taken
  const knownLevel = Math.max(options.playerLevel, ...anchors.map((quest) => quest.level))
  if (!historyBeforeLogs) return { completed, lineLevels, traderStages, historyBeforeLogs, stages, knownLevel }

  const eligible = (quest: Quest) => {
    if (known[quest.id] || options.exclude?.has(quest.id) || isBranch(quest) || quest.level > knownLevel) return false
    const faction = questFaction(quest.faction)
    return !faction || faction === options.faction
  }
  for (const quest of live) {
    if (!eligible(quest)) continue
    const trader = traderKeyOf(quest)
    let mark: ChronologyMark | undefined
    for (const line of quest.unlock?.lines ?? []) {
      const reached = lineLevels.get(line.id)
      if (reached && reached.level > line.level) { mark = { basis: 'line', anchorId: reached.anchorId }; break }
    }
    if (!mark && quest.unlock?.dialogue) {
      const later = anchors.find((entry) => traderKeyOf(entry) === trader && !entry.unlock?.dialogue)
      if (later) mark = { basis: 'start', anchorId: later.id }
    }
    // a quest with no known stage (opened by a story chapter, an event) has no place here
    const stage = traderStages.get(trader)
    const own = stages.get(quest.id)
    if (!mark && stage && staged.has(trader) && own && own < stage.ll) mark = { basis: 'stage', anchorId: stage.anchorId }
    if (mark) completed.set(quest.id, mark)
  }
  // What a probably completed quest needed first came before it.
  const queue = [...completed.keys()]
  while (queue.length) {
    const taskId = queue.shift()!
    const quest = byId.get(taskId)
    if (!quest) continue
    for (const requirement of questRequirements(quest)) {
      const previous = byId.get(requirement.taskId)
      if (!previous || !isCompletionOnly(requirement) || completed.has(previous.id) || !eligible(previous)) continue
      completed.set(previous.id, { basis: 'chain', anchorId: completed.get(taskId)!.anchorId, via: taskId })
      queue.push(previous.id)
    }
  }
  return { completed, lineLevels, traderStages, historyBeforeLogs, stages, knownLevel }
}
