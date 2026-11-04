/**
 * «Сообщить об ошибке» and «Ваши предложения» (routes/bugReports.ts): reports and ideas the players send from the app
 * (topic, description, up to five screenshots or photos, app version and OS) and the owner reads in the website's
 * «Админ-панель» → «Отчёты».
 *
 * Tables are created with IF NOT EXISTS; later columns are added when missing (ADDED_COLUMNS), nothing is ever dropped:
 *   bug_reports       — one report; `kind`: 'bug' («Сообщить об ошибке») or 'idea' («Ваши предложения», owner
 *                       13.10.2026); `email` is the account's address at the time it was sent; reward_days: subscription
 *                       days the owner granted for it («+1 день», owner 11.10.2026); mailed_at / mail_error: the PDF the
 *                       server e-mails to the owner (services/bugReportMail.ts);
 *   bug_report_files  — its screenshots (PNG / JPEG / WEBP, checked by their magic bytes, never by the declared type).
 *
 * Categories and quest corrections (owner, 13.10.2026: «там должна быть категория бага… человек может предложить свою
 * точку на карте этого квеста… и может написать заметку к квесту или точке»): `category` (src/shared/
 * reportCategories.ts); a quest report keeps the quest, what is wrong (`quest_issue`), the game mode, and optionally
 * the map, the point the player says is wrong (`marker_id`), the objective / story stage, the place the player
 * proposes (`point_x` / `point_z` in game metres, `point_floor`) and notes to the point and to the quest. Nothing is
 * changed by a report: the owner reads «Заявки», sees how many players agree (`matches`, see `questGroups`) and
 * corrects the quest himself.
 *
 * Deleting an account (AccountStore.deleteAccount) clears `account_id` and `email` of its reports: the report itself
 * stays for the owner to handle, without the personal link.
 *
 * The owner's read-only key («Доступ Claude к заявкам», routes/agentRequests.ts) reads `redactedPage`: the report
 * without the e-mail, the account, the granted days and the mail state.
 *
 * «Отчёты» (owner, 05.11.2026, src/shared/reportWork.ts): one table of reports and ideas. `work_status` is where a report
 * stands; `triage_summary` / `triage_plan`: what Claude drew from it and the plan, which the owner corrects; `work_note`,
 * `work_commit`: how the work ended. Claude reads and writes these through server/src/services/reportsAgent.ts on the
 * owner's computer, by SSH, and never through a route. The work starts only by `ownerWork('approve')`, the owner's button.
 * The old `status` follows: a report that left the working list reads «closed» (retention, «совпадает», the read-only key).
 *
 * Storage: screenshots of all reports together are kept under BUG_REPORT_STORAGE.maxStoredBytes (a new report with
 * screenshots past it is refused with 507; text-only reports are still accepted). Retention: screenshots of a closed
 * report are deleted 30 days after it was closed, of any report 90 days after it was sent (the text stays). It runs when
 * the store opens and at most hourly on new reports.
 */
import type { DatabaseSync } from 'node:sqlite'
import { transaction } from './database.js'
import { MATCH_RADIUS_M, QUEST_ISSUE_LABELS, REPORT_CATEGORY_LABELS, type QuestIssue, type ReportCategory, type ReportMode } from '../../../src/shared/reportCategories.js'
import { REPORT_PLAN_EDITABLE, REPORT_TEXT_LIMITS, REPORT_WORK_ACTIONS, REPORT_WORK_AWAITING, REPORT_WORK_CLOSED, REPORT_WORK_STATUSES, type ReportTableView, type ReportWorkAction, type ReportWorkStatus } from '../../../src/shared/reportWork.js'

type Row = Record<string, unknown>

export const BUG_REPORT_LIMITS = {
  topic: 120,
  description: 5000,
  files: 5,
  fileBytes: 5 * 1024 * 1024,
  totalBytes: 25 * 1024 * 1024,
}

const DAY = 24 * 60 * 60 * 1000

export const BUG_REPORT_STORAGE = {
  /** All stored screenshots together. */
  maxStoredBytes: 500 * 1024 * 1024,
  closedRetentionMs: 30 * DAY,
  retentionMs: 90 * DAY,
  pruneEveryMs: 60 * 60 * 1000,
}

export const STORAGE_FULL_MESSAGE = 'Хранилище скриншотов сейчас заполнено. Отправьте отчёт без скриншотов — опишите проблему словами.'

export type BugReportStatus = 'open' | 'closed'
/** 'bug': «Сообщить об ошибке»; 'idea': «Ваши предложения». */
export type ReportKind = 'bug' | 'idea'
export type ImageMime = 'image/png' | 'image/jpeg' | 'image/webp'

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS bug_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id TEXT,
    email TEXT,
    topic TEXT NOT NULL,
    description TEXT NOT NULL,
    app_version TEXT NOT NULL DEFAULT '',
    platform TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'open',
    created_at INTEGER NOT NULL,
    closed_at INTEGER);
  CREATE INDEX IF NOT EXISTS bug_reports_status ON bug_reports(status, created_at);
  CREATE INDEX IF NOT EXISTS bug_reports_account ON bug_reports(account_id);
  CREATE TABLE IF NOT EXISTS bug_report_files (
    report_id INTEGER NOT NULL REFERENCES bug_reports(id) ON DELETE CASCADE,
    idx INTEGER NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    data BLOB NOT NULL,
    PRIMARY KEY (report_id, idx));
  CREATE TABLE IF NOT EXISTS report_agent_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    seen_at INTEGER NOT NULL);
