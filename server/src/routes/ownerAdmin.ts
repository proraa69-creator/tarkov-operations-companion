/**
 * The owner's «Админ-панель» on the website (services/adminStore.ts), mounted at `/v1/accounts` BEFORE the accounts and
 * payouts routers. Every route needs the session of an account listed in TARKOV_OWNER_EMAILS: 401 without a session,
 * 404 for everybody else (the routes do not reveal that they exist). Responses are `Cache-Control: no-store`.
 *
 *   GET  /me/admin/overview                          -> users, subscriptions, revenue (today / month / all), payouts
 *   GET  /me/admin/series?period=day|month|year      -> { period, rows: [{ period, registrations, payments, revenue,
 *                                                         plans: { 1m: { count, revenue }, … } }] }
 *   GET  /me/admin/calendar?month=YYYY-MM            -> { month, today, days: [{ date, registrations, payments, revenue, plans }] }
 *   GET  /me/admin/day?date=YYYY-MM-DD               -> { date, totals, registrations, payments, grants, invites } (the calendar day window)
 *   GET  /me/admin/stats?from=YYYY-MM-DD&to=YYYY-MM-DD -> one aggregate for the owner app (AdminStore.stats; Moscow
 *                                                       days, default the last 30): users, regions, countries,
 *                                                       subscriptions, payers, revenue, referrals, trial conversion
 *   GET  /me/admin/payments?from&to&dateField=created|paid&status&plan&provider&method&region&q&limit&offset
 *                                                    -> { payments, total, totals }
 *   GET  /me/admin/payments.csv?…same filters        -> text/csv (UTF-8 BOM, «;»)
 *   POST /me/admin/payments/:id/amount       { amount ₽ 0–1 000 000 (kopecks allowed), comment? ≤200 }
 *                                                    -> AdminPayment (streamer share recounted; audit payment.amount;
 *                                                       404 unknown payment, 409 archived payment)
 *   GET  /me/admin/users?q&filter&region&country&payRegion&payer&expiresBefore&registeredFrom&registeredTo&seenSince
 *                       &autopay&sort=created|paidUntil|lastSeen|payments&order=asc|desc&limit&offset
 *                                                    -> { users, total, regions: { all, cis, europe, other, none } }
 *                                                       (region: the country named at registration — СНГ / Европа /
 *                                                       Другие / Не указана; the counts ignore the chosen region)
 *   GET  /me/admin/users.csv?…same filters           -> text/csv (UTF-8 BOM, «;», at most 50 000 rows; audit users.export)
 *   POST /me/admin/users/bulk-grant  { ids: id[] ≤500 | filter: <users filters>, days 1–3650, reason, dryRun? }
 *                                                    -> { affected, sample, skipped, dryRun } (one audit entry
 *                                                       subscription.bulk-grant; 400 { code: 'too_many', affected })
 *   GET  /me/admin/users/:id                         -> { user, payments, grants }
 *   POST /me/admin/users/:id/grant           { days 1–3650, reason }   -> { user, payments, grants }
 *   POST /me/admin/users/:id/revoke          { days 1–3650, reason }   -> { user, payments, grants } (takes paid days off; 409 when none)
 *   POST /me/admin/users/:id/cancel-autopay                            -> { user, payments, grants } (an archived one is closed here only)
 *   GET  /me/admin/users/:id/boosty          -> { region, friendAvailable, friendPercent, requests: [{ offer, region, at }] }
 *   Boosty (services/boosty.ts, services/boostySync.ts; docs/payments/payment-regions-and-announcements.md «API for the
 *   subscription tool»):
 *   GET  /me/admin/boosty                    -> { sync: BoostySyncStatus, review: { items, total }, levels, offers }
 *   GET  /me/admin/boosty/payments?email&limit&offset -> { payments: BoostyPaymentRecord[], total }
 *   GET  /me/admin/boosty/review?status=open|all&limit&offset -> { items: BoostyReviewItem[], total }
 *   POST /me/admin/boosty/payments           { email, offer: 'standard'|'friend', region?: 'CIS'|'WORLD', months?: 1|3|6|12 |
 *                                            days?: 1–400 | paidUntil?: 'YYYY-MM-DD', amount?: ₽, netAmount?: ₽ after the
 *                                            commission, reference?, reviewId?, recalculate?: the other region's offer issued
 *                                            for the days its sum is worth (owner, 20.10.2026) }
 *                                            -> 201 { payment, user, recalculatedDays? } «Подтвердить оплату Boosty» (the sync's grant
 *                                            path); 404/409 { error, code: unknown_email|no_country|region_mismatch|
 *                                            friend_without_referral } when the rules refuse it
 *   POST /me/admin/boosty/review/:id/dismiss -> { ok: true }
 *   PUT  /me/admin/boosty/levels/:levelId    { offer: 'WORLD_STANDARD'|'WORLD_FRIEND'|'CIS_STANDARD'|'CIS_FRIEND'|null }
 *   PUT  /me/admin/boosty/pause              { paused: boolean } -> { sync }
 *   POST /me/admin/boosty/sync               -> { sync } «Проверить сейчас» (409 when the server has no Boosty secrets)
 *   POST /me/admin/users/:id/block           { reason? }               -> { user, … } (sessions revoked, login 403)
 *   POST /me/admin/users/:id/unblock                                   -> { user, … }
 *   POST /me/admin/users/:id/revoke-sessions                           -> { revoked, user, … }
 *   POST /me/admin/users/:id/eft-account/unbind                        -> { user, … } (the bound Escape from Tarkov account is freed)
 *   POST /me/admin/users/:id/delete                                    -> { deleted: true } (as «Удалить аккаунт»; 409 owner / active autopay)
 *   GET  /me/admin/streamer-settings                 -> { defaultPercent, streamers: [{ code, email, percent, custom, linkEnabled }] }
 *   PUT  /me/admin/streamers/:code/percent   { percent: 0–100 | null } -> streamer settings
 *   PUT  /me/admin/streamers/:code/link      { enabled: boolean }      -> streamer settings
 *   POST /me/admin/streamers/:code/revoke                              -> streamer settings (the account becomes a user)
 *   GET  /me/admin/sales-settings                    -> prices, plans, providers (no keys; editing stays in the desktop app)
 *   GET  /me/admin/audit?limit&offset                -> { entries, total }
 *   GET  /me/admin/online                            -> { online, pc, phone, windowMinutes, at } («Онлайн сейчас»: accounts
 *                                                       in the PC or phone app within the window, services/presence.ts)
 *
 * Docs for the owner app: docs/codex/owner-admin-api.md.
 *
 * The owner's existing actions (streamer invites, payout decisions, payout limits; routes/accounts.ts, payouts.ts) are
 * written to the same audit log after they succeed. Rate limits are per owner account.
 */
