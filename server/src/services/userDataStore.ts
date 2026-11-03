import type { DatabaseSync } from 'node:sqlite'
import type { RaidMode } from '../models/api.js'

export interface StoredPosition {
  x: number
  y: number
  z: number
  yaw: number
  /** Client capture time (epoch ms). */
  at: number
  map?: string
  /** Server receive time, ISO 8601. */
  receivedAt: string
}

export interface CollectorState { itemIds: string[]; updatedAt: string | null }
/** «Убежище»: item id → pieces the player marked as found for the hideout. */
export interface HideoutState { found: Record<string, number>; updatedAt: string | null }
/**
 * Item counts per account and mode besides the hideout's (owner, 31.10.2026): 'quests' — pieces the player put aside for
 * the quests («Квесты» next to «Убежище»); 'stash' — what the last screen scan saw in the stash, for «Не нужны».
 */
export type ItemCountKind = 'quests' | 'stash'
export interface SettingsState { settings: Record<string, unknown>; updatedAt: string | null }
/**
 * The quest decisions of the account's PC as it shows them (src/sync/questMirror.ts), per mode: the phone shows the same.
 * `at`: when the PC made the copy; `records`: task id → record, already checked by the route.
 */
/** The mode the game is in on the account's PC (its logs tell), for the phone to follow (owner, 20.10.2026). */
export interface GameModeState { mode: RaidMode; at: string; receivedAt: string }

export interface QuestMirrorState { at: string; records: Record<string, unknown>; profile?: Record<string, unknown>; receivedAt: string }

/** A mode's level as the account's own desktop app knows it (PUT /v1/me/levels); friends see it in «Информация о друге». */
export interface SharedLevel {
  level: number
  /** null: the app does not know it (no Tarkov.dev profile of this mode); friends then see no prestige badge. */
  prestige: number | null
  /** When the level was true: the game's screen or the Tarkov.dev profile behind it (ISO 8601). */
  observedAt: string
  /** Server receive time, ISO 8601. */
  receivedAt: string
}
export type SharedLevels = Partial<Record<RaidMode, SharedLevel>>

type Row = Record<string, unknown>

/**
 * Small per-user documents: the Collector checklist, the latest position and the level the desktop app shared (per mode)
 * and the app settings blob. Only the latest position per user and mode is kept; nothing else about the raid is stored.
 */
export class UserDataStore {
  constructor(private readonly db: DatabaseSync) {
    db.exec(`CREATE TABLE IF NOT EXISTS user_collector (
        account_id TEXT NOT NULL, mode TEXT NOT NULL CHECK (mode IN ('pvp','pve','seasonal')),
        item_ids TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(account_id, mode));
      CREATE TABLE IF NOT EXISTS user_hideout (
        account_id TEXT NOT NULL, mode TEXT NOT NULL CHECK (mode IN ('pvp','pve','seasonal')),
        found TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(account_id, mode));
      CREATE TABLE IF NOT EXISTS user_item_counts (
        account_id TEXT NOT NULL, mode TEXT NOT NULL CHECK (mode IN ('pvp','pve','seasonal')), kind TEXT NOT NULL CHECK (kind IN ('quests','stash')),
        found TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(account_id, mode, kind));
      CREATE TABLE IF NOT EXISTS user_quest_mirror (
        account_id TEXT NOT NULL, mode TEXT NOT NULL CHECK (mode IN ('pvp','pve','seasonal')),
        records TEXT NOT NULL, at TEXT NOT NULL, received_at TEXT NOT NULL, PRIMARY KEY(account_id, mode));
      CREATE TABLE IF NOT EXISTS user_positions (
        account_id TEXT NOT NULL, mode TEXT NOT NULL CHECK (mode IN ('pvp','pve','seasonal')),
        x REAL NOT NULL, y REAL NOT NULL, z REAL NOT NULL, yaw REAL NOT NULL, at INTEGER NOT NULL,
        map TEXT, received_at TEXT NOT NULL, PRIMARY KEY(account_id, mode));
      CREATE TABLE IF NOT EXISTS user_settings (
        account_id TEXT PRIMARY KEY, settings TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS user_levels (
        account_id TEXT NOT NULL, mode TEXT NOT NULL CHECK (mode IN ('pvp','pve','seasonal')),
        level INTEGER NOT NULL, prestige INTEGER, observed_at TEXT NOT NULL, received_at TEXT NOT NULL,
        PRIMARY KEY(account_id, mode));`)
    db.exec(`CREATE TABLE IF NOT EXISTS user_game_mode (
        account_id TEXT PRIMARY KEY, mode TEXT NOT NULL CHECK (mode IN ('pvp','pve','seasonal')), at TEXT NOT NULL, received_at TEXT NOT NULL)`)
    // 0.6.0.77: the copy carries the level, faction, prestige and tracked quests too (a table of 0.6.0.75 has no column).
    const columns = db.prepare('PRAGMA table_info(user_quest_mirror)').all() as Array<{ name: string }>
    if (!columns.some((column) => column.name === 'profile')) db.exec('ALTER TABLE user_quest_mirror ADD COLUMN profile TEXT')
  }

