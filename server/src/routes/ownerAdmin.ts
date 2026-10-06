/**
 * The owner's «Админ-панель» on the website (services/adminStore.ts), mounted at `/v1/accounts` BEFORE the accounts and
 * payouts routers. Every route needs the session of an account listed in TARKOV_OWNER_EMAILS: 401 without a session,
 * 404 for everybody else (the routes do not reveal that they exist). Responses are `Cache-Control: no-store`.
 *
 *   GET  /me/admin/overview                          -> users, subscriptions, revenue (ЮKassa / Lava / total), payouts
 *   GET  /me/admin/series?period=day|month|year      -> { period, rows: [{ period, registrations, payments, revenue,
 *                                                         yookassa, lava, plans: { 1m: { count, revenue }, … } }] }
 *   GET  /me/admin/calendar?month=YYYY-MM            -> { month, today, days: [{ date, registrations, payments, revenue, yookassa, lava, plans }] }
 *   GET  /me/admin/day?date=YYYY-MM-DD               -> { date, totals, registrations, payments, grants, invites } (the calendar day window)
 *   GET  /me/admin/payments?from&to&status&provider&plan&q&limit&offset -> { payments, total, totals }
 *   GET  /me/admin/payments.csv?…same filters        -> text/csv (UTF-8 BOM, «;»)
 *   GET  /me/admin/users?q&filter&limit&offset       -> { users, total }
 *   GET  /me/admin/users/:id                         -> { user, payments, grants }
 *   POST /me/admin/users/:id/grant           { days 1–3650, reason }   -> { user, payments, grants }
 *   POST /me/admin/users/:id/cancel-autopay                            -> { user, payments, grants }
 *   POST /me/admin/users/:id/block           { reason? }               -> { user, … } (sessions revoked, login 403)
 *   POST /me/admin/users/:id/unblock                                   -> { user, … }
 *   POST /me/admin/users/:id/revoke-sessions                           -> { revoked, user, … }
 *   GET  /me/admin/streamer-settings                 -> { defaultPercent, streamers: [{ code, email, percent, custom, linkEnabled }] }
 *   PUT  /me/admin/streamers/:code/percent   { percent: 0–100 | null } -> streamer settings
 *   PUT  /me/admin/streamers/:code/link      { enabled: boolean }      -> streamer settings
 *   POST /me/admin/streamers/:code/revoke                              -> streamer settings (the account becomes a user)
 *   GET  /me/admin/sales-settings                    -> prices, plans, providers (no keys; editing stays in the desktop app)
 *   GET  /me/admin/lava/events                       -> { configured, events (last 100 webhook calls), pending (unconfirmed invoices) }
 *   POST /me/admin/lava/events/:id/confirm           -> { already, paymentId, …events }  (amount-mismatch rows only; grants the stored plan once)
 *   GET  /me/admin/audit?limit&offset                -> { entries, total }
 *
 * The owner's existing actions (streamer invites, payout decisions, payout limits; routes/accounts.ts, payouts.ts) are
 * written to the same audit log after they succeed. Rate limits are per owner account.
 */
import express from 'express'
import type { NextFunction, Request, Response } from 'express'
import { z } from 'zod'
import { AccountError, bearer, FixedWindowRateLimiter, type AccountStore } from '../services/accountStore.js'
import type { AdminStore, PaymentFilter, UserFilter } from '../services/adminStore.js'
import { PaymentError } from '../services/paymentStore.js'

const DAY = /^\d{4}-\d{2}-\d{2}$/
const pageSchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
})
const paymentFilterSchema = z.object({
  from: z.string().regex(DAY).optional(),
  to: z.string().regex(DAY).optional(),
  status: z.enum(['pending', 'succeeded', 'canceled', 'refunded']).optional(),
  provider: z.enum(['yookassa', 'lava']).optional(),
  plan: z.enum(['1m', '3m', '6m', '12m']).optional(),
  q: z.string().trim().max(254).optional(),
})
const userQuerySchema = z.object({
  q: z.string().trim().max(254).default(''),
  filter: z.enum(['all', 'active', 'trial', 'inactive', 'streamers', 'blocked']).default('all'),
})
const periodSchema = z.object({ period: z.enum(['day', 'month', 'year']).default('day') })
const idSchema = z.string().regex(/^[a-f0-9]{24}$/)
const codeSchema = z.string().trim().regex(/^[A-Za-z0-9_-]{3,24}$/).transform((code) => code.toUpperCase())
const grantSchema = z.object({ days: z.number().int().min(1).max(3650), reason: z.string().trim().min(3).max(200) })
const blockSchema = z.object({ reason: z.string().trim().max(200).optional() })
const percentSchema = z.object({ percent: z.number().min(0).max(100).nullable() })
const linkSchema = z.object({ enabled: z.boolean() })

