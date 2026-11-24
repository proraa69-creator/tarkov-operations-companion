import type { DatabaseSync } from 'node:sqlite'

/**
 * «Обновление», the owner's own texts of what a release brought (owner, 06.11.2026: «Я смогу сам отредактировать… моментально этот
 * текст должен поменяться и у всех пользователей, без обновления приложения»). A release's lines as the owner left them, one row a
 * version in the accounts' database; a version with no row reads as the app's own (src/data/playerNews.json).
 */
export type PlayerNewsKind = 'added' | 'changed' | 'improved'
export interface PlayerNewsItem { kind: PlayerNewsKind; ru: string; en: string }

const KINDS: ReadonlySet<string> = new Set<PlayerNewsKind>(['added', 'changed', 'improved'])
const isItem = (value: unknown): value is PlayerNewsItem => {
  const row = value as PlayerNewsItem | null
  return Boolean(row) && KINDS.has(row!.kind) && typeof row!.ru === 'string' && typeof row!.en === 'string'
}

export class PlayerNewsStore {
  constructor(private readonly db: DatabaseSync, private readonly now: () => number = Date.now) {
    db.exec(`CREATE TABLE IF NOT EXISTS player_news_edits (
        version TEXT PRIMARY KEY,
        items TEXT NOT NULL,
        updated_by TEXT NOT NULL,
        updated_at TEXT NOT NULL);`)
  }

  /** Version → its lines as the owner left them. */
  edits(): Record<string, PlayerNewsItem[]> {
    const rows = this.db.prepare('SELECT version, items FROM player_news_edits').all() as unknown as Array<{ version: string; items: string }>
    const result: Record<string, PlayerNewsItem[]> = {}
    for (const row of rows) {
      try {
        const items: unknown = JSON.parse(row.items)
        if (Array.isArray(items)) result[row.version] = items.filter(isItem)
      } catch { /* a damaged row reads as the app's own text */ }
    }
    return result
  }

  save(version: string, items: PlayerNewsItem[], actor: string) {
    this.db.prepare(`INSERT INTO player_news_edits (version, items, updated_by, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(version) DO UPDATE SET items = excluded.items, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
      .run(version, JSON.stringify(items), actor, new Date(this.now()).toISOString())
  }

  /** Back to the app's own text; true when there was something to remove. */
  reset(version: string) {
    return Number(this.db.prepare('DELETE FROM player_news_edits WHERE version = ?').run(version).changes) > 0
  }
}
