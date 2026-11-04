/**
 * A Tasks-table reading against the quest's own chain (a player's ticket №37, 04.11.2026: «Каратель. Часть 3» in the app
 * while the logs hold «Часть 1» and the game has not opened the rest; docs/quests/quest-state-engine.md «When a quest
 * leaves the lists»). The parts of a chain differ by one sign, and older versions read a lost number as whichever part
 * came first in the catalog: such a record is held by no one, yet it stayed for good and proved the parts before it done.
 *
 * Only numbered chains. The logs miss a hand-in of their own numbered parts in 1.4% of the cases (69 of 4906, all players,
 * 04.11.2026), so a real next part is ruled out only if its own «taken» is missing from the logs as well. Across other
 * chains they say nothing: «На свет» never logs its hand-ins (219 quests held with «Ложный вызов» still open, none with
 * it closed), «Путь выживальщика» misses them up to 53% of the time, and the record is a right title read right.
 * «Оружейник» neither: its catalog chain does not hold (gunsmithFromLogs).
 */
import type { Quest, QuestInputLayers, TaskProgressRecord } from '../domain/types'
import { isGunsmithQuest } from '../gunsmith/gunsmith'
import { chainStems, isNumberedQuest } from '../import/questOcr'
import { isCompletionOnly, isLiveGameQuest, questRequirements } from '../progression/questBasics'

/** Hand-ins and readings may come from PCs whose clocks differ a little. */
const CLOCK_SLACK_MS = 5 * 60 * 1000

/** The parts a numbered quest needs handed in before it: its mandatory prerequisites of its own chain, however far back. */
export function earlierChainParts(quest: Quest, byId: ReadonlyMap<string, Quest>): Quest[] {
  if (!isLiveGameQuest(quest) || isGunsmithQuest(quest) || !isNumberedQuest(quest)) return []
  const stems = new Set(chainStems(quest))
  const earlier: Quest[] = []
  const seen = new Set([quest.id])
  const stack = [quest]
  while (stack.length) {
    for (const requirement of questRequirements(stack.pop()!)) {
      if (!isCompletionOnly(requirement) || seen.has(requirement.taskId)) continue
      seen.add(requirement.taskId)
      const before = byId.get(requirement.taskId)
      if (!before) continue
      stack.push(before)
      if (!isGunsmithQuest(before) && chainStems(before).some((stem) => stems.has(stem))) earlier.push(before)
    }
  }
  return earlier
}

/**
 * The earlier part that says a reading of the quest at `readAt` cannot be: the logs hold it not handed in yet, or show its
 * hand-in after the reading (no one sees the next part before that, and a record keeps the time of its first reading). A
 * mark of the player's own on the part is no log record, so it rules nothing out.
 */
export function partHoldingBack(quest: Quest, readAt: string, records: Record<string, TaskProgressRecord>, byId: ReadonlyMap<string, Quest>) {
  const read = Date.parse(readAt)
  return earlierChainParts(quest, byId).find((before) => {
    const record = records[before.id]
    if (record?.source !== 'eft-log') return false
    return record.status === 'active' || (record.status === 'completed' && Date.parse(record.updatedAt) > read + CLOCK_SLACK_MS)
  })
}

/** The rows of a frame read now that may count: not the quests whose earlier part the logs hold open. */
export function rowsTheChainAllows<T extends { questId: string }>(matches: T[], records: Record<string, TaskProgressRecord>, quests: readonly Quest[], at: string): T[] {
  const byId = new Map(quests.map((quest) => [quest.id, quest]))
  return matches.filter((match) => {
    const quest = byId.get(match.questId)
    return !quest || !partHoldingBack(quest, at, records, byId)
  })
}

/**
 * The layers without the Tasks-table records the chain rules out (the same object when there are none): the table's own
 * and those that came in the account's copy from another PC. Only where the screen decided: a mark or a log event of the
 * quest itself stands. The engine then decides without them and the corrected copy goes to the server, so the phone and
 * other PCs lose them too.
 */
export function withoutScreenQuestsAheadOfChain(layers: QuestInputLayers, records: Record<string, TaskProgressRecord>, quests: readonly Quest[]): QuestInputLayers {
  const byId = new Map(quests.map((quest) => [quest.id, quest]))
  const ahead = (taskId: string, record: TaskProgressRecord) => {
    if (record.status !== 'active' || record.source !== 'screen-scan' || records[taskId]?.source !== 'screen-scan') return false
    const quest = byId.get(taskId)
    return Boolean(quest && partHoldingBack(quest, record.updatedAt, records, byId))
  }
  const kept = (layer: Record<string, TaskProgressRecord> | undefined) => {
    if (!layer || !Object.entries(layer).some(([taskId, record]) => ahead(taskId, record))) return layer
    return Object.fromEntries(Object.entries(layer).filter(([taskId, record]) => !ahead(taskId, record)))
  }
  const table = kept(layers.table)
  const mirror = kept(layers.mirror)
  if (table === layers.table && mirror === layers.mirror) return layers
  return { ...layers, table: table ?? {}, ...(mirror ? { mirror } : {}) }
}
