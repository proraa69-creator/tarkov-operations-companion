/**
 * «Сообщить об ошибке» (routes/bugReports.ts): reports the players send from the app (topic, description, up to five
 * screenshots, app version and OS) and the owner reads in the website's «Админ-панель» → «Баг-репорты».
 *
 * Tables are created with IF NOT EXISTS and never change existing ones:
 *   bug_reports       — one report; `email` is the account's address at the time it was sent;
 *   bug_report_files  — its screenshots (PNG / JPEG / WEBP, checked by their magic bytes, never by the declared type).
 *
 * Deleting an account (AccountStore.deleteAccount) clears `account_id` and `email` of its reports: the report itself
 * stays for the owner to handle, without the personal link.
 *
 * Storage: screenshots of all reports together are kept under BUG_REPORT_STORAGE.maxStoredBytes (a new report with
 * screenshots past it is refused with 507; text-only reports are still accepted). Retention: screenshots of a closed
 * report are deleted 30 days after it was closed, of any report 90 days after it was sent (the text stays). It runs when
 * the store opens and at most hourly on new reports.
 */
import type { DatabaseSync } from 'node:sqlite'
import { transaction } from './database.js'

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

export interface BugReportInput {
  topic: string
  description: string
  appVersion: string
  platform: string
  files: Buffer[]
}

export interface BugReportFileView { idx: number; mime: ImageMime; size: number }
export interface BugReportSummary {
  id: number
  email?: string
  accountId?: string
  topic: string
  appVersion: string
  platform: string
  status: BugReportStatus
  createdAt: string
  closedAt?: string
  files: number
}
export interface BugReportView extends Omit<BugReportSummary, 'files'> { description: string; files: BugReportFileView[] }

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
      const result = this.db.prepare('INSERT INTO bug_reports (account_id, email, topic, description, app_version, platform, status, created_at) VALUES (?, ?, ?, ?, ?, ?, \'open\', ?)')
        .run(accountId, email ?? null, input.topic, input.description, input.appVersion, input.platform, at)
      const id = Number(result.lastInsertRowid)
      const insert = this.db.prepare('INSERT INTO bug_report_files (report_id, idx, mime, size, data) VALUES (?, ?, ?, ?, ?)')
      input.files.forEach((file, idx) => insert.run(id, idx, mimes[idx], file.length, file))
      return { id, createdAt: iso(at)! }
    })
  }

  list(status: BugReportStatus | undefined, limit: number, offset: number): { reports: BugReportSummary[]; total: number; counts: Record<BugReportStatus, number> } {
    const counts = { open: 0, closed: 0 }
    for (const row of this.db.prepare('SELECT status, COUNT(*) AS n FROM bug_reports GROUP BY status').all() as Row[]) {
      if (row.status === 'open' || row.status === 'closed') counts[row.status] = Number(row.n)
    }
    const where = status ? 'WHERE r.status = ?' : ''
    const params = status ? [status] : []
    const rows = this.db.prepare(`SELECT r.*, (SELECT COUNT(*) FROM bug_report_files f WHERE f.report_id = r.id) AS file_count
      FROM bug_reports r ${where} ORDER BY r.created_at DESC, r.id DESC LIMIT ? OFFSET ?`).all(...params, limit, offset) as Row[]
    return { reports: rows.map((row) => ({ ...this.base(row), files: Number(row.file_count) })), total: status ? counts[status] : counts.open + counts.closed, counts }
  }

  get(id: number): BugReportView | undefined {
    const row = this.db.prepare('SELECT * FROM bug_reports WHERE id = ?').get(id) as Row | undefined
    if (!row) return undefined
    const files = (this.db.prepare('SELECT idx, mime, size FROM bug_report_files WHERE report_id = ? ORDER BY idx').all(id) as Row[])
      .map((file) => ({ idx: Number(file.idx), mime: String(file.mime) as ImageMime, size: Number(file.size) }))
    return { ...this.base(row), description: String(row.description), files }
  }

  file(id: number, idx: number): { mime: ImageMime; data: Buffer } | undefined {
    const row = this.db.prepare('SELECT mime, data FROM bug_report_files WHERE report_id = ? AND idx = ?').get(id, idx) as Row | undefined
    if (!row) return undefined
    return { mime: String(row.mime) as ImageMime, data: Buffer.from(row.data as Uint8Array) }
  }

  setStatus(id: number, status: BugReportStatus): BugReportView | undefined {
    const result = this.db.prepare('UPDATE bug_reports SET status = ?, closed_at = ? WHERE id = ?').run(status, status === 'closed' ? this.now() : null, id)
    return Number(result.changes) ? this.get(id) : undefined
  }

  private base(row: Row): Omit<BugReportSummary, 'files'> {
    return {
      id: Number(row.id),
      ...(row.email == null ? {} : { email: String(row.email) }),
      ...(row.account_id == null ? {} : { accountId: String(row.account_id) }),
      topic: String(row.topic),
      appVersion: String(row.app_version ?? ''),
      platform: String(row.platform ?? ''),
      status: row.status === 'closed' ? 'closed' : 'open',
      createdAt: iso(row.created_at)!,
      ...(row.closed_at == null ? {} : { closedAt: iso(row.closed_at)! }),
    }
  }
}
