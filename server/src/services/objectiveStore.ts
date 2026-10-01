import type { DatabaseSync } from 'node:sqlite'
import type { ObjectiveProgress, ProgressEvent } from '../../../src/domain/types'
import { decide, mergeEventLists, normalizeObjective, undoProgressEvent } from '../../../src/progression/objectiveProgress'
import type { RaidMode } from '../models/api.js'
import { transaction } from './database.js'

/** Per owner and mode. Objectives: one row per objective id; events: the newest are kept. */
export const MAX_SERVER_OBJECTIVES = 5000
export const MAX_SERVER_EVENTS = 3000
/** Events returned by GET / sync: the newest ones (the app keeps ~600 locally). */
export const EVENTS_RETURNED = 600

export class ObjectiveLimitError extends Error {}

export interface ObjectiveSnapshot { objectives: ObjectiveProgress[]; events: ProgressEvent[]; updatedAt: string | null }
export type UndoResult = { status: 'ok'; snapshot: ObjectiveSnapshot } | { status: 'not-found' } | { status: 'not-undoable' }

type Row = Record<string, unknown>

/**
 * Objective progress and its history (`progress_events`) of signed-in users, per mode. The merge uses the same
 * rules as the app (src/progression/objectiveProgress.ts): manual beats automatic, newer beats older; a log
 * completion never overwrites a manual value here (the app asks the user and sends the answer as a manual value).
 * Owners are `user:<accountId>`; every query is scoped by owner, so one account never sees another's rows.
 */
export class ObjectiveStore {
  constructor(private readonly db: DatabaseSync) {
    db.exec(`CREATE TABLE IF NOT EXISTS objective_progress (
        owner TEXT NOT NULL, mode TEXT NOT NULL CHECK (mode IN ('pvp','pve','seasonal')), objective_id TEXT NOT NULL,
        task_id TEXT NOT NULL, type TEXT NOT NULL, target INTEGER NOT NULL, current INTEGER NOT NULL, completed_at TEXT,
        source TEXT NOT NULL, confidence REAL NOT NULL, observed_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        PRIMARY KEY(owner, mode, objective_id));
      CREATE TABLE IF NOT EXISTS progress_events (
        owner TEXT NOT NULL, mode TEXT NOT NULL CHECK (mode IN ('pvp','pve','seasonal')), event_id TEXT NOT NULL,
        task_id TEXT NOT NULL, objective_id TEXT, event_type TEXT NOT NULL, old_value TEXT, new_value TEXT,
        source TEXT NOT NULL, confidence REAL NOT NULL, observed_at TEXT NOT NULL, reversible INTEGER NOT NULL,
        undone_at TEXT, refers_to TEXT, received_at TEXT NOT NULL,
        PRIMARY KEY(owner, mode, event_id));
      CREATE INDEX IF NOT EXISTS progress_events_time ON progress_events(owner, mode, observed_at);`)
  }

  get(owner: string, mode: RaidMode): ObjectiveSnapshot {
    const objectives = (this.db.prepare(`SELECT * FROM objective_progress WHERE owner=? AND mode=? ORDER BY task_id, objective_id`).all(owner, mode) as Row[]).map(toObjective)
    const events = (this.db.prepare(`SELECT * FROM (SELECT * FROM progress_events WHERE owner=? AND mode=? ORDER BY observed_at DESC, event_id DESC LIMIT ?) ORDER BY observed_at, event_id`)
      .all(owner, mode, EVENTS_RETURNED) as Row[]).map((row) => toEvent(row, mode))
    const latest = this.db.prepare('SELECT MAX(updated_at) AS at FROM objective_progress WHERE owner=? AND mode=?').get(owner, mode) as Row | undefined
    return { objectives, events, updatedAt: latest?.at == null ? null : String(latest.at) }
  }

  /** Merges the app's copy into the server copy and returns the merged state. */
  sync(owner: string, mode: RaidMode, input: { objectives: ObjectiveProgress[]; events: ProgressEvent[] }): ObjectiveSnapshot {
    const now = new Date().toISOString()
    transaction(this.db, () => {
      const select = this.db.prepare('SELECT * FROM objective_progress WHERE owner=? AND mode=? AND objective_id=?')
      const count = Number((this.db.prepare('SELECT COUNT(*) AS n FROM objective_progress WHERE owner=? AND mode=?').get(owner, mode) as Row).n)
      let added = 0
      for (const value of input.objectives) {
        const incoming = normalizeObjective(value)
        const row = select.get(owner, mode, incoming.objectiveId) as Row | undefined
        if (!row && count + added >= MAX_SERVER_OBJECTIVES) throw new ObjectiveLimitError('Слишком много целей заданий')
        if (decide(row ? toObjective(row) : undefined, incoming) !== 'apply') continue
        if (!row) added += 1
        this.upsertObjective(owner, mode, incoming, now)
      }
      for (const event of input.events) this.upsertEvent(owner, mode, event, now)
      this.pruneEvents(owner, mode)
    })
    return this.get(owner, mode)
  }

