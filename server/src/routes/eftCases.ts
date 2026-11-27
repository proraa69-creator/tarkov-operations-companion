/**
 * «Отчёты» → «Аккаунты Таркова» (services/eftLedger.ts; owner, 15.11.2026), the owner only:
 *   GET  /v1/accounts/me/admin/eft-cases?view=active|working|closed&limit&offset -> { rows, counts: { active, working, closed },
 *        disputes: { rows, counts } } — «спор за игровой аккаунт» beside the cases (owner, 27.11.2026; apps from before it
 *        read `rows` and `counts` only)
 *   POST /v1/accounts/me/admin/eft-cases/:id/status  { status: active|working|closed } -> { case } (audit: eft.case-status)
 *   POST /v1/accounts/me/admin/eft-disputes/:id/status  { status: active|working } -> { dispute } («Взять» / «Вернуть»;
 *        audit: eft.case-status, kind dispute)
 *   POST /v1/accounts/me/admin/eft-disputes/:id/decision  { decision: keep|transfer|unbind } -> { dispute } («Оставить
 *        привязку» / «Отдать спорящему» / «Снять обе», AccountStore.decideEftDispute; audit: eft.dispute)
 * Anybody else gets 404. Personal: `Cache-Control: no-store`.
 */
import express from 'express'
import type { Request, Response } from 'express'
import { z } from 'zod'
import { AccountError, bearer, FixedWindowRateLimiter, type AccountStore } from '../services/accountStore.js'
import { EFT_CASE_STATUSES, EFT_DISPUTE_CHOICES } from '../services/eftLedger.js'
import type { AuditAction } from '../services/adminStore.js'

const listSchema = z.object({
  view: z.enum(['active', 'working', 'closed']).default('active'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
})
const statusSchema = z.object({ status: z.enum(EFT_CASE_STATUSES as unknown as ['active', 'working', 'closed']) })
const disputeStatusSchema = z.object({ status: z.enum(['active', 'working']) })
const decisionSchema = z.object({ decision: z.enum(EFT_DISPUTE_CHOICES) })
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
  const told = () => { try { options.changed?.() } catch { /* the badge catches up */ } }

  router.get('/v1/accounts/me/admin/eft-cases', (req, res) => {
    if (!owner(req, res)) return
    const query = listSchema.safeParse(req.query)
    if (!query.success) { res.status(400).json({ error: 'Некорректный запрос' }); return }
    const { view, limit, offset } = query.data
    res.json({ ...accounts.eftLedger.list(view, limit, offset), disputes: accounts.eftLedger.listDisputes(view, limit, offset) })
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
    told()
    res.json({ case: updated })
  })

  router.post('/v1/accounts/me/admin/eft-disputes/:id/status', express.json({ limit: '4kb' }), (req, res) => {
    const actor = owner(req, res)
    if (!actor) return
    const id = idSchema.safeParse(req.params.id)
    const body = disputeStatusSchema.safeParse(req.body)
    if (!id.success || !body.success) { res.status(400).json({ error: 'Некорректный статус' }); return }
    let dispute
    try {
      dispute = accounts.setEftDisputeStatus(id.data, body.data.status)
    } catch (error) {
      if (error instanceof AccountError) { res.status(error.status).json({ error: error.message }); return }
      throw error
    }
    try { options.audit?.(actor, 'eft.case-status', String(dispute.id), { status: dispute.status, kind: 'dispute' }) } catch { /* saved already */ }
    told()
    res.json({ dispute })
  })

  router.post('/v1/accounts/me/admin/eft-disputes/:id/decision', express.json({ limit: '4kb' }), (req, res) => {
    const actor = owner(req, res)
    if (!actor) return
    const id = idSchema.safeParse(req.params.id)
    const body = decisionSchema.safeParse(req.body)
    if (!id.success || !body.success) { res.status(400).json({ error: 'Некорректное решение' }); return }
    let dispute
    try {
      dispute = accounts.decideEftDispute(id.data, body.data.decision)
    } catch (error) {
      if (error instanceof AccountError) { res.status(error.status).json({ error: error.message }); return }
      throw error
    }
    // The owner's journal (owner, 27.11.2026): the decision, the game account and both accounts.
    try {
      options.audit?.(actor, 'eft.dispute', dispute.disputer.email ?? dispute.disputer.accountId, { decision: body.data.decision, case: dispute.id, eft: dispute.eft, holder: dispute.holder.email ?? dispute.holder.accountId })
    } catch { /* decided already */ }
    told()
    res.json({ dispute })
  })
  return router
}
