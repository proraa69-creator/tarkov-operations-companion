/**
 * «Страж сервера» (docs/server-guard.md): the request guard (services/securityGuard.ts), the API's health
 * (services/serverHealth.ts) and backups (services/serverBackups.ts) wired into the API. app.ts mounts
 * `middleware` first (bans, scanner paths, counting every answer) and `router` after the JSON parser:
 *
 * This PC only (a direct request to 127.0.0.1:8787 — the owner app's watchdog; 404 through the site / public link, and
 * for a browser page: Host must be 127.0.0.1 / localhost, no Origin header — see localAppRequest):
 *   GET  /health/detail                         -> error rates, event loop, memory, database check, backups, security
 *   POST /health/backup  { kind }               -> { backup } | 500 { error }   (daily / before-restart / manual)
 *
 * The owner's admin panel («Безопасность»; owner session as in routes/ownerAdmin.ts: 401 / 404 for everybody else):
 *   GET  /v1/accounts/me/admin/security                      -> summary, health, series, backups, bans, allowlist, events
 *   GET  /v1/accounts/me/admin/security/events?limit&offset&reason -> { events, total }
 *   POST /v1/accounts/me/admin/security/bans    { ip, hours 1–720, note? } -> { bans }
 *   POST /v1/accounts/me/admin/security/bans/:id/unban                     -> { bans }
 *   POST /v1/accounts/me/admin/security/allowlist { ip, note? }            -> { allowlist }
 *   POST /v1/accounts/me/admin/security/allowlist/:key/remove              -> { allowlist }
 */
import express from 'express'
import type { Request, Response } from 'express'
import { z } from 'zod'
import { bearer, FixedWindowRateLimiter, type AccountStore } from '../services/accountStore.js'
import { allowlistFromEnv, directLocal, GUARD_REASONS, SecurityGuard, type GuardReason } from '../services/securityGuard.js'
import { ServerHealth } from '../services/serverHealth.js'
import { BackupService, type BackupKind } from '../services/serverBackups.js'

export interface ServerGuardOptions {
  now?: () => number
  allowlist?: string[]
  /** Backups folder (default: `backups` next to the database file). */
  backupDir?: string
  /** 0 switches the hourly quick_check timer off (tests). */
  quickCheckEveryMs?: number
}

const banSchema = z.object({ ip: z.string().trim().min(2).max(64), hours: z.number().int().min(1).max(720).default(24), note: z.string().trim().max(120).optional() })
const allowSchema = z.object({ ip: z.string().trim().min(2).max(64), note: z.string().trim().max(120).optional() })
const pageSchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  reason: z.enum(GUARD_REASONS as [GuardReason, ...GuardReason[]]).optional(),
})
const backupSchema = z.object({ kind: z.enum(['daily', 'before-restart', 'manual']).default('manual') })

/** Host names a request made on this PC to the API port carries (anything else is DNS rebinding). */
const LOCAL_HOST = /^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d{1,5})?$/i

/**
 * Besides the loopback socket: the owner app's own call (Node fetch from the main process) — Host 127.0.0.1 /
 * localhost, no Origin and no cross-site Sec-Fetch-Site. A web page open in a browser on this PC can reach
 * 127.0.0.1:8787 too (a «simple» POST needs no preflight), or point a rebinding DNS name at it; both are refused.
 */
export function localAppRequest(req: Request) {
  if (!LOCAL_HOST.test(req.get('host') ?? '')) return false
  if (req.get('origin') !== undefined) return false
  const site = (req.get('sec-fetch-site') ?? 'none').toLowerCase()
  return site === 'none' || site === 'same-origin'
}