import express from 'express'
import type { NextFunction, Request, Response } from 'express'
import { z } from 'zod'
import { AccountError, bearer, FixedWindowRateLimiter, type AccountStore } from '../services/accountStore.js'
import { BULK_GRANT_MAX, BulkGrantLimitError, userQueryDetails, type AdminStore, type PaymentFilter, type UserQuery } from '../services/adminStore.js'
import { PaymentError } from '../services/paymentStore.js'
import type { PresenceTracker } from '../services/presence.js'
import { BOOSTY_OFFER_KEYS, BOOSTY_OFFER_TABLE, BoostyGrantError, type BoostyPayments } from '../services/boosty.js'
import { BOOSTY_SYNC_OFF, type BoostySync } from '../services/boostySync.js'
import { boostySessionFrom, type BoostyCredentials } from '../services/boostyClient.js'

const DAY = /^\d{4}-\d{2}-\d{2}$/
/** YYYY-MM-DD that is a real date. */
const daySchema = z.string().regex(DAY).refine((day) => {
  const time = Date.parse(`${day}T00:00:00Z`)
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === day
}, 'date')
const pageSchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
})
const paymentFilterSchema = z.object({
  from: z.string().regex(DAY).optional(),
  to: z.string().regex(DAY).optional(),
  status: z.enum(['pending', 'succeeded', 'canceled', 'refunded']).optional(),
  plan: z.enum(['1m', '3m', '6m', '12m']).optional(),
  q: z.string().trim().max(254).optional(),
  provider: z.enum(['yookassa', 'boosty', 'archive']).optional(),
  method: z.string().trim().regex(/^[a-z][a-z0-9_]{0,31}$/).optional(),
  region: z.enum(['RU', 'CIS', 'WORLD', 'none']).optional(),
  dateField: z.enum(['created', 'paid']).default('created'),
})
/** The filters of «Пользователи» (the list, its CSV and the bulk grant's `filter`). */
const userFilterShape = {
  q: z.string().trim().max(254).default(''),
  filter: z.enum(['all', 'active', 'trial', 'inactive', 'streamers', 'blocked']).default('all'),
  region: z.enum(['all', 'russia', 'cis', 'world', 'europe', 'other', 'none']).default('all'),
  country: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/).optional(),
  payRegion: z.enum(['RU', 'CIS', 'WORLD', 'none']).optional(),
  payer: z.enum(['yes', 'no']).optional(),
  expiresBefore: daySchema.optional(),
  registeredFrom: daySchema.optional(),
  registeredTo: daySchema.optional(),
  seenSince: daySchema.optional(),
  autopay: z.enum(['yes', 'no']).optional(),
  sort: z.enum(['created', 'paidUntil', 'lastSeen', 'payments']).default('created'),
  order: z.enum(['asc', 'desc']).default('desc'),
}
const userQuerySchema = z.object(userFilterShape)
/** The bulk grant's filter: unknown keys are refused (a misspelt filter must never widen the grant to everybody). */
const bulkFilterSchema = z.object(userFilterShape).strict()
const bulkGrantSchema = z.object({
  ids: z.array(z.string().regex(/^[a-f0-9]{24}$/)).min(1).max(10_000).optional(),
  filter: bulkFilterSchema.optional(),
  days: z.number().int().min(1).max(3650),
  reason: z.string().trim().min(3).max(200),
  dryRun: z.boolean().default(false),
}).strict().refine((input) => (input.ids === undefined) !== (input.filter === undefined), { message: 'ids or filter' })
const statsSchema = z.object({ from: daySchema.optional(), to: daySchema.optional() })
const periodSchema = z.object({ period: z.enum(['day', 'month', 'year']).default('day') })
const onlineSchema = z.object({ days: z.coerce.number().int().min(1).max(90).default(30) })
const idSchema = z.string().regex(/^[a-f0-9]{24}$/)
const codeSchema = z.string().trim().regex(/^[A-Za-z0-9_-]{3,24}$/).transform((code) => code.toUpperCase())
const grantSchema = z.object({ days: z.number().int().min(1).max(3650), reason: z.string().trim().min(3).max(200) })
const blockSchema = z.object({ reason: z.string().trim().max(200).optional() })
const percentSchema = z.object({ percent: z.number().min(0).max(100).nullable() })
const linkSchema = z.object({ enabled: z.boolean() })
/**
 * «Подтвердить оплату Boosty»: what the owner saw on Boosty. `region`: the region of the offer that was bought (default:
 * the account's); the period: `months` added, or `paidUntil` (Boosty's «оплачено до», a date); `amount` in roubles
 * (optional, for the statistics), `reference` the owner's note (the same one is refused twice), `reviewId` the review
 * item this settles.
 */