`

/** Columns added after the first release of the table (name, type with default). */
const ADDED_COLUMNS: Array<[string, string]> = [
  ['reward_days', 'INTEGER NOT NULL DEFAULT 0'],
  ['rewarded_at', 'INTEGER'],
  ['mailed_at', 'INTEGER'],
  ['mail_error', 'TEXT'],
  ['kind', "TEXT NOT NULL DEFAULT 'bug'"],
  ['category', 'TEXT'],
  ['quest_id', 'TEXT'],
  ['quest_issue', 'TEXT'],
  ['game_mode', 'TEXT'],
  ['map_id', 'TEXT'],
  ['marker_id', 'TEXT'],
  ['objective_id', 'TEXT'],
  ['stage_index', 'INTEGER'],
  ['point_x', 'REAL'],
  ['point_z', 'REAL'],
  ['point_floor', 'TEXT'],
  ['point_note', 'TEXT'],
  ['quest_note', 'TEXT'],
  ['answered_at', 'INTEGER'],
  ['work_status', "TEXT NOT NULL DEFAULT 'review'"],
  ['triage_summary', 'TEXT'],
  ['triage_plan', 'TEXT'],
  ['triage_at', 'INTEGER'],
  ['plan_edited_at', 'INTEGER'],
  ['work_approved_at', 'INTEGER'],
  ['work_started_at', 'INTEGER'],
  ['work_finished_at', 'INTEGER'],
  ['work_published_at', 'INTEGER'],
  ['work_note', 'TEXT'],
  ['work_commit', 'TEXT'],
  ['work_published_commit', 'TEXT'],
  ['work_changed_at', 'INTEGER'],
]

export class BugReportError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** The image type by its first bytes; undefined for anything else (whatever the client declared). */
export function sniffImage(data: Uint8Array): ImageMime | undefined {
  if (data.length >= 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47 && data[4] === 0x0d && data[5] === 0x0a && data[6] === 0x1a && data[7] === 0x0a) return 'image/png'
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg'
  if (data.length >= 12 && String.fromCharCode(...data.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...data.subarray(8, 12)) === 'WEBP') return 'image/webp'
  return undefined
}

/** A quest correction proposed by a player (the «Квест» category). */
export interface QuestReport {
  questId: string
  issue: QuestIssue
  mode?: ReportMode
  mapId?: string
  /** The point on the map the player says is wrong. */
  markerId?: string
  objectiveId?: string
  stageIndex?: number
  /** Where the player says it really is (game metres, the map's floor name). */
  point?: { x: number; z: number; floor?: string }
  pointNote?: string
  questNote?: string
}

export interface BugReportInput {
  /** 'bug' when not given. */
  kind?: ReportKind
  category?: ReportCategory
  quest?: QuestReport
  topic: string
  description: string
  appVersion: string
  platform: string
  files: Buffer[]
}

export interface BugReportFileView { idx: number; mime: ImageMime; size: number }
export interface BugReportSummary {
  id: number
  kind: ReportKind
  category?: ReportCategory
  quest?: QuestReport
  /** Open quest reports that agree with this one, itself included (same point area, same wrong point or same issue). */
  matches?: number
  /** What this report agrees on with the others of its group (the owner's «Заявки» groups by it). */
  group?: string
  email?: string
  accountId?: string
  topic: string
  appVersion: string
  platform: string
  status: BugReportStatus
  createdAt: string
  closedAt?: string
  files: number
  /** Subscription days the owner granted for this report (0 = none yet). */
  rewardDays: number
  rewardedAt?: string
  /** When the owner last answered it from its card (routes/supportChat.ts); it stays after «Проблема решена» deletes the chat. */
  answeredAt?: string
  /** When the PDF went to the owner's mailbox; the last error if it did not. */
  mailedAt?: string
  mailError?: string
  /** What Claude drew from the report and the plan of work (the owner may have corrected the plan). */
  triage?: ReportTriage
  work: ReportWork
}
export interface ReportTriage { summary?: string; plan?: string; at?: string; planEditedAt?: string }
export interface ReportWork {
  status: ReportWorkStatus
  /** How the work ended, in a few words. */
  note?: string
  /** The commit of the fix; «Добавлено на сервер» only once the published version holds it. */
  commit?: string
  publishedCommit?: string
  approvedAt?: string
  startedAt?: string
  finishedAt?: string
  publishedAt?: string
}
export interface BugReportView extends Omit<BugReportSummary, 'files'> { description: string; files: BugReportFileView[] }
/** A line of the owner's table: the report with its text, the number of its images. */
export interface ReportTableRow extends BugReportSummary { description: string }
export interface ReportTablePage {
  rows: ReportTableRow[]
  total: number
  /** `awaiting`: reports that wait for the owner, whichever list is shown. */
  counts: { active: number; closed: number; awaiting: number }
  /** When Claude last looked in from the owner's computer; absent: never. */
  agentSeenAt?: string
}

/** A report for the read-only key (routes/agentRequests.ts): no e-mail, account id, granted days or mail state. */
export interface RedactedReport {
  id: number
  kind: ReportKind
  category?: ReportCategory
  quest?: QuestReport
  /** As in BugReportSummary: open quest reports that agree with this one, and what they agree on. */
  matches?: number
  group?: string
  topic: string
  description: string
  appVersion: string
  platform: string
  status: BugReportStatus
  createdAt: string
  closedAt?: string
  files: number
  /** The caller's pseudonym of the sender's account; absent when the account was deleted. */
  reporter?: string
}

const iso = (ms: unknown) => (ms == null ? undefined : new Date(Number(ms)).toISOString())
const quoted = (statuses: readonly ReportWorkStatus[]) => statuses.map((status) => `'${status}'`).join(', ')
const CLOSED_SQL = quoted(REPORT_WORK_CLOSED)
const AWAITING_SQL = quoted(REPORT_WORK_AWAITING)
/** The fields of a report Claude may read: named one by one, so the e-mail, the account, the days and the mail state never are. */
const AGENT_COLUMNS = `r.id, r.kind, r.category, r.account_id, r.topic, r.description, r.app_version, r.platform, r.status, r.created_at, r.closed_at,
  r.quest_id, r.quest_issue, r.game_mode, r.map_id, r.marker_id, r.objective_id, r.stage_index, r.point_x, r.point_z, r.point_floor, r.point_note, r.quest_note,
  (SELECT COUNT(*) FROM bug_report_files f WHERE f.report_id = r.id) AS file_count`
/** A report as Claude sees it, with the analysis and the state of the work. */
export type AgentReport = RedactedReport & {
  summary?: string
  plan?: string
  approvedAt?: string
  startedAt?: string
  commit?: string
}

/** Checks the screenshots: count, size, total and the real image type. Returns their types in order. */
export function checkScreenshots(files: Buffer[]): ImageMime[] {
  if (files.length > BUG_REPORT_LIMITS.files) throw new BugReportError(400, `Не больше ${BUG_REPORT_LIMITS.files} скриншотов`)
  let total = 0
  return files.map((file) => {
    if (file.length === 0) throw new BugReportError(400, 'Пустой файл скриншота')
    if (file.length > BUG_REPORT_LIMITS.fileBytes) throw new BugReportError(400, 'Скриншот больше 5 МБ')
    total += file.length
    if (total > BUG_REPORT_LIMITS.totalBytes) throw new BugReportError(400, 'Скриншоты вместе больше 25 МБ')
    const mime = sniffImage(file)
    if (!mime) throw new BugReportError(400, 'Скриншоты принимаются только в PNG, JPEG или WEBP')
    return mime
  })
}

export interface BugReportStoreOptions {
  now?: () => number
  /** Overrides BUG_REPORT_STORAGE.maxStoredBytes (tests). */
  maxStoredBytes?: number
  /** False for a short-lived reader beside the running server (services/reportsAgent.ts): retention stays the server's job. */
  prune?: boolean
}

export class BugReportStore {
  private readonly db: DatabaseSync
  private readonly now: () => number
  private readonly maxStoredBytes: number
  private lastPrune = -Infinity

  constructor(db: DatabaseSync, options: BugReportStoreOptions = {}) {
    this.db = db
    this.now = options.now ?? Date.now
    this.maxStoredBytes = options.maxStoredBytes ?? BUG_REPORT_STORAGE.maxStoredBytes
    this.db.exec(SCHEMA)
    const columns = new Set((this.db.prepare('PRAGMA table_info(bug_reports)').all() as Row[]).map((row) => String(row.name)))
    for (const [name, type] of ADDED_COLUMNS) if (!columns.has(name)) this.db.exec(`ALTER TABLE bug_reports ADD COLUMN ${name} ${type}`)
    // Reports closed before the table stay closed, under a status of their own; the open ones wait for the owner's check.
    if (!columns.has('work_status')) this.db.exec("UPDATE bug_reports SET work_status = 'closed' WHERE status = 'closed'")
    this.db.exec('CREATE INDEX IF NOT EXISTS bug_reports_kind ON bug_reports(kind, status, created_at)')
    this.db.exec('CREATE INDEX IF NOT EXISTS bug_reports_quest ON bug_reports(status, quest_id)')
    this.db.exec('CREATE INDEX IF NOT EXISTS bug_reports_work ON bug_reports(work_status, id)')
    this.db.exec('CREATE INDEX IF NOT EXISTS bug_reports_work_changed ON bug_reports(work_changed_at)')
    if (options.prune !== false) this.pruneScreenshots()
  }

  /** Bytes of all stored screenshots. */
  storedBytes() {
    return Number((this.db.prepare('SELECT COALESCE(SUM(size), 0) AS n FROM bug_report_files').get() as { n: number }).n)
  }

  /** Whether no more screenshots are accepted (checked before an upload is read, too). */
  screenshotsFull() {
    return this.storedBytes() >= this.maxStoredBytes
  }

  /**
   * Retention: deletes the screenshots of reports closed more than 30 days ago and of every report older than 90 days.
   * Reports themselves (text) stay. Returns the number of files deleted.
   */
  pruneScreenshots() {
    const now = this.now()
    this.lastPrune = now
    const result = this.db.prepare(`DELETE FROM bug_report_files WHERE report_id IN (
      SELECT id FROM bug_reports WHERE (status = 'closed' AND COALESCE(closed_at, created_at) < ?) OR created_at < ?)`)
      .run(now - BUG_REPORT_STORAGE.closedRetentionMs, now - BUG_REPORT_STORAGE.retentionMs)
    return Number(result.changes)
  }

  create(accountId: string, email: string | undefined, input: BugReportInput): { id: number; createdAt: string } {
    const mimes = checkScreenshots(input.files)
    const at = this.now()
    if (at - this.lastPrune >= BUG_REPORT_STORAGE.pruneEveryMs) {
      try { this.pruneScreenshots() } catch { /* the report is still saved */ }
    }
    const incoming = input.files.reduce((sum, file) => sum + file.length, 0)
    return transaction(this.db, () => {
      if (incoming > 0 && this.storedBytes() + incoming > this.maxStoredBytes) throw new BugReportError(507, STORAGE_FULL_MESSAGE)
      const quest = input.quest
      const result = this.db.prepare(`INSERT INTO bug_reports (kind, account_id, email, topic, description, app_version, platform, status, created_at,
          category, quest_id, quest_issue, game_mode, map_id, marker_id, objective_id, stage_index, point_x, point_z, point_floor, point_note, quest_note)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(input.kind ?? 'bug', accountId, email ?? null, input.topic, input.description, input.appVersion, input.platform, at,
          input.category ?? null, quest?.questId ?? null, quest?.issue ?? null, quest?.mode ?? null, quest?.mapId ?? null, quest?.markerId ?? null,
          quest?.objectiveId ?? null, quest?.stageIndex ?? null, quest?.point?.x ?? null, quest?.point?.z ?? null, quest?.point?.floor ?? null,
          quest?.pointNote ?? null, quest?.questNote ?? null)
      const id = Number(result.lastInsertRowid)
      const insert = this.db.prepare('INSERT INTO bug_report_files (report_id, idx, mime, size, data) VALUES (?, ?, ?, ?, ?)')
      input.files.forEach((file, idx) => insert.run(id, idx, mimes[idx], file.length, file))
      return { id, createdAt: iso(at)! }
    })
  }

  /**
   * A page of reports, newest first, of one status and / or kind; `counts`: open / closed of that kind (all kinds when
   * none is given); `kinds`: open reports of each kind (the admin panel's «Ошибки» / «Предложения» switch).
   */
  list(status: BugReportStatus | undefined, limit: number, offset: number, kind?: ReportKind): { reports: BugReportSummary[]; total: number; counts: Record<BugReportStatus, number>; kinds: Record<ReportKind, number>; awaiting: number } {
    const counts = { open: 0, closed: 0 }
    const kinds = { bug: 0, idea: 0 }
    for (const row of this.db.prepare('SELECT kind, status, COUNT(*) AS n FROM bug_reports GROUP BY kind, status').all() as Row[]) {
      const rowKind: ReportKind = row.kind === 'idea' ? 'idea' : 'bug'
      if (row.status === 'open') kinds[rowKind] += Number(row.n)
      if ((!kind || rowKind === kind) && (row.status === 'open' || row.status === 'closed')) counts[row.status] += Number(row.n)
    }
    const conditions = [...(status ? ['r.status = ?'] : []), ...(kind ? ['r.kind = ?'] : [])]
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    const params = [...(status ? [status] : []), ...(kind ? [kind] : [])]
    const rows = this.db.prepare(`SELECT r.*, (SELECT COUNT(*) FROM bug_report_files f WHERE f.report_id = r.id) AS file_count
      FROM bug_reports r ${where} ORDER BY r.created_at DESC, r.id DESC LIMIT ? OFFSET ?`).all(...params, limit, offset) as Row[]
    const groups = rows.some((row) => row.quest_id != null) ? this.questGroups() : new Map<number, { group: string; matches: number }>()
    return { reports: rows.map((row) => ({ ...this.base(row), ...groups.get(Number(row.id)), files: Number(row.file_count) })), total: status ? counts[status] : counts.open + counts.closed, counts, kinds, awaiting: this.awaitingCount() }
  }

  /**
   * A page of reports of every kind for the read-only key (routes/agentRequests.ts), newest first, of one status or
   * all. The columns are named one by one, so the e-mail, the granted days and the mail state are never read; the
   * account id only goes through `pseudonym`. `total`: reports of that status; `counts`: open / closed.
   */
  redactedPage(status: BugReportStatus | undefined, limit: number, offset: number, pseudonym: (accountId: string) => string): { reports: RedactedReport[]; total: number; counts: Record<BugReportStatus, number> } {
    const counts = { open: 0, closed: 0 }
    for (const row of this.db.prepare('SELECT status, COUNT(*) AS n FROM bug_reports GROUP BY status').all() as Row[]) {
      if (row.status === 'open' || row.status === 'closed') counts[row.status] += Number(row.n)
    }
    const rows = this.db.prepare(`SELECT ${AGENT_COLUMNS}
      FROM bug_reports r ${status ? 'WHERE r.status = ?' : ''} ORDER BY r.created_at DESC, r.id DESC LIMIT ? OFFSET ?`)
      .all(...(status ? [status] : []), limit, offset) as Row[]
    const groups = rows.some((row) => row.quest_id != null && row.status === 'open') ? this.questGroups() : new Map<number, { group: string; matches: number }>()
    const reports = rows.map((row) => redacted(row, groups, pseudonym))
    return { reports, total: status ? counts[status] : counts.open + counts.closed, counts }
  }

  /** Open reports of every kind. */
  openCount() {
    return Number((this.db.prepare("SELECT COUNT(*) AS n FROM bug_reports WHERE status = 'open'").get() as { n: number }).n)
  }

  /** Reports that wait for the owner (the number on «Отчёты»): a new one, or one Claude could not do. */
  awaitingCount() {
    return Number((this.db.prepare(`SELECT COUNT(*) AS n FROM bug_reports WHERE work_status IN (${AWAITING_SQL})`).get() as { n: number }).n)
  }

  /** The newest report's number (the phone's «Новый отчёт №N»); 0 with none. */
  latestId() {
    return Number((this.db.prepare('SELECT COALESCE(MAX(id), 0) AS n FROM bug_reports').get() as { n: number }).n)
  }

  /**
   * Moves when Claude's script wrote something. It runs in a process of its own, so it cannot wake the waiting apps;
   * they see this in the answers of GET …/requests/events, which come at least every ~25 s, and read the table again.
   */
  workStamp() {
    const row = this.db.prepare('SELECT COALESCE((SELECT MAX(work_changed_at) FROM bug_reports), 0) AS changed, COALESCE((SELECT seen_at FROM report_agent_state WHERE id = 1), 0) AS seen').get() as { changed: number; seen: number }
    return Math.max(Number(row.changed), Number(row.seen))
  }

  /** A page of the owner's table: «active» or «closed», the newest number first, with the texts. */
  table(view: ReportTableView, limit: number, offset: number): ReportTablePage {
    const where = view === 'closed' ? `work_status IN (${CLOSED_SQL})` : `work_status NOT IN (${CLOSED_SQL})`
    const rows = this.db.prepare(`SELECT r.*, (SELECT COUNT(*) FROM bug_report_files f WHERE f.report_id = r.id) AS file_count
      FROM bug_reports r WHERE r.${where} ORDER BY r.id DESC LIMIT ? OFFSET ?`).all(limit, offset) as Row[]
    const groups = rows.some((row) => row.quest_id != null) ? this.questGroups() : new Map<number, { group: string; matches: number }>()
    const counts = { active: 0, closed: 0, awaiting: 0 }
    for (const row of this.db.prepare('SELECT work_status, COUNT(*) AS n FROM bug_reports GROUP BY work_status').all() as Row[]) {
      const status = String(row.work_status) as ReportWorkStatus
      counts[REPORT_WORK_CLOSED.includes(status) ? 'closed' : 'active'] += Number(row.n)
      if (REPORT_WORK_AWAITING.includes(status)) counts.awaiting += Number(row.n)
    }
    const seen = this.db.prepare('SELECT seen_at FROM report_agent_state WHERE id = 1').get() as { seen_at: number } | undefined
    return {
      rows: rows.map((row) => ({ ...this.base(row), ...groups.get(Number(row.id)), description: String(row.description), files: Number(row.file_count) })),
      total: view === 'closed' ? counts.closed : counts.active,
      counts,
      ...(seen ? { agentSeenAt: iso(seen.seen_at)! } : {}),
    }
  }

  /** The owner corrects the plan in the table; only before giving it away. */
  savePlan(id: number, plan: string): BugReportView | undefined {
    const text = checkedText(plan, REPORT_TEXT_LIMITS.plan, 'План')
    const at = this.now()
    return this.changeWork(id, this.db.prepare(`UPDATE bug_reports SET triage_plan = ?, plan_edited_at = ?, work_changed_at = ?
      WHERE id = ? AND work_status IN (${quoted(REPORT_PLAN_EDITABLE)})`).run(text || null, at, at, id))
  }

  /**
   * The owner's buttons, and the ONLY way to `queued`: «Отдать в работу» with the plan on the screen, which from then on is
   * what Claude works by, «Отклонить», «Уже реализовано», «Вернуть на проверку». The server's route lets the owner alone here.
   */
  ownerWork(id: number, action: ReportWorkAction, plan?: string): BugReportView | undefined {
    const at = this.now()
    const { from, to } = REPORT_WORK_ACTIONS[action]
    const allowed = `id = ? AND work_status IN (${quoted(from)})`
    if (action === 'approve') {
      const current = this.db.prepare('SELECT triage_plan FROM bug_reports WHERE id = ?').get(id) as Row | undefined
      if (!current) return undefined
      const stored = current.triage_plan == null ? '' : String(current.triage_plan)
      const text = plan === undefined ? stored : checkedText(plan, REPORT_TEXT_LIMITS.plan, 'План')
      if (!text) throw new BugReportError(400, 'Напишите план: без него отчёт в работу не отдаётся')
      return this.changeWork(id, this.db.prepare(`UPDATE bug_reports SET work_status = ?, triage_plan = ?, plan_edited_at = CASE WHEN ? <> ? THEN ? ELSE plan_edited_at END,
          work_approved_at = ?, work_started_at = NULL, work_finished_at = NULL, work_note = NULL, work_commit = NULL, status = 'open', closed_at = NULL, work_changed_at = ?
        WHERE ${allowed}`).run(to, text, text, stored, at, at, at, id))
    }
    const closing = REPORT_WORK_CLOSED.includes(to)
    return this.changeWork(id, this.db.prepare(`UPDATE bug_reports SET work_status = ?, work_approved_at = NULL, status = ?, closed_at = ?, work_changed_at = ? WHERE ${allowed}`)
      .run(to, closing ? 'closed' : 'open', closing ? at : null, at, id))
  }

  /** Claude looked in from the owner's computer (the table says when). */
  agentSeen() {
    this.db.prepare('INSERT INTO report_agent_state (id, seen_at) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET seen_at = excluded.seen_at').run(this.now())
  }

  /** New reports nobody has analysed yet, the oldest first. */
  agentPending(limit: number): AgentReport[] {
    return this.agentRows("r.work_status = 'review' AND r.triage_at IS NULL", 'r.id', limit)
  }

  /**
   * What Claude drew from a report and the plan. Only while it waits for the check and only once; a plan the owner has
   * already written stays. It moves no status: the work starts by the owner's button.
   */
  agentTriage(id: number, input: { summary: string; plan: string }): BugReportView | undefined {
    const summary = checkedText(input.summary, REPORT_TEXT_LIMITS.summary, 'Вывод')
    const plan = checkedText(input.plan, REPORT_TEXT_LIMITS.plan, 'План')
    if (!summary || !plan) throw new BugReportError(400, 'Нужны и вывод, и план')
    const at = this.now()
    return this.changeWork(id, this.db.prepare(`UPDATE bug_reports SET triage_summary = ?, triage_plan = CASE WHEN plan_edited_at IS NULL THEN ? ELSE triage_plan END, triage_at = ?, work_changed_at = ?
      WHERE id = ? AND work_status = 'review' AND triage_at IS NULL`).run(summary, plan, at, at, id))
  }

  /** What the owner gave away and what Claude has taken. */
  agentJobs(): { queued: AgentReport[]; inProgress: AgentReport[] } {
    return {
      queued: this.agentRows("r.work_status = 'queued' AND r.work_approved_at IS NOT NULL", 'r.work_approved_at, r.id', 50),
      inProgress: this.agentRows("r.work_status = 'in-progress'", 'r.work_started_at, r.id', 50),
    }
  }

  agentStart(id: number): BugReportView | undefined {
    const at = this.now()
    return this.changeWork(id, this.db.prepare("UPDATE bug_reports SET work_status = 'in-progress', work_started_at = ?, work_changed_at = ? WHERE id = ? AND work_status = 'queued' AND work_approved_at IS NOT NULL").run(at, at, id))
  }

  /** «Выполнено» needs the commit of the fix; «Не реализовано» only says why, and the report goes back to the owner. */
  agentFinish(id: number, input: { outcome: 'done' | 'failed'; note: string; commit?: string }): BugReportView | undefined {
    const note = checkedText(input.note, REPORT_TEXT_LIMITS.note, 'Описание')
    if (!note) throw new BugReportError(400, 'Нужно короткое описание')
    const commit = input.outcome === 'done' ? input.commit?.trim().toLowerCase() ?? '' : null
    if (commit !== null && !/^[a-f0-9]{40}$/.test(commit)) throw new BugReportError(400, 'Для «Выполнено» нужен полный хеш коммита')
    const at = this.now()
    return this.changeWork(id, this.db.prepare("UPDATE bug_reports SET work_status = ?, work_note = ?, work_commit = ?, work_finished_at = ?, work_changed_at = ? WHERE id = ? AND work_status = 'in-progress'").run(input.outcome, note, commit, at, at, id))
  }

  /** Done reports with their commits, waiting to appear in a published version. */
  agentDone(): Array<{ id: number; commit: string }> {
    return (this.db.prepare("SELECT id, work_commit FROM bug_reports WHERE work_status = 'done' AND work_commit IS NOT NULL ORDER BY id").all() as Row[])
      .map((row) => ({ id: Number(row.id), commit: String(row.work_commit) }))
  }

  /** «Добавлено на сервер»: the version published on the site holds the commit of the fix. */
  agentPublished(id: number, publishedCommit: string): BugReportView | undefined {
    const published = publishedCommit.trim().toLowerCase()
    if (!/^[a-f0-9]{40}$/.test(published)) throw new BugReportError(400, 'Нужен полный хеш опубликованного коммита')
    const at = this.now()
    return this.changeWork(id, this.db.prepare("UPDATE bug_reports SET work_status = 'deployed', work_published_commit = ?, work_published_at = ?, status = 'closed', closed_at = ?, work_changed_at = ? WHERE id = ? AND work_status = 'done'").run(published, at, at, at, id))
  }

  /** The report after a change of its work; undefined when there is none, 409 when it no longer stands where it did. */
  private changeWork(id: number, result: { changes: number | bigint }) {
    const report = this.get(id)
    if (!report) return undefined
    if (!Number(result.changes)) throw new BugReportError(409, `Отчёт №${id} уже в другом статусе: обновите таблицу`)
    return report
  }

  private agentRows(where: string, order: string, limit: number): AgentReport[] {
    const rows = this.db.prepare(`SELECT ${AGENT_COLUMNS}, r.triage_summary, r.triage_plan, r.work_approved_at, r.work_started_at, r.work_commit FROM bug_reports r WHERE ${where} ORDER BY ${order} LIMIT ?`).all(limit) as Row[]
    const groups = rows.some((row) => row.quest_id != null) ? this.questGroups() : new Map<number, { group: string; matches: number }>()
    return rows.map((row) => ({
      ...redacted(row, groups),
      ...(row.triage_summary == null ? {} : { summary: String(row.triage_summary) }),
      ...(row.triage_plan == null ? {} : { plan: String(row.triage_plan) }),
      ...(row.work_approved_at == null ? {} : { approvedAt: iso(row.work_approved_at)! }),
      ...(row.work_started_at == null ? {} : { startedAt: iso(row.work_started_at)! }),
      ...(row.work_commit == null ? {} : { commit: String(row.work_commit) }),
    }))
  }

  /**
   * «Статистика по изменениям» (owner, 13.10.2026: «анализируй информацию и если она сходится 2-3-4 раза значит буду в
   * ручную менять»): open quest reports that agree, report id → its group and how many reports are in it.
   * - a proposed place: the same quest on the same map within MATCH_RADIUS_M of the group's first place;
   * - «this point is wrong» without a place: the same point;
   * - anything else: the same quest and the same issue.
   * Nothing is changed by it: the owner decides.
   */
  questGroups(): Map<number, { group: string; matches: number }> {
    const rows = this.db.prepare("SELECT id, quest_id, quest_issue, map_id, marker_id, point_x, point_z FROM bug_reports WHERE status = 'open' AND quest_id IS NOT NULL ORDER BY created_at, id").all() as Row[]
    const members = new Map<string, number[]>()
    const places: Array<{ key: string; quest: string; map: string; x: number; z: number }> = []
    for (const row of rows) {
      const id = Number(row.id)
      const quest = String(row.quest_id)
      let key: string
      if (row.point_x != null && row.point_z != null && row.map_id != null) {
        const x = Number(row.point_x), z = Number(row.point_z), map = String(row.map_id)
        const near = places.find((place) => place.quest === quest && place.map === map && Math.hypot(place.x - x, place.z - z) <= MATCH_RADIUS_M)
        if (near) key = near.key
        else {
          key = `point:${quest}:${map}:${places.filter((place) => place.quest === quest && place.map === map).length}`
          places.push({ key, quest, map, x, z })
        }
      } else if (row.marker_id != null) key = `marker:${quest}:${String(row.marker_id)}`
      else key = `issue:${quest}:${String(row.quest_issue ?? 'other')}`
      members.set(key, [...(members.get(key) ?? []), id])
    }
    const groups = new Map<number, { group: string; matches: number }>()
    for (const [group, ids] of members) for (const id of ids) groups.set(id, { group, matches: ids.length })
    return groups
  }

  get(id: number): BugReportView | undefined {
    const row = this.db.prepare('SELECT * FROM bug_reports WHERE id = ?').get(id) as Row | undefined
    if (!row) return undefined
    const files = (this.db.prepare('SELECT idx, mime, size FROM bug_report_files WHERE report_id = ? ORDER BY idx').all(id) as Row[])
      .map((file) => ({ idx: Number(file.idx), mime: String(file.mime) as ImageMime, size: Number(file.size) }))
    const group = row.quest_id != null && row.status === 'open' ? this.questGroups().get(id) : undefined
    return { ...this.base(row), ...group, description: String(row.description), files }
  }

  file(id: number, idx: number): { mime: ImageMime; data: Buffer } | undefined {
    const row = this.db.prepare('SELECT mime, data FROM bug_report_files WHERE report_id = ? AND idx = ?').get(id, idx) as Row | undefined
    if (!row) return undefined
    return { mime: String(row.mime) as ImageMime, data: Buffer.from(row.data as Uint8Array) }
  }

  /** Every screenshot of a report with its bytes, in order (the PDF for the owner). */
  files(id: number): Array<{ idx: number; mime: ImageMime; data: Buffer }> {
    return (this.db.prepare('SELECT idx, mime, data FROM bug_report_files WHERE report_id = ? ORDER BY idx').all(id) as Row[])
      .map((row) => ({ idx: Number(row.idx), mime: String(row.mime) as ImageMime, data: Buffer.from(row.data as Uint8Array) }))
  }

  /** Records subscription days the owner granted for the report (they add up). */
  addReward(id: number, days: number): BugReportView | undefined {
    const result = this.db.prepare('UPDATE bug_reports SET reward_days = reward_days + ?, rewarded_at = ? WHERE id = ?').run(days, this.now(), id)
    return Number(result.changes) ? this.get(id) : undefined
  }

  /** «Отвечено» (owner, 04.11.2026): the owner answered this report from its card, now. */
  markAnswered(id: number) {
    this.db.prepare('UPDATE bug_reports SET answered_at = ? WHERE id = ?').run(this.now(), id)
  }

  /** The PDF reached the mail provider (clears an earlier error). */
  markMailed(id: number) {
    this.db.prepare('UPDATE bug_reports SET mailed_at = ?, mail_error = NULL WHERE id = ?').run(this.now(), id)
  }

  /** The PDF could not be sent: the reason, shortened, for the admin panel. */
  markMailFailed(id: number, error: string) {
    this.db.prepare('UPDATE bug_reports SET mail_error = ? WHERE id = ?').run(error.slice(0, 300), id)
  }

  /** Close / reopen of apps before the table («Заявки», an owner app not yet updated): the table's status follows. */
  setStatus(id: number, status: BugReportStatus): BugReportView | undefined {
    const at = this.now()
    const result = status === 'closed'
      ? this.db.prepare(`UPDATE bug_reports SET status = 'closed', closed_at = ?, work_changed_at = ?, work_status = CASE WHEN work_status IN (${CLOSED_SQL}) THEN work_status ELSE 'closed' END WHERE id = ?`).run(at, at, id)
      : this.db.prepare(`UPDATE bug_reports SET status = 'open', closed_at = NULL, work_changed_at = ?, work_status = CASE WHEN work_status IN (${CLOSED_SQL}) THEN 'review' ELSE work_status END WHERE id = ?`).run(at, id)
    return Number(result.changes) ? this.get(id) : undefined
  }

  private base(row: Row): Omit<BugReportSummary, 'files'> {
    return {
      id: Number(row.id),
      kind: row.kind === 'idea' ? 'idea' : 'bug',
      ...(row.category == null ? {} : { category: String(row.category) as ReportCategory }),
      ...(row.quest_id == null ? {} : { quest: questOf(row) }),
      ...(row.email == null ? {} : { email: String(row.email) }),
      ...(row.account_id == null ? {} : { accountId: String(row.account_id) }),
      topic: String(row.topic),
      appVersion: String(row.app_version ?? ''),
      platform: String(row.platform ?? ''),
      status: row.status === 'closed' ? 'closed' : 'open',
      createdAt: iso(row.created_at)!,
      ...(row.closed_at == null ? {} : { closedAt: iso(row.closed_at)! }),
      rewardDays: Number(row.reward_days ?? 0),
      ...(row.rewarded_at == null ? {} : { rewardedAt: iso(row.rewarded_at)! }),
      ...(row.answered_at == null ? {} : { answeredAt: iso(row.answered_at)! }),
      ...(row.mailed_at == null ? {} : { mailedAt: iso(row.mailed_at)! }),
      ...(row.mail_error == null ? {} : { mailError: String(row.mail_error) }),
      ...(row.triage_summary == null && row.triage_plan == null ? {} : { triage: triageOf(row) }),
      work: workOf(row),
    }
  }
}

