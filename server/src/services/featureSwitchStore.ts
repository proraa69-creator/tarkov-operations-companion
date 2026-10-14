import type { DatabaseSync } from 'node:sqlite'

/**
 * Features the owner turns on or off for every app at once (owner, 14.10.2026: «добавь в админ приложении, включить или
 * выключить функции миникарты (всплывающее окно карты поверх игры, и функция отслеживания)… После обновления приложения
 * у всех по стандарту функция миникарты выключена»). One switch for now: the minimap over the game and the position
 * tracking from the game's screenshots. No row: off.
 */
export interface FeatureSwitches {
  minimap: boolean
  /**
   * When the minimap was last switched off (ISO time), null while it was never on. The apps show their one-time notice
   * («функция мини-карты временно выключена») again only when this changes.
   */
  minimapChangedAt: string | null
}

export interface OwnedFeatureSwitches extends FeatureSwitches { updatedBy: string | null; updatedAt: string | null }

interface Row { enabled: number; off_since: string | null; updated_by: string; updated_at: string }

export class FeatureSwitchStore {
  constructor(private readonly db: DatabaseSync, private readonly now: () => number = Date.now) {
    db.exec(`CREATE TABLE IF NOT EXISTS feature_switches (
        name TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL,
        off_since TEXT,
        updated_by TEXT NOT NULL,
        updated_at TEXT NOT NULL);`)
  }

  private row(name: string) {
    return this.db.prepare('SELECT enabled, off_since, updated_by, updated_at FROM feature_switches WHERE name = ?').get(name) as unknown as Row | undefined
  }

  /** What every app gets: no author, no time of the last change but the switch-off. */
  publicView(): FeatureSwitches {
    const row = this.row('minimap')
    return { minimap: row?.enabled === 1, minimapChangedAt: row?.off_since ?? null }
  }

  current(): OwnedFeatureSwitches {
    const row = this.row('minimap')
    return { ...this.publicView(), updatedBy: row?.updated_by ?? null, updatedAt: row?.updated_at ?? null }
  }

  /** Turns the minimap on or off for everybody. The switch-off time moves only when it was on before. */
  setMinimap(enabled: boolean, actor: string): OwnedFeatureSwitches {
    const before = this.row('minimap')
    const at = new Date(this.now()).toISOString()
    const offSince = !enabled && before?.enabled === 1 ? at : before?.off_since ?? null
    this.db.prepare(`INSERT INTO feature_switches (name, enabled, off_since, updated_by, updated_at) VALUES ('minimap', ?, ?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET enabled = excluded.enabled, off_since = excluded.off_since, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
      .run(enabled ? 1 : 0, offSince, actor, at)
    return this.current()
  }
}
