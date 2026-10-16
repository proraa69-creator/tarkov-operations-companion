import type { DatabaseSync } from 'node:sqlite'
import { EVENT_QUEST_LIMITS, type EventQuestDefinition } from '../../../src/data/eventQuestDefinitions'

/**
 * «Ивент-квесты» the owner keeps in the owner app (owner, 16.10.2026: «добавь в админ панели возможность добавлять ивент
 * квесты и редактировать их»): one definition per quest id (src/data/eventQuestDefinitions.ts), shared by every player
 * and every mode the definition names. A definition with a built-in quest's id replaces that quest (removing it brings
 * the built-in one back); a new id adds a quest. The server's quest base builds them into the catalog
 * (services/catalogService.ts) and the apps lay them over the catalog they have (src/data/eventQuests.ts).
 */
export type StoredEventQuest = EventQuestDefinition & { createdAt: string; updatedAt: string; updatedBy: string }
export type EventQuestInput = Omit<EventQuestDefinition, 'createdAt' | 'updatedAt' | 'updatedBy'>

interface Row { id: string; data: string; created_at: string; updated_by: string; updated_at: string }

export class EventQuestStore {
  constructor(private readonly db: DatabaseSync, private readonly now: () => number = Date.now) {
    db.exec(`CREATE TABLE IF NOT EXISTS event_quests (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_by TEXT NOT NULL,
        updated_at TEXT NOT NULL);`)
  }

  /** Every definition, the oldest first (new quests of a series follow in this order). */
  list(): StoredEventQuest[] {
    const rows = this.db.prepare('SELECT * FROM event_quests ORDER BY created_at, id').all() as unknown as Row[]
    return rows.flatMap((row) => {
      const stored = toStored(row)
      return stored ? [stored] : []
    })
  }

  get(id: string): StoredEventQuest | undefined {
    const row = this.db.prepare('SELECT * FROM event_quests WHERE id = ?').get(id) as unknown as Row | undefined
    return row ? toStored(row) : undefined
  }

  /** Creates or replaces the definition of `input.id`; `full` when the table already holds the most definitions. */
  save(input: EventQuestInput, actor: string): StoredEventQuest | 'full' {
    const existing = this.db.prepare('SELECT created_at FROM event_quests WHERE id = ?').get(input.id) as { created_at: string } | undefined
    if (!existing) {
      const count = Number((this.db.prepare('SELECT COUNT(*) AS n FROM event_quests').get() as { n: number }).n)
      if (count >= EVENT_QUEST_LIMITS.definitions) return 'full'
    }
    const at = new Date(this.now()).toISOString()
    const row: Row = { id: input.id, data: JSON.stringify(input), created_at: existing?.created_at ?? at, updated_by: actor, updated_at: at }
    this.db.prepare(`INSERT INTO event_quests (id, data, created_at, updated_by, updated_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
      .run(row.id, row.data, row.created_at, row.updated_by, row.updated_at)
    return toStored(row)!
  }

  /** The removed definition, or undefined when there was none. */
  remove(id: string): StoredEventQuest | undefined {
    const found = this.get(id)
    if (!found) return undefined
    this.db.prepare('DELETE FROM event_quests WHERE id = ?').run(id)
    return found
  }
}

function toStored(row: Row): StoredEventQuest | undefined {
  try {
    const data = JSON.parse(row.data) as EventQuestDefinition
    return { ...data, id: row.id, createdAt: row.created_at, updatedAt: row.updated_at, updatedBy: row.updated_by }
  } catch {
    return undefined
  }
}
