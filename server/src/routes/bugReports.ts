/**
 * «Сообщить об ошибке» (services/bugReportStore.ts).
 *
 *   POST /v1/bug-reports  { topic, description, appVersion?, platform?, screenshots?: [{ data: base64 }] }  -> 201 { id, createdAt }
 *        Signed-in accounts only (Bearer). Up to 5 screenshots, PNG / JPEG / WEBP by magic bytes, ≤ 5 MB each,
 *        ≤ 25 MB together. 5 reports per hour per account and per IP.
 *
 * Owner only (TARKOV_OWNER_EMAILS with a confirmed e-mail): 401 without a session, 404 for everybody else.
 *   GET  /v1/accounts/me/admin/bug-reports?status=open|closed&limit&offset -> { reports, total, counts: { open, closed } }
 *   GET  /v1/accounts/me/admin/bug-reports/:id                            -> { report } (description, file metadata)
 *   GET  /v1/accounts/me/admin/bug-reports/:id/files/:idx                 -> the image bytes (inline, no-store, nosniff)
 *   POST /v1/accounts/me/admin/bug-reports/:id/status  { status }         -> { report } (audit: bug.status)
 *
 * Mounted in app.ts BEFORE the global `express.json({ limit: '1mb' })`: the upload has its own JSON parser with a
 * limit that fits 25 MB of screenshots in base64; the other routes parse at most a few kilobytes.
 */
import express from 'express'
import type { Request, Response } from 'express'
import { z } from 'zod'
import { bearer, FixedWindowRateLimiter, type AccountStore } from '../services/accountStore.js'
import { BUG_REPORT_LIMITS, BugReportError, type BugReportStore } from '../services/bugReportStore.js'

/** Base64 of 25 MB is ~33.4 MB; the topic, description and JSON around it fit in the rest. */
export const BUG_REPORT_BODY_LIMIT = '36mb'
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/
const DATA_URL_PREFIX = /^data:image\/(?:png|jpeg|webp);base64,/

const uploadSchema = z.object({
  topic: z.string().trim().min(1).max(BUG_REPORT_LIMITS.topic),
  description: z.string().trim().min(1).max(BUG_REPORT_LIMITS.description),
  appVersion: z.string().trim().max(80).default(''),
  platform: z.string().trim().max(160).default(''),
  screenshots: z.array(z.object({ data: z.string().max(Math.ceil(BUG_REPORT_LIMITS.fileBytes / 3) * 4 + 64) })).max(20).default([]),
})
const pageSchema = z.object({
  status: z.enum(['open', 'closed']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
})
const idSchema = z.coerce.number().int().min(1).max(Number.MAX_SAFE_INTEGER)
const idxSchema = z.coerce.number().int().min(0).max(BUG_REPORT_LIMITS.files - 1)
const statusSchema = z.object({ status: z.enum(['open', 'closed']) })

export type BugReportAudit = (actor: string, action: 'bug.status', target: string, details: Record<string, unknown>) => void
export interface BugReportLimits { perAccount: number; perIp: number; windowMs: number }
export const BUG_REPORT_RATE_LIMITS: BugReportLimits = { perAccount: 5, perIp: 5, windowMs: 60 * 60 * 1000 }

function decodeScreenshot(raw: string) {
  const data = raw.replace(DATA_URL_PREFIX, '').replace(/\s+/g, '')
  if (!BASE64.test(data) || data.length % 4 === 1) throw new BugReportError(400, 'Повреждённый файл скриншота')
  return Buffer.from(data, 'base64')
}

export function createBugReportsRouter(accounts: AccountStore, store: BugReportStore, options: { audit?: BugReportAudit; limits?: Partial<BugReportLimits> } = {}) {
  const router = express.Router()
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
    const retry = attemptLimiter.hit(`account:${accountId}`) || attemptLimiter.hit(`ip:${req.ip ?? 'unknown'}`)
    if (retry) { req.resume(); res.set('Retry-After', String(retry)).set('Connection', 'close').status(429).json({ error: 'Слишком много отчётов. Попробуйте через час.' }); return }
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
      const retry = accountLimiter.hit(accountId) || ipLimiter.hit(req.ip ?? 'unknown')
      if (retry) { res.set('Retry-After', String(retry)).status(429).json({ error: 'Слишком много отчётов. Попробуйте через час.' }); return }
      const created = store.create(accountId, accounts.emailOf(accountId), { topic: body.data.topic, description: body.data.description, appVersion: body.data.appVersion, platform: body.data.platform, files })
      res.status(201).json(created)
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
    res.json(store.list(query.data.status, query.data.limit, query.data.offset))
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

  router.post('/v1/accounts/me/admin/bug-reports/:id/status', express.json({ limit: '4kb' }), (req, res) => {
    const actor = owner('write', req, res)
    if (!actor) return
    const body = statusSchema.safeParse(req.body)
    if (!body.success) { res.status(400).json({ error: 'Некорректный статус' }); return }
    const id = idSchema.safeParse(req.params.id)
    const report = id.success ? store.setStatus(id.data, body.data.status) : undefined
    if (!report) { notFound(res); return }
    try { options.audit?.(actor, 'bug.status', String(report.id), { status: report.status }) } catch { /* the status is already saved */ }
    res.json({ report })
  })

  return router
}
