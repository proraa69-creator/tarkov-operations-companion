/**
 * Subscription payments, mounted at `/v1/payments` (services/paymentStore.ts).
 *
 *   GET  /plans                      -> 200 { enabled, plans, providers }
 *   GET  /                           Bearer -> 200 { payments, autopay, friendDiscount: { percent, plan: '1m' } | null }
 *   POST /                           Bearer { plan, consent: { version }, method?: 'sbp' | 'sberbank' | 'tinkoff_bank',
 *                                    autopay?: { version } } -> 201 { paymentId, confirmationUrl }
 *                                    (400 without the offer / personal data consent; its version and time are stored.
 *                                    `autopay` is the separate, optional «Согласен на автоматическое списание…» consent)
 *   POST /autopay/cancel             Bearer -> 200 { autopay } («Отменить автопродление», one click; 409 for an archived
 *                                    autopayment, which support closes)
 *   GET  /:id                        Bearer -> 200 payment (re-checked with ЮKassa while pending)
 *   POST /yookassa/webhook           ЮKassa notification -> 200 (the body is only a hint: the payment / refund is re-read)
 */
import express from 'express'
import type { Request, Response } from 'express'
import { z } from 'zod'
import { AccountError, bearer, CONSENT_VERSION, FixedWindowRateLimiter, type AccountStore } from '../services/accountStore.js'
import { PaymentError, type PaymentStore } from '../services/paymentStore.js'
import type { InviteProgram } from '../services/invites.js'

const planSchema = z.object({ plan: z.enum(['1m', '3m', '6m', '12m']) })
/** The payer ticked «Я принимаю условия оферты…» for this version of the documents (website/src/legal). */
const consentSchema = z.object({ consent: z.object({ version: z.string().regex(CONSENT_VERSION) }) })
const optionsSchema = z.object({
  method: z.enum(['sbp', 'sberbank', 'tinkoff_bank']).default('sbp'),
  autopay: z.object({ version: z.string().regex(CONSENT_VERSION) }).optional(),
})
const webhookSchema = z.object({ event: z.string().max(64), object: z.object({ id: z.string().max(64) }).passthrough() }).passthrough()

/** This PC's own website (and the app's dev server): the only Origins used when no public address is configured. */
const LOCAL_SITES = ['http://localhost:5202', 'http://127.0.0.1:5202', 'http://localhost:5173', 'http://127.0.0.1:5173']

/**
 * Where ЮKassa sends the payer back: the configured public address (TARKOV_PUBLIC_URL). Never an arbitrary request
 * Origin — otherwise anybody could create a genuine payment page that returns the payer to a site of their choice.
 */
function siteUrl(req: Request, payments: PaymentStore) {
  if (payments.config?.publicUrl) return payments.config.publicUrl
  const origin = req.get('origin') ?? ''
  if (LOCAL_SITES.includes(origin)) return origin
  throw new PaymentError(400, 'Не задан адрес сайта для возврата после оплаты')
}

/** `invites`: «Пригласи друга» — a friend's code gives a discount on the first month (services/invites.ts). */
export function createPaymentsRouter(accounts: AccountStore, payments: PaymentStore, invites?: InviteProgram) {
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

  router.get('/plans', handle((_req, res) => {
    res.json({ enabled: payments.enabled, plans: payments.plans(), providers: payments.providers() })
  }))

  router.get('/', handle((req, res) => {
    const id = account(req)
    const percent = invites?.discountPercent(id) ?? 0
    res.json({ payments: payments.list(id), autopay: payments.autopay(id), friendDiscount: percent ? { percent, plan: '1m' } : null })
  }))

  router.post('/', handle(async (req, res) => {
    const id = account(req)
    const retry = createLimiter.hit(`pay:${id}`)
    if (retry) { res.set('Retry-After', String(retry)).status(429).json({ error: 'Слишком много попыток. Попробуйте позже.' }); return }
    const { plan } = planSchema.parse(req.body)
    if (accounts.view(id).subscription.lifetime) { res.status(409).json({ error: 'У стримера бесплатная подписка — оплачивать ничего не нужно' }); return }
    const consent = consentSchema.safeParse(req.body)
    if (!consent.success) { res.status(400).json({ error: 'Примите условия оферты и дайте согласие на обработку персональных данных' }); return }
    const version = consent.data.consent.version
    const options = optionsSchema.parse(req.body)
    const created = await payments.create(accounts.billingInfo(id), plan, siteUrl(req, payments), { version }, options.autopay, invites?.discountPercent(id) ? { percent: invites.discountPercent(id) } : undefined, options.method)
    accounts.recordConsent(id, 'payment', version)
    res.status(201).json(created)
  }))

  router.post('/autopay/cancel', handle(async (req, res) => {
    const id = account(req)
    res.json({ autopay: await payments.cancelAutopay(accounts.billingInfo(id)) })
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
    // A refund takes the paid days, the streamer's share and friend rewards back (re-read from the ЮKassa API).
    if (parsed.success && parsed.data.event === 'refund.succeeded') void payments.syncRefund(parsed.data.object.id).catch(() => {})
  })

  return router
}
