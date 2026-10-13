/**
 * «Сообщить об ошибке» and «Ваши предложения» (services/bugReportStore.ts): one endpoint, `kind` tells them apart.
 *
 *   POST /v1/bug-reports  { kind?: 'bug' | 'idea', category?, quest?, topic, description, appVersion?, platform?, screenshots?: [{ data: base64 }] }
 *        -> 201 { id, createdAt }. `kind` is 'bug' when not given (apps before 13.10.2026). `category`: what the bug is
 *        about (src/shared/reportCategories.ts); `quest` (category «Квест»): { questId, issue, mode?, mapId?, markerId?,
 *        objectiveId?, stageIndex?, point?: { x, z, floor? }, pointNote?, questNote? } — a quest correction the player
 *        proposes (owner, 13.10.2026); with it the description may be empty.
 *        Signed-in accounts only (Bearer). Up to 5 screenshots, PNG / JPEG / WEBP by magic bytes, ≤ 5 MB each,
 *        ≤ 25 MB together. 5 reports per hour per account and per IP (an IPv6 /64 counts as one address). At most
 *        MAX_CONCURRENT_UPLOADS bodies are read at a time (503 + Retry-After past that). Screenshots past the global
 *        storage quota: 507 (text-only reports still go through); see services/bugReportStore.ts for retention.
 *
 * Owner only (TARKOV_OWNER_EMAILS with a confirmed e-mail): 401 without a session, 404 for everybody else.
 *   GET  /v1/accounts/me/admin/bug-reports?status=open|closed&kind=bug|idea&limit&offset
 *        -> { reports, total, counts: { open, closed } (of that kind), kinds: { bug, idea } (open ones) }
 *   GET  /v1/accounts/me/admin/bug-reports/:id                            -> { report } (description, file metadata)
 *   GET  /v1/accounts/me/admin/bug-reports/:id/files/:idx                 -> the image bytes (inline, no-store, nosniff)
 *   GET  /v1/accounts/me/admin/bug-reports/:id/files/:idx/data            -> { mime, data: base64 } (the owner app's gateway
 *        forwards JSON only)
 *   GET  /v1/accounts/me/admin/requests/events?since=<version>            -> { version, open } long polling (~25 s): the
 *        owner app's «Заявки» badge moves the moment a report arrives or is closed
 *   POST /v1/accounts/me/admin/bug-reports/:id/status  { status }         -> { report } (audit: bug.status)
 *   POST /v1/accounts/me/admin/bug-reports/:id/reward  { days 1–365 }     -> { report } subscription days for the reporter
 *        («Нашёл баг или ошибку? +1 день», owner 11.10.2026): granted like «Выдать подписку» with the reason
 *        «Отчёт об ошибке №N» («Предложение №N» for an idea) and added to the report's reward_days (audit: bug.reward);
 *        409 when the account is gone.
 *   POST /v1/accounts/me/admin/bug-reports/:id/mail                       -> { report } sends the report's PDF to the
 *        owner's mailbox again (audit: bug.mail); 503 when e-mail is not configured.
 *
 * Every new report goes to the owner's mailbox as a PDF (services/bugReportMail.ts, TARKOV_BUG_REPORT_EMAIL), in the
 * background: the player's answer never waits for it, and a failure is kept on the report for the admin panel.
 *
 * Mounted in app.ts BEFORE the global `express.json({ limit: '1mb' })`: the upload has its own JSON parser with a
 * limit that fits 25 MB of screenshots in base64; the other routes parse at most a few kilobytes.
 */
import express from 'express'
import type { Request, Response } from 'express'
import { z } from 'zod'
import { bearer, FixedWindowRateLimiter, type AccountStore } from '../services/accountStore.js'
import { BUG_REPORT_LIMITS, BugReportError, STORAGE_FULL_MESSAGE, type BugReportStore } from '../services/bugReportStore.js'
import { ipRateKey } from '../services/securityGuard.js'
import type { MapUpdates } from './mapUpdates.js'
import { QUEST_ISSUES, REPORT_CATEGORIES, REPORT_MODES } from '../../../src/shared/reportCategories.js'