/** Existing owner routes whose successful calls go to the audit log too. Only validated, non-secret fields are kept. */
const AUDITED: Array<{ method: string; path: string; action: 'streamer.invite' | 'payout.decide' | 'payout.limits'; describe: (body: Record<string, unknown>) => { target?: string; details?: Record<string, unknown> } }> = [
  { method: 'POST', path: '/me/admin/streamer-invites', action: 'streamer.invite', describe: (body) => ({ target: String(body.code ?? '').trim().toUpperCase().slice(0, 24) }) },
  { method: 'POST', path: '/me/admin/payouts/decide', action: 'payout.decide', describe: (body) => ({ target: String(body.id ?? '').slice(0, 24), details: { status: String(body.status ?? '').slice(0, 10), ...(typeof body.comment === 'string' && body.comment ? { comment: body.comment.slice(0, 200) } : {}) } }) },
  { method: 'PUT', path: '/me/admin/payout-limits', action: 'payout.limits', describe: (body) => ({ details: { min: Number(body.min), max: Number(body.max) } }) },
]

export function createOwnerAdminRouter(accounts: AccountStore, admin: AdminStore) {
  const router = express.Router()
  const readLimiter = new FixedWindowRateLimiter(240, 60 * 1000)
  const writeLimiter = new FixedWindowRateLimiter(30, 60 * 1000)
  const exportLimiter = new FixedWindowRateLimiter(10, 60 * 1000)

  /** The owner's e-mail for the session, or undefined (the request then falls through to 401/404). */
  const ownerOf = (req: Request) => {
    const id = accounts.authenticate(bearer(req.get('authorization')))
    if (!id) return { id: undefined, email: undefined }
    return { id, email: accounts.isOwner(id) ? accounts.emailOf(id) : undefined }
  }

  // Audit of the owner's older actions: logged once they have succeeded (status < 300).
  router.use((req: Request, res: Response, next: NextFunction) => {
    const audited = AUDITED.find((entry) => entry.method === req.method && entry.path === req.path)
    if (!audited) { next(); return }
    const body = req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {}
    const { email } = ownerOf(req)
    if (email) res.on('finish', () => { if (res.statusCode < 300) { try { const { target, details } = audited.describe(body); admin.audit(email, audited.action, target, details) } catch { /* the action itself already succeeded */ } } })
    next()
  })

  type Handler = (req: Request, res: Response, actor: string) => unknown
  const owner = (kind: 'read' | 'write' | 'export', run: Handler) => async (req: Request, res: Response) => {
    res.set('Cache-Control', 'no-store')
    try {
      const { id, email } = ownerOf(req)
      if (!id) { res.status(401).json({ error: 'Требуется вход в аккаунт' }); return }
      if (!email) { res.status(404).json({ error: 'Не найдено' }); return }
      const limiter = kind === 'read' ? readLimiter : kind === 'write' ? writeLimiter : exportLimiter
      const retry = limiter.hit(`${kind}:${id}`)
      if (retry) { res.set('Retry-After', String(retry)).status(429).json({ error: 'Слишком много запросов. Подождите минуту.' }); return }
      await run(req, res, email)
    } catch (error) {
      if (error instanceof AccountError || error instanceof PaymentError) { res.status(error.status).json({ error: error.message }); return }
      if (error instanceof z.ZodError) { res.status(400).json({ error: 'Некорректные данные запроса' }); return }
      throw error
    }
  }

  const paymentFilter = (req: Request): PaymentFilter => {
    const filter = paymentFilterSchema.parse(req.query)
    if (filter.from && filter.to && filter.from > filter.to) throw new AccountError(400, 'Начало периода позже конца')
    return { ...filter, q: filter.q || undefined }
  }

  router.get('/me/admin/overview', owner('read', (_req, res) => { res.json(admin.overview()) }))
  router.get('/me/admin/series', owner('read', (req, res) => {
    const { period } = periodSchema.parse(req.query)
    res.json({ period, rows: admin.series(period) })
  }))

  router.post('/me/admin/payments/:id/refunded', owner('write', (req, res, actor) => {
    res.json(admin.markRefunded(actor, z.string().regex(/^[a-f0-9]{24}$/).parse(req.params.id)))
  }))
  router.get('/me/admin/calendar', owner('read', (req, res) => {
    const { month } = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }).parse(req.query)
    res.json(admin.calendar(month))
  }))
  router.get('/me/admin/day', owner('read', (req, res) => {
    const { date } = z.object({ date: z.string().regex(DAY) }).parse(req.query)
    if (Number.isNaN(Date.parse(`${date}T00:00:00Z`))) throw new AccountError(400, 'Некорректная дата')
    res.json(admin.day(date))
  }))

  router.get('/me/admin/payments', owner('read', (req, res) => {
    const { limit, offset } = pageSchema.parse(req.query)
    res.json(admin.paymentList(paymentFilter(req), limit, offset))
  }))
  router.get('/me/admin/payments.csv', owner('export', (req, res, actor) => {
    const filter = paymentFilter(req)
    const { csv, rows } = admin.paymentsCsv(filter)
    admin.audit(actor, 'payments.export', undefined, { rows, ...Object.fromEntries(Object.entries(filter).filter(([, value]) => value !== undefined)) })
    res.set('Content-Type', 'text/csv; charset=utf-8')
    res.set('Content-Disposition', `attachment; filename="raidos-payments-${new Date().toISOString().slice(0, 10)}.csv"`)
    res.send(csv)
  }))

  router.get('/me/admin/users', owner('read', (req, res) => {
    const { q, filter } = userQuerySchema.parse(req.query)
    const { limit, offset } = pageSchema.parse(req.query)
    res.json(admin.users(q, filter as UserFilter, limit, offset))
  }))
  router.get('/me/admin/users/:id', owner('read', (req, res) => { res.json(admin.user(idSchema.parse(req.params.id))) }))
  router.post('/me/admin/users/:id/grant', owner('write', (req, res, actor) => {
    const { days, reason } = grantSchema.parse(req.body)
    res.json(admin.grant(actor, idSchema.parse(req.params.id), days, reason))
  }))
  router.post('/me/admin/users/:id/cancel-autopay', owner('write', async (req, res, actor) => { res.json(await admin.cancelAutopay(actor, idSchema.parse(req.params.id))) }))
  router.post('/me/admin/users/:id/block', owner('write', (req, res, actor) => {
    const { reason } = blockSchema.parse(req.body ?? {})
    res.json(admin.setBlocked(actor, idSchema.parse(req.params.id), true, reason || undefined))
  }))
  router.post('/me/admin/users/:id/unblock', owner('write', (req, res, actor) => { res.json(admin.setBlocked(actor, idSchema.parse(req.params.id), false)) }))
  router.post('/me/admin/users/:id/revoke-sessions', owner('write', (req, res, actor) => { res.json(admin.revokeSessions(actor, idSchema.parse(req.params.id))) }))

  router.get('/me/admin/streamer-settings', owner('read', (_req, res) => { res.json(admin.streamerSettings()) }))
  router.put('/me/admin/streamers/:code/percent', owner('write', (req, res, actor) => {
    const { percent } = percentSchema.parse(req.body)
    res.json(admin.setStreamerPercent(actor, codeSchema.parse(req.params.code), percent))
  }))
  router.put('/me/admin/streamers/:code/link', owner('write', (req, res, actor) => {
    const { enabled } = linkSchema.parse(req.body)
    res.json(admin.setStreamerLink(actor, codeSchema.parse(req.params.code), enabled))
  }))
  router.post('/me/admin/streamers/:code/revoke', owner('write', (req, res, actor) => { res.json(admin.revokeStreamer(actor, codeSchema.parse(req.params.code))) }))

  router.get('/me/admin/lava/events', owner('read', (_req, res) => { res.json(admin.lavaEvents()) }))
  router.post('/me/admin/lava/events/:id/confirm', owner('write', (req, res, actor) => {
    const id = z.coerce.number().int().min(1).max(Number.MAX_SAFE_INTEGER).parse(req.params.id)
    res.json(admin.confirmLavaMismatch(actor, id))
  }))
  router.get('/me/admin/sales-settings', owner('read', (_req, res) => { res.json(admin.salesSettings()) }))
  router.get('/me/admin/audit', owner('read', (req, res) => {
    const { limit, offset } = pageSchema.parse(req.query)
    res.json(admin.auditLog(limit, offset))
  }))

  return router
}
