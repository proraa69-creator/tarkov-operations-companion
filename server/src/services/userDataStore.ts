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
export interface SettingsState { settings: Record<string, unknown>; updatedAt: string | null }

type Row = Record<string, unknown>

/**
 * Small per-user documents: the Collector checklist and the latest position (per mode) and the app settings blob.
 * Only the latest position per user and mode is kept; nothing else about the raid is stored.
 */
export class UserDataStore {
  constructor(private readonly db: DatabaseSync) {
    db.exec(`CREATE TABLE IF NOT EXISTS user_collector (
        account_id TEXT NOT NULL, mode TEXT NOT NULL CHECK (mode IN ('pvp','pve','seasonal')),
        item_ids TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(account_id, mode));
      CREATE TABLE IF NOT EXISTS user_positions (
        account_id TEXT NOT NULL, mode TEXT NOT NULL CHECK (mode IN ('pvp','pve','seasonal')),
        x REAL NOT NULL, y REAL NOT NULL, z REAL NOT NULL, yaw REAL NOT NULL, at INTEGER NOT NULL,
        map TEXT, received_at TEXT NOT NULL, PRIMARY KEY(account_id, mode));
      CREATE TABLE IF NOT EXISTS user_settings (
        account_id TEXT PRIMARY KEY, settings TEXT NOT NULL, updated_at TEXT NOT NULL);`)
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
}

function parseStringArray(raw: unknown): string[] {
  try {
    const parsed = JSON.parse(String(raw)) as unknown
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : []
  } catch {
    return []
  }
}
