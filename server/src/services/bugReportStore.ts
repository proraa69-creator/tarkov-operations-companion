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
 * Storage: screenshots of all reports together are kept under BUG_REPORT_STORAGE.maxStoredBytes (a new report with
 * screenshots past it is refused with 507; text-only reports are still accepted). Retention: screenshots of a closed
 * report are deleted 30 days after it was closed, of any report 90 days after it was sent (the text stays). It runs when
 * the store opens and at most hourly on new reports.
 */
import type { DatabaseSync } from 'node:sqlite'
import { transaction } from './database.js'
import { MATCH_RADIUS_M, QUEST_ISSUE_LABELS, REPORT_CATEGORY_LABELS, type QuestIssue, type ReportCategory, type ReportMode } from '../../../src/shared/reportCategories.js'

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
  /** When the PDF went to the owner's mailbox; the last error if it did not. */
  mailedAt?: string
  mailError?: string
}
export interface BugReportView extends Omit<BugReportSummary, 'files'> { description: string; files: BugReportFileView[] }

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
    this.db.exec('CREATE INDEX IF NOT EXISTS bug_reports_kind ON bug_reports(kind, status, created_at)')
    this.db.exec('CREATE INDEX IF NOT EXISTS bug_reports_quest ON bug_reports(status, quest_id)')
    this.pruneScreenshots()
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
  list(status: BugReportStatus | undefined, limit: number, offset: number, kind?: ReportKind): { reports: BugReportSummary[]; total: number; counts: Record<BugReportStatus, number>; kinds: Record<ReportKind, number> } {
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
    return { reports: rows.map((row) => ({ ...this.base(row), ...groups.get(Number(row.id)), files: Number(row.file_count) })), total: status ? counts[status] : counts.open + counts.closed, counts, kinds }
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
    const rows = this.db.prepare(`SELECT r.id, r.kind, r.category, r.account_id, r.topic, r.description, r.app_version, r.platform, r.status, r.created_at, r.closed_at,
        r.quest_id, r.quest_issue, r.game_mode, r.map_id, r.marker_id, r.objective_id, r.stage_index, r.point_x, r.point_z, r.point_floor, r.point_note, r.quest_note,
        (SELECT COUNT(*) FROM bug_report_files f WHERE f.report_id = r.id) AS file_count
      FROM bug_reports r ${status ? 'WHERE r.status = ?' : ''} ORDER BY r.created_at DESC, r.id DESC LIMIT ? OFFSET ?`)
      .all(...(status ? [status] : []), limit, offset) as Row[]
    const groups = rows.some((row) => row.quest_id != null && row.status === 'open') ? this.questGroups() : new Map<number, { group: string; matches: number }>()
    const reports = rows.map((row): RedactedReport => ({
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
      ...(row.account_id == null ? {} : { reporter: pseudonym(String(row.account_id)) }),
    }))
    return { reports, total: status ? counts[status] : counts.open + counts.closed, counts }
  }

  /** Open reports of every kind (the owner app's «Заявки» badge). */
  openCount() {
    return Number((this.db.prepare("SELECT COUNT(*) AS n FROM bug_reports WHERE status = 'open'").get() as { n: number }).n)
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

  /** The PDF reached the mail provider (clears an earlier error). */
  markMailed(id: number) {
    this.db.prepare('UPDATE bug_reports SET mailed_at = ?, mail_error = NULL WHERE id = ?').run(this.now(), id)
  }

  /** The PDF could not be sent: the reason, shortened, for the admin panel. */
  markMailFailed(id: number, error: string) {
    this.db.prepare('UPDATE bug_reports SET mail_error = ? WHERE id = ?').run(error.slice(0, 300), id)
  }

  setStatus(id: number, status: BugReportStatus): BugReportView | undefined {
    const result = this.db.prepare('UPDATE bug_reports SET status = ?, closed_at = ? WHERE id = ?').run(status, status === 'closed' ? this.now() : null, id)
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
      ...(row.mailed_at == null ? {} : { mailedAt: iso(row.mailed_at)! }),
      ...(row.mail_error == null ? {} : { mailError: String(row.mail_error) }),
    }
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
