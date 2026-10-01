/**
 * «Страж сервера»: automatic SQLite backups (docs/server-guard.md). A consistent online copy with `VACUUM INTO` (the
 * same as `npm --prefix server run backup`), written next to the database in `backups/`:
 *   companion-daily-2026-10-01T03-00-00Z.sqlite           — once a day (the owner app's watchdog asks for it);
 *   companion-before-restart-2026-10-01T03-00-00Z.sqlite  — before the watchdog restarts the API because of errors;
 *   companion-manual-….sqlite                             — «Сделать копию сейчас».
 * Rotation keeps 14 days, and always the newest KEEP_MIN copies. Other files in the folder (e.g. the CLI's
 * companion-<stamp>.sqlite) are never touched. Restoring is manual on purpose (see the docs): never silently.
 */
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'

export type BackupKind = 'daily' | 'before-restart' | 'manual'
export interface BackupFile { name: string; kind: BackupKind; at: string; bytes: number }
export interface BackupStatus { enabled: boolean; dir?: string; lastAt?: string; lastFile?: string; lastKind?: BackupKind; count: number; totalBytes: number; lastError?: string; lastErrorAt?: string }

export const BACKUP_KEEP_DAYS = 14
export const BACKUP_KEEP_MIN = 3
const NAME = /^companion-(daily|before-restart|manual)-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})Z\.sqlite$/

/** The database file behind a connection ('' for an in-memory database). */
export function databaseFile(db: DatabaseSync) {
  try {
    const row = (db.prepare('PRAGMA database_list').all() as Array<{ name: string; file: string }>).find((item) => item.name === 'main')
    return row?.file ?? ''
  } catch {
    return ''
  }
}

export function backupName(kind: BackupKind, at: number) {
  return `companion-${kind}-${new Date(at).toISOString().slice(0, 19).replace(/:/g, '-')}Z.sqlite`
}

export function parseBackupName(name: string): { kind: BackupKind; at: number } | null {
  const match = NAME.exec(name)
  if (!match) return null
  return { kind: match[1] as BackupKind, at: Date.parse(`${match[2]}T${match[3]}:${match[4]}:${match[5]}Z`) }
}

/** Which backups rotation removes: older than `keepDays`, except the newest `keepMin` (pure, unit-tested). */
export function backupsToRemove(names: string[], now: number, keepDays = BACKUP_KEEP_DAYS, keepMin = BACKUP_KEEP_MIN) {
  const parsed = names.map((name) => ({ name, info: parseBackupName(name) })).filter((item): item is { name: string; info: { kind: BackupKind; at: number } } => item.info !== null)
  parsed.sort((a, b) => b.info.at - a.info.at)
  const cutoff = now - keepDays * 24 * 60 * 60 * 1000
  return parsed.slice(keepMin).filter((item) => item.info.at < cutoff).map((item) => item.name)
}

export class BackupService {
  readonly dir: string | undefined
  private readonly db: DatabaseSync
  private readonly now: () => number
  private lastError: { message: string; at: number } | undefined

  constructor(db: DatabaseSync, options: { dir?: string; now?: () => number } = {}) {
    this.db = db
    this.now = options.now ?? Date.now
    const file = databaseFile(db)
    this.dir = options.dir ?? (file ? join(dirname(file), 'backups') : undefined)
  }

  get enabled() { return Boolean(this.dir) }

  /** Writes one backup and rotates the folder. Throws with a readable message when it cannot. */
  create(kind: BackupKind): BackupFile {
    if (!this.dir) throw new Error('Резервные копии недоступны: база данных в памяти')
    try {
      mkdirSync(this.dir, { recursive: true })
      let at = this.now()
      let target = join(this.dir, backupName(kind, at))
      // Two copies within one second (a manual one right after the daily one): the next free second.
      while (existsSync(target)) { at += 1000; target = join(this.dir, backupName(kind, at)) }
      this.db.prepare('VACUUM INTO ?').run(target)
      this.lastError = undefined
      this.rotate()
      return { name: target.slice(this.dir.length + 1), kind, at: new Date(at).toISOString(), bytes: statSync(target).size }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.lastError = { message, at: this.now() }
      throw new Error(`Резервная копия не создана: ${message}`, { cause: error })
    }
  }

  rotate() {
    if (!this.dir || !existsSync(this.dir)) return []
    const remove = backupsToRemove(readdirSync(this.dir), this.now())
    for (const name of remove) { try { unlinkSync(join(this.dir, name)) } catch { /* in use: next time */ } }
    return remove
  }

  list(): BackupFile[] {
    if (!this.dir || !existsSync(this.dir)) return []
    const files: BackupFile[] = []
    for (const name of readdirSync(this.dir)) {
      const info = parseBackupName(name)
      if (!info) continue
      let bytes: number
      try { bytes = statSync(join(this.dir, name)).size } catch { continue }
      files.push({ name, kind: info.kind, at: new Date(info.at).toISOString(), bytes })
    }
    return files.sort((a, b) => b.at.localeCompare(a.at))
  }

  status(): BackupStatus {
    if (!this.dir) return { enabled: false, count: 0, totalBytes: 0 }
    const files = this.list()
    const last = files[0]
    return {
      enabled: true, dir: this.dir, count: files.length, totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
      ...(last ? { lastAt: last.at, lastFile: last.name, lastKind: last.kind } : {}),
      ...(this.lastError ? { lastError: this.lastError.message, lastErrorAt: new Date(this.lastError.at).toISOString() } : {}),
    }
  }
}