  /** «Отменить» from the website / phone: same rule as in the app (old value back as a manual value). */
  undo(owner: string, mode: RaidMode, eventId: string): UndoResult {
    return transaction(this.db, () => {
      const row = this.db.prepare('SELECT * FROM progress_events WHERE owner=? AND mode=? AND event_id=?').get(owner, mode, eventId) as Row | undefined
      if (!row) return { status: 'not-found' as const }
      const event = toEvent(row, mode)
      if (event.eventType === 'task-status' || !event.objectiveId) return { status: 'not-undoable' as const }
      const objectiveRow = this.db.prepare('SELECT * FROM objective_progress WHERE owner=? AND mode=? AND objective_id=?').get(owner, mode, event.objectiveId) as Row | undefined
      const objective = objectiveRow ? toObjective(objectiveRow) : undefined
      const before = { objectiveProgress: objective ? { [objective.objectiveId]: objective } : {}, progressEvents: [event], objectiveConflicts: [] }
      const after = undoProgressEvent(before, eventId)
      if (after === before) return { status: 'not-undoable' as const }
      const now = new Date().toISOString()
      const restored = after.objectiveProgress[event.objectiveId]
      if (restored) this.upsertObjective(owner, mode, restored, now)
      for (const entry of after.progressEvents) this.upsertEvent(owner, mode, entry, now)
      return { status: 'ok' as const, snapshot: this.get(owner, mode) }
    })
  }

  private upsertObjective(owner: string, mode: RaidMode, value: ObjectiveProgress, now: string) {
    this.db.prepare(`INSERT INTO objective_progress (owner, mode, objective_id, task_id, type, target, current, completed_at, source, confidence, observed_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(owner, mode, objective_id) DO UPDATE SET task_id=excluded.task_id, type=excluded.type, target=excluded.target, current=excluded.current,
        completed_at=excluded.completed_at, source=excluded.source, confidence=excluded.confidence, observed_at=excluded.observed_at, updated_at=excluded.updated_at`)
      .run(owner, mode, value.objectiveId, value.taskId, value.type, value.target, value.current, value.completedAt ?? null, value.source, value.confidence, value.observedAt, now)
  }

  private upsertEvent(owner: string, mode: RaidMode, event: ProgressEvent, now: string) {
    const known = this.db.prepare('SELECT * FROM progress_events WHERE owner=? AND mode=? AND event_id=?').get(owner, mode, event.id) as Row | undefined
    if (known) {
      // Only the undo mark of a known event may change; everything else is history.
      const merged = mergeEventLists([toEvent(known, mode)], [{ ...event, mode }])[0]
      if (merged.undoneAt && merged.undoneAt !== (known.undone_at ?? undefined)) {
        this.db.prepare('UPDATE progress_events SET undone_at=? WHERE owner=? AND mode=? AND event_id=?').run(merged.undoneAt, owner, mode, event.id)
      }
      return
    }
    this.db.prepare(`INSERT INTO progress_events (owner, mode, event_id, task_id, objective_id, event_type, old_value, new_value, source, confidence, observed_at, reversible, undone_at, refers_to, received_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(owner, mode, event.id, event.taskId, event.objectiveId ?? null, event.eventType, JSON.stringify(event.oldValue ?? null), JSON.stringify(event.newValue ?? null),
        event.source, event.confidence, event.observedAt, event.reversible ? 1 : 0, event.undoneAt ?? null, event.refersTo ?? null, now)
  }

  private pruneEvents(owner: string, mode: RaidMode) {
    this.db.prepare(`DELETE FROM progress_events WHERE owner=? AND mode=? AND event_id NOT IN (
      SELECT event_id FROM progress_events WHERE owner=? AND mode=? ORDER BY observed_at DESC, event_id DESC LIMIT ?)`)
      .run(owner, mode, owner, mode, MAX_SERVER_EVENTS)
  }
}

function toObjective(row: Row): ObjectiveProgress {
  return {
    objectiveId: String(row.objective_id),
    taskId: String(row.task_id),
    type: String(row.type),
    target: Number(row.target),
    current: Number(row.current),
    ...(row.completed_at == null ? {} : { completedAt: String(row.completed_at) }),
    source: String(row.source) as ObjectiveProgress['source'],
    confidence: Number(row.confidence),
    observedAt: String(row.observed_at),
  }
}

function toEvent(row: Row, mode: RaidMode): ProgressEvent {
  return {
    id: String(row.event_id),
    mode,
    taskId: String(row.task_id),
    ...(row.objective_id == null ? {} : { objectiveId: String(row.objective_id) }),
    eventType: String(row.event_type) as ProgressEvent['eventType'],
    oldValue: parseValue(row.old_value),
    newValue: parseValue(row.new_value),
    source: String(row.source) as ProgressEvent['source'],
    confidence: Number(row.confidence),
    observedAt: String(row.observed_at),
    reversible: Number(row.reversible) === 1,
    ...(row.undone_at == null ? {} : { undoneAt: String(row.undone_at) }),
    ...(row.refers_to == null ? {} : { refersTo: String(row.refers_to) }),
  }
}

function parseValue(raw: unknown): number | string | null {
  try {
    const value = JSON.parse(String(raw)) as unknown
    return typeof value === 'number' || typeof value === 'string' ? value : null
  } catch {
    return null
  }
}