/** Base64 of 25 MB is ~33.4 MB; the topic, description and JSON around it fit in the rest. */
export const BUG_REPORT_BODY_LIMIT = '36mb'
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/
const DATA_URL_PREFIX = /^data:image\/(?:png|jpeg|webp);base64,/

const kindSchema = z.enum(['bug', 'idea'])
const ident = z.string().trim().regex(/^[A-Za-z0-9_.:-]{1,200}$/)
/** Game metres; the largest maps are well within ±2000. */
const metres = z.number().finite().min(-5000).max(5000)
const questSchema = z.object({
  questId: ident,
  issue: z.enum(QUEST_ISSUES),
  mode: z.enum(REPORT_MODES).optional(),
  mapId: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/).optional(),
  markerId: ident.optional(),
  objectiveId: ident.optional(),
  stageIndex: z.number().int().min(0).max(200).optional(),
  point: z.object({ x: metres, z: metres, floor: z.string().trim().min(1).max(40).optional() }).optional(),
  pointNote: z.string().trim().max(300).optional().transform((value) => value || undefined),
  questNote: z.string().trim().max(1000).optional().transform((value) => value || undefined),
}).refine((quest) => !quest.point || quest.mapId, { message: 'A proposed point needs its map' })
const uploadSchema = z.object({
  kind: kindSchema.default('bug'),
  category: z.enum(REPORT_CATEGORIES).optional(),
  quest: questSchema.optional(),
  topic: z.string().trim().min(1).max(BUG_REPORT_LIMITS.topic),
  // A quest correction may be the whole report (a proposed point and notes): its description may stay empty.
  description: z.string().trim().max(BUG_REPORT_LIMITS.description).default(''),
  appVersion: z.string().trim().max(80).default(''),
  platform: z.string().trim().max(160).default(''),
  screenshots: z.array(z.object({ data: z.string().max(Math.ceil(BUG_REPORT_LIMITS.fileBytes / 3) * 4 + 64) })).max(20).default([]),
}).refine((report) => report.description.length > 0 || report.quest, { message: 'Describe the problem' })
const eventsSchema = z.object({ since: z.string().regex(/^\d{1,16}$/).optional() })
const pageSchema = z.object({
  status: z.enum(['open', 'closed']).optional(),
  kind: kindSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
})
const idSchema = z.coerce.number().int().min(1).max(Number.MAX_SAFE_INTEGER)
const idxSchema = z.coerce.number().int().min(0).max(BUG_REPORT_LIMITS.files - 1)
const statusSchema = z.object({ status: z.enum(['open', 'closed']) })
const rewardSchema = z.object({ days: z.number().int().min(1).max(365) })

export type BugReportAudit = (actor: string, action: 'bug.status' | 'bug.reward' | 'bug.mail', target: string, details: Record<string, unknown>) => void
/** Sends a report's PDF to the owner (services/bugReportMail.ts). */
export interface BugReportMail {
  readonly enabled: boolean
  /** In the background, one after another (a new report). */
  queue(id: number): void
  /** Now; resolves with the report as it is afterwards (mailed or the error). */
  send(id: number): Promise<unknown>
}
/** Grants subscription days to an account (AdminStore.grant). */
export type GrantDays = (actor: string, accountId: string, days: number, reason: string) => void
export interface BugReportLimits { perAccount: number; perIp: number; windowMs: number }
export const BUG_REPORT_RATE_LIMITS: BugReportLimits = { perAccount: 5, perIp: 5, windowMs: 60 * 60 * 1000 }
/** Upload bodies read at the same time (each may be ~36 MB of JSON in memory while it is parsed). */
export const MAX_CONCURRENT_UPLOADS = 2
/** A report without screenshots is a few kilobytes; a bigger body while the screenshot storage is full is refused unread. */
const TEXT_ONLY_BODY_BYTES = 64 * 1024