  /** The database these documents live in (objective progress is stored next to them). */
  get database() { return this.db }

  getCollector(accountId: string, mode: RaidMode): CollectorState {
    const row = this.db.prepare('SELECT item_ids, updated_at FROM user_collector WHERE account_id=? AND mode=?').get(accountId, mode) as Row | undefined
    if (!row) return { itemIds: [], updatedAt: null }
    return { itemIds: parseStringArray(row.item_ids), updatedAt: String(row.updated_at) }
  }

  setCollector(accountId: string, mode: RaidMode, itemIds: string[]): CollectorState {
    const unique = [...new Set(itemIds)]
    const updatedAt = new Date().toISOString()
    this.db.prepare(`INSERT INTO user_collector (account_id, mode, item_ids, updated_at) VALUES (?,?,?,?)
      ON CONFLICT(account_id, mode) DO UPDATE SET item_ids=excluded.item_ids, updated_at=excluded.updated_at`).run(accountId, mode, JSON.stringify(unique), updatedAt)
    return { itemIds: unique, updatedAt }
  }

  getHideout(accountId: string, mode: RaidMode): HideoutState {
    const row = this.db.prepare('SELECT found, updated_at FROM user_hideout WHERE account_id=? AND mode=?').get(accountId, mode) as Row | undefined
    if (!row) return { found: {}, updatedAt: null }
    return { found: parseCounts(row.found), updatedAt: String(row.updated_at) }
  }

  setHideout(accountId: string, mode: RaidMode, found: Record<string, number>): HideoutState {
    const kept = Object.fromEntries(Object.entries(found).filter(([, count]) => Number.isInteger(count) && count > 0))
    const updatedAt = new Date().toISOString()
    this.db.prepare(`INSERT INTO user_hideout (account_id, mode, found, updated_at) VALUES (?,?,?,?)
      ON CONFLICT(account_id, mode) DO UPDATE SET found=excluded.found, updated_at=excluded.updated_at`).run(accountId, mode, JSON.stringify(kept), updatedAt)
    return { found: kept, updatedAt }
  }

  getItemCounts(accountId: string, mode: RaidMode, kind: ItemCountKind): HideoutState {
    const row = this.db.prepare('SELECT found, updated_at FROM user_item_counts WHERE account_id=? AND mode=? AND kind=?').get(accountId, mode, kind) as Row | undefined
    if (!row) return { found: {}, updatedAt: null }
    return { found: parseCounts(row.found), updatedAt: String(row.updated_at) }
  }

  setItemCounts(accountId: string, mode: RaidMode, kind: ItemCountKind, found: Record<string, number>): HideoutState {
    const kept = Object.fromEntries(Object.entries(found).filter(([, count]) => Number.isInteger(count) && count > 0))
    const updatedAt = new Date().toISOString()
    this.db.prepare(`INSERT INTO user_item_counts (account_id, mode, kind, found, updated_at) VALUES (?,?,?,?,?)
      ON CONFLICT(account_id, mode, kind) DO UPDATE SET found=excluded.found, updated_at=excluded.updated_at`).run(accountId, mode, kind, JSON.stringify(kept), updatedAt)
    return { found: kept, updatedAt }
  }

