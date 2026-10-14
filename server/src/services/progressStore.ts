import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import type { RaidMode, SyncEvent, SyncRequest, SyncResponse } from '../models/api.js'
import { transaction } from './database.js'

export interface UserSyncRequest {
  accountId?: number
  characterId?: string
  /** The logs report a profile reset / wipe at this time: older events of this character no longer count. */
  resetAt?: string
  events: SyncEvent[]
}

/**
 * The character a mode's records belong to (the one synced last) and its latest trusted profile reset: the phone and a PC
 * without logs drop their older records of that mode the same way the desktop does (src/import/logApply.ts).
 */
export interface ProgressScope { accountId: number; characterId: string; syncedAt: string; resetAt?: string }
export interface UserProgressResponse extends SyncResponse { scope: ProgressScope | null }

type Row = Record<string, unknown>

/**
 * Quest events from EFT logs, stored idempotently per owner / mode / Tarkov account / character.
 * Owners: 'local-development' for the dev token endpoint, `user:<accountId>` for signed-in website accounts.
 */
export class ProgressStore {
  private db: DatabaseSync
  private readonly ownsDb: boolean
  constructor(pathOrDb: string | DatabaseSync) {
    this.ownsDb = typeof pathOrDb === 'string'
    this.db = typeof pathOrDb === 'string' ? new DatabaseSync(pathOrDb) : pathOrDb
    this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS quest_events (
        owner TEXT NOT NULL, mode TEXT NOT NULL, account_id INTEGER NOT NULL,
        character_id TEXT NOT NULL, task_id TEXT NOT NULL, status TEXT NOT NULL,
        occurred_at TEXT NOT NULL, event_id TEXT NOT NULL, received_at TEXT NOT NULL,
        PRIMARY KEY(owner, event_id));
      CREATE INDEX IF NOT EXISTS events_scope ON quest_events(owner,mode,account_id,character_id,occurred_at);
      CREATE TABLE IF NOT EXISTS progress_scopes (
        owner TEXT NOT NULL, mode TEXT NOT NULL, account_id INTEGER NOT NULL, character_id TEXT NOT NULL,
        synced_at TEXT NOT NULL, PRIMARY KEY(owner, mode));`)
    // The latest trusted reset of the scope's character (added after the first release: older databases get the column).
    const columns = this.db.prepare('PRAGMA table_info(progress_scopes)').all() as Row[]
    if (!columns.some((column) => column.name === 'reset_at')) this.db.exec('ALTER TABLE progress_scopes ADD COLUMN reset_at TEXT')
  }

  /** Development single-owner endpoint (/v1/sync/events). */
  sync(owner: string, input: SyncRequest): SyncResponse {
    this.insert(owner, input.mode, input.accountId, input.characterId, input.events)
    return this.project(owner, input.mode, input.accountId, input.characterId)
  }

  /**
   * Signed-in user: stores the batch for the given (or last known) character of this mode and returns every
   * record the server knows for it, so rotated/deleted local logs do not lose progress. A reported reset (only a trusted
   * one: a catalog trader quest accepted again after its hand-in) deletes the character's older events; the latest one is
   * kept with the scope, and events older than it are not stored again (another PC whose logs never showed the reset).
   */
  syncUser(owner: string, mode: RaidMode, input: UserSyncRequest, now = Date.now()): UserProgressResponse {
    const previous = this.scope(owner, mode)
    const accountId = input.accountId ?? previous?.accountId ?? 0
    const characterId = input.characterId ?? previous?.characterId ?? ''
    const syncedAt = new Date(now).toISOString()
    // A client clock far ahead must not hide this character's events for good.
    const latest = new Date(now + 60_000).toISOString()
    const reported = input.resetAt && input.resetAt > latest ? latest : input.resetAt
    const kept = previous?.characterId === characterId ? previous.resetAt : undefined
    const resetAt = reported && (!kept || reported > kept) ? reported : kept
    transaction(this.db, () => {
      if (reported) {
        this.db.prepare('DELETE FROM quest_events WHERE owner=? AND mode=? AND account_id=? AND character_id=? AND occurred_at < ?')
          .run(owner, mode, accountId, characterId, reported)
      }
      this.insertRows(owner, mode, accountId, characterId, input.events, resetAt)
      this.db.prepare(`INSERT INTO progress_scopes (owner, mode, account_id, character_id, synced_at, reset_at) VALUES (?,?,?,?,?,?)
        ON CONFLICT(owner, mode) DO UPDATE SET account_id=excluded.account_id, character_id=excluded.character_id, synced_at=excluded.synced_at, reset_at=excluded.reset_at`)
        .run(owner, mode, accountId, characterId, syncedAt, resetAt ?? null)
    })
    return { ...this.project(owner, mode, accountId, characterId), scope: { accountId, characterId, syncedAt, ...(resetAt ? { resetAt } : {}) } }
  }

  /** Records of the character that was synced last in this mode. */
  userRecords(owner: string, mode: RaidMode): UserProgressResponse {
    const scope = this.scope(owner, mode)
    if (!scope) return { revision: createHash('sha256').update('[]').digest('hex'), records: [], coverage: 'partial', scope: null }
    return { ...this.project(owner, mode, scope.accountId, scope.characterId), scope }
  }

  scope(owner: string, mode: RaidMode): ProgressScope | undefined {
    const row = this.db.prepare('SELECT account_id, character_id, synced_at, reset_at FROM progress_scopes WHERE owner=? AND mode=?').get(owner, mode) as Row | undefined
    if (!row) return undefined
    return { accountId: Number(row.account_id), characterId: String(row.character_id), syncedAt: String(row.synced_at), ...(typeof row.reset_at === 'string' && row.reset_at ? { resetAt: row.reset_at } : {}) }
  }

  close() { if (this.ownsDb) this.db.close() }

  private insert(owner: string, mode: RaidMode, accountId: number, characterId: string, events: SyncEvent[]) {
    transaction(this.db, () => this.insertRows(owner, mode, accountId, characterId, events))
  }

  private insertRows(owner: string, mode: RaidMode, accountId: number, characterId: string, events: SyncEvent[], notBefore?: string) {
    const insert = this.db.prepare('INSERT OR IGNORE INTO quest_events VALUES (?,?,?,?,?,?,?,?,?)')
    const receivedAt = new Date().toISOString()
    for (const event of events) {
      if (notBefore && event.timestamp < notBefore) continue
      const id = createHash('sha256').update(JSON.stringify([mode, accountId, characterId, event.taskId, event.status, event.timestamp])).digest('hex')
      insert.run(owner, mode, accountId, characterId, event.taskId, event.status, event.timestamp, id, receivedAt)
    }
  }

  private project(owner: string, mode: RaidMode, accountId: number, characterId: string): SyncResponse {
    const rows = this.db.prepare(`SELECT task_id, status, occurred_at FROM quest_events
      WHERE owner=? AND mode=? AND account_id=? AND character_id=?
      ORDER BY occurred_at, CASE status WHEN 'completed' THEN 3 WHEN 'failed' THEN 2 ELSE 1 END`).all(owner, mode, accountId, characterId)
    const records = new Map<string, SyncResponse['records'][number]>()
    for (const row of rows) records.set(String(row.task_id), { taskId: String(row.task_id), status: row.status as 'active' | 'completed' | 'failed', updatedAt: String(row.occurred_at), source: 'eft-log' })
    return { revision: createHash('sha256').update(JSON.stringify([...records.values()])).digest('hex'), records: [...records.values()], coverage: 'partial' }
  }
}