const boostyPaymentSchema = z.object({
  email: z.string().trim().min(3).max(254),
  offer: z.enum(['standard', 'friend']),
  region: z.enum(['CIS', 'WORLD']).optional(),
  months: z.union([z.literal(1), z.literal(3), z.literal(6), z.literal(12)]).optional(),
  days: z.number().int().min(1).max(400).optional(),
  paidUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}(T[\d:.]+Z)?$/).optional(),
  amount: z.number().finite().min(0).max(1_000_000).optional(),
  netAmount: z.number().finite().min(0).max(1_000_000).optional(),
  reference: z.string().trim().max(120).optional().transform((value) => value || undefined),
  reviewId: z.number().int().positive().optional(),
  recalculate: z.boolean().optional(),
}).strict().refine((input) => [input.months, input.days, input.paidUntil].filter((value) => value !== undefined).length === 1, { message: 'period' })
const boostyListSchema = z.object({ email: z.string().trim().max(254).optional() })
const reviewListSchema = z.object({ status: z.enum(['open', 'all']).default('open') })
const levelSchema = z.object({ offer: z.enum(BOOSTY_OFFER_KEYS).nullable() }).strict()
const pauseSchema = z.object({ paused: z.boolean() }).strict()
const sessionSchema = z.object({ session: z.string().min(20).max(12_000).optional(), auth: z.string().min(20).max(12_000).optional(), clientId: z.string().min(8).max(300).optional() }).strict()
  .refine((value) => Boolean(value.session || (value.auth && value.clientId)), 'Вставьте данные Boosty')
const MAX_PAID_AHEAD_MS = 400 * 24 * 60 * 60 * 1000