  getQuestMirror(accountId: string, mode: RaidMode): QuestMirrorState | null {
    const row = this.db.prepare('SELECT records, profile, at, received_at FROM user_quest_mirror WHERE account_id=? AND mode=?').get(accountId, mode) as Row | undefined
    if (!row) return null
    const object = (value: unknown): Record<string, unknown> | undefined => {
      try {
        const parsed = JSON.parse(String(value)) as unknown
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined
      } catch { return undefined }
    }
    // a broken row reads as an empty copy
    const profile = row.profile == null ? undefined : object(row.profile)
    return { at: String(row.at), records: object(row.records) ?? {}, ...(profile ? { profile } : {}), receivedAt: String(row.received_at) }
  }

  getGameMode(accountId: string): GameModeState | null {
    const row = this.db.prepare('SELECT mode, at, received_at FROM user_game_mode WHERE account_id=?').get(accountId) as Row | undefined
    return row ? { mode: String(row.mode) as RaidMode, at: String(row.at), receivedAt: String(row.received_at) } : null
  }

  /** A newer switch replaces the kept one; one told late (an older time) changes nothing. */
  setGameMode(accountId: string, mode: RaidMode, at: string): GameModeState {
    const kept = this.getGameMode(accountId)
    if (kept && kept.at >= at) return kept
    const receivedAt = new Date().toISOString()
    this.db.prepare(`INSERT INTO user_game_mode (account_id, mode, at, received_at) VALUES (?,?,?,?)
      ON CONFLICT(account_id) DO UPDATE SET mode=excluded.mode, at=excluded.at, received_at=excluded.received_at`).run(accountId, mode, at, receivedAt)
    return { mode, at, receivedAt }
  }

  /** The PC's newer copy replaces the kept one; an older one (sent late) changes nothing. */
  setQuestMirror(accountId: string, mode: RaidMode, at: string, records: Record<string, unknown>, profile?: Record<string, unknown>): QuestMirrorState {
    const kept = this.getQuestMirror(accountId, mode)
    if (kept && kept.at > at) return kept
    const receivedAt = new Date().toISOString()
    this.db.prepare(`INSERT INTO user_quest_mirror (account_id, mode, records, profile, at, received_at) VALUES (?,?,?,?,?,?)
      ON CONFLICT(account_id, mode) DO UPDATE SET records=excluded.records, profile=excluded.profile, at=excluded.at, received_at=excluded.received_at`)
      .run(accountId, mode, JSON.stringify(records), profile ? JSON.stringify(profile) : null, at, receivedAt)
    return { at, records, ...(profile ? { profile } : {}), receivedAt }
  }

  /**
   * A reset of the whole mode (POST /v1/me/progress/:mode/reset): the Collector checklist and the shared level of that
   * mode, when they are older than `at` (a list ticked after the reset stays). Other modes are not touched.
   */
  clearModeBefore(accountId: string, mode: RaidMode, at: string) {
    this.db.prepare('DELETE FROM user_collector WHERE account_id=? AND mode=? AND updated_at < ?').run(accountId, mode, at)
    this.db.prepare('DELETE FROM user_hideout WHERE account_id=? AND mode=? AND updated_at < ?').run(accountId, mode, at)
    this.db.prepare('DELETE FROM user_item_counts WHERE account_id=? AND mode=? AND updated_at < ?').run(accountId, mode, at)
    this.db.prepare('DELETE FROM user_quest_mirror WHERE account_id=? AND mode=? AND at < ?').run(accountId, mode, at)
    this.db.prepare('DELETE FROM user_levels WHERE account_id=? AND mode=? AND observed_at < ?').run(accountId, mode, at)
  }

