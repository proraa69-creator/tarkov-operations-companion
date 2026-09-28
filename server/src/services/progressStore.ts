import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import type { SyncRequest, SyncResponse } from '../models/api.js'

export class ProgressStore {
  private db: DatabaseSync
  constructor(path: string) {
    this.db = new DatabaseSync(path)
    this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS quest_events (
        owner TEXT NOT NULL, mode TEXT NOT NULL, account_id INTEGER NOT NULL,
        character_id TEXT NOT NULL, task_id TEXT NOT NULL, status TEXT NOT NULL,
        occurred_at TEXT NOT NULL, event_id TEXT NOT NULL, received_at TEXT NOT NULL,
        PRIMARY KEY(owner, event_id));
      CREATE INDEX IF NOT EXISTS events_scope ON quest_events(owner,mode,account_id,character_id,occurred_at);`)
  }
  sync(owner: string, input: SyncRequest): SyncResponse {
    const insert = this.db.prepare('INSERT OR IGNORE INTO quest_events VALUES (?,?,?,?,?,?,?,?,?)')
    this.db.exec('BEGIN')
    try {
      for (const event of input.events) {
        const id = createHash('sha256').update(JSON.stringify([input.mode, input.accountId, input.characterId, event.taskId, event.status, event.timestamp])).digest('hex')
        insert.run(owner, input.mode, input.accountId, input.characterId, event.taskId, event.status, event.timestamp, id, new Date().toISOString())
      }
      this.db.exec('COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
    const rows = this.db.prepare(`SELECT task_id, status, occurred_at FROM quest_events
      WHERE owner=? AND mode=? AND account_id=? AND character_id=?
      ORDER BY occurred_at, CASE status WHEN 'completed' THEN 3 WHEN 'failed' THEN 2 ELSE 1 END`).all(owner, input.mode, input.accountId, input.characterId)
    const records = new Map<string, SyncResponse['records'][number]>()
    for (const row of rows) records.set(String(row.task_id), { taskId: String(row.task_id), status: row.status as 'active' | 'completed' | 'failed', updatedAt: String(row.occurred_at), source: 'eft-log' })
    return { revision: createHash('sha256').update(JSON.stringify([...records.values()])).digest('hex'), records: [...records.values()], coverage: 'partial' }
  }
  close() { this.db.close() }
}
