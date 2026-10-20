/**
 * POST /v1/payments/bezebee/webhook — BZB's payment notification (services/bezebeeWebhook.ts). Read as raw bytes: the
 * X-BZB-Signature HMAC is over the exact body. Answers 200 for every notification that was kept (applied or not, so BZB
 * does not retry it), 401 for a bad signature (BZB does not retry 4xx), 503 while BZB is not set up on this server.
 */
import express from 'express'
import type { BezebeeWebhooks } from '../services/bezebeeWebhook.js'

export function createBezebeeWebhookRouter(webhooks: BezebeeWebhooks | undefined) {
  const router = express.Router()
  router.post('/', express.raw({ type: () => true, limit: '256kb' }), (req, res) => {
    res.set('Cache-Control', 'no-store')
    if (!webhooks) { res.status(503).json({ error: 'BZB is not configured' }); return }
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)
    const event = webhooks.receive(body, req.get('x-bzb-signature') ?? undefined)
    if (event.signature === 'bad') { res.status(401).json({ ok: false }); return }
    res.json({ ok: true, status: event.status })
  })
  return router
}