export function createServerGuard(accounts: AccountStore, options: ServerGuardOptions = {}) {
  const db = accounts.database
  const ownerOf = (req: Request) => {
    const id = accounts.authenticate(bearer(req.get('authorization')))
    if (!id) return { id: undefined, email: undefined }
    return { id, email: accounts.isOwner(id) ? accounts.emailOf(id) : undefined }
  }
  const guard = new SecurityGuard(db, {
    now: options.now,
    allowlist: options.allowlist ?? allowlistFromEnv(),
    ownerRequest: (req) => Boolean(ownerOf(req).email),
    onBan: (ban) => console.log(`${new Date().toISOString()} [guard] Banned ${ban.ip} until ${ban.until} (${ban.source}: ${ban.reason}, level ${ban.level})`),
  })
  const health = new ServerHealth(db, { now: options.now, quickCheckEveryMs: options.quickCheckEveryMs })
  const backups = new BackupService(db, { dir: options.backupDir, now: options.now })
  const guardMiddleware = guard.middleware()

  /** Bans first; then every answer is counted for the error rate (also this PC's own requests). */
  const middleware: express.RequestHandler = (req, res, next) => {
    res.on('finish', () => health.record(res.statusCode))
    guardMiddleware(req, res, next)
  }

  const detail = (local: boolean) => ({
    ok: true, service: 'tarkov-operations-api', at: new Date((options.now ?? Date.now)()).toISOString(),
    ...health.detail(local),
    backups: local ? backups.status() : (({ dir: _dir, ...rest }) => { void _dir; return rest })(backups.status()),
    security: guard.summary(),
  })

  const router = express.Router()
  const localOnly = (run: (req: Request, res: Response) => void) => (req: Request, res: Response) => {
    res.set('Cache-Control', 'no-store')
    if (!directLocal(req) || !localAppRequest(req)) { res.status(404).json({ error: 'Не найдено' }); return }
    run(req, res)
  }
  router.get('/health/detail', localOnly((_req, res) => { res.json(detail(true)) }))
  router.post('/health/backup', localOnly((req, res) => {
    const parsed = backupSchema.safeParse(req.body ?? {})
    const kind: BackupKind = parsed.success ? parsed.data.kind : 'manual'
    try {
      const backup = backups.create(kind)
      console.log(`${new Date().toISOString()} [guard] Backup (${kind}) written: ${backup.name}`)
      res.json({ backup, backups: backups.status() })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`${new Date().toISOString()} [guard] ${message}`)
      res.status(500).json({ error: message })
    }
  }))

  const readLimiter = new FixedWindowRateLimiter(120, 60 * 1000)
  const writeLimiter = new FixedWindowRateLimiter(30, 60 * 1000)
  const owner = (kind: 'read' | 'write', run: (req: Request, res: Response, actor: string) => void) => (req: Request, res: Response) => {
    res.set('Cache-Control', 'no-store')
    const { id, email } = ownerOf(req)
    if (!id) { res.status(401).json({ error: 'Требуется вход в аккаунт' }); return }
    if (!email) { res.status(404).json({ error: 'Не найдено' }); return }
    const retry = (kind === 'read' ? readLimiter : writeLimiter).hit(`${kind}:${id}`)
    if (retry) { res.set('Retry-After', String(retry)).status(429).json({ error: 'Слишком много запросов. Подождите минуту.' }); return }
    try {
      run(req, res, email)
    } catch (error) {
      if (error instanceof z.ZodError) { res.status(400).json({ error: 'Некорректные данные запроса' }); return }
      if (error instanceof Error && /IP-адрес/.test(error.message)) { res.status(400).json({ error: error.message }); return }
      throw error
    }
  }
  const base = '/v1/accounts/me/admin/security'
  router.get(base, owner('read', (_req, res) => {
    const view = detail(false)
    res.json({ ...view, series: health.series(60, 24), recentSeries: health.series(5, 24), bans: guard.listBans(), allowlist: guard.allowlist().map(({ key, ...rest }) => ({ id: key, ...rest })), events: guard.listEvents(50, 0).events, backupFiles: backups.list().slice(0, 20) })
  }))
  router.get(`${base}/events`, owner('read', (req, res) => {
    const { limit, offset, reason } = pageSchema.parse(req.query)
    res.json(guard.listEvents(limit, offset, reason))
  }))
  router.post(`${base}/bans`, owner('write', (req, res, actor) => {
    const { ip, hours, note } = banSchema.parse(req.body ?? {})
    guard.ban(ip, { reason: note ? `вручную: ${note}` : 'вручную', source: 'manual', minutes: hours * 60, actor })
    res.json({ bans: guard.listBans() })
  }))
  router.post(`${base}/bans/:id/unban`, owner('write', (req, res, actor) => {
    const id = z.coerce.number().int().positive().parse(req.params.id)
    if (!guard.unban(id, actor)) { res.status(404).json({ error: 'Блокировка не найдена' }); return }
    res.json({ bans: guard.listBans() })
  }))
  router.post(`${base}/allowlist`, owner('write', (req, res, actor) => {
    const { ip, note } = allowSchema.parse(req.body ?? {})
    guard.allow(ip, actor, note)
    res.json({ allowlist: guard.allowlist().map(({ key, ...rest }) => ({ id: key, ...rest })), bans: guard.listBans() })
  }))
  router.post(`${base}/allowlist/:key/remove`, owner('write', (req, res) => {
    const key = z.string().regex(/^[a-f0-9]{32}$/).parse(req.params.key)
    guard.disallow(key)
    res.json({ allowlist: guard.allowlist().map(({ key: id, ...rest }) => ({ id, ...rest })) })
  }))

  return { middleware, router, guard, health, backups }
}
