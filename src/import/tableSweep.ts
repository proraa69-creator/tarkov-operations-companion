import type { Quest, RaidMode, TaskProgressRecord } from '../domain/types'
import { questFaction } from '../progression/questBasics'
import { STORY_IDS } from '../quests/questInputs'
import type { ScreenScanMatch } from './screenScanSync'
import { isNumberedQuest, nearCatalogTitle, ocrKey, rowStatus, tableTitleIndex, type GameLanguage, type QuestRowStatus } from './questOcr'
import type { TasksTableReading } from './tasksTableLayout'

/**
 * A whole read of the Tasks table, frame by frame (owner, 04.11.2026: «Если его нету в квестах по экрану, он делает
 * сканирование также, и этот квест уходит, если его нету. Обнаружение должно быть четкое … стопроцентное совпадание»;
 * docs/quests/quest-state-engine.md «A whole read of the Tasks table»).
 *
 * The list scrolls (about nine rows a page, players hold 39 current quests on average), so no one frame shows it. The frames
 * are put together by their rows into the list, top to bottom. The read is proven only when:
 *   - the list is in one piece, from a frame with the scrollbar's thumb at the top to one with it at the bottom (or one page
 *     with blank space under its last row: it fits), seen on two fresh frames at least;
 *   - every row of it is settled (below);
 *   - the number of rows is what the thumb's length says, so no row slipped through;
 *   - «Побочные» was open and nothing typed in «Поиск» on every frame that counted: anything else shows a part of the list.
 * A row is settled by its title read EXACTLY as the game's language writes a catalog quest's title. Nothing else names a quest:
 * no part of a title, no «close enough». A numbered title it would add must read alike at two positions of the list: one
 * digit misread is another part, the only way an exact title can be wrong. A row the catalog has no title for (it lags behind
 * the game: «Честный отзыв», «Сечь поляну» on a real frame) is settled when it reads alike at two positions and is near no
 * title of the catalog: then it is no misread quest, and names nothing. Anything else leaves the row unsettled, and the read
 * not proven: nothing goes.
 */
export interface SweepCell {
  /** What was read here: per title key, the positions of the list it was read at. */
  reads: Record<string, Array<number | string>>
  status?: QuestRowStatus
}
interface SweepPiece { cells: SweepCell[]; top: boolean; bottom: boolean }

export interface TableSweep {
  /** The first frame that counted: what happens in the game after it, the logs tell (a hand-in during the read). */
  startedAt: number
  lastAt: number
  language: GameLanguage
  pieces: SweepPiece[]
  /** The list's length as the thumb says it. */
  estimate: number | null
  share: number | null
  stray: boolean
  /** The last frame's list fits on its page. */
  fits: boolean
  /** Fresh frames that counted: one look is never a proof, it may have caught the screen changing. */
  looks: number
}

export type SweepRefusal = 'search' | 'tab' | 'view'

/** The frame's language by its «Поиск» placeholder; null: something else is in the field (a typed word), or it was not read. */
export function searchFieldLanguage(search: string): GameLanguage | null {
  const word = search.replace(/^[^\p{L}]+/u, '').toLowerCase()
  if (/^поиск(?![\p{L}])/u.test(word)) return 'ru'
  if (/^search(?![\p{L}])/u.test(word)) return 'en'
  return null
}

/** A list that changes by more than this between frames is another list: another tab, or a search typed in. */
const SHARE_CHANGE = 0.15
/** The rows the thumb's length gives, against the rows read: one, and a little for its pixels on a long list. */
const estimateSlack = (estimate: number) => 1 + estimate * 0.06
const ANCHOR_LENGTH = 4

/** The next state of a read after one frame. A frame refused (`refusal`) counts for nothing; the same sweep comes back. */
export function withTableFrame(sweep: TableSweep | null, reading: TasksTableReading, observedAt: number): { sweep: TableSweep | null; refusal?: SweepRefusal } {
  if (!reading.rows.length) return { sweep }
  if (!reading.sideTab) return { sweep, refusal: 'tab' }
  const language = searchFieldLanguage(reading.search)
  if (!language) return { sweep, refusal: 'search' }
  const statuses = reading.rows.map((row) => rowStatus(row.status))
  // «Показать заблокированные», a trader's own tab: quests not being done beside those that are. Never the list of current quests.
  if (statuses.some((status) => status === 'locked' || status === 'available')) return { sweep, refusal: 'view' }
  if (sweep && !(observedAt > sweep.lastAt)) return { sweep }
  const changed = sweep && ((sweep.share === null) !== (reading.share === null) || (sweep.share !== null && reading.share !== null && Math.abs(sweep.share - reading.share) > sweep.share * SHARE_CHANGE) || sweep.language !== language)
  const base: TableSweep = sweep && !changed ? sweep : { startedAt: observedAt, lastAt: observedAt, language, pieces: [], estimate: null, share: null, stray: false, fits: false, looks: 0 }
  // A list that fits never scrolls: its second reading is a second look; one that scrolls counts a position once.
  const position = reading.fits ? `at ${observedAt}` : reading.scroll
  const piece: SweepPiece = {
    cells: reading.rows.map((row, index) => {
      const key = ocrKey(row.title)
      return { reads: key ? { [key]: [position] } : {}, ...(statuses[index] ? { status: statuses[index] } : {}) }
    }),
    top: reading.atTop,
    bottom: reading.atBottom,
  }
  const pieces = joinPieces([...base.pieces, piece])
  // The same rows two ways round: the list was sorted again. What was put together no longer holds.
  if (!pieces) return { sweep: { ...base, startedAt: observedAt, lastAt: observedAt, pieces: [piece], share: reading.share, estimate: reading.share ? reading.pageRows / reading.share : null, stray: reading.stray, fits: reading.fits, looks: 1 } }
  return { sweep: { ...base, lastAt: observedAt, pieces, share: reading.share, estimate: reading.share ? reading.pageRows / reading.share : null, stray: base.stray || reading.stray, fits: reading.fits, looks: base.looks + 1 } }
}

