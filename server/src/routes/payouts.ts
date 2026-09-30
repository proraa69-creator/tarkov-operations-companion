/**
 * Streamer payouts (services/payoutStore.ts), mounted at `/v1/accounts` next to the accounts router. Every route needs
 * the site/app session (`Authorization: Bearer <token>`), so the desktop app can show the same cabinet through its
 * service gateway.
 *
 * Streamer (403 for other accounts):
 *   GET  /me/payouts                 -> 200 { percent, earned, paidOut, pending, available, minimum, currency,
 *                                            details: { phone (masked), bank, recipient } | null,
 *                                            autoPayout: { enabled, intervalDays, limits: { min, max }, nextAt },
 *                                            payouts: [{ id, amount, status, auto, createdAt, decidedAt?, comment?, destination }] }
 *   PUT  /me/payout-settings         { phone?, bank?, recipient?, auto?, intervalDays? } -> 200 same as GET /me/payouts
 *   POST /me/payouts                 { amount } (roubles, ≥ minimum, ≤ available; one open request) -> 201 payout
 *
 * Owner (TARKOV_OWNER_EMAILS; 404 for everybody else):
 *   GET  /me/admin/payouts           -> 200 { payouts: [... + code, email, phone, bank, recipient], limits: { min, max } }
 *   POST /me/admin/payouts/decide    { id, status: 'paid' | 'rejected', comment? } -> 200 payout
 *   PUT  /me/admin/payout-limits     { min, max } (days the streamers may choose for auto-payout) -> 200 { limits }
 *
 * Amounts are roubles. Nothing here moves money: the owner transfers it and marks the request paid.
 */
import express from 'express'
import type { Request, Response } from 'express'
import { z } from 'zod'
import { AccountError, bearer, FixedWindowRateLimiter, type AccountStore } from '../services/accountStore.js'
import { PayoutError, type PayoutStore } from '../services/payoutStore.js'

const requestSchema = z.object({ amount: z.number().positive().max(10_000_000) })
const settingsSchema = z.object({
  phone: z.string().max(40).optional(),
  bank: z.string().max(80).optional(),
  recipient: z.string().max(120).optional(),
  auto: z.boolean().optional(),
  intervalDays: z.number().int().optional(),
})
const decideSchema = z.object({ id: z.string().regex(/^[a-f0-9]{24}$/), status: z.enum(['paid', 'rejected']), comment: z.string().max(200).optional() })
const limitsSchema = z.object({ min: z.number().int(), max: z.number().int() })

export function createPayoutsRouter(accounts: AccountStore, payouts: PayoutStore) {
  const router = express.Router()
  const requestLimiter = new FixedWindowRateLimiter(20, 60 * 60 * 1000)

  const handle = (run: (req: Request, res: Response) => void) => (req: Request, res: Response) => {
    res.set('Cache-Control', 'no-store')
    try {
      run(req, res)
    } catch (error) {
      if (error instanceof PayoutError || error instanceof AccountError) { res.status(error.status).json({ error: error.message }); return }
      if (error instanceof z.ZodError) { res.status(400).json({ error: 'Некорректные данные запроса' }); return }
      throw error
    }
  }
  const signedIn = (req: Request) => {
    const id = accounts.authenticate(bearer(req.get('authorization')))
    if (!id) throw new AccountError(401, 'Требуется вход в аккаунт')
    return id
  }
  const streamer = (req: Request) => {
    const id = signedIn(req)
    const code = accounts.streamerCode(id)
    if (!code) throw new AccountError(403, 'Выплаты доступны только стримерам')
    return { id, code }
  }
  const owner = (req: Request) => {
    if (!accounts.isOwner(signedIn(req))) throw new AccountError(404, 'Не найдено')
  }

  router.get('/me/payouts', handle((req, res) => {
    const { id, code } = streamer(req)
    res.json(payouts.overview(id, code))
  }))

  router.put('/me/payout-settings', handle((req, res) => {
    const { id, code } = streamer(req)
    payouts.saveSettings(id, settingsSchema.parse(req.body))
    res.json(payouts.overview(id, code))
  }))

  router.post('/me/payouts', handle((req, res) => {
    const { id, code } = streamer(req)
    const retry = requestLimiter.hit(`payout:${id}`)
    if (retry) { res.set('Retry-After', String(retry)).status(429).json({ error: 'Слишком много попыток. Попробуйте позже.' }); return }
    res.status(201).json(payouts.request(id, code, requestSchema.parse(req.body).amount))
  }))

  router.get('/me/admin/payouts', handle((req, res) => {
    owner(req)
    res.json({ payouts: payouts.ownerList((accountId) => accounts.emailOf(accountId)), limits: payouts.intervalLimits() })
  }))

  router.post('/me/admin/payouts/decide', handle((req, res) => {
    owner(req)
    const { id, status, comment } = decideSchema.parse(req.body)
    res.json(payouts.decide(id, status, comment))
  }))

  router.put('/me/admin/payout-limits', handle((req, res) => {
    owner(req)
    const { min, max } = limitsSchema.parse(req.body)
    res.json({ limits: payouts.setIntervalLimits(min, max) })
  }))

  return router
}