/** Trimmed; past the limit it is refused, never cut unseen. */
function checkedText(value: string, limit: number, label: string) {
  const text = value.trim()
  if (text.length > limit) throw new BugReportError(400, `${label}: не больше ${limit} символов`)
  return text
}

function triageOf(row: Row): ReportTriage {
  return {
    ...(row.triage_summary == null ? {} : { summary: String(row.triage_summary) }),
    ...(row.triage_plan == null ? {} : { plan: String(row.triage_plan) }),
    ...(row.triage_at == null ? {} : { at: iso(row.triage_at)! }),
    ...(row.plan_edited_at == null ? {} : { planEditedAt: iso(row.plan_edited_at)! }),
  }
}

function workOf(row: Row): ReportWork {
  const status = String(row.work_status ?? 'review') as ReportWorkStatus
  return {
    status: REPORT_WORK_STATUSES.includes(status) ? status : 'review',
    ...(row.work_note == null ? {} : { note: String(row.work_note) }),
    ...(row.work_commit == null ? {} : { commit: String(row.work_commit) }),
    ...(row.work_published_commit == null ? {} : { publishedCommit: String(row.work_published_commit) }),
    ...(row.work_approved_at == null ? {} : { approvedAt: iso(row.work_approved_at)! }),
    ...(row.work_started_at == null ? {} : { startedAt: iso(row.work_started_at)! }),
    ...(row.work_finished_at == null ? {} : { finishedAt: iso(row.work_finished_at)! }),
    ...(row.work_published_at == null ? {} : { publishedAt: iso(row.work_published_at)! }),
  }
}

