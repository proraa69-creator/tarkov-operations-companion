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

export interface ProgressScope { accountId: number; characterId: string; syncedAt: string }
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
  }

  /** Development single-owner endpoint (/v1/sync/events). */
  sync(owner: string, input: SyncRequest): SyncResponse {
    this.insert(owner, input.mode, input.accountId, input.characterId, input.events)
    return this.project(owner, input.mode, input.accountId, input.characterId)
  }

  /**
   * Signed-in user: stores the batch for the given (or last known) character of this mode and returns every
   * record the server knows for it, so rotated/deleted local logs do not lose progress.
   */
  syncUser(owner: string, mode: RaidMode, input: UserSyncRequest): UserProgressResponse {
    const previous = this.scope(owner, mode)
    const accountId = input.accountId ?? previous?.accountId ?? 0
    const characterId = input.characterId ?? previous?.characterId ?? ''
    const syncedAt = new Date().toISOString()
    transaction(this.db, () => {
      if (input.resetAt) {
        this.db.prepare('DELETE FROM quest_events WHERE owner=? AND mode=? AND account_id=? AND character_id=? AND occurred_at < ?')
          .run(owner, mode, accountId, characterId, input.resetAt)
      }
      this.insertRows(owner, mode, accountId, characterId, input.events)
      this.db.prepare(`INSERT INTO progress_scopes (owner, mode, account_id, character_id, synced_at) VALUES (?,?,?,?,?)
        ON CONFLICT(owner, mode) DO UPDATE SET account_id=excluded.account_id, character_id=excluded.character_id, synced_at=excluded.synced_at`)
        .run(owner, mode, accountId, characterId, syncedAt)
    })
    return { ...this.project(owner, mode, accountId, characterId), scope: { accountId, characterId, syncedAt } }
  }

  /** Records of the character that was synced last in this mode. */
  userRecords(owner: string, mode: RaidMode): UserProgressResponse {
    const scope = this.scope(owner, mode)
    if (!scope) return { revision: createHash('sha256').update('[]').digest('hex'), records: [], coverage: 'partial', scope: null }
    return { ...this.project(owner, mode, scope.accountId, scope.characterId), scope }
  }

  scope(owner: string, mode: RaidMode): ProgressScope | undefined {
    const row = this.db.prepare('SELECT account_id, character_id, synced_at FROM progress_scopes WHERE owner=? AND mode=?').get(owner, mode) as Row | undefined
    return row ? { accountId: Number(row.account_id), characterId: String(row.character_id), syncedAt: String(row.synced_at) } : undefined
  }

  close() { if (this.ownsDb) this.db.close() }

  private insert(owner: string, mode: RaidMode, accountId: number, characterId: string, events: SyncEvent[]) {
    transaction(this.db, () => this.insertRows(owner, mode, accountId, characterId, events))
  }

  private insertRows(owner: string, mode: RaidMode, accountId: number, characterId: string, events: SyncEvent[]) {
    const insert = this.db.prepare('INSERT OR IGNORE INTO quest_events VALUES (?,?,?,?,?,?,?,?,?)')
    const receivedAt = new Date().toISOString()
    for (const event of events) {
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
