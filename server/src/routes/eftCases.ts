/**
 * «Отчёты» → «Аккаунты Таркова» (services/eftLedger.ts; owner, 15.11.2026), the owner only:
 *   GET  /v1/accounts/me/admin/eft-cases?view=active|working|closed&limit&offset -> { rows, counts: { active, working, closed } }
 *   POST /v1/accounts/me/admin/eft-cases/:id/status  { status: active|working|closed } -> { case } (audit: eft.case-status)
 * Anybody else gets 404. Personal: `Cache-Control: no-store`.
 */
import express from 'express'
import type { Request, Response } from 'express'
import { z } from 'zod'
import { bearer, FixedWindowRateLimiter, type AccountStore } from '../services/accountStore.js'
import { EFT_CASE_STATUSES } from '../services/eftLedger.js'
import type { AuditAction } from '../services/adminStore.js'

const listSchema = z.object({
  view: z.enum(['active', 'working', 'closed']).default('active'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
})
const statusSchema = z.object({ status: z.enum(EFT_CASE_STATUSES as unknown as ['active', 'working', 'closed']) })
const idSchema = z.coerce.number().int().min(1).max(1e12)

export function createEftCasesRouter(accounts: AccountStore, options: { audit?: (actor: string, action: AuditAction, target: string, details: Record<string, unknown>) => void; changed?: () => void } = {}) {
  const router = express.Router()
  const limiter = new FixedWindowRateLimiter(120, 60_000)
  const owner = (req: Request, res: Response) => {
    res.set('Cache-Control', 'no-store')
    const id = accounts.authenticate(bearer(req.get('authorization')))
    if (!id) { res.status(401).json({ error: 'Требуется вход в аккаунт' }); return undefined }
    if (!accounts.isOwner(id)) { res.status(404).json({ error: 'Не найдено' }); return undefined }
    const retry = limiter.hit(id)
    if (retry) { res.set('Retry-After', String(retry)).status(429).json({ error: 'Слишком много запросов. Подождите минуту.' }); return undefined }
    return accounts.emailOf(id) ?? id
  }

  router.get('/v1/accounts/me/admin/eft-cases', (req, res) => {
    if (!owner(req, res)) return
    const query = listSchema.safeParse(req.query)
    if (!query.success) { res.status(400).json({ error: 'Некорректный запрос' }); return }
    res.json(accounts.eftLedger.list(query.data.view, query.data.limit, query.data.offset))
  })

  router.post('/v1/accounts/me/admin/eft-cases/:id/status', express.json({ limit: '4kb' }), (req, res) => {
    const actor = owner(req, res)
    if (!actor) return
    const id = idSchema.safeParse(req.params.id)
    const body = statusSchema.safeParse(req.body)
    if (!id.success || !body.success) { res.status(400).json({ error: 'Некорректный статус' }); return }
    const updated = accounts.eftLedger.setStatus(id.data, body.data.status)
    if (!updated) { res.status(404).json({ error: 'Случай не найден' }); return }
    try { options.audit?.(actor, 'eft.case-status', String(updated.id), { status: updated.status }) } catch { /* saved already */ }
    try { options.changed?.() } catch { /* the badge catches up */ }
    res.json({ case: updated })
  })
  return router
}
