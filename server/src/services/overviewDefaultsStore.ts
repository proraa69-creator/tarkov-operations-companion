import type { DatabaseSync } from 'node:sqlite'
import { sanitizeOverviewDefaults, type OverviewDefaults } from '../../../src/overview/overviewDefaults'

/**
 * «Админ панель» → «Блоки» (owner, 16.10.2026): the Overview every player starts from — the default order on the PC and
 * the phone, hidden blocks and the owner's own headings (src/overview/overviewDefaults.ts). One row in the accounts'
 * database; none means the built-in Overview.
 */
export type StoredOverviewDefaults = OverviewDefaults & { updatedAt: string; updatedBy: string }

interface Row { data: string; updated_by: string; updated_at: string }

export class OverviewDefaultsStore {
  constructor(private readonly db: DatabaseSync, private readonly now: () => number = Date.now) {
    db.exec(`CREATE TABLE IF NOT EXISTS overview_defaults (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        data TEXT NOT NULL,
        updated_by TEXT NOT NULL,
        updated_at TEXT NOT NULL);`)
  }

  /** The owner's defaults with the author, or null for the built-in Overview. */
  current(): StoredOverviewDefaults | null {
    const row = this.db.prepare('SELECT data, updated_by, updated_at FROM overview_defaults WHERE id = 1').get() as unknown as Row | undefined
    if (!row) return null
    try {
      const data = sanitizeOverviewDefaults(JSON.parse(row.data))
      return data ? { ...data, updatedAt: row.updated_at, updatedBy: row.updated_by } : null
    } catch {
      return null
    }
  }

  /** What every app gets: no author. */
  publicView(): OverviewDefaults | null {
    const stored = this.current()
    if (!stored) return null
    const view: Partial<StoredOverviewDefaults> = { ...stored }
    delete view.updatedBy
    return view as OverviewDefaults
  }

  save(defaults: OverviewDefaults, actor: string): StoredOverviewDefaults {
    const at = new Date(this.now()).toISOString()
    const clean = sanitizeOverviewDefaults(defaults) ?? { hidden: [], titles: {} }
    delete clean.updatedAt
    this.db.prepare(`INSERT INTO overview_defaults (id, data, updated_by, updated_at) VALUES (1, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
      .run(JSON.stringify(clean), actor, at)
    return { ...clean, updatedAt: at, updatedBy: actor }
  }

  /** Back to the built-in Overview; true when there was something to remove. */
  reset(): boolean {
    return Number(this.db.prepare('DELETE FROM overview_defaults WHERE id = 1').run().changes) > 0
  }
}