  getPosition(accountId: string, mode: RaidMode): StoredPosition | null {
    const row = this.db.prepare('SELECT x, y, z, yaw, at, map, received_at FROM user_positions WHERE account_id=? AND mode=?').get(accountId, mode) as Row | undefined
    if (!row) return null
    return {
      x: Number(row.x), y: Number(row.y), z: Number(row.z), yaw: Number(row.yaw), at: Number(row.at),
      ...(row.map == null ? {} : { map: String(row.map) }), receivedAt: String(row.received_at),
    }
  }

  setPosition(accountId: string, mode: RaidMode, position: Omit<StoredPosition, 'receivedAt'>): StoredPosition {
    const receivedAt = new Date().toISOString()
    this.db.prepare(`INSERT INTO user_positions (account_id, mode, x, y, z, yaw, at, map, received_at) VALUES (?,?,?,?,?,?,?,?,?)
      ON CONFLICT(account_id, mode) DO UPDATE SET x=excluded.x, y=excluded.y, z=excluded.z, yaw=excluded.yaw, at=excluded.at, map=excluded.map, received_at=excluded.received_at`)
      .run(accountId, mode, position.x, position.y, position.z, position.yaw, position.at, position.map ?? null, receivedAt)
    return { ...position, receivedAt }
  }

  getSettings(accountId: string): SettingsState {
    const row = this.db.prepare('SELECT settings, updated_at FROM user_settings WHERE account_id=?').get(accountId) as Row | undefined
    if (!row) return { settings: {}, updatedAt: null }
    try {
      const parsed = JSON.parse(String(row.settings)) as unknown
      return { settings: parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}, updatedAt: String(row.updated_at) }
    } catch {
      return { settings: {}, updatedAt: String(row.updated_at) }
    }
  }

  setSettings(accountId: string, settings: Record<string, unknown>): SettingsState {
    const updatedAt = new Date().toISOString()
    this.db.prepare(`INSERT INTO user_settings (account_id, settings, updated_at) VALUES (?,?,?)
      ON CONFLICT(account_id) DO UPDATE SET settings=excluded.settings, updated_at=excluded.updated_at`).run(accountId, JSON.stringify(settings), updatedAt)
    return { settings, updatedAt }
  }

  /** The levels the account's desktop app shared, per mode; a mode it never shared is absent. */
  getLevels(accountId: string): SharedLevels {
    const rows = this.db.prepare('SELECT mode, level, prestige, observed_at, received_at FROM user_levels WHERE account_id=?').all(accountId) as Row[]
    const levels: SharedLevels = {}
    for (const row of rows) {
      levels[String(row.mode) as RaidMode] = {
        level: Number(row.level), prestige: row.prestige == null ? null : Number(row.prestige),
        observedAt: String(row.observed_at), receivedAt: String(row.received_at),
      }
    }
    return levels
  }

  /**
   * Each mode sent replaces that mode's level as it is: the app has already weighed the game's screen against Tarkov.dev
   * (a misread level is corrected by an older but right one). Modes not sent keep theirs. Returns every mode stored.
   */
  setLevels(accountId: string, levels: Partial<Record<RaidMode, Omit<SharedLevel, 'receivedAt'>>>): SharedLevels {
    const receivedAt = new Date().toISOString()
    const upsert = this.db.prepare(`INSERT INTO user_levels (account_id, mode, level, prestige, observed_at, received_at) VALUES (?,?,?,?,?,?)
      ON CONFLICT(account_id, mode) DO UPDATE SET level=excluded.level, prestige=excluded.prestige, observed_at=excluded.observed_at, received_at=excluded.received_at`)
    for (const [mode, entry] of Object.entries(levels)) {
      if (entry) upsert.run(accountId, mode, entry.level, entry.prestige, entry.observedAt, receivedAt)
    }
    return this.getLevels(accountId)
  }
}

function parseStringArray(raw: unknown): string[] {
  try {
    const parsed = JSON.parse(String(raw)) as unknown
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : []
  } catch {
    return []
  }
}

function parseCounts(value: unknown): Record<string, number> {
  try {
    const parsed = JSON.parse(String(value)) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, number] => Number.isInteger(entry[1]) && (entry[1] as number) > 0))
  } catch {
    return {}
  }
}
