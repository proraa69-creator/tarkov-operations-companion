/** Goons (Кочевники) sightings reported by app users. PvP, PvE and Seasonal are always kept apart. */
export const GOON_MAP_IDS = ['customs', 'woods', 'shoreline', 'lighthouse'] as const
export const GOON_MODES = ['pvp', 'pve', 'seasonal'] as const
export type GoonMapId = typeof GOON_MAP_IDS[number]
export type GoonMode = typeof GOON_MODES[number]

export interface GoonSighting {
  mapId: GoonMapId
  mode: GoonMode
  /** Server time, ISO 8601. */
  reportedAt: string
  /** Opaque reporter key (hashed client address). Never returned by the API. */
  reporter: string
}

export interface GoonMapStat { mapId: GoonMapId; count: number; lastAt: string }
export interface GoonSnapshot { latest: { mapId: GoonMapId; reportedAt: string } | null; last5h: GoonMapStat[] }

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

/** Latest sighting ever kept (24 h) plus per-map counts for the last 5 hours, most reported first. */
export function summarizeGoons(store: GoonStore, mode: GoonMode, nowMs: number): GoonSnapshot {
  const day = store.list(mode, nowMs - GOON_RETENTION_MS)
  const latest = day[0] ? { mapId: day[0].mapId, reportedAt: day[0].reportedAt } : null
  const stats = new Map<GoonMapId, GoonMapStat>()
  for (const entry of day) {
    if (Date.parse(entry.reportedAt) < nowMs - GOON_STATS_WINDOW_MS) break
    const current = stats.get(entry.mapId)
    if (current) current.count += 1
    else stats.set(entry.mapId, { mapId: entry.mapId, count: 1, lastAt: entry.reportedAt })
  }
  const last5h = [...stats.values()].sort((a, b) => b.count - a.count || b.lastAt.localeCompare(a.lastAt))
  return { latest, last5h }
}
