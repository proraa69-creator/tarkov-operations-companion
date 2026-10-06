import { randomBytes } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'

/**
 * Quest map points corrected by the owner by hand (owner app → «Карты» → «Квесты: правка точек»), e.g. after a bug
 * report. Shared by every player and every game mode (quest / zone ids are the same in PvP, PvE and Season): the app
 * lays them over the catalog and story points (src/data/questPointOverrides.ts).
 *
 * - `move`: the point `markerId` (an app marker id: `quest-zone-<quest>-<zone>`, `quest-item-…`, `<map>-<quest>-stage-N`)
 *   is drawn at x / z instead (and on `floor`, absent = main level);
 * - `hide`: the point `markerId` is not drawn; x / z keep where it stood, so the editor can show it greyed out;
 * - `add`: an extra point of the quest (of `objectiveId` or story `stageIndex` when given).
 * Positions are game metres (x / z), the same as the map markers of the catalog.
 */
export type QuestPointKind = 'move' | 'add' | 'hide'

export interface QuestPointOverride {
  id: string
  questId: string
  /** The original point (move / hide); absent for an added point. */
  markerId?: string
  objectiveId?: string
  stageIndex?: number
  mapId: string
  x: number
  z: number
  floor?: string
  kind: QuestPointKind
  note?: string
  updatedBy: string
  updatedAt: string
}

export type QuestPointInput = Omit<QuestPointOverride, 'id' | 'updatedBy' | 'updatedAt'>

/** Far more than all quest points of all maps; protects the table from a runaway client. */
export const MAX_QUEST_POINT_OVERRIDES = 5000

interface Row {
  id: string; quest_id: string; marker_id: string | null; objective_id: string | null; stage_index: number | null
  map_id: string; x: number; z: number; floor: string | null; kind: string; note: string | null; updated_by: string; updated_at: string
}

export class QuestPointStore {
  constructor(private readonly db: DatabaseSync, private readonly now: () => number = Date.now) {
    db.exec(`CREATE TABLE IF NOT EXISTS quest_point_overrides (
        id TEXT PRIMARY KEY,
        quest_id TEXT NOT NULL,
        marker_id TEXT,
        objective_id TEXT,
        stage_index INTEGER,
        map_id TEXT NOT NULL,
        x REAL NOT NULL,
        z REAL NOT NULL,
        floor TEXT,
        kind TEXT NOT NULL,
        note TEXT,
        updated_by TEXT NOT NULL,
        updated_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS quest_point_overrides_quest ON quest_point_overrides(quest_id);
      CREATE UNIQUE INDEX IF NOT EXISTS quest_point_overrides_marker ON quest_point_overrides(marker_id) WHERE marker_id IS NOT NULL;`)
  }

  list(): QuestPointOverride[] {
    const rows = this.db.prepare('SELECT * FROM quest_point_overrides ORDER BY updated_at, id').all() as unknown as Row[]
    return rows.map(toOverride)
  }

  get(id: string): QuestPointOverride | undefined {
    const row = this.db.prepare('SELECT * FROM quest_point_overrides WHERE id = ?').get(id) as unknown as Row | undefined
    return row ? toOverride(row) : undefined
  }

  /**
   * Saves a correction. `id` updates that override; otherwise a move / hide replaces the override of the same original
   * point (one correction per point) and an add creates a new one.
   * `missing`: no override with that id; `full`: the table is full; `invalid`: move / hide without a marker id.
   */
  save(input: QuestPointInput, actor: string, id?: string): QuestPointOverride | 'missing' | 'full' | 'invalid' {
    if (input.kind !== 'add' && !input.markerId) return 'invalid'
    const markerId = input.kind === 'add' ? null : input.markerId!
    const existing = id
      ? this.db.prepare('SELECT id FROM quest_point_overrides WHERE id = ?').get(id) as { id: string } | undefined
      : markerId ? this.db.prepare('SELECT id FROM quest_point_overrides WHERE marker_id = ?').get(markerId) as { id: string } | undefined : undefined
    if (id && !existing) return 'missing'
    if (!existing) {
      const count = Number((this.db.prepare('SELECT COUNT(*) AS n FROM quest_point_overrides').get() as { n: number }).n)
      if (count >= MAX_QUEST_POINT_OVERRIDES) return 'full'
    }
    const row: Row = {
      id: existing?.id ?? randomBytes(12).toString('hex'),
      quest_id: input.questId,
      marker_id: markerId,
      objective_id: input.objectiveId ?? null,
      stage_index: input.stageIndex ?? null,
      map_id: input.mapId,
      x: input.x,
      z: input.z,
      floor: input.floor ?? null,
      kind: input.kind,
      note: input.note ?? null,
      updated_by: actor,
      updated_at: new Date(this.now()).toISOString(),
    }
    // An update by id may point the override at another original point: that point's own override gives way.
    if (existing && markerId) this.db.prepare('DELETE FROM quest_point_overrides WHERE marker_id = ? AND id <> ?').run(markerId, existing.id)
    this.db.prepare(`INSERT INTO quest_point_overrides (id, quest_id, marker_id, objective_id, stage_index, map_id, x, z, floor, kind, note, updated_by, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET quest_id = excluded.quest_id, marker_id = excluded.marker_id, objective_id = excluded.objective_id,
          stage_index = excluded.stage_index, map_id = excluded.map_id, x = excluded.x, z = excluded.z, floor = excluded.floor,
          kind = excluded.kind, note = excluded.note, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
      .run(row.id, row.quest_id, row.marker_id, row.objective_id, row.stage_index, row.map_id, row.x, row.z, row.floor, row.kind, row.note, row.updated_by, row.updated_at)
    return toOverride(row)
  }

  /** The removed override («Вернуть исходную точку»), or undefined when there was none. */
  remove(id: string): QuestPointOverride | undefined {
    const found = this.get(id)
    if (!found) return undefined
    this.db.prepare('DELETE FROM quest_point_overrides WHERE id = ?').run(id)
    return found
  }
}

function toOverride(row: Row): QuestPointOverride {
  return {
    id: row.id,
    questId: row.quest_id,
    ...(row.marker_id ? { markerId: row.marker_id } : {}),
    ...(row.objective_id ? { objectiveId: row.objective_id } : {}),
    ...(row.stage_index == null ? {} : { stageIndex: Number(row.stage_index) }),
    mapId: row.map_id,
    x: Number(row.x),
    z: Number(row.z),
    ...(row.floor ? { floor: row.floor } : {}),
    kind: row.kind === 'hide' || row.kind === 'add' ? row.kind : 'move',
    ...(row.note ? { note: row.note } : {}),
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  }
}
