import { randomBytes } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'

/**
 * Quest requirements the owner curated in the quest constructor (owner app → «Карты» → «Редактировать квесты» →
 * «Требования»; owner, 15.10.2026: «функцию выбора предмета или ключа из каталога, что бы я в реальном времени мог
 * добавить требование квеста»). Shared by every player and every game mode, like the corrected points and texts
 * (services/questPointStore.ts); the app merges them into the quest (src/data/questRequirementOverrides.ts):
 *
 * - `add`: the quest needs `count` of `itemId` for `kind` (bring into the raid, hand over, find in raid, a key, plant,
 *   use). When the catalog already has the same item for the same kind, the entry replaces its count / comment;
 * - `hide`: the catalog's requirement of `itemId` for `kind` is not shown («скрыть»).
 *
 * One entry per quest, item and kind. `position` orders a quest's entries (the owner reorders them by hand).
 * `objectiveId` / `pointId` / `mapId` optionally tie the entry to an objective, a map point or a map.
 */
export type QuestRequirementOp = 'add' | 'hide'
export type QuestRequirementKind = 'bring' | 'handover' | 'find' | 'key' | 'plant' | 'use'
export const QUEST_REQUIREMENT_KINDS: readonly QuestRequirementKind[] = ['bring', 'handover', 'find', 'key', 'plant', 'use']

export interface QuestRequirementOverride {
  id: string
  questId: string
  op: QuestRequirementOp
  itemId: string
  kind: QuestRequirementKind
  count: number
  foundInRaid?: boolean
  comment?: string
  commentEn?: string
  objectiveId?: string
  pointId?: string
  mapId?: string
  position: number
  updatedBy: string
  updatedAt: string
}

export type QuestRequirementInput = Omit<QuestRequirementOverride, 'id' | 'position' | 'updatedBy' | 'updatedAt'>

/** Far more than the owner will ever curate; protects the table from a runaway client. */
export const MAX_QUEST_REQUIREMENT_OVERRIDES = 5000
/** Entries of one quest. */
export const MAX_QUEST_REQUIREMENTS_PER_QUEST = 100

interface Row {
  id: string; quest_id: string; op: string; item_id: string; kind: string; count: number; found_in_raid: number | null
  comment: string | null; comment_en: string | null; objective_id: string | null; point_id: string | null; map_id: string | null
  position: number; updated_by: string; updated_at: string
}

export class QuestRequirementStore {
  constructor(private readonly db: DatabaseSync, private readonly now: () => number = Date.now) {
    db.exec(`CREATE TABLE IF NOT EXISTS quest_requirement_overrides (
        id TEXT PRIMARY KEY,
        quest_id TEXT NOT NULL,
        op TEXT NOT NULL,
        item_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        count INTEGER NOT NULL,
        found_in_raid INTEGER,
        comment TEXT,
        comment_en TEXT,
        objective_id TEXT,
        point_id TEXT,
        map_id TEXT,
        position INTEGER NOT NULL,
        updated_by TEXT NOT NULL,
        updated_at TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS quest_requirement_overrides_key ON quest_requirement_overrides(quest_id, item_id, kind);`)
  }

  list(): QuestRequirementOverride[] {
    const rows = this.db.prepare('SELECT * FROM quest_requirement_overrides ORDER BY quest_id, position, updated_at, id').all() as unknown as Row[]
    return rows.map(toOverride)
  }

  get(id: string): QuestRequirementOverride | undefined {
    const row = this.db.prepare('SELECT * FROM quest_requirement_overrides WHERE id = ?').get(id) as unknown as Row | undefined
    return row ? toOverride(row) : undefined
  }

