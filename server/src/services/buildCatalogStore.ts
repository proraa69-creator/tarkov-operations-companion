import { randomBytes } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { transaction } from './database.js'

/**
 * «Топ сборок» (owner, 17.10.2026: «добавь ещё топ сборок и люди смогут туда выкладывать сборку»): weapon builds players
 * publish from «Сборка оружия», per game mode, with one like per account. A build is its share code (src/arsenal/
 * buildStorage.ts, «RB1.<weapon>.<ammo>.<tree>», a few hundred characters), so the whole catalog stays small: 10 000
 * builds are a few megabytes, and a page of the top is one indexed query.
 *
 * Deleting an account removes its builds and its likes (AccountStore.deleteAccount).
 */
export const BUILD_MODES = ['pvp', 'pve', 'seasonal'] as const
export type BuildMode = typeof BUILD_MODES[number]
export type BuildSort = 'top' | 'new'

/** Published builds one account may keep per mode; the oldest has to be removed for a new one. */
export const MAX_BUILDS_PER_ACCOUNT = 30
export const BUILD_PAGE_SIZE = 50

export interface SharedBuild {
  id: string
  mode: BuildMode
  weaponId: string
  name: string
  code: string
  /** The author's game nickname when published (or none). */
  author?: string
  likes: number
  liked: boolean
  mine: boolean
  createdAt: string
}

export interface NewSharedBuild {
  mode: BuildMode
  weaponId: string
  name: string
  code: string
  author?: string
}

interface Row { id: string; account_id: string; mode: string; weapon_id: string; name: string; code: string; author: string | null; created_at: number; likes: number; liked: number }

export class BuildCatalogStore {
  constructor(private readonly db: DatabaseSync, private readonly now: () => number = Date.now) {
    db.exec(`CREATE TABLE IF NOT EXISTS shared_builds (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        mode TEXT NOT NULL,
        weapon_id TEXT NOT NULL,
        name TEXT NOT NULL,
        code TEXT NOT NULL,
        author TEXT,
        created_at INTEGER NOT NULL,
        UNIQUE (account_id, mode, code));
      CREATE INDEX IF NOT EXISTS shared_builds_mode_weapon ON shared_builds(mode, weapon_id, created_at);
      CREATE INDEX IF NOT EXISTS shared_builds_account ON shared_builds(account_id, mode);
      CREATE TABLE IF NOT EXISTS shared_build_likes (
        build_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (build_id, account_id));
      CREATE INDEX IF NOT EXISTS shared_build_likes_account ON shared_build_likes(account_id);`)
  }

  /** One page of a mode's builds (of one weapon when given): the most liked first, or the newest. */
  list(viewer: string, mode: BuildMode, options: { weaponId?: string; sort?: BuildSort; offset?: number } = {}): { builds: SharedBuild[]; total: number } {
    const where = options.weaponId ? 'b.mode = ? AND b.weapon_id = ?' : 'b.mode = ?'
    const params: string[] = options.weaponId ? [mode, options.weaponId] : [mode]
    const order = options.sort === 'new' ? 'b.created_at DESC, b.id' : 'likes DESC, b.created_at DESC, b.id'
    const rows = this.db.prepare(`SELECT b.*, (SELECT COUNT(*) FROM shared_build_likes l WHERE l.build_id = b.id) AS likes,
        EXISTS (SELECT 1 FROM shared_build_likes l WHERE l.build_id = b.id AND l.account_id = ?) AS liked
      FROM shared_builds b WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`).all(viewer, ...params, BUILD_PAGE_SIZE, Math.max(0, options.offset ?? 0)) as unknown as Row[]
    const total = (this.db.prepare(`SELECT COUNT(*) AS count FROM shared_builds b WHERE ${where}`).get(...params) as { count: number }).count
    return { builds: rows.map((row) => toBuild(row, viewer)), total }
  }

  /** `duplicate`: this account already published the same build in this mode; `full`: MAX_BUILDS_PER_ACCOUNT reached. */
  publish(accountId: string, build: NewSharedBuild): SharedBuild | 'duplicate' | 'full' {
    return transaction(this.db, () => {
      if (this.db.prepare('SELECT 1 FROM shared_builds WHERE account_id = ? AND mode = ? AND code = ?').get(accountId, build.mode, build.code)) return 'duplicate' as const
      const count = (this.db.prepare('SELECT COUNT(*) AS count FROM shared_builds WHERE account_id = ? AND mode = ?').get(accountId, build.mode) as { count: number }).count
      if (count >= MAX_BUILDS_PER_ACCOUNT) return 'full' as const
      const id = randomBytes(12).toString('hex')
      const createdAt = this.now()
      this.db.prepare('INSERT INTO shared_builds (id, account_id, mode, weapon_id, name, code, author, created_at) VALUES (?,?,?,?,?,?,?,?)')
        .run(id, accountId, build.mode, build.weaponId, build.name, build.code, build.author ?? null, createdAt)
      return toBuild({ id, account_id: accountId, mode: build.mode, weapon_id: build.weaponId, name: build.name, code: build.code, author: build.author ?? null, created_at: createdAt, likes: 0, liked: 0 }, accountId)
    })
  }

  /** Likes or unlikes the build for this account; undefined when there is no such build. An author cannot like their own. */
  toggleLike(accountId: string, buildId: string): { likes: number; liked: boolean } | 'own' | undefined {
    return transaction(this.db, () => {
      const build = this.db.prepare('SELECT account_id FROM shared_builds WHERE id = ?').get(buildId) as { account_id: string } | undefined
      if (!build) return undefined
      if (build.account_id === accountId) return 'own' as const
      const removed = this.db.prepare('DELETE FROM shared_build_likes WHERE build_id = ? AND account_id = ?').run(buildId, accountId).changes > 0
      if (!removed) this.db.prepare('INSERT INTO shared_build_likes (build_id, account_id, created_at) VALUES (?,?,?)').run(buildId, accountId, this.now())
      const likes = (this.db.prepare('SELECT COUNT(*) AS count FROM shared_build_likes WHERE build_id = ?').get(buildId) as { count: number }).count
      return { likes, liked: !removed }
    })
  }

  /** The author or the owner (`anyone`) removes a build; false when there is none they may remove. */
  remove(accountId: string, buildId: string, anyone = false): boolean {
    return transaction(this.db, () => {
      const build = this.db.prepare('SELECT account_id FROM shared_builds WHERE id = ?').get(buildId) as { account_id: string } | undefined
      if (!build || (!anyone && build.account_id !== accountId)) return false
      this.db.prepare('DELETE FROM shared_build_likes WHERE build_id = ?').run(buildId)
      this.db.prepare('DELETE FROM shared_builds WHERE id = ?').run(buildId)
      return true
    })
  }
}

function toBuild(row: Row, viewer: string): SharedBuild {
  return {
    id: row.id,
    mode: row.mode as BuildMode,
    weaponId: row.weapon_id,
    name: row.name,
    code: row.code,
    ...(row.author ? { author: row.author } : {}),
    likes: Number(row.likes),
    liked: Boolean(row.liked),
    mine: row.account_id === viewer,
    createdAt: new Date(Number(row.created_at)).toISOString(),
  }
}
