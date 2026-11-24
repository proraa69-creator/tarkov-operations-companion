import type { DatabaseSync } from 'node:sqlite'

/**
 * The weapon builds the owner set by hand (owner, 02.11.2026: «сделай в админ приложении ручное редактирование сборок 100к
 * 200к и топ сборка, что бы я мог настраивать каждое оружие. в результате этих сборок я буду обучать как приложение должно
 * собирать оружие. должен запоминать что я меняю и делать выводы, как лучше собирать в будущем»).
 *
 * - `owner_builds`: one build per weapon and tier (`budget` «до 100 000 ₽», `middle` «до 200 000 ₽», `top`), its code
 *   (src/arsenal/buildStorage.ts encodeBuild, «RB1.…»). Every player's app shows it instead of the solved one.
 * - `owner_build_lessons`: what the owner's edits taught, per part: how many times he put it in where the app had another
 *   (`chosen`) and how many times he took it out (`rejected`). The app's solver gives a part points for the difference
 *   (src/arsenal/tieredBuilds.ts LEARNED_POINTS) on every weapon, so the next builds lean his way.
 * The same in every game mode: parts and their fit do not change with the mode, only prices do.
 */
export type OwnerBuildTier = 'budget' | 'middle' | 'top'
export const OWNER_BUILD_TIERS: readonly OwnerBuildTier[] = ['budget', 'middle', 'top']

export interface OwnerBuild {
  weaponId: string
  tier: OwnerBuildTier
  code: string
  updatedAt: string
  updatedBy: string
}

export interface OwnerBuildLesson { chosen: number; rejected: number }

/** Far more than there are weapons × tiers; protects the table from a runaway client. */
export const MAX_OWNER_BUILDS = 3000

interface BuildRow { weapon_id: string; tier: string; code: string; updated_at: string; updated_by: string }
interface LessonRow { part_id: string; chosen: number; rejected: number }

export class OwnerBuildStore {
  constructor(private readonly db: DatabaseSync, private readonly now: () => number = Date.now) {
    db.exec(`CREATE TABLE IF NOT EXISTS owner_builds (
        weapon_id TEXT NOT NULL,
        tier TEXT NOT NULL,
        code TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        updated_by TEXT NOT NULL,
        PRIMARY KEY (weapon_id, tier));
      CREATE TABLE IF NOT EXISTS owner_build_lessons (
        part_id TEXT PRIMARY KEY,
        chosen INTEGER NOT NULL DEFAULT 0,
        rejected INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL);`)
  }

  list(): OwnerBuild[] {
    const rows = this.db.prepare('SELECT * FROM owner_builds ORDER BY weapon_id, tier').all() as unknown as BuildRow[]
    return rows.map((row) => ({ weaponId: row.weapon_id, tier: row.tier as OwnerBuildTier, code: row.code, updatedAt: row.updated_at, updatedBy: row.updated_by }))
  }

  /** Part id → what the owner's edits taught about it (only parts he ever put in or took out). */
  lessons(): Record<string, OwnerBuildLesson> {
    const rows = this.db.prepare('SELECT part_id, chosen, rejected FROM owner_build_lessons').all() as unknown as LessonRow[]
    return Object.fromEntries(rows.map((row) => [row.part_id, { chosen: row.chosen, rejected: row.rejected }]))
  }

  /**
   * The owner's build of a weapon and tier; `added` / `removed`: the parts he put in and took out against the build the
   * app had shown, each counted once per save. 'full' when the table already holds MAX_OWNER_BUILDS other builds.
   */
  save(input: { weaponId: string; tier: OwnerBuildTier; code: string; added: string[]; removed: string[] }, actor: string): OwnerBuild | 'full' {
    const exists = this.db.prepare('SELECT 1 FROM owner_builds WHERE weapon_id = ? AND tier = ?').get(input.weaponId, input.tier)
    if (!exists && (this.db.prepare('SELECT COUNT(*) AS n FROM owner_builds').get() as { n: number }).n >= MAX_OWNER_BUILDS) return 'full'
    const at = new Date(this.now()).toISOString()
    this.db.exec('BEGIN')
    try {
      this.db.prepare(`INSERT INTO owner_builds (weapon_id, tier, code, updated_at, updated_by) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (weapon_id, tier) DO UPDATE SET code = excluded.code, updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
        .run(input.weaponId, input.tier, input.code, at, actor)
      const learn = this.db.prepare(`INSERT INTO owner_build_lessons (part_id, chosen, rejected, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT (part_id) DO UPDATE SET chosen = chosen + excluded.chosen, rejected = rejected + excluded.rejected, updated_at = excluded.updated_at`)
      for (const id of new Set(input.added)) learn.run(id, 1, 0, at)
      for (const id of new Set(input.removed)) learn.run(id, 0, 1, at)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
    return { weaponId: input.weaponId, tier: input.tier, code: input.code, updatedAt: at, updatedBy: actor }
  }

  /** Back to the app's own build of the weapon and tier (what it taught stays). */
  remove(weaponId: string, tier: OwnerBuildTier): boolean {
    return Number(this.db.prepare('DELETE FROM owner_builds WHERE weapon_id = ? AND tier = ?').run(weaponId, tier).changes) > 0
  }
}
