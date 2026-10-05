/**
 * «Страж сервера», part 1: the request guard (docs/server-guard.md). Watches every request per visitor address (req.ip:
 * the visitor behind the site proxy / Cloudflare tunnel, see `trust proxy` in app.ts) and scores what only attackers
 * and scanners do: probing for /.env, /wp-admin, /.git, *.php…, path traversal, SQL / script injection markers, bursts
 * of 401/403/404/429, failed sign-ins over many e-mails (credential stuffing), Lava webhook key failures and oversized
 * bodies. An address that collects BAN_SCORE points within WINDOW_MS is banned for 15 min → 1 h → 24 h (escalating
 * over 7 days); a banned address gets a cheap 403 before any parsing.
 *
 * Never banned: loopback (this PC, also the owner's own browser through the site server), direct local requests and the
 * allowlist (TARKOV_GUARD_ALLOWLIST and the admin panel). A request with the owner's session passes a ban as well, so the
 * owner can always lift one from the website.
 *
 * Stored in SQLite (tables are created IF NOT EXISTS; nothing else is touched): masked address (203.0.113.*), a salted
 * hash of the address for matching, path without the query, reason, count and time. Never bodies, query strings,
 * e-mails, passwords or tokens. Events and old bans are kept 30 days.
 */
import { createHash, randomBytes } from 'node:crypto'
import { isIP } from 'node:net'
import type { DatabaseSync } from 'node:sqlite'
import type { Request, RequestHandler } from 'express'

export type GuardReason =
  | 'scanner' | 'traversal' | 'injection' | 'not-found' | 'auth-fail' | 'rate-limited' | 'login-fail'
  | 'credential-stuffing' | 'webhook-signature' | 'oversized'

export const GUARD_REASONS: GuardReason[] = ['scanner', 'traversal', 'injection', 'not-found', 'auth-fail', 'rate-limited', 'login-fail', 'credential-stuffing', 'webhook-signature', 'oversized']

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** Sliding window of the per-address score. */
export const WINDOW_MS = 10 * MINUTE
/** Points within WINDOW_MS that ban an address. */
export const BAN_SCORE = 100
/** Escalation: first ban, second within ESCALATION_MS, third and later. */
export const BAN_STEPS_MS = [15 * MINUTE, HOUR, DAY]
export const ESCALATION_MS = 7 * DAY
export const RETENTION_MS = 30 * DAY

/**
 * Points per signal. `free`: how many of that kind within the window cost nothing — normal clients do get a few 401s
 * (an expired session), 404s (an unknown streamer code) and 429s (a fast double click).
 */
export const SIGNAL_RULES: Record<GuardReason, { points: number; free: number }> = {
  scanner: { points: 35, free: 0 },
  traversal: { points: 50, free: 0 },
  injection: { points: 35, free: 0 },
  'not-found': { points: 4, free: 30 },
  'auth-fail': { points: 5, free: 20 },
  'rate-limited': { points: 3, free: 30 },
  'login-fail': { points: 10, free: 8 },
  'credential-stuffing': { points: BAN_SCORE, free: 0 },
  'webhook-signature': { points: 20, free: 0 },
  oversized: { points: 25, free: 0 },
}
/** Different e-mails with failed sign-ins from one address within CREDENTIAL_WINDOW_MS = credential stuffing. */
export const CREDENTIAL_EMAILS = 6
export const CREDENTIAL_WINDOW_MS = 15 * MINUTE

// ---------------------------------------------------------------------------------------------------------------
// Heuristics (pure, unit-tested against every real API path in serverGuard.test.ts)

/**
 * Paths only vulnerability scanners ask for. The API itself serves /health and /v1/* only, and no real path segment
 * starts with a dot or ends in a file extension (streamer codes and ids are [A-Za-z0-9_-]).
 */
