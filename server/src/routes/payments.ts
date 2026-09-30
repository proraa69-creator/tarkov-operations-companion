/**
 * Subscription payments, mounted at `/v1/payments` (services/paymentStore.ts).
 *
 *   GET  /plans                      -> 200 { enabled, plans }
 *   GET  /                           Bearer -> 200 { payments }
 *   POST /                           Bearer { plan } -> 201 { paymentId, confirmationUrl }
 *   GET  /:id                        Bearer -> 200 payment (re-checked with ЮKassa while pending)
 *   POST /yookassa/webhook           ЮKassa notification -> 200 (the body is only a hint: the payment is re-read)
 */
import express from 'express'
import type { Request, Response } from 'express'
import { z } from 'zod'
import { AccountError, bearer, FixedWindowRateLimiter, type AccountStore } from '../services/accountStore.js'
import { PaymentError, type PaymentStore } from '../services/paymentStore.js'

const planSchema = z.object({ plan: z.enum(['1m', '3m', '6m', '12m']) })
const webhookSchema = z.object({ event: z.string().max(64), object: z.object({ id: z.string().max(64) }).passthrough() }).passthrough()

/** Where ЮKassa sends the user back: the configured public address, else the site the request came from. */
function siteUrl(req: Request, payments: PaymentStore) {
  if (payments.config?.publicUrl) return payments.config.publicUrl
  const origin = req.get('origin') ?? ''
  try {
    const url = new URL(origin)
    if (url.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(url.hostname)) return url.origin
  } catch { /* no usable origin */ }
  throw new PaymentError(400, 'Не задан адрес сайта для возврата после оплаты')
}

export function createPaymentsRouter(accounts: AccountStore, payments: PaymentStore) {
  const router = express.Router()
  const createLimiter = new FixedWindowRateLimiter(10, 15 * 60 * 1000)

  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next() })

  const handle = (run: (req: Request, res: Response) => Promise<void> | void) => async (req: Request, res: Response) => {
    try {
      await run(req, res)
    } catch (error) {
      if (error instanceof PaymentError || error instanceof AccountError) { res.status(error.status).json({ error: error.message }); return }
      if (error instanceof z.ZodError) { res.status(400).json({ error: 'Некорректные данные запроса' }); return }
      throw error
    }
  }
  const account = (req: Request) => {
    const id = accounts.authenticate(bearer(req.get('authorization')))
    if (!id) throw new AccountError(401, 'Требуется вход в аккаунт')
    return id
  }

  router.get('/plans', handle((_req, res) => { res.json({ enabled: payments.enabled, plans: payments.plans() }) }))

  router.get('/', handle((req, res) => { res.json({ payments: payments.list(account(req)) }) }))

  router.post('/', handle(async (req, res) => {
    const id = account(req)
    const retry = createLimiter.hit(`pay:${id}`)
    if (retry) { res.set('Retry-After', String(retry)).status(429).json({ error: 'Слишком много попыток. Попробуйте позже.' }); return }
    const { plan } = planSchema.parse(req.body)
    res.status(201).json(await payments.create(accounts.billingInfo(id), plan, siteUrl(req, payments)))
  }))

  router.get('/:id', handle(async (req, res) => {
    const id = z.string().regex(/^[a-f0-9]{24}$/).parse(req.params.id)
    res.json(await payments.status(account(req), id))
  }))

  // Answer at once (ЮKassa retries on errors); the payment itself is re-read from the ЮKassa API.
  router.post('/yookassa/webhook', (req, res) => {
    const parsed = webhookSchema.safeParse(req.body)
    res.status(200).json({ ok: true })
    if (parsed.success && parsed.data.event.startsWith('payment.')) void payments.sync(parsed.data.object.id).catch(() => {})
  })

  return router
}
