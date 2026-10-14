import type { DatabaseSync } from 'node:sqlite'

/**
 * Features the owner turns on or off for every app at once (owner, 14.10.2026: «добавь в админ приложении, включить или
 * выключить функции миникарты (всплывающее окно карты поверх игры, и функция отслеживания)… После обновления приложения
 * у всех по стандарту функция миникарты выключена»). Two switches:
 * - `minimap`: the minimap over the game and the position tracking from the game's screenshots. No row: off.
 * - `minimapOverlay` (owner, 14.10.2026: «отключить именно мини карту по кнопке. то есть ее выключаешь и местоположение
 *   появляется только в приложении. а всплывающее окно не появляется вообще»): only the window over the game, while the
 *   first is on. No row: on, so turning the first on gives the whole minimap.
 */
export interface FeatureSwitches {
  minimap: boolean
  /**
   * When the minimap was last switched off (ISO time), null while it was never on. The apps show their one-time notice
   * («функция мини-карты временно выключена») again only when this changes.
   */
  minimapChangedAt: string | null
  /** The minimap window over the game (needs `minimap` too). Off: the position shows only in the app. */
  minimapOverlay: boolean
}

export type FeatureSwitchName = 'minimap' | 'minimapOverlay'

export interface OwnedFeatureSwitches extends FeatureSwitches { updatedBy: string | null; updatedAt: string | null }

interface Row { enabled: number; off_since: string | null; updated_by: string; updated_at: string }

/** A switch the owner never touched. */
const DEFAULTS: Record<FeatureSwitchName, boolean> = { minimap: false, minimapOverlay: true }

export class FeatureSwitchStore {
  constructor(private readonly db: DatabaseSync, private readonly now: () => number = Date.now) {
    db.exec(`CREATE TABLE IF NOT EXISTS feature_switches (
        name TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL,
        off_since TEXT,
        updated_by TEXT NOT NULL,
        updated_at TEXT NOT NULL);`)
  }

  private row(name: FeatureSwitchName) {
    return this.db.prepare('SELECT enabled, off_since, updated_by, updated_at FROM feature_switches WHERE name = ?').get(name) as unknown as Row | undefined
  }

  private enabled(name: FeatureSwitchName, row = this.row(name)) {
    return row ? row.enabled === 1 : DEFAULTS[name]
  }

  /** What every app gets: no author, no time of the last change but the minimap's switch-off. */
  publicView(): FeatureSwitches {
    const minimap = this.row('minimap')
    return { minimap: this.enabled('minimap', minimap), minimapChangedAt: minimap?.off_since ?? null, minimapOverlay: this.enabled('minimapOverlay') }
  }

  /** With who changed a switch last and when. */
  current(): OwnedFeatureSwitches {
    const last = [this.row('minimap'), this.row('minimapOverlay')].filter((row): row is Row => Boolean(row)).sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0]
    return { ...this.publicView(), updatedBy: last?.updated_by ?? null, updatedAt: last?.updated_at ?? null }
  }

  /** Turns a switch on or off for everybody. The switch-off time moves only when it was on before. */
  set(name: FeatureSwitchName, enabled: boolean, actor: string): OwnedFeatureSwitches {
    const before = this.row(name)
    const at = new Date(this.now()).toISOString()
    const offSince = !enabled && this.enabled(name, before) ? at : before?.off_since ?? null
    this.db.prepare(`INSERT INTO feature_switches (name, enabled, off_since, updated_by, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET enabled = excluded.enabled, off_since = excluded.off_since, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
      .run(name, enabled ? 1 : 0, offSince, actor, at)
    return this.current()
  }

  setMinimap(enabled: boolean, actor: string): OwnedFeatureSwitches {
    return this.set('minimap', enabled, actor)
  }
}