/** Pieces that share rows joined, until none can be; null when two rows disagree about their order. */
function joinPieces(pieces: SweepPiece[]): SweepPiece[] | null {
  const out = [...pieces]
  for (let again = true; again;) {
    again = false
    for (let a = 0; a < out.length && !again; a += 1) {
      for (let b = a + 1; b < out.length && !again; b += 1) {
        const offset = pieceOffset(out[a]!, out[b]!)
        if (offset === 'clash') return null
        if (offset === null) continue
        out[a] = joined(out[a]!, out[b]!, offset)
        out.splice(b, 1)
        again = true
      }
    }
  }
  return out
}

/** Where `b` lies against `a` by the titles they share: its first cell at this cell of `a`. */
function pieceOffset(a: SweepPiece, b: SweepPiece): number | 'clash' | null {
  const votes = new Map<number, number>()
  const place = new Map<string, number[]>()
  a.cells.forEach((cell, index) => { for (const key of Object.keys(cell.reads)) if (key.length >= ANCHOR_LENGTH) place.set(key, [...(place.get(key) ?? []), index]) })
  b.cells.forEach((cell, index) => {
    for (const key of Object.keys(cell.reads)) for (const at of place.get(key) ?? []) votes.set(at - index, (votes.get(at - index) ?? 0) + 1)
  })
  if (!votes.size) return null
  const ranked = [...votes.entries()].sort((left, right) => right[1] - left[1])
  // Rows that disagree about where they are: the list was sorted again. One misread among many does not count.
  if (ranked.length > 1 && ranked[0]![1] < ranked[1]![1] * 3) return 'clash'
  const [offset, count] = ranked[0]!
  // Rows above the list's first or below its last: the pieces are not of one list.
  if (a.top && offset < 0) return count >= 2 ? 'clash' : null
  if (b.top && offset > 0) return count >= 2 ? 'clash' : null
  if (a.bottom && offset + b.cells.length > a.cells.length) return count >= 2 ? 'clash' : null
  if (b.bottom && offset + b.cells.length < a.cells.length) return count >= 2 ? 'clash' : null
  return offset
}

function joined(a: SweepPiece, b: SweepPiece, offset: number): SweepPiece {
  const start = Math.min(0, offset)
  const end = Math.max(a.cells.length, offset + b.cells.length)
  const cells: SweepCell[] = []
  for (let index = start; index < end; index += 1) {
    const left = a.cells[index]
    const right = b.cells[index - offset]
    cells.push(left && right ? merged(left, right) : (left ?? right)!)
  }
  return { cells, top: a.top || b.top, bottom: a.bottom || b.bottom }
}

function merged(a: SweepCell, b: SweepCell): SweepCell {
  const reads = { ...a.reads }
  for (const [key, positions] of Object.entries(b.reads)) reads[key] = [...new Set([...(reads[key] ?? []), ...positions])]
  const status = a.status ?? b.status
  return { reads, ...(status ? { status } : {}) }
}

/** One row of the list once it is settled: `ids` every quest of that title (faction variants share one); none for a title the catalog lacks. */
export interface SweepRow { ids: string[]; status?: QuestRowStatus }

export interface SweepResult {
  /** The whole list is proven read. */
  proven: boolean
  rows: SweepRow[]
  /** Rows read and settled so far, of `total` (the thumb's estimate, or the rows seen). */
  read: number
  total: number
  /** Rows seen but not settled. */
  unsettled: number
}

