import type { DatabaseSync } from 'node:sqlite'
import type { RaidMode } from '../../../src/domain/types'
import { sanitizeHideoutModules, sanitizeModeModules, type HideoutModules, type ModeModules } from '../../../src/hideout/hideoutModules'

/**
 * «Админ панель» → «Модули убежища» (owner, 20.11.2026): per mode, the hideout modules open from the start and the ones turned off,
 * for every player (src/hideout/hideoutModules.ts). One row in the accounts' database; none means every mode as in the game.
 */
export type StoredHideoutModules = HideoutModules & { updatedAt: string; updatedBy: string }

interface Row { data: string; updated_by: string; updated_at: string }

export class HideoutModulesStore {
  constructor(private readonly db: DatabaseSync, private readonly now: () => number = Date.now) {
    db.exec(`CREATE TABLE IF NOT EXISTS hideout_modules (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        data TEXT NOT NULL,
        updated_by TEXT NOT NULL,
        updated_at TEXT NOT NULL);`)
  }

  /** The owner's setting with the author, or null for none. */
  current(): StoredHideoutModules | null {
    const row = this.db.prepare('SELECT data, updated_by, updated_at FROM hideout_modules WHERE id = 1').get() as unknown as Row | undefined
    if (!row) return null
    try {
      const data = sanitizeHideoutModules(JSON.parse(row.data))
      return data ? { modes: data.modes, updatedAt: row.updated_at, updatedBy: row.updated_by } : null
    } catch {
      return null
    }
  }

  /** What every app gets: no author. */
  publicView(): HideoutModules | null {
    const stored = this.current()
    return stored ? { modes: stored.modes, updatedAt: stored.updatedAt } : null
  }

  /**
   * One mode's lists replaced, the other modes kept. Both lists empty: the mode as in the game; no mode left: the row goes and the
   * answer is null.
   */
  saveMode(mode: RaidMode, lists: ModeModules, actor: string): StoredHideoutModules | null {
    const modes = { ...(this.current()?.modes ?? {}) }
    const clean = sanitizeModeModules(lists)
    if (clean) modes[mode] = clean
    else delete modes[mode]
    if (!Object.keys(modes).length) {
      this.db.prepare('DELETE FROM hideout_modules WHERE id = 1').run()
      return null
    }
    const at = new Date(this.now()).toISOString()
    this.db.prepare(`INSERT INTO hideout_modules (id, data, updated_by, updated_at) VALUES (1, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
      .run(JSON.stringify({ modes }), actor, at)
    return { modes, updatedAt: at, updatedBy: actor }
  }
}