const SCANNER_PATTERNS = [
  /(?:^|\/)\.(?!well-known(?:\/|$))[^/]*(?:\/|$)/i, // dotfiles and dot-folders: /.env, /.git/config, /.aws/credentials, /.DS_Store
  /\.(?:php\d?|phtml|asp|aspx|jsp|cgi|pl|env|ini|bak|old|sql|sqlite|swp|yml|yaml|conf|config|log)(?:\/|$)/i,
]
/** Well-known scanner targets; only outside /v1/ (a streamer code like SHELL in /v1/…/streamers/SHELL is fine). */
const SCANNER_ROOTS = [
  /(?:^|\/)(?:wp-admin|wp-login|wp-content|wp-includes|wp-json|xmlrpc|wordpress|phpmyadmin|phpMyAdmin|pma|myadmin|mysqladmin|adminer|cgi-bin|boaform|hnap1|actuator|server-status|server-info|vendor\/phpunit|_ignition|telescope|solr|jenkins|manager\/html|owa|autodiscover|webdav|shell|setup\.cgi|druid|geoserver|remote\/login|global-protect|sslvpn|dana-na|cfide)(?:\/|$|\.)/i,
]

export function scannerPath(path: string) {
  if (SCANNER_PATTERNS.some((pattern) => pattern.test(path))) return true
  return !/^\/v1(?:\/|$)/i.test(path) && SCANNER_ROOTS.some((pattern) => pattern.test(path))
}

