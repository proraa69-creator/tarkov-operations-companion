import type { AppDataset, Quest, QuestHelpView, QuestUnlock, RaidMode } from '../domain/types'
import rawSnapshot from './questGrid.snapshot.json'

/**
 * «Сетка квестов» (owner, 12.10.2026: «возьми с сайтов Tarkov Dev, Tarkov Help всю историю квестов, всю сетку квестов»).
 * src/data/questGrid.snapshot.json is written by `node scripts/quest-grid-snapshot.mjs` from json.tarkov.dev (per mode)
 * and tarkov.help's quest map; docs/quests/quest-grid-report.md is the comparison made with it.
 *
 * The catalog brings each task's line conditions itself (src/data/catalogSource.ts reads `otherRequirements`); a catalog
 * built before that (an older server) gets them from the snapshot. The snapshot also gives each trader's lines their order
 * and loyalty level (tarkov.help files a line's tasks under one loyalty level) and tarkov.help's view of every task.
 */
interface SnapshotLine { trader: string; traders?: string[]; ll?: number; levels: number[]; order: number }
interface SnapshotMode {
  tasks: Record<string, { lines?: Array<[string, number]>; dialogue?: boolean }>
  lines: Record<string, SnapshotLine>
}
export interface HelpHistoryQuest extends QuestHelpView {
  trader: string
  name: string
  slug?: string
  en?: string
}
interface QuestGridSnapshot {
  format: number
  generatedAt: string
  modes: Record<string, SnapshotMode | string>
  help: Record<string, QuestHelpView & { timed?: boolean }>
  history: HelpHistoryQuest[]
}

const snapshot = rawSnapshot as unknown as QuestGridSnapshot
const UPSTREAM_MODE: Record<RaidMode, string> = { pvp: 'regular', pve: 'pve', seasonal: 'pvp-season' }

/** When the snapshot was taken (ISO). */
export const questGridSnapshotDate = snapshot.generatedAt

/** Quests tarkov.help lists that the game no longer has: removed, event and story ones (by trader). */
export const questGridHistory: readonly HelpHistoryQuest[] = snapshot.history

function snapshotMode(mode: RaidMode): SnapshotMode | undefined {
  let entry: SnapshotMode | string | undefined = snapshot.modes[UPSTREAM_MODE[mode]]
  // a mode equal to PvP's only names it
  for (let hop = 0; typeof entry === 'string' && hop < 3; hop += 1) entry = snapshot.modes[entry]
  return entry && typeof entry === 'object' ? entry : undefined
}

/** The snapshot's line conditions of one task in a mode. */
export function snapshotUnlock(mode: RaidMode, taskId: string): QuestUnlock | undefined {
  const entry = snapshotMode(mode)?.tasks[taskId]
  if (!entry) return undefined
  return {
    ...(entry.lines?.length ? { lines: entry.lines.map(([id, level]) => ({ id, level })) } : {}),
    ...(entry.dialogue ? { dialogue: true } : {}),
  }
}

/** tarkov.help's view of a task (PvP data, the same tasks in every mode). */
export function helpViewOf(taskId: string): QuestHelpView | undefined {
  const view = snapshot.help[taskId]
  if (!view) return undefined
  return {
    ...(view.ll ? { ll: view.ll } : {}),
    ...(view.level ? { level: view.level } : {}),
    ...(view.kappa ? { kappa: true } : {}),
    ...(view.after?.length ? { after: view.after } : {}),
    ...(view.afterNames?.length ? { afterNames: view.afterNames } : {}),
    ...(view.name ? { name: view.name } : {}),
  }
}

/**
 * The catalog's quests with their trader id, line conditions (the catalog's, else the snapshot's), each line's order among
 * the trader's lines and loyalty level, and tarkov.help's view. Lines unknown to the snapshot (a new game version) come
 * after the known ones, by their id (BSG creates a trader's lines in order).
 */
export function withQuestGrid(dataset: AppDataset, mode: RaidMode = dataset.metadata?.mode ?? 'pvp'): AppDataset {
  if (!dataset.quests.length) return dataset
  const lineInfo = snapshotMode(mode)?.lines ?? {}
  const traderIdByName = new Map(dataset.traders.map((trader) => [trader.name, trader.id]))
  const prepared = dataset.quests.map((quest) => {
    const traderId = quest.traderId ?? traderIdByName.get(quest.trader)
    const unlock = quest.unlock ?? snapshotUnlock(mode, quest.id)
    const helpView = quest.helpView ?? helpViewOf(quest.id)
    if (!traderId && !unlock && !helpView) return quest
    return { ...quest, ...(traderId ? { traderId } : {}), ...(unlock ? { unlock } : {}), ...(helpView ? { helpView } : {}) }
  })
  // each trader's lines in order: tarkov.help's loyalty level, then the id
  const linesByTrader = new Map<string, Map<string, number | undefined>>()
  for (const quest of prepared) {
    for (const line of quest.unlock?.lines ?? []) {
      const owner = lineInfo[line.id]?.trader ?? quest.traderId ?? quest.trader
      const lines = linesByTrader.get(owner) ?? new Map<string, number | undefined>()
      lines.set(line.id, lineInfo[line.id]?.ll ?? lines.get(line.id))
      linesByTrader.set(owner, lines)
    }
  }
  const place = new Map<string, { order: number; ll?: number }>()
  for (const lines of linesByTrader.values()) {
    const ordered = [...lines].sort(([a, llA], [b, llB]) => (llA ?? 9) - (llB ?? 9) || a.localeCompare(b))
    ordered.forEach(([id, ll], index) => place.set(id, { order: index + 1, ...(ll ? { ll } : {}) }))
  }
  const quests = prepared.map((quest): Quest => {
    if (!quest.unlock?.lines?.length) return quest
    return { ...quest, unlock: { ...quest.unlock, lines: quest.unlock.lines.map((line) => ({ ...line, ...place.get(line.id) })) } }
  })
  return { ...dataset, quests }
}
