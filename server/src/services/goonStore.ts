/** Goons (Кочевники) sightings reported by app users. PvP, PvE and Seasonal are always kept apart. */
import type { DatabaseSync } from 'node:sqlite'
export const GOON_MAP_IDS = ['customs', 'woods', 'shoreline', 'lighthouse'] as const
export const GOON_MODES = ['pvp', 'pve', 'seasonal'] as const
export type GoonMapId = typeof GOON_MAP_IDS[number]
export type GoonMode = typeof GOON_MODES[number]

export interface GoonSighting {
  mapId: GoonMapId
  mode: GoonMode
  /** Server time, ISO 8601. */
  reportedAt: string
  /** Opaque reporter key (hashed account id, or hashed client address for anonymous reports). Never returned by the API. */
  reporter: string
  /** The reporter's Escape from Tarkov nickname for this mode, from his account (shown to everybody). */
  nickname?: string
}

/** A sighting as everybody sees it: where, when, who saw it. */
export interface GoonSightingView { mapId: GoonMapId; reportedAt: string; nickname?: string }

export interface GoonMapStat { mapId: GoonMapId; count: number; lastAt: string }
export interface GoonSnapshot { latest: GoonSightingView | null; last5h: GoonMapStat[]; recent: GoonSightingView[] }
/** How many of the newest sightings (last 5 hours) the snapshot lists with their nicknames. */
export const GOON_RECENT_LIMIT = 8

/** Storage contract so the in-memory store can later be swapped for SQLite/Redis without touching the routes. */
export interface GoonStore {
  add(sighting: GoonSighting): void
  /** Sightings of one mode reported at or after `sinceMs`, newest first. */
  list(mode: GoonMode, sinceMs: number): GoonSighting[]
  /** Newest sighting of this reporter in any mode (rate limiting). */
  lastByReporter(reporter: string): GoonSighting | undefined
  /** Newest sighting of this reporter for one mode and map (dedupe). */
  lastByReporterOnMap(reporter: string, mode: GoonMode, mapId: GoonMapId): GoonSighting | undefined
  /** Removes everything reported before `beforeMs`. */
  prune(beforeMs: number): void
}

export const GOON_RETENTION_MS = 24 * 60 * 60 * 1000
export const GOON_STATS_WINDOW_MS = 5 * 60 * 60 * 1000

export class MemoryGoonStore implements GoonStore {
  /** Kept sorted oldest → newest because entries are appended with server time. */
  private sightings: GoonSighting[] = []
  constructor(private readonly maxEntries = 50_000) {}

  add(sighting: GoonSighting) {
    this.sightings.push(sighting)
    if (this.sightings.length > this.maxEntries) this.sightings.splice(0, this.sightings.length - this.maxEntries)
  }

  list(mode: GoonMode, sinceMs: number) {
    const result: GoonSighting[] = []
    for (let index = this.sightings.length - 1; index >= 0; index -= 1) {
      const entry = this.sightings[index]
      if (Date.parse(entry.reportedAt) < sinceMs) break
      if (entry.mode === mode) result.push(entry)
    }
    return result
  }

  lastByReporter(reporter: string) {
    return this.sightings.findLast((entry) => entry.reporter === reporter)
  }

  lastByReporterOnMap(reporter: string, mode: GoonMode, mapId: GoonMapId) {
    return this.sightings.findLast((entry) => entry.reporter === reporter && entry.mode === mode && entry.mapId === mapId)
  }

  prune(beforeMs: number) {
    const firstKept = this.sightings.findIndex((entry) => Date.parse(entry.reportedAt) >= beforeMs)
    this.sightings = firstKept === -1 ? [] : this.sightings.slice(firstKept)
  }
}

type Row = Record<string, unknown>
const toSighting = (row: Row | undefined): GoonSighting | undefined => row
  ? { mapId: row.map_id as GoonMapId, mode: row.mode as GoonMode, reportedAt: String(row.reported_at), reporter: String(row.reporter),
    ...(typeof row.nickname === 'string' && row.nickname ? { nickname: row.nickname } : {}) }
  : undefined