/** `..` segments, also percent-encoded (%2e%2e, %252e, overlong %c0%ae) and with backslashes. On the raw URL. */
export function traversalUrl(rawUrl: string) {
  const lower = rawUrl.toLowerCase()
  if (/(?:^|[/\\])\.\.(?:[/\\?#]|$)/.test(lower)) return true
  if (/%2e%2e|%252e|%c0%ae|%e0%80%ae|\.\.%2f|\.\.%5c|%2f\.\.|%5c\.\./.test(lower)) return true
  return /(?:^|=)\.\.[/\\]/.test(safeDecode(lower))
}

const INJECTION_PATTERNS = [
  /\bunion\b[\s/*+]{1,20}(?:all[\s/*+]+)?select\b/i,
  /\b(?:information_schema|sqlite_master|sqlite_schema|pg_catalog|pg_sleep|waitfor\s+delay|benchmark\s*\(|load_file\s*\(|into\s+outfile)\b/i,
  /['"]\s*(?:or|and)\s+['"]?\w+['"]?\s*(?:=|like)\s*['"]?\w+/i, // ' or '1'='1
  /;\s*(?:drop|truncate|alter)\s+table\b/i,
  /\bsleep\s*\(\s*\d+\s*\)/i,
  /<\s*script\b/i,
  /<[^>]{0,80}\bon(?:error|load|mouseover|focus)\s*=/i,
  /\bjavascript\s*:/i,
  /\$\{\s*(?:jndi|env|sys)\s*:/i,
  /\/etc\/(?:passwd|shadow)|\bwin\.ini\b|\/proc\/self\//i,
]

/** SQL / script / template injection markers in a piece of text (a query value, a body string). Conservative. */
export function injectionMarker(text: string) {
  if (text.length < 4) return false
  const decoded = safeDecode(text)
  return INJECTION_PATTERNS.some((pattern) => pattern.test(text) || (decoded !== text && pattern.test(decoded)))
}

/** Body fields that are free text by nature (passwords may contain anything); never scanned. */
const UNSCANNED_KEYS = /^(?:password|currentPassword|newPassword|token|code|signature|secret)$/i

/** Walks a JSON body (at most `budget` characters of strings) and reports the first injection marker. */
export function bodyInjection(body: unknown, budget = 16_384) {
  let left = budget
  const visit = (value: unknown, depth: number): boolean => {
    if (left <= 0 || depth > 6) return false
    if (typeof value === 'string') { left -= value.length; return injectionMarker(value.slice(0, 2048)) }
    if (Array.isArray(value)) return value.slice(0, 200).some((item) => visit(item, depth + 1))
    if (value && typeof value === 'object') return Object.entries(value as Record<string, unknown>).slice(0, 200).some(([key, item]) => !UNSCANNED_KEYS.test(key) && visit(item, depth + 1))
    return false
  }
  return visit(body, 0)
}

/** Paths whose 401 means «wrong password / code» (counted as failed sign-ins, not as an expired session). */
const LOGIN_PATHS = /^\/v1\/accounts\/(?:login|email\/login|phone\/login|login-codes\/redeem|register\/confirm|email\/reset|phone\/reset)\/?$/
export const isLoginPath = (path: string) => LOGIN_PATHS.test(path)
/** Personal documents (settings, Collector, notes): free text the user owns, never scanned for markers. */
const UNSCANNED_PATHS = /^\/v1\/me\//

function safeDecode(text: string) {
  try { return decodeURIComponent(text.replace(/\+/g, ' ')) } catch { return text }
}

const LOOPBACK = /^(?:127(?:\.\d{1,3}){3}|::1|0:0:0:0:0:0:0:1)$/

/** 127.0.0.1 for ::ffff:127.0.0.1; trims; empty for garbage. */
export function normalizeIp(raw: string | undefined) {
  const ip = (raw ?? '').trim().replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, '').toLowerCase()
  return isIP(ip) ? ip : ''
}

export function isLoopbackIp(ip: string) {
  return LOOPBACK.test(normalizeIp(ip))
}

/** 203.0.113.* / 2001:db8:85a3:* — what is shown and stored. */
export function maskIp(raw: string) {
  const ip = normalizeIp(raw)
  if (!ip) return 'неизвестно'
  if (isIP(ip) === 4) return ip.split('.').slice(0, 3).join('.') + '.*'
  const expanded = ip.includes('::') ? expandV6(ip) : ip.split(':')
  return `${expanded.slice(0, 3).join(':')}:*`
}

function expandV6(ip: string) {
  const [head, tail] = ip.split('::')
  const left = head ? head.split(':') : []
  const right = tail ? tail.split(':') : []
  return [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right]
}

/** Request made on this PC straight to the API port (as app.ts directLocalRequest). */
export function directLocal(req: Request) {
  if (req.get('x-forwarded-for') !== undefined || req.get('forwarded') !== undefined || req.get('cf-connecting-ip') !== undefined) return false
  return isLoopbackIp(req.socket.remoteAddress ?? '')
}

function cleanPath(path: string) {
  // eslint-disable-next-line no-control-regex -- control characters are exactly what is stripped
  return path.replace(/[\u0000-\u001f\u007f]/g, '?').slice(0, 160) || '/'
}

// ---------------------------------------------------------------------------------------------------------------

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS security_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS security_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bucket INTEGER NOT NULL,
    ip_key TEXT NOT NULL,
    ip_masked TEXT NOT NULL,
    reason TEXT NOT NULL,
    path TEXT NOT NULL,
    detail TEXT,
    count INTEGER NOT NULL,
    points INTEGER NOT NULL,
    first_at INTEGER NOT NULL,
    last_at INTEGER NOT NULL,
    UNIQUE (bucket, ip_key, reason, path));
  CREATE INDEX IF NOT EXISTS security_events_last ON security_events(last_at);
  CREATE TABLE IF NOT EXISTS security_bans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip_key TEXT NOT NULL,
    ip_masked TEXT NOT NULL,
    reason TEXT NOT NULL,
    level INTEGER NOT NULL,
    source TEXT NOT NULL,
    actor TEXT,
    created_at INTEGER NOT NULL,
    until INTEGER NOT NULL,
    lifted_at INTEGER,
    lifted_by TEXT);
  CREATE INDEX IF NOT EXISTS security_bans_key ON security_bans(ip_key, created_at);
  CREATE TABLE IF NOT EXISTS security_allowlist (
    ip_key TEXT PRIMARY KEY,
    ip_masked TEXT NOT NULL,
    note TEXT,
    actor TEXT,
    created_at INTEGER NOT NULL);
`

export interface SecurityEvent { id: number; at: string; firstAt: string; ip: string; reason: GuardReason; path: string; detail?: string; count: number; points: number }
export interface SecurityBan { id: number; ip: string; reason: string; level: number; source: 'auto' | 'manual'; actor?: string; createdAt: string; until: string; active: boolean; liftedAt?: string; liftedBy?: string }
export interface AllowEntry { key: string; ip: string; note?: string; createdAt: string; source: 'admin' | 'env' }
export interface SecuritySummary {
  activeBans: number
  bans24h: number
  bans1h: number
  /** Since this server process started (the watchdog compares it between checks). */
  bansSinceStart: number
  blockedSinceStart: number
  events1h: number
  events24h: number
  byReason24h: Partial<Record<GuardReason, number>>
  credentialStuffing1h: number
  lastBanAt?: string
}

interface Hit { at: number; reason: GuardReason; points: number }
interface IpState { hits: Hit[]; emails: Map<string, number>; stuffingAt: number }
interface ActiveBan { id: number; until: number }

export interface SecurityGuardOptions {
  now?: () => number
  /** Extra addresses that are never banned (TARKOV_GUARD_ALLOWLIST, comma separated). */
  allowlist?: string[]
  /** A request with the owner's session passes a ban. */
  ownerRequest?: (req: Request) => boolean
  /** Told about every new ban (the API log). */
  onBan?: (ban: SecurityBan) => void
}

export class SecurityGuard {
  readonly db: DatabaseSync
  private readonly now: () => number
  private readonly salt: string
  private readonly states = new Map<string, IpState>()
  private readonly bans = new Map<string, ActiveBan>()
  private readonly allowKeys = new Set<string>()
  private readonly envAllow: AllowEntry[] = []
  private readonly opts: SecurityGuardOptions
  private bansSinceStart = 0
  private blockedSinceStart = 0
  private lastPrune = 0

  constructor(db: DatabaseSync, options: SecurityGuardOptions = {}) {
    this.db = db
    this.opts = options
    this.now = options.now ?? Date.now
    db.exec(SCHEMA)
    const saved = db.prepare("SELECT value FROM security_meta WHERE key = 'salt'").get() as { value: string } | undefined
    this.salt = saved?.value ?? randomBytes(16).toString('hex')
    if (!saved) db.prepare("INSERT INTO security_meta (key, value) VALUES ('salt', ?)").run(this.salt)
    for (const raw of options.allowlist ?? []) {
      const ip = normalizeIp(raw)
      if (!ip) continue
      this.allowKeys.add(this.key(ip))
      this.envAllow.push({ key: this.key(ip), ip: maskIp(ip), createdAt: new Date(0).toISOString(), source: 'env' })
    }
    for (const row of db.prepare('SELECT ip_key FROM security_allowlist').all() as Array<{ ip_key: string }>) this.allowKeys.add(row.ip_key)
    for (const row of db.prepare('SELECT id, ip_key, until FROM security_bans WHERE lifted_at IS NULL AND until > ?').all(this.now()) as Array<{ id: number; ip_key: string; until: number }>) {
      this.bans.set(row.ip_key, { id: row.id, until: row.until })
    }
    this.prune()
  }

  /** Salted hash of the address: bans match on it, the address itself is never stored. */
  key(ip: string) {
    return createHash('sha256').update(`${this.salt}|${normalizeIp(ip) || ip}`).digest('hex').slice(0, 32)
  }

  /** Whether the address can never be banned. */
  exempt(ip: string) {
    const normal = normalizeIp(ip)
    return !normal || isLoopbackIp(normal) || this.allowKeys.has(this.key(normal))
  }

  /** The active ban of an address (expired ones are dropped here). */
  activeBan(ip: string) {
    const key = this.key(ip)
    const ban = this.bans.get(key)
    if (!ban) return undefined
    if (ban.until <= this.now()) { this.bans.delete(key); return undefined }
    return ban
  }

  /**
   * One signal from `ip`. Returns the points it cost (0 within the free allowance) and whether it banned the address.
   * Exempt addresses are never scored.
   */
  signal(ip: string, reason: GuardReason, path: string, detail?: string) {
    const normal = normalizeIp(ip)
    if (!normal || this.exempt(normal)) return { points: 0, banned: false }
    const now = this.now()
    const state = this.state(normal, now)
    const rule = SIGNAL_RULES[reason]
    const sameKind = state.hits.filter((hit) => hit.reason === reason).length
    const points = sameKind >= rule.free ? rule.points : 0
    state.hits.push({ at: now, reason, points })
    if (state.hits.length > 400) state.hits.splice(0, state.hits.length - 400)
    if (points > 0) this.persist(normal, reason, path, detail, points, now)
    const score = state.hits.reduce((sum, hit) => sum + hit.points, 0)
    if (score >= BAN_SCORE && !this.activeBan(normal)) {
      const top = topReason(state.hits)
      this.ban(normal, { reason: top, source: 'auto' })
      this.states.delete(normal)
      return { points, banned: true }
    }
    return { points, banned: false }
  }

  /** Failed sign-in for `emailHash` (a hash of the address the client typed; the e-mail itself is never kept). */
  failedLogin(ip: string, path: string, emailHash?: string) {
    const normal = normalizeIp(ip)
    if (!normal || this.exempt(normal)) return { points: 0, banned: false }
    const now = this.now()
    const state = this.state(normal, now)
    if (emailHash) state.emails.set(emailHash, now)
    for (const [hash, at] of state.emails) if (at < now - CREDENTIAL_WINDOW_MS) state.emails.delete(hash)
    if (state.emails.size >= CREDENTIAL_EMAILS && now - state.stuffingAt > CREDENTIAL_WINDOW_MS) {
      state.stuffingAt = now
      return this.signal(normal, 'credential-stuffing', path, `${state.emails.size} разных e-mail`)
    }
    return this.signal(normal, 'login-fail', path)
  }

  /** Current score of an address (tests, diagnostics). */
  score(ip: string) {
    const state = this.states.get(normalizeIp(ip))
    if (!state) return 0
    const since = this.now() - WINDOW_MS
    return state.hits.filter((hit) => hit.at > since).reduce((sum, hit) => sum + hit.points, 0)
  }

  private state(ip: string, now: number) {
    let state = this.states.get(ip)
    if (!state) {
      if (this.states.size >= 5000) {
        // Oldest first (insertion order): drop the idle ones, then the oldest if still too many.
        for (const [key, value] of this.states) if (!value.hits.length || value.hits[value.hits.length - 1]!.at < now - WINDOW_MS) this.states.delete(key)
        while (this.states.size >= 5000) this.states.delete(this.states.keys().next().value!)
      }
      state = { hits: [], emails: new Map(), stuffingAt: -Infinity }
      this.states.set(ip, state)
    }
    const since = now - WINDOW_MS
    if (state.hits.length && state.hits[0]!.at <= since) state.hits = state.hits.filter((hit) => hit.at > since)
    return state
  }

  private persist(ip: string, reason: GuardReason, path: string, detail: string | undefined, points: number, now: number) {
    try {
      this.db.prepare(`
        INSERT INTO security_events (bucket, ip_key, ip_masked, reason, path, detail, count, points, first_at, last_at)
        VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
        ON CONFLICT (bucket, ip_key, reason, path) DO UPDATE SET count = count + 1, points = points + excluded.points,
          last_at = excluded.last_at, detail = COALESCE(excluded.detail, detail)`)
        .run(Math.floor(now / HOUR), this.key(ip), maskIp(ip), reason, cleanPath(path), detail ?? null, points, now, now)
    } catch { /* the guard never breaks a request */ }
    if (now - this.lastPrune > HOUR) this.prune()
  }

  /** Bans an address: escalating for automatic bans, `minutes` for the owner's manual ones. */
  ban(ip: string, options: { reason: string; source: 'auto' | 'manual'; minutes?: number; actor?: string }) {
    const normal = normalizeIp(ip)
    if (!normal) throw new Error('Некорректный IP-адрес')
    const now = this.now()
    const key = this.key(normal)
    const previous = (this.db.prepare("SELECT COUNT(*) AS n FROM security_bans WHERE ip_key = ? AND source = 'auto' AND created_at > ?").get(key, now - ESCALATION_MS) as { n: number }).n
    const level = options.source === 'auto' ? Math.min(previous, BAN_STEPS_MS.length - 1) : 0
    const duration = options.source === 'manual' ? Math.max(1, options.minutes ?? 24 * 60) * MINUTE : BAN_STEPS_MS[level]!
    const until = now + duration
    const result = this.db.prepare('INSERT INTO security_bans (ip_key, ip_masked, reason, level, source, actor, created_at, until) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(key, maskIp(normal), options.reason.slice(0, 64), level, options.source, options.actor ?? null, now, until)
    const id = Number(result.lastInsertRowid)
    this.bans.set(key, { id, until })
    this.bansSinceStart += 1
    const ban = this.banById(id)!
    try { this.opts.onBan?.(ban) } catch { /* logging only */ }
    return ban
  }

  unban(id: number, actor: string) {
    const row = this.db.prepare('SELECT ip_key FROM security_bans WHERE id = ?').get(id) as { ip_key: string } | undefined
    if (!row) return undefined
    this.db.prepare('UPDATE security_bans SET lifted_at = ?, lifted_by = ? WHERE id = ? AND lifted_at IS NULL').run(this.now(), actor, id)
    const active = this.bans.get(row.ip_key)
    if (active?.id === id) this.bans.delete(row.ip_key)
    return this.banById(id)
  }

  allow(ip: string, actor: string, note?: string) {
    const normal = normalizeIp(ip)
    if (!normal) throw new Error('Некорректный IP-адрес')
    const key = this.key(normal)
    this.db.prepare('INSERT INTO security_allowlist (ip_key, ip_masked, note, actor, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (ip_key) DO UPDATE SET note = excluded.note')
      .run(key, maskIp(normal), note?.slice(0, 120) ?? null, actor, this.now())
    this.allowKeys.add(key)
    // An allowed address is not banned any more.
    const ban = this.bans.get(key)
    if (ban) this.unban(ban.id, actor)
    this.states.delete(normal)
    return this.allowlist()
  }

  disallow(key: string) {
    this.db.prepare('DELETE FROM security_allowlist WHERE ip_key = ?').run(key)
    if (!this.envAllow.some((entry) => entry.key === key)) this.allowKeys.delete(key)
    return this.allowlist()
  }

  allowlist(): AllowEntry[] {
    const rows = this.db.prepare('SELECT ip_key, ip_masked, note, created_at FROM security_allowlist ORDER BY created_at DESC').all() as Array<{ ip_key: string; ip_masked: string; note: string | null; created_at: number }>
    return [...this.envAllow, ...rows.map((row) => ({ key: row.ip_key, ip: row.ip_masked, ...(row.note ? { note: row.note } : {}), createdAt: new Date(row.created_at).toISOString(), source: 'admin' as const }))]
  }

  /** A banned request was refused (counted only in memory: a flood must not write to the database). */
  blocked() { this.blockedSinceStart += 1 }

  private banById(id: number) {
    const row = this.db.prepare('SELECT * FROM security_bans WHERE id = ?').get(id) as Record<string, unknown> | undefined
    return row ? this.banView(row) : undefined
  }

  private banView(row: Record<string, unknown>): SecurityBan {
    const until = Number(row.until)
    const lifted = row.lifted_at === null ? undefined : Number(row.lifted_at)
    return {
      id: Number(row.id), ip: String(row.ip_masked), reason: String(row.reason), level: Number(row.level), source: row.source === 'manual' ? 'manual' : 'auto',
      ...(row.actor ? { actor: String(row.actor) } : {}), createdAt: new Date(Number(row.created_at)).toISOString(), until: new Date(until).toISOString(),
      active: lifted === undefined && until > this.now(), ...(lifted !== undefined ? { liftedAt: new Date(lifted).toISOString(), liftedBy: String(row.lifted_by ?? '') } : {}),
    }
  }

  /** Active bans first, then the latest finished ones (last 7 days). */
  listBans(limit = 100): SecurityBan[] {
    const now = this.now()
    const rows = this.db.prepare(`SELECT * FROM security_bans WHERE (lifted_at IS NULL AND until > ?) OR created_at > ?
      ORDER BY (lifted_at IS NULL AND until > ?) DESC, created_at DESC LIMIT ?`).all(now, now - 7 * DAY, now, limit) as Array<Record<string, unknown>>
    return rows.map((row) => this.banView(row))
  }

  listEvents(limit = 100, offset = 0, reason?: GuardReason): { events: SecurityEvent[]; total: number } {
    const where = reason ? 'WHERE reason = ?' : ''
    const params = reason ? [reason] : []
    const total = (this.db.prepare(`SELECT COUNT(*) AS n FROM security_events ${where}`).get(...params) as { n: number }).n
    const rows = this.db.prepare(`SELECT * FROM security_events ${where} ORDER BY last_at DESC, id DESC LIMIT ? OFFSET ?`).all(...params, limit, offset) as Array<Record<string, unknown>>
    return {
      total,
      events: rows.map((row) => ({
        id: Number(row.id), at: new Date(Number(row.last_at)).toISOString(), firstAt: new Date(Number(row.first_at)).toISOString(), ip: String(row.ip_masked),
        reason: String(row.reason) as GuardReason, path: String(row.path), ...(row.detail ? { detail: String(row.detail) } : {}), count: Number(row.count), points: Number(row.points),
      })),
    }
  }

  summary(): SecuritySummary {
    const now = this.now()
    const count = (sql: string, ...params: number[]) => Number((this.db.prepare(sql).get(...params) as { n: number | null }).n ?? 0)
    const byReason: Partial<Record<GuardReason, number>> = {}
    for (const row of this.db.prepare('SELECT reason, SUM(count) AS n FROM security_events WHERE last_at > ? GROUP BY reason').all(now - DAY) as Array<{ reason: GuardReason; n: number }>) byReason[row.reason] = row.n
    const last = this.db.prepare('SELECT MAX(created_at) AS at FROM security_bans').get() as { at: number | null }
    let active = 0
    for (const [key, ban] of this.bans) { if (ban.until > now) active += 1; else this.bans.delete(key) }
    return {
      activeBans: active,
      bans24h: count('SELECT COUNT(*) AS n FROM security_bans WHERE created_at > ?', now - DAY),
      bans1h: count('SELECT COUNT(*) AS n FROM security_bans WHERE created_at > ?', now - HOUR),
      bansSinceStart: this.bansSinceStart,
      blockedSinceStart: this.blockedSinceStart,
      events1h: count('SELECT SUM(count) AS n FROM security_events WHERE last_at > ?', now - HOUR),
      events24h: count('SELECT SUM(count) AS n FROM security_events WHERE last_at > ?', now - DAY),
      byReason24h: byReason,
      credentialStuffing1h: count("SELECT SUM(count) AS n FROM security_events WHERE reason = 'credential-stuffing' AND last_at > ?", now - HOUR),
      ...(last.at ? { lastBanAt: new Date(last.at).toISOString() } : {}),
    }
  }

  /** Retention: events older than 30 days, finished bans older than 30 days. */
  prune() {
    const now = this.now()
    this.lastPrune = now
    const cutoff = now - RETENTION_MS
    try {
      const events = this.db.prepare('DELETE FROM security_events WHERE last_at < ?').run(cutoff).changes
      const bans = this.db.prepare('DELETE FROM security_bans WHERE until < ? AND (lifted_at IS NOT NULL OR until < ?)').run(cutoff, now).changes
      return { events: Number(events), bans: Number(bans) }
    } catch {
      return { events: 0, bans: 0 }
    }
  }

  /**
   * The middleware: refuses banned addresses, scores request-time signals (scanner paths, traversal, injection in the
   * query) and, when the answer is sent, the status-based ones (401/403/404/429/413, failed sign-ins, webhook keys)
   * and injection markers in the JSON body.
   */
  middleware(): RequestHandler {
    return (req, res, next) => {
      const ip = normalizeIp(req.ip ?? req.socket.remoteAddress)
      if (directLocal(req) || this.exempt(ip)) { next(); return }
      const ban = this.activeBan(ip)
      if (ban) {
        if (this.ownerPasses(req)) { next(); return }
        this.blocked()
        res.set({ 'Retry-After': String(Math.max(1, Math.ceil((ban.until - this.now()) / 1000))), 'Cache-Control': 'no-store', Connection: 'close' })
        res.status(403).json({ error: 'Доступ с этого адреса временно ограничен. Попробуйте позже.' })
        return
      }
      const path = req.path
      if (scannerPath(path)) {
        this.signal(ip, 'scanner', path)
        res.status(404).json({ error: 'Не найдено' })
        return
      }
      if (traversalUrl(req.originalUrl ?? req.url)) {
        this.signal(ip, 'traversal', path)
        res.status(400).json({ error: 'Некорректный адрес' })
        return
      }
      const query = (req.originalUrl ?? '').split('?')[1]
      if (query && injectionMarker(query.slice(0, 4096))) {
        this.signal(ip, 'injection', path, 'query')
        res.status(400).json({ error: 'Некорректные данные запроса' })
        return
      }
      // The path now: routers strip their mount path from req.url while they handle the request.
      res.on('finish', () => {
        try { this.afterResponse(ip, req, path, res.statusCode) } catch { /* never breaks a request */ }
      })
      next()
    }
  }

  private ownerPasses(req: Request) {
    if (!req.get('authorization') || !this.opts.ownerRequest) return false
    try { return this.opts.ownerRequest(req) } catch { return false }
  }

  private afterResponse(ip: string, req: Request, path: string, status: number) {
    if (req.body && typeof req.body === 'object' && !UNSCANNED_PATHS.test(path) && bodyInjection(req.body)) this.signal(ip, 'injection', path, 'body')
    if (status === 401 && req.method === 'POST' && isLoginPath(path)) {
      const email = typeof (req.body as { email?: unknown } | undefined)?.email === 'string' ? String((req.body as { email: string }).email).trim().toLowerCase() : ''
      this.failedLogin(ip, path, email ? createHash('sha256').update(`${this.salt}|${email}`).digest('hex').slice(0, 16) : undefined)
      return
    }
    if (status === 401 && /^\/v1\/payments\/lava\/webhook\/?$/.test(path)) { this.signal(ip, 'webhook-signature', path); return }
    if (status === 413) { this.signal(ip, 'oversized', path); return }
    if (status === 401 || status === 403) { this.signal(ip, 'auth-fail', path); return }
    if (status === 404 || status === 405) { this.signal(ip, 'not-found', path); return }
    if (status === 429) this.signal(ip, 'rate-limited', path)
  }
}

function topReason(hits: Hit[]): GuardReason {
  const totals = new Map<GuardReason, number>()
  for (const hit of hits) totals.set(hit.reason, (totals.get(hit.reason) ?? 0) + hit.points)
  return [...totals.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'scanner'
}

/** TARKOV_GUARD_ALLOWLIST=1.2.3.4,2001:db8::1 */
export function allowlistFromEnv(env: NodeJS.ProcessEnv = process.env) {
  return (env.TARKOV_GUARD_ALLOWLIST ?? '').split(',').map((item) => item.trim()).filter(Boolean)
}