  /**
   * Saves an entry. `id` updates that entry (it keeps its place); otherwise the entry of the same quest, item and kind
   * is replaced, or a new one goes to the end of the quest's list. Another entry with the new quest / item / kind gives
   * way. `missing`: no entry with that id; `full`: the table or the quest's list is full.
   */
  save(input: QuestRequirementInput, actor: string, id?: string): QuestRequirementOverride | 'missing' | 'full' {
    const existing = id
      ? this.db.prepare('SELECT id, quest_id, position FROM quest_requirement_overrides WHERE id = ?').get(id) as { id: string; quest_id: string; position: number } | undefined
      : this.db.prepare('SELECT id, quest_id, position FROM quest_requirement_overrides WHERE quest_id = ? AND item_id = ? AND kind = ?')
        .get(input.questId, input.itemId, input.kind) as { id: string; quest_id: string; position: number } | undefined
    if (id && !existing) return 'missing'
    const sameQuest = existing?.quest_id === input.questId
    if (!existing) {
      const total = Number((this.db.prepare('SELECT COUNT(*) AS n FROM quest_requirement_overrides').get() as { n: number }).n)
      if (total >= MAX_QUEST_REQUIREMENT_OVERRIDES) return 'full'
    }
    if (!sameQuest) {
      const ofQuest = Number((this.db.prepare('SELECT COUNT(*) AS n FROM quest_requirement_overrides WHERE quest_id = ?').get(input.questId) as { n: number }).n)
      if (ofQuest >= MAX_QUEST_REQUIREMENTS_PER_QUEST) return 'full'
    }
    const last = this.db.prepare('SELECT MAX(position) AS p FROM quest_requirement_overrides WHERE quest_id = ?').get(input.questId) as { p: number | null }
    const row: Row = {
      id: existing?.id ?? randomBytes(12).toString('hex'),
      quest_id: input.questId,
      op: input.op,
      item_id: input.itemId,
      kind: input.kind,
      count: input.count,
      found_in_raid: input.foundInRaid === undefined ? null : Number(input.foundInRaid),
      comment: input.comment ?? null,
      comment_en: input.commentEn ?? null,
      objective_id: input.objectiveId ?? null,
      point_id: input.pointId ?? null,
      map_id: input.mapId ?? null,
      position: sameQuest && existing ? existing.position : (last.p ?? -1) + 1,
      updated_by: actor,
      updated_at: new Date(this.now()).toISOString(),
    }
    this.db.prepare('DELETE FROM quest_requirement_overrides WHERE quest_id = ? AND item_id = ? AND kind = ? AND id <> ?').run(row.quest_id, row.item_id, row.kind, row.id)
    this.db.prepare(`INSERT INTO quest_requirement_overrides (id, quest_id, op, item_id, kind, count, found_in_raid, comment, comment_en, objective_id, point_id, map_id, position, updated_by, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET quest_id = excluded.quest_id, op = excluded.op, item_id = excluded.item_id, kind = excluded.kind,
          count = excluded.count, found_in_raid = excluded.found_in_raid, comment = excluded.comment, comment_en = excluded.comment_en,
          objective_id = excluded.objective_id, point_id = excluded.point_id, map_id = excluded.map_id, position = excluded.position,
          updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
      .run(row.id, row.quest_id, row.op, row.item_id, row.kind, row.count, row.found_in_raid, row.comment, row.comment_en, row.objective_id, row.point_id, row.map_id,
        row.position, row.updated_by, row.updated_at)
    return toOverride(row)
  }

  /** The removed entry (an added requirement disappears, a hidden one is shown again), or undefined. */
  remove(id: string): QuestRequirementOverride | undefined {
    const found = this.get(id)
    if (!found) return undefined
    this.db.prepare('DELETE FROM quest_requirement_overrides WHERE id = ?').run(id)
    return found
  }

  /**
   * Puts a quest's entries in the order of `ids` (entries not named keep their order after them). False when an id is
   * not an entry of that quest.
   */
  reorder(questId: string, ids: string[], actor: string): boolean {
    const rows = this.db.prepare('SELECT id FROM quest_requirement_overrides WHERE quest_id = ? ORDER BY position, updated_at, id').all(questId) as Array<{ id: string }>
    const known = new Set(rows.map((row) => row.id))
    if (ids.some((id) => !known.has(id)) || new Set(ids).size !== ids.length) return false
    const order = [...ids, ...rows.map((row) => row.id).filter((id) => !ids.includes(id))]
    const at = new Date(this.now()).toISOString()
    const update = this.db.prepare('UPDATE quest_requirement_overrides SET position = ?, updated_by = ?, updated_at = ? WHERE id = ?')
    order.forEach((id, index) => update.run(index, actor, at, id))
    return true
  }
}

function toOverride(row: Row): QuestRequirementOverride {
  return {
    id: row.id,
    questId: row.quest_id,
    op: row.op === 'hide' ? 'hide' : 'add',
    itemId: row.item_id,
    kind: (QUEST_REQUIREMENT_KINDS as readonly string[]).includes(row.kind) ? row.kind as QuestRequirementKind : 'bring',
    count: Number(row.count) || 1,
    ...(row.found_in_raid == null ? {} : { foundInRaid: Boolean(row.found_in_raid) }),
    ...(row.comment ? { comment: row.comment } : {}),
    ...(row.comment_en ? { commentEn: row.comment_en } : {}),
    ...(row.objective_id ? { objectiveId: row.objective_id } : {}),
    ...(row.point_id ? { pointId: row.point_id } : {}),
    ...(row.map_id ? { mapId: row.map_id } : {}),
    position: Number(row.position),
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  }
}