/**
 * Persistent store in the shared SQLite database, so sightings survive a server restart.
 * `reported_at` is an ISO string in UTC with fixed width, so text order equals time order.
 */
export class SqliteGoonStore implements GoonStore {
  constructor(private readonly db: DatabaseSync) {
    db.exec(`CREATE TABLE IF NOT EXISTS goon_sightings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mode TEXT NOT NULL CHECK (mode IN ('pvp','pve','seasonal')),
        map_id TEXT NOT NULL,
        reported_at TEXT NOT NULL,
        reporter TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS goon_sightings_mode ON goon_sightings(mode, reported_at);
      CREATE INDEX IF NOT EXISTS goon_sightings_reporter ON goon_sightings(reporter, reported_at);`)
    // Older databases: the nickname of the reporter (the column is added once, existing rows stay anonymous).
    const columns = db.prepare('PRAGMA table_info(goon_sightings)').all() as Array<{ name?: unknown }>
    if (!columns.some((column) => column.name === 'nickname')) db.exec('ALTER TABLE goon_sightings ADD COLUMN nickname TEXT')
  }

  add(sighting: GoonSighting) {
    this.db.prepare('INSERT INTO goon_sightings (mode, map_id, reported_at, reporter, nickname) VALUES (?, ?, ?, ?, ?)')
      .run(sighting.mode, sighting.mapId, sighting.reportedAt, sighting.reporter, sighting.nickname ?? null)
  }

  list(mode: GoonMode, sinceMs: number) {
    const rows = this.db.prepare('SELECT * FROM goon_sightings WHERE mode = ? AND reported_at >= ? ORDER BY reported_at DESC, id DESC LIMIT 50000')
      .all(mode, new Date(sinceMs).toISOString()) as Row[]
    return rows.map((row) => toSighting(row)!)
  }

  lastByReporter(reporter: string) {
    return toSighting(this.db.prepare('SELECT * FROM goon_sightings WHERE reporter = ? ORDER BY reported_at DESC, id DESC LIMIT 1').get(reporter) as Row | undefined)
  }

  lastByReporterOnMap(reporter: string, mode: GoonMode, mapId: GoonMapId) {
    return toSighting(this.db.prepare('SELECT * FROM goon_sightings WHERE reporter = ? AND mode = ? AND map_id = ? ORDER BY reported_at DESC, id DESC LIMIT 1').get(reporter, mode, mapId) as Row | undefined)
  }

  prune(beforeMs: number) {
    this.db.prepare('DELETE FROM goon_sightings WHERE reported_at < ?').run(new Date(beforeMs).toISOString())
  }
}

const viewOf = (entry: GoonSighting): GoonSightingView => ({ mapId: entry.mapId, reportedAt: entry.reportedAt, ...(entry.nickname ? { nickname: entry.nickname } : {}) })

/**
 * Latest sighting ever kept (24 h), per-map counts for the last 5 hours (most reported first) and the newest sightings
 * of those 5 hours with the nickname of who saw them.
 */
export function summarizeGoons(store: GoonStore, mode: GoonMode, nowMs: number): GoonSnapshot {
  const day = store.list(mode, nowMs - GOON_RETENTION_MS)
  const latest = day[0] ? viewOf(day[0]) : null
  const recent = day.filter((entry) => Date.parse(entry.reportedAt) >= nowMs - GOON_STATS_WINDOW_MS).slice(0, GOON_RECENT_LIMIT).map(viewOf)
  const stats = new Map<GoonMapId, GoonMapStat>()
  for (const entry of day) {
    if (Date.parse(entry.reportedAt) < nowMs - GOON_STATS_WINDOW_MS) break
    const current = stats.get(entry.mapId)
    if (current) current.count += 1
    else stats.set(entry.mapId, { mapId: entry.mapId, count: 1, lastAt: entry.reportedAt })
  }
  const last5h = [...stats.values()].sort((a, b) => b.count - a.count || b.lastAt.localeCompare(a.lastAt))
  return { latest, last5h, recent }
}
