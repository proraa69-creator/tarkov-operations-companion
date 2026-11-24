import type { ModeProgress, Quest, RaidMode, TableSyncState } from '../domain/types'

/**
 * The first sync of the Tasks table. Owner, 04.11.2026: «оставить только при первом запуске, что бы прошла синхронизация,
 * больше сканировать не надо так как логи новых и закрытых квестов будут появляться». After it the logs alone go on, and the
 * table is passed over (src/components/StoryScreenScanner.tsx); only «Найти квесты по экрану» or the owner's grant
 * (src/account/trialFeatures.ts) read it again, for a while.
 *
 * One for each mode of each profile on each PC: the state is in the mode (`ModeProgress.tableSync`) and is not sent anywhere,
 * so PvP, PvE and the season each have their own and a new PC has its own. What empties a mode opens its sync again: «Сброс»,
 * «Вайп / Престиж» and a new nickname build the mode anew (wipeModeProgress), a new character or the game's own reset in the
 * logs drops it (AppState applyLogState). A profile of an older version has none yet, so every player already here gets one
 * read with the mended reader (src/import/questOcr.ts): that is what brings back a real quest of the titles the old reader
 * invented (src/quests/questChain.ts).
 *
 * It stays open until the table was really read, for as long as that takes: a player may not open «Задания» for days, and
 * the table scrolls (about nine rows a page, and players hold 39 current quests on average). A visit is the table on screen,
 * until it is not; it counts with two fresh readings that named a quest. The sync ends when:
 *   - the whole list was read twice alike: it fits on a page (src/import/questSession.ts);
 *   - or, from the second visit on, a visit adds no quest and the readings so far name most of the quests the logs hold open.
 *     Those are in the table too, so having read them says the list was scrolled through, not only its first page. No such
 *     quests: nothing to tell it by, and the two visits are all there is;
 *   - or after TABLE_SYNC_MOST_VISITS visits, whatever they showed: logs holding quests the game no longer lists never get there.
 */
export const TABLE_SYNC_LEAST_VISITS = 2
export const TABLE_SYNC_MOST_VISITS = 6
export const TABLE_SYNC_LOGGED_SEEN = 0.75
const VISIT_READINGS = 2

/** The table on screen once: what was read, and what the table's layer held before it. */
export interface TableVisit {
  profileId: string
  mode: RaidMode
  readings: number
  lastAt: number
  seen: string[]
  tableBefore: string[]
  /** The whole list was read twice alike on this visit. */
  whole?: boolean
}

export const newTableSync = (now: string): TableSyncState => ({ startedAt: now, seen: [], visits: 0 })

/** The mode's table is still to be read. No state yet: it is. */
export function tableSyncOpen(progress: Pick<ModeProgress, 'tableSync'> | undefined) {
  return !progress?.tableSync?.doneAt
}

export function startTableVisit(profileId: string, mode: RaidMode, progress: Pick<ModeProgress, 'questInputs'> | undefined): TableVisit {
  return { profileId, mode, readings: 0, lastAt: 0, seen: [], tableBefore: Object.keys(progress?.questInputs?.table ?? {}) }
}

/** One frame of the table: a fresh reading (not the main process's copy of the last one) that named a quest counts. */
export function withTableReading(visit: TableVisit, questIds: string[], observedAt: number): TableVisit {
  if (!questIds.length || !(observedAt > visit.lastAt)) return visit
  return { ...visit, readings: visit.readings + 1, lastAt: observedAt, seen: [...new Set([...visit.seen, ...questIds])] }
}

/** The mode's sync after a visit; the same object when the visit changes nothing. */
export function tableSyncAfterVisit(progress: Pick<ModeProgress, 'tableSync' | 'taskProgress' | 'questInputs'>, visit: TableVisit, quests: readonly Quest[], now: string): TableSyncState | undefined {
  if (progress.tableSync?.doneAt || (!visit.whole && !visit.readings)) return progress.tableSync
  const before = progress.tableSync ?? newTableSync(now)
  const seen = [...new Set([...before.seen, ...visit.seen])]
  if (visit.whole) return { ...before, seen, visits: before.visits + 1, doneAt: now }
  if (visit.readings < VISIT_READINGS) return { ...before, seen }
  const visits = before.visits + 1
  const added = Object.keys(progress.questInputs?.table ?? {}).some((taskId) => !visit.tableBefore.includes(taskId))
  const enough = visits >= TABLE_SYNC_MOST_VISITS || (visits >= TABLE_SYNC_LEAST_VISITS && !added && loggedQuestsSeen(progress, seen, quests))
  return { ...before, seen, visits, ...(enough ? { doneAt: now } : {}) }
}

/** The readings name most of the trader quests the logs hold open (none: nothing to tell by). */
function loggedQuestsSeen(progress: Pick<ModeProgress, 'taskProgress'>, seen: string[], quests: readonly Quest[]) {
  const trader = new Set(quests.filter((quest) => quest.kind !== 'story').map((quest) => quest.id))
  const logged = Object.values(progress.taskProgress).filter((record) => record.source === 'eft-log' && record.status === 'active' && trader.has(record.taskId))
  const read = new Set(seen)
  return logged.filter((record) => read.has(record.taskId)).length >= logged.length * TABLE_SYNC_LOGGED_SEEN
}
