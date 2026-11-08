/**
 * The subscription through Apple In-App Purchase (services/appleSubscriptions.ts):
 *
 *   GET  /v1/apple/iap            Bearer -> 200 { enabled, products: [{ id, months }], appAccountToken?, subscription? }
 *                                 (`appAccountToken` — the account's UUID for StoreKit; `subscription` — the account's
 *                                 Apple period: { productId, months, expiresAt, active })
 *   POST /v1/apple/transactions   Bearer { transactions: [JWS, …] (1–20) } -> 200 { results: [{ status, transactionId?,
 *                                 productId?, expiresAt?, reason? }], paidUntil?, subscription? }
 *                                 (a purchase, «Восстановить покупки», a renewal StoreKit told the app about; 503 while
 *                                 the purchases are off)
 *   POST /v1/apple/notifications  App Store Server Notifications V2 { signedPayload } -> 200 { ok: true } once Apple's
 *                                 signature holds (applied or not, so Apple does not resend it), 400 when it does not
 *                                 hold or the body is not one, 503 while the purchases are off (Apple retries).
 */
import express from 'express'
import { z } from 'zod'
import { bearer, FixedWindowRateLimiter, type AccountStore } from '../services/accountStore.js'
import type { AppleSubscriptions } from '../services/appleSubscriptions.js'
import type { PaymentStore } from '../services/paymentStore.js'
import { PaymentError } from '../services/paymentStore.js'

const JWS = z.string().min(20).max(20_000).regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
const transactionsSchema = z.object({ transactions: z.array(JWS).min(1).max(20) })
const notificationSchema = z.object({ signedPayload: z.string().min(20).max(200_000) })
/** Sends per account and minute: a purchase and a restore are a few; more is a loop or abuse. */
const PER_ACCOUNT_PER_MINUTE = 20
const NOTIFICATIONS_PER_MINUTE = 600

export function createAppleRouter(accounts: AccountStore, apple: AppleSubscriptions, payments: PaymentStore) {
  const router = express.Router()
  const perAccount = new FixedWindowRateLimiter(PER_ACCOUNT_PER_MINUTE, 60_000)
  const notifications = new FixedWindowRateLimiter(NOTIFICATIONS_PER_MINUTE, 60_000)
  const signedIn = (authorization: string | undefined) => accounts.authenticate(bearer(authorization))

  router.get('/v1/apple/iap', (req, res) => {
    res.set('Cache-Control', 'no-store')
    const accountId = signedIn(req.get('authorization'))
    if (!accountId) { res.status(401).json({ error: 'Требуется вход в аккаунт', code: 'auth_required' }); return }
    if (!apple.enabled) { res.json({ enabled: false, products: [] }); return }
    const subscription = apple.view(accountId)
    res.json({ enabled: true, products: apple.products(), appAccountToken: apple.tokenFor(accountId), ...(subscription ? { subscription } : {}) })
  })

  router.post('/v1/apple/transactions', async (req, res) => {
    res.set('Cache-Control', 'no-store')
    const accountId = signedIn(req.get('authorization'))
    if (!accountId) { res.status(401).json({ error: 'Требуется вход в аккаунт', code: 'auth_required' }); return }
    const retry = perAccount.hit(accountId)
    if (retry) { res.set('Retry-After', String(retry)).status(429).json({ error: 'Слишком много запросов. Попробуйте позже.' }); return }
    const parsed = transactionsSchema.safeParse(req.body)
    if (!parsed.success) { res.status(400).json({ error: 'Некорректные данные покупки' }); return }
    try {
      const results = await apple.fromApp(accountId, parsed.data.transactions)
      const paidUntil = payments.paidUntil(accountId)
      const subscription = apple.view(accountId)
      res.json({ results, ...(paidUntil ? { paidUntil: new Date(paidUntil).toISOString() } : {}), ...(subscription ? { subscription } : {}) })
    } catch (error) {
      if (error instanceof PaymentError) { res.status(error.status).json({ error: error.message }); return }
      console.error('Apple transactions failed', error instanceof Error ? error.message : 'unknown error')
      res.status(500).json({ error: 'Не удалось проверить покупку. Попробуйте ещё раз.' })
    }
  })

  router.post('/v1/apple/notifications', async (req, res) => {
    res.set('Cache-Control', 'no-store')
    if (!apple.enabled) { res.status(503).json({ ok: false }); return }
    if (notifications.hit('apple')) { res.status(429).json({ ok: false }); return }
    const parsed = notificationSchema.safeParse(req.body)
    if (!parsed.success) { res.status(400).json({ ok: false }); return }
    try {
      const { type, result } = await apple.fromNotification(parsed.data.signedPayload)
      if (result && result.status !== 'known') console.log(`Apple notification ${type}: ${result.status}${result.reason ? ` (${result.reason})` : ''}`)
      res.json({ ok: true })
    } catch (error) {
      if (error instanceof PaymentError) { res.status(error.status).json({ ok: false }); return }
      console.warn('Apple notification refused:', error instanceof Error ? error.message.slice(0, 160) : 'unknown error')
      res.status(400).json({ ok: false })
    }
  })

  return router
}
