import type { DatabaseSync } from 'node:sqlite'

const DAY_MS = 24 * 60 * 60 * 1000
const MSK_MS = 3 * 60 * 60 * 1000
export const ONLINE_WINDOW_MS = 10 * 60 * 1000
export const ONLINE_SAMPLE_MS = 60 * 1000
const RETENTION_DAYS = 400

type Row = Record<string, unknown>

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS online_daily_stats (
    day TEXT PRIMARY KEY,
    min_online INTEGER NOT NULL,
    max_online INTEGER NOT NULL,
    sum_online INTEGER NOT NULL,
    samples INTEGER NOT NULL,
    last_sample_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS online_daily_users (
    day TEXT NOT NULL,
    account_id TEXT NOT NULL,
    PRIMARY KEY (day, account_id));
  CREATE INDEX IF NOT EXISTS online_daily_users_day ON online_daily_users(day);
`

const mskDay = (time: number) => new Date(time + MSK_MS).toISOString().slice(0, 10)

export interface OnlineDayStats {
  date: string
  users: number
  minimum: number
  maximum: number
  average: number
  samples: number
}

/** Server-side online counters. "Online" means an authenticated request during the last ten minutes. */
export class OnlineStatsStore {
  private readonly db: DatabaseSync
  private readonly now: () => number

  constructor(db: DatabaseSync, options: { now?: () => number } = {}) {
    this.db = db
    this.now = options.now ?? Date.now
    this.db.exec(SCHEMA)
  }

  current(at = this.now()) {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM accounts WHERE deleted_at IS NULL AND blocked_at IS NULL AND last_seen_at >= ?").get(at - ONLINE_WINDOW_MS) as Row
    return Number(row.n ?? 0)
  }

  /** One sample per minute, even if more than one server process asks during that minute. */
  sample(at = this.now()) {
    const minute = Math.floor(at / ONLINE_SAMPLE_MS) * ONLINE_SAMPLE_MS
    const day = mskDay(minute)
    const existing = this.db.prepare('SELECT last_sample_at FROM online_daily_stats WHERE day = ?').get(day) as Row | undefined
    if (existing && Number(existing.last_sample_at) >= minute) return this.current(at)
    const cutoff = at - ONLINE_WINDOW_MS
    const active = this.db.prepare("SELECT id FROM accounts WHERE deleted_at IS NULL AND blocked_at IS NULL AND last_seen_at >= ?").all(cutoff) as Row[]
    const online = active.length
    this.db.prepare(`INSERT INTO online_daily_stats (day, min_online, max_online, sum_online, samples, last_sample_at)
      VALUES (?, ?, ?, ?, 1, ?)
      ON CONFLICT(day) DO UPDATE SET
        min_online = MIN(min_online, excluded.min_online),
        max_online = MAX(max_online, excluded.max_online),
        sum_online = sum_online + excluded.sum_online,
        samples = samples + 1,
        last_sample_at = excluded.last_sample_at`).run(day, online, online, online, minute)
    const remember = this.db.prepare('INSERT OR IGNORE INTO online_daily_users (day, account_id) VALUES (?, ?)')
    for (const row of active) remember.run(day, String(row.id))
    const cutoffDay = mskDay(at - RETENTION_DAYS * DAY_MS)
    this.db.prepare('DELETE FROM online_daily_users WHERE day < ?').run(cutoffDay)
    this.db.prepare('DELETE FROM online_daily_stats WHERE day < ?').run(cutoffDay)
    return online
  }

  summary(days = 30) {
    const at = this.now()
    const current = this.sample(at)
    const rows = this.db.prepare(`SELECT s.day, s.min_online, s.max_online, s.sum_online, s.samples,
      (SELECT COUNT(*) FROM online_daily_users u WHERE u.day = s.day) AS users
      FROM online_daily_stats s ORDER BY s.day DESC LIMIT ?`).all(days) as Row[]
    const history: OnlineDayStats[] = rows.map((row) => ({
      date: String(row.day),
      users: Number(row.users ?? 0),
      minimum: Number(row.min_online ?? 0),
      maximum: Number(row.max_online ?? 0),
      average: Number((Number(row.sum_online ?? 0) / Math.max(1, Number(row.samples ?? 0))).toFixed(1)),
      samples: Number(row.samples ?? 0),
    }))
    return { generatedAt: new Date(at).toISOString(), windowMinutes: ONLINE_WINDOW_MS / 60_000, current, today: history.find((row) => row.date === mskDay(at)) ?? null, history }
  }
}
