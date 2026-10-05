/**
 * Subscription payments, mounted at `/v1/payments` (services/paymentStore.ts). No payment provider is connected, so
 * nothing can be bought here; the cabinet shows the plans (none now) and the payment history.
 *
 *   GET  /plans                      -> 200 { enabled, plans }
 *   GET  /                           Bearer -> 200 { payments }
 */
import express from 'express'
import { AccountError, bearer, type AccountStore } from '../services/accountStore.js'
import type { PaymentStore } from '../services/paymentStore.js'

export function createPaymentsRouter(accounts: AccountStore, payments: PaymentStore) {
  const router = express.Router()

  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next() })

  router.get('/plans', (_req, res) => {
    res.json({ enabled: payments.enabled, plans: payments.plans() })
  })

  router.get('/', (req, res) => {
    const id = accounts.authenticate(bearer(req.get('authorization')))
    if (!id) { res.status(401).json({ error: new AccountError(401, 'Требуется вход в аккаунт').message }); return }
    res.json({ payments: payments.list(id) })
  })

  return router
}