function safeFull(store: BugReportStore) {
  try { return store.screenshotsFull() } catch { return false }
}

function decodeScreenshot(raw: string) {
  const data = raw.replace(DATA_URL_PREFIX, '').replace(/\s+/g, '')
  if (!BASE64.test(data) || data.length % 4 === 1) throw new BugReportError(400, 'Повреждённый файл скриншота')
  return Buffer.from(data, 'base64')
}

/** `signals`: the owner app's «Заявки» long polling (a MapUpdates whose answers carry `open`), told on every new or closed report. */
export function createBugReportsRouter(accounts: AccountStore, store: BugReportStore, options: { audit?: BugReportAudit; limits?: Partial<BugReportLimits>; maxConcurrentUploads?: number; mail?: BugReportMail; grant?: GrantDays; signals?: MapUpdates } = {}) {
  const router = express.Router()
  const maxUploads = options.maxConcurrentUploads ?? MAX_CONCURRENT_UPLOADS
  let uploads = 0
  const limits = { ...BUG_REPORT_RATE_LIMITS, ...options.limits }
  const accountLimiter = new FixedWindowRateLimiter(limits.perAccount, limits.windowMs)
  const ipLimiter = new FixedWindowRateLimiter(limits.perIp, limits.windowMs)
  const readLimiter = new FixedWindowRateLimiter(600, 60 * 1000)
  const writeLimiter = new FixedWindowRateLimiter(60, 60 * 1000)

  // Uploads may be large, so the session and a cheap attempt limit are checked BEFORE the body is read: nobody without an
  // account (and no account sending in a loop) can make the server buffer and parse tens of megabytes.
  const attemptLimiter = new FixedWindowRateLimiter(limits.perAccount * 4, limits.windowMs)
  const beforeBody: express.RequestHandler = (req, res, next) => {
    res.set('Cache-Control', 'no-store')
    const accountId = accounts.authenticate(bearer(req.get('authorization')))
    if (!accountId) { req.resume(); res.status(401).set('Connection', 'close').json({ error: 'Войдите в аккаунт, чтобы отправить отчёт об ошибке' }); return }
    // A global cap on bodies being read: a few accounts cannot make the server hold many large uploads at once.
    if (uploads >= maxUploads) { req.resume(); res.set('Retry-After', '10').set('Connection', 'close').status(503).json({ error: 'Сервер сейчас принимает другие отчёты. Повторите через несколько секунд.' }); return }
    const retry = attemptLimiter.hit(`account:${accountId}`) || attemptLimiter.hit(`ip:${ipRateKey(req.ip)}`)
    if (retry) { req.resume(); res.set('Retry-After', String(retry)).set('Connection', 'close').status(429).json({ error: 'Слишком много отчётов. Попробуйте через час.' }); return }
    if (Number(req.get('content-length') ?? 0) > TEXT_ONLY_BODY_BYTES && safeFull(store)) { req.resume(); res.set('Connection', 'close').status(507).json({ error: STORAGE_FULL_MESSAGE }); return }
    uploads += 1
    let released = false
    const release = () => { if (!released) { released = true; uploads -= 1 } }
    res.once('finish', release)
    res.once('close', release)
    res.locals.accountId = accountId
    next()
  }

  router.post('/v1/bug-reports', beforeBody, express.json({ limit: BUG_REPORT_BODY_LIMIT }), (req, res) => {
    const accountId = String(res.locals.accountId)
    const body = uploadSchema.safeParse(req.body)
    if (!body.success) { res.status(400).json({ error: 'Укажите тему (до 120 символов) и описание (до 5000 символов)' }); return }
    try {
      if (body.data.screenshots.length > BUG_REPORT_LIMITS.files) throw new BugReportError(400, `Не больше ${BUG_REPORT_LIMITS.files} скриншотов`)
      const files = body.data.screenshots.map((shot) => decodeScreenshot(shot.data))
      const retry = accountLimiter.hit(accountId) || ipLimiter.hit(ipRateKey(req.ip))
      if (retry) { res.set('Retry-After', String(retry)).status(429).json({ error: 'Слишком много отчётов. Попробуйте через час.' }); return }
      const created = store.create(accountId, accounts.emailOf(accountId), {
        kind: body.data.kind, category: body.data.kind === 'bug' ? body.data.category : undefined, quest: body.data.kind === 'bug' ? body.data.quest : undefined,
        topic: body.data.topic, description: body.data.description, appVersion: body.data.appVersion, platform: body.data.platform, files,
      })
      res.status(201).json(created)
      try { options.signals?.changed() } catch { /* the badge catches up on its next wait */ }
      try { options.mail?.queue(created.id) } catch { /* the report is saved; the owner can send the PDF from the panel */ }
    } catch (error) {
      if (error instanceof BugReportError) { res.status(error.status).json({ error: error.message }); return }
      throw error
    }
  })

  /** The owner's e-mail, or an answer was already sent. */
  const owner = (kind: 'read' | 'write', req: Request, res: Response) => {
    res.set('Cache-Control', 'no-store')
    const id = accounts.authenticate(bearer(req.get('authorization')))
    if (!id) { res.status(401).json({ error: 'Требуется вход в аккаунт' }); return undefined }
    if (!accounts.isOwner(id)) { res.status(404).json({ error: 'Не найдено' }); return undefined }
    const retry = (kind === 'read' ? readLimiter : writeLimiter).hit(id)
    if (retry) { res.set('Retry-After', String(retry)).status(429).json({ error: 'Слишком много запросов. Подождите минуту.' }); return undefined }
    return accounts.emailOf(id) ?? id
  }
  const notFound = (res: Response) => { res.status(404).json({ error: 'Отчёт не найден' }) }

  router.get('/v1/accounts/me/admin/bug-reports', (req, res) => {
    if (!owner('read', req, res)) return
    const query = pageSchema.safeParse(req.query)
    if (!query.success) { res.status(400).json({ error: 'Некорректные данные запроса' }); return }
    res.json(store.list(query.data.status, query.data.limit, query.data.offset, query.data.kind))
  })

  router.get('/v1/accounts/me/admin/bug-reports/:id', (req, res) => {
    if (!owner('read', req, res)) return
    const id = idSchema.safeParse(req.params.id)
    const report = id.success ? store.get(id.data) : undefined
    if (!report) { notFound(res); return }
    res.json({ report })
  })

  router.get('/v1/accounts/me/admin/bug-reports/:id/files/:idx', (req, res) => {
    if (!owner('read', req, res)) return
    const id = idSchema.safeParse(req.params.id)
    const idx = idxSchema.safeParse(req.params.idx)
    const file = id.success && idx.success ? store.file(id.data, idx.data) : undefined
    if (!file) { res.status(404).json({ error: 'Файл не найден' }); return }
    const extension = file.mime.slice('image/'.length).replace('jpeg', 'jpg')
    res.set({
      'Content-Type': file.mime,
      'Content-Length': String(file.data.length),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `inline; filename="bug-${id.data}-${idx.data! + 1}.${extension}"`,
      'Content-Security-Policy': "default-src 'none'; sandbox",
    })
    res.end(file.data)
  })

  router.get('/v1/accounts/me/admin/bug-reports/:id/files/:idx/data', (req, res) => {
    if (!owner('read', req, res)) return
    const id = idSchema.safeParse(req.params.id)
    const idx = idxSchema.safeParse(req.params.idx)
    const file = id.success && idx.success ? store.file(id.data, idx.data) : undefined
    if (!file) { res.status(404).json({ error: 'Файл не найден' }); return }
    res.json({ mime: file.mime, data: file.data.toString('base64') })
  })

  // «Заявки» (owner app, bottom left): waits for the next new or closed report and answers with the open count.
  router.get('/v1/accounts/me/admin/requests/events', (req, res) => {
    res.set('Cache-Control', 'no-store')
    const id = accounts.authenticate(bearer(req.get('authorization')))
    if (!id) { res.status(401).json({ error: 'Требуется вход в аккаунт' }); return }
    if (!accounts.isOwner(id)) { res.status(404).json({ error: 'Не найдено' }); return }
    const query = eventsSchema.safeParse(req.query)
    if (!query.success) { res.status(400).json({ error: 'Некорректный запрос' }); return }
    if (!options.signals) { res.json({ version: 0, open: store.openCount() }); return }
    options.signals.wait(res, `owner:${id}`, query.data.since === undefined ? undefined : Number(query.data.since))
  })

  router.post('/v1/accounts/me/admin/bug-reports/:id/status', express.json({ limit: '4kb' }), (req, res) => {
    const actor = owner('write', req, res)
    if (!actor) return
    const body = statusSchema.safeParse(req.body)
    if (!body.success) { res.status(400).json({ error: 'Некорректный статус' }); return }
    const id = idSchema.safeParse(req.params.id)
    const report = id.success ? store.setStatus(id.data, body.data.status) : undefined
    if (!report) { notFound(res); return }
    try { options.audit?.(actor, 'bug.status', String(report.id), { status: report.status }) } catch { /* the status is already saved */ }
    try { options.signals?.changed() } catch { /* the badge catches up on its next wait */ }
    res.json({ report })
  })

  router.post('/v1/accounts/me/admin/bug-reports/:id/reward', express.json({ limit: '4kb' }), (req, res) => {
    const actor = owner('write', req, res)
    if (!actor) return
    const body = rewardSchema.safeParse(req.body)
    if (!body.success) { res.status(400).json({ error: 'Число дней: от 1 до 365' }); return }
    const id = idSchema.safeParse(req.params.id)
    const report = id.success ? store.get(id.data) : undefined
    if (!report) { notFound(res); return }
    if (!options.grant) { res.status(503).json({ error: 'Выдача подписки на этом сервере недоступна' }); return }
    if (!report.accountId) { res.status(409).json({ error: 'Аккаунт отправителя удалён: дни выдать некому' }); return }
    try {
      options.grant(actor, report.accountId, body.data.days, `${report.kind === 'idea' ? 'Предложение' : 'Отчёт об ошибке'} №${report.id}`)
    } catch (error) {
      // AccountError (404 «Пользователь не найден», …) answers as it is; anything else is a server fault
      const status = (error as { status?: unknown }).status
      if (typeof status !== 'number') throw error
      res.status(status).json({ error: error instanceof Error ? error.message : 'Не удалось выдать дни' })
      return
    }
    const updated = store.addReward(report.id, body.data.days)
    try { options.audit?.(actor, 'bug.reward', String(report.id), { days: body.data.days, email: report.email ?? null }) } catch { /* the days are already granted */ }
    res.json({ report: updated })
  })

  router.post('/v1/accounts/me/admin/bug-reports/:id/mail', async (req, res) => {
    const actor = owner('write', req, res)
    if (!actor) return
    const id = idSchema.safeParse(req.params.id)
    const report = id.success ? store.get(id.data) : undefined
    if (!report) { notFound(res); return }
    if (!options.mail?.enabled) { res.status(503).json({ error: 'Отправка писем на сервере не настроена (TARKOV_EMAIL_PROVIDER, TARKOV_EMAIL_API_KEY)' }); return }
    await options.mail.send(report.id)
    try { options.audit?.(actor, 'bug.mail', String(report.id), {}) } catch { /* the mail went out already */ }
    res.json({ report: store.get(report.id) })
  })

  return router
}