/** A row read with AGENT_COLUMNS: no e-mail, account, days or mail state. The account only as a pseudonym, when one is asked for. */
function redacted(row: Row, groups: Map<number, { group: string; matches: number }>, pseudonym?: (accountId: string) => string): RedactedReport {
  return {
    id: Number(row.id),
    kind: row.kind === 'idea' ? 'idea' : 'bug',
    ...(row.category == null ? {} : { category: String(row.category) as ReportCategory }),
    ...(row.quest_id == null ? {} : { quest: questOf(row) }),
    ...groups.get(Number(row.id)),
    topic: String(row.topic),
    description: String(row.description),
    appVersion: String(row.app_version ?? ''),
    platform: String(row.platform ?? ''),
    status: row.status === 'closed' ? 'closed' : 'open',
    createdAt: iso(row.created_at)!,
    ...(row.closed_at == null ? {} : { closedAt: iso(row.closed_at)! }),
    files: Number(row.file_count),
    ...(row.account_id == null || !pseudonym ? {} : { reporter: pseudonym(String(row.account_id)) }),
  }
}

function questOf(row: Row): QuestReport {
  const text = (value: unknown) => (value == null ? undefined : String(value))
  const mode = text(row.game_mode)
  return {
    questId: String(row.quest_id),
    issue: (text(row.quest_issue) ?? 'other') as QuestIssue,
    ...(mode === 'pvp' || mode === 'pve' || mode === 'seasonal' ? { mode } : {}),
    ...(row.map_id == null ? {} : { mapId: String(row.map_id) }),
    ...(row.marker_id == null ? {} : { markerId: String(row.marker_id) }),
    ...(row.objective_id == null ? {} : { objectiveId: String(row.objective_id) }),
    ...(row.stage_index == null ? {} : { stageIndex: Number(row.stage_index) }),
    ...(row.point_x == null || row.point_z == null ? {} : { point: { x: Number(row.point_x), z: Number(row.point_z), ...(row.point_floor == null ? {} : { floor: String(row.point_floor) }) } }),
    ...(row.point_note == null ? {} : { pointNote: String(row.point_note) }),
    ...(row.quest_note == null ? {} : { questNote: String(row.quest_note) }),
  }
}