function settle(cell: SweepCell, index: Map<string, Quest[]>, current: ReadonlySet<string>, quests: Quest[]): SweepRow | null {
  const reads = Object.entries(cell.reads).sort((left, right) => right[1].length - left[1].length)
  const exact = reads.filter(([key]) => index.has(key))
  if (exact.length) {
    const [key, positions] = exact[0]!
    // Another exact title read here too: only far fewer times than this one.
    if (exact.slice(1).some(([, other]) => other.length * 3 > positions.length)) return null
    const named = index.get(key)!
    const needsTwo = named.some(isNumberedQuest) && !named.some((quest) => current.has(quest.id))
    if (needsTwo && positions.length < 2) return null
    return { ids: named.map((quest) => quest.id), ...(cell.status ? { status: cell.status } : {}) }
  }
  const best = reads[0]
  if (!best || best[1].length < 2 || best[0].length < 5 || nearCatalogTitle(best[0], quests)) return null
  return { ids: [] }
}

/** The read so far against the catalog and the quests the mode holds current. */
export function sweepResult(sweep: TableSweep | null, quests: Quest[], current: ReadonlySet<string>): SweepResult {
  if (!sweep || !sweep.pieces.length) return { proven: false, rows: [], read: 0, total: 0, unsettled: 0 }
  const index = tableTitleIndex(quests, sweep.language)
  const settled = sweep.pieces.map((piece) => piece.cells.map((cell) => settle(cell, index, current, quests)))
  const flat = settled.flat()
  const read = flat.filter(Boolean).length
  const total = Math.max(flat.length, Math.round(sweep.estimate ?? 0))
  const unsettled = flat.length - read
  const piece = sweep.pieces.length === 1 ? sweep.pieces[0]! : null
  const inOnePiece = Boolean(piece?.top && piece.bottom)
  const counted = sweep.estimate === null || Math.abs(flat.length - sweep.estimate) <= estimateSlack(sweep.estimate)
  const proven = inOnePiece && !unsettled && counted && !sweep.stray && sweep.looks >= 2
  return { proven, rows: proven ? (settled[0] as SweepRow[]) : [], read, total, unsettled }
}

const isTableQuest = (quest: Quest | undefined) => Boolean(quest) && quest!.kind !== 'story' && !quest!.id.startsWith('wiki:') && !STORY_IDS.has(quest!.id)

/** The quest a row of several ids (faction variants share a title) is: the one held already, else the player's faction's, else the first. */
function rowQuest(ids: readonly string[], records: Record<string, TaskProgressRecord>, byId: ReadonlyMap<string, Quest>, faction: string | undefined) {
  return ids.find((id) => records[id]?.status === 'active')
    ?? ids.find((id) => { const own = questFaction(byId.get(id)?.faction); return own && own === faction })
    ?? ids.find((id) => !questFaction(byId.get(id)?.faction))
    ?? ids[0]!
}

/**
 * What a whole read changes in a mode. Added: a row's quest not held now (also over an older hand-in: the list is the newer
 * word). Gone: a trader quest held now that no row names; a story chapter and the quests of its story are never in this tab.
 * A row «провалено» lists the quest as no longer being done: it is not current either.
 */
export function wholeTableChanges(records: Record<string, TaskProgressRecord>, rows: readonly SweepRow[], quests: readonly Quest[], faction?: string) {
  const byId = new Map(quests.map((quest) => [quest.id, quest]))
  const listed = new Set<string>()
  const added: string[] = []
  for (const row of rows) {
    if (!row.ids.length || row.status === 'failed') continue
    for (const id of row.ids) listed.add(id)
    const id = rowQuest(row.ids, records, byId, faction)
    if (records[id]?.status !== 'active') added.push(id)
  }
  const gone = Object.values(records).filter((record) => record.status === 'active' && !listed.has(record.taskId) && isTableQuest(byId.get(record.taskId))).map((record) => record.taskId)
  return { added, gone }
}

/**
 * The rows of one frame that may fill the table's layer now, whatever the read as a whole comes to: only titles read exactly. A
 * numbered title not held yet waits for a second frame (no status, so `requireConfirmation` holds it: src/import/screenScanSync.ts).
 */
export function exactTableRows(reading: TasksTableReading, quests: Quest[], records: Record<string, TaskProgressRecord>, faction?: string): ScreenScanMatch[] {
  const byId = new Map(quests.map((quest) => [quest.id, quest]))
  return reading.rows.flatMap((row): ScreenScanMatch[] => {
    const named = tableTitleIndex(quests, /[а-яё]/i.test(row.title) ? 'ru' : 'en').get(ocrKey(row.title))
    if (!named) return []
    const id = rowQuest(named.map((quest) => quest.id), records, byId, faction)
    const status = rowStatus(row.status)
    const waits = named.some(isNumberedQuest) && records[id]?.status !== 'active' && status !== 'failed'
    return [waits ? { questId: id, score: 0.99 } : { questId: id, score: 1, ...(status ? { status } : {}) }]
  })
}

/** The mode the game's corner stamp names («1.3.0.0.48484 | … | PvP S»), when it was read: PvE, or PvP (the season's too). */
export function stampContradicts(text: string, mode: RaidMode) {
  const stamp = /\|\s*pv([pe])\b/i.exec(text)?.[1]?.toLowerCase()
  return stamp === 'e' ? mode !== 'pve' : stamp === 'p' ? mode === 'pve' : false
}
