/**
 * «Пригласи друга» (services/invites.ts), mounted at `/v1/accounts`.
 *
 *   GET  /me/invites                         Bearer -> program (code, counters, rank, next rank, rewards)
 *   PUT  /me/invites/code     { code }       Bearer -> program (only while nobody has used the current code)
 *   GET  /me/admin/invite-rewards?status&limit&offset   owner -> { rewards, total, counts }
 *   POST /me/admin/invite-rewards/:id/decide { decision: 'approve' | 'cancel', comment? }  owner -> reward
 *
 * Owner routes answer 404 to everybody else, like the rest of the admin panel.
 */
import express from 'express'
import type { Request, Response } from 'express'
import { z } from 'zod'
import { AccountError, bearer, FixedWindowRateLimiter, type AccountStore } from '../services/accountStore.js'
import type { InviteProgram, RewardStatus } from '../services/invites.js'

const listSchema = z.object({
  status: z.enum(['pending', 'review', 'granted', 'canceled']).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
})
const decideSchema = z.object({ decision: z.enum(['approve', 'cancel']), comment: z.string().trim().max(300).optional() })

export function createInvitesRouter(accounts: AccountStore, invites: InviteProgram, audit?: (actor: string, action: 'invite.decide', target: string, details: Record<string, unknown>) => void) {
  const router = express.Router()
  const writes = new FixedWindowRateLimiter(20, 15 * 60 * 1000)

  const handle = (run: (req: Request, res: Response, accountId: string) => void) => (req: Request, res: Response) => {
    res.set('Cache-Control', 'no-store')
    const accountId = accounts.authenticate(bearer(req.get('authorization')))
    if (!accountId) { res.status(401).json({ error: 'Требуется вход в аккаунт' }); return }
    try {
      run(req, res, accountId)
    } catch (error) {
      if (error instanceof AccountError) { res.status(error.status).json({ error: error.message }); return }
      if (error instanceof z.ZodError) { res.status(400).json({ error: 'Некорректные данные запроса' }); return }
      throw error
    }
  }
  const owner = (run: (req: Request, res: Response, actor: string) => void) => handle((req, res, accountId) => {
    const email = accounts.isOwner(accountId) ? accounts.emailOf(accountId) : undefined
    if (!email) { res.status(404).json({ error: 'Не найдено' }); return }
    run(req, res, email)
  })

  router.get('/me/invites', handle((_req, res, accountId) => { res.json(invites.program(accountId)) }))
  router.put('/me/invites/code', handle((req, res, accountId) => {
    const retry = writes.hit(`invite-code:${accountId}`)
    if (retry) { res.set('Retry-After', String(retry)).status(429).json({ error: 'Слишком много попыток. Попробуйте позже.' }); return }
    const { code } = z.object({ code: z.string().max(40) }).parse(req.body)
    res.json(invites.setCode(accountId, code))
  }))

  router.get('/me/admin/invite-rewards', owner((req, res) => {
    const { status, limit, offset } = listSchema.parse(req.query)
    res.json(invites.adminList(status as RewardStatus | undefined, limit, offset))
  }))
  router.post('/me/admin/invite-rewards/:id/decide', owner((req, res, actor) => {
    const id = z.coerce.number().int().min(1).max(Number.MAX_SAFE_INTEGER).parse(req.params.id)
    const { decision, comment } = decideSchema.parse(req.body)
    const reward = invites.decide(actor, id, decision, comment || undefined)
    try { audit?.(actor, 'invite.decide', reward.inviter, { id, decision, ...(comment ? { comment } : {}) }) } catch { /* the decision is already stored */ }
    res.json(reward)
  }))

  return router
}