const MODE_LABELS: Record<ReportMode, string> = { pvp: 'PvP', pve: 'PvE', seasonal: 'Сезон' }

/** The category and the quest correction as «label: value» rows (the owner's PDF and e-mail). */
export function reportDetails(report: Pick<BugReportSummary, 'category' | 'quest' | 'matches'>): Array<[string, string]> {
  const rows: Array<[string, string]> = []
  if (report.category) rows.push(['Категория', REPORT_CATEGORY_LABELS[report.category] ?? report.category])
  const quest = report.quest
  if (!quest) return rows
  rows.push(['Квест (id)', quest.questId], ['Что не так', QUEST_ISSUE_LABELS[quest.issue] ?? quest.issue])
  if (quest.mode) rows.push(['Режим', MODE_LABELS[quest.mode]])
  if (quest.mapId) rows.push(['Карта', quest.mapId])
  if (quest.objectiveId) rows.push(['Цель (id)', quest.objectiveId])
  if (quest.stageIndex != null) rows.push(['Этап', String(quest.stageIndex + 1)])
  if (quest.markerId) rows.push(['Неверная точка', quest.markerId])
  if (quest.point) rows.push(['Предложенное место', `x ${Math.round(quest.point.x)}, z ${Math.round(quest.point.z)}${quest.point.floor ? ` · ${quest.point.floor}` : ''}`])
  if (quest.pointNote) rows.push(['Заметка к точке', quest.pointNote])
  if (quest.questNote) rows.push(['Заметка к квесту', quest.questNote])
  if (report.matches && report.matches > 1) rows.push(['Совпадает с отчётами', String(report.matches - 1)])
  return rows
}