/** Existing owner routes whose successful calls go to the audit log too. Only validated, non-secret fields are kept. */
const AUDITED: Array<{ method: string; path: string; action: 'streamer.invite' | 'payout.decide' | 'payout.limits'; describe: (body: Record<string, unknown>) => { target?: string; details?: Record<string, unknown> } }> = [
  { method: 'POST', path: '/me/admin/streamer-invites', action: 'streamer.invite', describe: (body) => ({ target: String(body.code ?? '').trim().toUpperCase().slice(0, 24) }) },
  { method: 'POST', path: '/me/admin/payouts/decide', action: 'payout.decide', describe: (body) => ({ target: String(body.id ?? '').slice(0, 24), details: { status: String(body.status ?? '').slice(0, 10), ...(typeof body.comment === 'string' && body.comment ? { comment: body.comment.slice(0, 200) } : {}) } }) },
  { method: 'PUT', path: '/me/admin/payout-limits', action: 'payout.limits', describe: (body) => ({ details: { min: Number(body.min), max: Number(body.max) } }) },
]

/**
 * The Boosty session the owner pastes in the panel (PUT /me/admin/boosty/session): `save` keeps it next to the database,
 * `connect` starts the automatic issuance when the server had none.
 */
export interface BoostySessionHooks {
  blog: string
  save(credentials: BoostyCredentials): void
  connect(credentials: BoostyCredentials): BoostySync
}

