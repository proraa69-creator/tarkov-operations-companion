import type { ModeProgress, Quest } from '../domain/types'
import type { QuestRowStatus } from './questOcr'
import { tableRowLines } from './screenScanSync'

/**
 * A watch of the Tasks table (audit P8): what may end an OCR-sourced «active» record that the table no longer lists.
 *
 * Only a view that provably shows the whole current list counts, and only to remove such a record — never to mark one
 * completed, and never for a record that came from the logs (the logs' own hand-in event completes a quest). The table
 * scrolls, and a scrolled page, a quest scrolled out of sight or re-sorted after items were handed over looks exactly
 * like a hand-in; so the old rules («missing while its trader's rows show», «gone while its neighbours stay») are gone.
 * A view is the whole list when:
 *   - it is the table (two or more rows with a status cell) and every such row is a catalog trader quest — no row whose
 *     title was not read, which could be the missing quest itself, and no other tab (story chapters, operational tasks);
 *   - it holds at most WHOLE_LIST_MAX_ROWS rows: a page of the table holds about nine at any screen ratio, so the list
 *     fits on the page and nothing is scrolled away;
 *   - the same rows were read twice in a row, from two fresh readings (not the main process's copy of one).
 * Then a stored OCR quest missing from it is no longer current — at most WHOLE_LIST_MAX_GONE at once: more missing at
 * once is more likely another view than that many hand-ins, and nothing is removed.
 */
export interface QuestScanSession {
  /** The last fresh reading of the table. */
  last?: TableView
  /** The whole current list read alike twice in a row: the quests on it. */
  wholeList?: { ids: string[]; at: number }
}

/** One reading of the table: the quests it lists and whether it shows the whole list. */
export interface TableView {
  /** Every trader quest named on the frame (row status read or not). */
  ids: string[]
  /** The rows with a status read, as `id:status`, sorted: what two readings must agree on. */
  rows: string[]
  observedAt: number
  whole: boolean
}

/** The list fits on one page of the table with room to spare (about nine rows a page). */
export const WHOLE_LIST_MAX_ROWS = 6
/** Stored OCR quests a whole list may end at once. */
export const WHOLE_LIST_MAX_GONE = 2

export function createScanSession(): QuestScanSession {
  return {}
}

const squeeze = (value: string) => value.replace(/\s+/g, ' ').trim()

/**
 * What a table frame shows (`matches`: what matchQuestsFromOcr read on `text`, with the line each title was read on). The
 * whole list needs every row with a status cell to name exactly one catalog trader quest.
 */
export function tableView(text: string, matches: Array<{ questId: string; status?: QuestRowStatus; line?: string }>, quests: Quest[], observedAt: number): TableView {
  const byId = new Map(quests.map((quest) => [quest.id, quest]))
  const trader = matches.filter((match) => {
    const quest = byId.get(match.questId)
    return quest && quest.kind !== 'story' && !quest.id.startsWith('wiki:')
  })
  const statused = trader.filter((match) => match.status !== undefined)
  const rows = [...new Set(statused.map((match) => `${match.questId}:${match.status}`))].sort()
  const rowLines = tableRowLines(text).map(squeeze)
  // One quest a row: a row nothing was read on could be the missing quest itself; one read as two quests is misread.
  const placed = statused.length > 0 && statused.every((match) => match.line)
  const oneEach = !placed || rowLines.every((row) => new Set(statused.filter((match) => row.includes(squeeze(match.line!))).map((match) => match.questId)).size === 1)
  const whole = rowLines.length >= 2 && rowLines.length <= WHOLE_LIST_MAX_ROWS && rows.length === rowLines.length
    && new Set(statused.map((match) => match.questId)).size === rows.length && oneEach
  return { ids: [...new Set(trader.map((match) => match.questId))], rows, observedAt, whole }
}

/** A fresh reading joins the session; a copy of the last one (the same capture time) is no second reading. */
export function recordTableView(session: QuestScanSession, view: TableView): QuestScanSession {
  const last = session.last
  if (last && !(view.observedAt > last.observedAt)) return session
  const twice = Boolean(last?.whole && view.whole && last.rows.join('|') === view.rows.join('|'))
  return { last: view, ...(twice ? { wholeList: { ids: view.ids, at: view.observedAt } } : {}) }
}

/**
 * Ends what the whole current list no longer shows: OCR-sourced «active» trader quests are removed — not completed, the
 * table cannot tell a hand-in from a failed or abandoned quest. Logs' records, story chapters and anything else stay.
 */
export function reconcileWithSession(progress: ModeProgress, session: QuestScanSession, quests: Quest[]): ModeProgress {
  const whole = session.wholeList
  if (!whole) return progress
  const listed = new Set(whole.ids)
  const byId = new Map(quests.map((quest) => [quest.id, quest]))
  const gone = Object.values(progress.taskProgress).filter((record) => {
    if (record.source !== 'screen-scan' || record.status !== 'active' || listed.has(record.taskId)) return false
    const quest = byId.get(record.taskId)
    return Boolean(quest) && quest!.kind !== 'story'
  })
  if (!gone.length || gone.length > WHOLE_LIST_MAX_GONE) return progress
  const taskProgress = { ...progress.taskProgress }
  for (const record of gone) delete taskProgress[record.taskId]
  return { ...progress, taskProgress }
}