export function createOwnerAdminRouter(accounts: AccountStore, admin: AdminStore, presence?: PresenceTracker, boosty?: BoostyPayments, boostySyncAtStart?: BoostySync, boostySession?: BoostySessionHooks) {
  let boostySync = boostySyncAtStart
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
    return { ...filter, q: filter.q || undefined, dateField: filter.dateField === 'paid' ? 'paid' : undefined }
  }
  const toUserQuery = (input: z.infer<typeof userQuerySchema>): UserQuery => {
    if (input.registeredFrom && input.registeredTo && input.registeredFrom > input.registeredTo) throw new AccountError(400, 'Начало периода позже конца')
    return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as UserQuery
  }

  router.get('/me/admin/stats', owner('read', (req, res) => {
    const { from, to } = statsSchema.parse(req.query)
    res.json(admin.stats(from, to))
  }))

  router.get('/me/admin/overview', owner('read', (_req, res) => { res.json(admin.overview()) }))
  router.get('/me/admin/online-stats', owner('read', (req, res) => {
    const { days } = onlineSchema.parse(req.query)
    res.json(admin.onlineStats(days))
  }))
  router.get('/me/admin/series', owner('read', (req, res) => {
    const { period } = periodSchema.parse(req.query)
    res.json({ period, rows: admin.series(period) })
  }))

  router.post('/me/admin/payments/:id/refunded', owner('write', (req, res, actor) => {
    res.json(admin.markRefunded(actor, z.string().regex(/^[a-f0-9]{24}$/).parse(req.params.id)))
  }))
  router.post('/me/admin/payments/:id/amount', owner('write', (req, res, actor) => {
    const id = z.string().regex(/^[a-f0-9]{24}$/).parse(req.params.id)
    const { amount, comment } = z.object({
      amount: z.number().finite().min(0).max(1_000_000).refine((value) => Math.abs(Math.round(value * 100) - value * 100) < 1e-6, 'At most two decimals'),
      comment: z.string().max(200).optional(),
    }).strict().parse(req.body)
    res.json(admin.setPaymentAmount(actor, id, amount, comment))
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
    const query = toUserQuery(userQuerySchema.parse(req.query))
    const { limit, offset } = pageSchema.parse(req.query)
    res.json(admin.userList(query, limit, offset))
  }))
  router.get('/me/admin/users.csv', owner('export', (req, res, actor) => {
    const query = toUserQuery(userQuerySchema.parse(req.query))
    const { csv, rows } = admin.usersCsv(query)
    admin.audit(actor, 'users.export', undefined, { rows, ...userQueryDetails(query) })
    res.set('Content-Type', 'text/csv; charset=utf-8')
    res.set('Content-Disposition', `attachment; filename="raidos-users-${new Date().toISOString().slice(0, 10)}.csv"`)
    res.send(csv)
  }))
  router.post('/me/admin/users/bulk-grant', owner('write', (req, res, actor) => {
    const input = bulkGrantSchema.parse(req.body)
    try {
      res.json(admin.bulkGrant(actor, {
        ...(input.ids ? { ids: input.ids } : { query: toUserQuery(input.filter!) }),
        days: input.days, reason: input.reason, dryRun: input.dryRun,
      }))
    } catch (error) {
      if (error instanceof BulkGrantLimitError) { res.status(400).json({ error: error.message, code: 'too_many', affected: error.affected, max: BULK_GRANT_MAX }); return }
      throw error
    }
  }))
  router.get('/me/admin/users/:id', owner('read', (req, res) => { res.json(admin.user(idSchema.parse(req.params.id))) }))
  router.post('/me/admin/users/:id/grant', owner('write', (req, res, actor) => {
    const { days, reason } = grantSchema.parse(req.body)
    res.json(admin.grant(actor, idSchema.parse(req.params.id), days, reason))
  }))
  router.post('/me/admin/users/:id/revoke', owner('write', (req, res, actor) => {
    const { days, reason } = grantSchema.parse(req.body)
    res.json(admin.revoke(actor, idSchema.parse(req.params.id), days, reason))
  }))
  router.get('/me/admin/users/:id/boosty', owner('read', (req, res) => {
    const id = idSchema.parse(req.params.id)
    admin.user(id)
    if (!boosty) throw new AccountError(503, 'Boosty не подключён')
    res.json(boosty.ownerView(id))
  }))
  const needBoosty = () => {
    if (!boosty) throw new AccountError(503, 'Boosty не подключён')
    return boosty
  }
  const syncStatus = () => boostySync?.status() ?? BOOSTY_SYNC_OFF
  router.get('/me/admin/boosty', owner('read', (_req, res) => {
    const store = needBoosty()
    res.json({ sync: syncStatus(), review: store.review({ status: 'open', limit: 50, offset: 0 }), levels: store.levels(), offers: BOOSTY_OFFER_TABLE.map(({ key, region, kind, levelId }) => ({ key, region, kind, levelId })) })
  }))
  router.post('/me/admin/boosty/payments', owner('write', (req, res, actor) => {
    const store = needBoosty()
    const input = boostyPaymentSchema.parse(req.body)
    let paidUntil: number | undefined
    if (input.paidUntil) {
      // A plain date is the end of that day (Moscow): Boosty shows «оплачено до» as a date.
      paidUntil = Date.parse(input.paidUntil.length === 10 ? `${input.paidUntil}T23:59:59+03:00` : input.paidUntil)
      const now = accounts.clock()
      if (!Number.isFinite(paidUntil) || paidUntil <= now || paidUntil > now + MAX_PAID_AHEAD_MS) throw new AccountError(400, 'Дата «оплачено до» должна быть в будущем, не дальше чем через 400 дней')
    }
    const amount = input.amount ?? 0
    try {
      const done = store.confirm(actor, {
        email: input.email, offer: input.offer, amount: Math.round(amount * 100),
        ...(input.netAmount !== undefined ? { netAmount: Math.round(input.netAmount * 100) } : {}),
        ...(input.region ? { region: input.region } : {}),
        ...(input.months !== undefined ? { months: input.months } : input.days !== undefined ? { days: input.days } : { paidUntil }),
        ...(input.recalculate ? { recalculate: true } : {}),
        ...(input.reference ? { reference: input.reference } : {}),
        ...(input.reviewId !== undefined ? { reviewId: input.reviewId } : {}),
      })
      admin.audit(actor, 'payment.boosty-confirm', accounts.emailOf(done.accountId), { paymentId: done.payment.id, offer: input.offer, region: done.region, ...(input.months ? { months: input.months } : done.days !== undefined || input.days !== undefined ? { days: done.days ?? input.days } : { paidUntil: input.paidUntil }), amount, ...(input.netAmount !== undefined ? { netAmount: input.netAmount } : {}), ...(done.days !== undefined ? { recalculated: true } : {}), ...(input.reference ? { reference: input.reference } : {}) })
      const record = store.list({ accountId: done.accountId, limit: 50, offset: 0 }).payments.find((item) => item.id === done.payment.id)
      res.status(201).json({ payment: record, user: admin.user(done.accountId).user, ...(done.days !== undefined ? { recalculatedDays: done.days } : {}) })
    } catch (error) {
      if (error instanceof BoostyGrantError) { res.status(error.status).json({ error: error.message, code: error.reason }); return }
      throw error
    }
  }))
  router.get('/me/admin/boosty/payments', owner('read', (req, res) => {
    const store = needBoosty()
    const { email } = boostyListSchema.parse(req.query)
    const { limit, offset } = pageSchema.parse(req.query)
    const accountId = email ? accounts.accountByEmail(email)?.id : undefined
    if (email && !accountId) { res.json({ payments: [], total: 0 }); return }
    res.json(store.list({ ...(accountId ? { accountId } : {}), limit, offset }))
  }))
  router.get('/me/admin/boosty/review', owner('read', (req, res) => {
    const store = needBoosty()
    const { status } = reviewListSchema.parse(req.query)
    const { limit, offset } = pageSchema.parse(req.query)
    res.json(store.review({ status, limit, offset }))
  }))
  router.post('/me/admin/boosty/review/:id/dismiss', owner('write', (req, res, actor) => {
    needBoosty().dismissReview(actor, z.coerce.number().int().positive().parse(req.params.id))
    res.json({ ok: true })
  }))
  router.put('/me/admin/boosty/levels/:levelId', owner('write', (req, res) => {
    const levelId = z.string().regex(/^\d{1,20}$/).parse(req.params.levelId)
    needBoosty().mapLevel(levelId, levelSchema.parse(req.body).offer)
    res.json({ levels: needBoosty().levels() })
  }))
  router.put('/me/admin/boosty/pause', owner('write', (req, res) => {
    const { paused } = pauseSchema.parse(req.body)
    if (!boostySync) throw new AccountError(409, 'Автовыдача Boosty выключена: на сервере нет BOOSTY_AUTH и BOOSTY_CLIENT_ID')
    boostySync.setPaused(paused)
    res.json({ sync: syncStatus() })
  }))
  // «Токен Boosty» (owner, 17.10.2026): a new session pasted in the panel replaces BOOSTY_AUTH without the server's files.
  // The values are never echoed, logged or audited.
  router.put('/me/admin/boosty/session', owner('write', (req, res, actor) => {
    needBoosty()
    if (!boostySession) throw new AccountError(503, 'Этот сервер не принимает токен Boosty из панели')
    const input = sessionSchema.parse(req.body)
    const credentials = boostySessionFrom(input, boostySession.blog)
    if (!credentials) throw new AccountError(400, 'Не похоже на данные Boosty: нужны auth (с accessToken и refreshToken) и _clientId с boosty.to')
    boostySession.save(credentials)
    if (boostySync) boostySync.replaceCredentials(credentials)
    else { boostySync = boostySession.connect(credentials); boostySync.start(1000) }
    admin.audit(actor, 'boosty.session', undefined, {})
    res.json({ sync: syncStatus() })
  }))
  router.post('/me/admin/boosty/sync', owner('write', async (_req, res) => {
    if (!boostySync) throw new AccountError(409, 'Автовыдача Boosty выключена: на сервере нет BOOSTY_AUTH и BOOSTY_CLIENT_ID')
    res.json({ sync: await boostySync.runOnce(true) })
  }))
  router.post('/me/admin/users/:id/cancel-autopay', owner('write', async (req, res, actor) => { res.json(await admin.cancelAutopay(actor, idSchema.parse(req.params.id))) }))
  router.post('/me/admin/users/:id/block', owner('write', (req, res, actor) => {
    const { reason } = blockSchema.parse(req.body ?? {})
    res.json(admin.setBlocked(actor, idSchema.parse(req.params.id), true, reason || undefined))
  }))
  router.post('/me/admin/users/:id/unblock', owner('write', (req, res, actor) => { res.json(admin.setBlocked(actor, idSchema.parse(req.params.id), false)) }))
  router.post('/me/admin/users/:id/revoke-sessions', owner('write', (req, res, actor) => { res.json(admin.revokeSessions(actor, idSchema.parse(req.params.id))) }))
  router.post('/me/admin/users/:id/eft-account/unbind', owner('write', (req, res, actor) => { res.json(admin.unbindEftAccount(actor, idSchema.parse(req.params.id))) }))
  router.post('/me/admin/users/:id/delete', owner('write', (req, res, actor) => { res.json(admin.deleteUser(actor, idSchema.parse(req.params.id))) }))

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

  // «Онлайн сейчас» (owner, 14.10.2026): the owner app reads it every ~45 s under «Ваши предложения», the website's
  // admin panel at its top. In memory, nothing personal: just the counts.
  router.get('/me/admin/online', owner('read', (_req, res) => {
    if (!presence) throw new AccountError(404, 'Не найдено')
    res.json(presence.count())
  }))

  router.get('/me/admin/sales-settings', owner('read', (_req, res) => { res.json(admin.salesSettings()) }))
  router.get('/me/admin/audit', owner('read', (req, res) => {
    const { limit, offset } = pageSchema.parse(req.query)
    res.json(admin.auditLog(limit, offset))
  }))

  return router
}
