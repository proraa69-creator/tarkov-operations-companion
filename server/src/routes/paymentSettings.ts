/** Owner web controls for non-secret Lava.top settings. Keys are entered only in the Electron owner app. */
import express from 'express'
import { z } from 'zod'
import { bearer, FixedWindowRateLimiter, type AccountStore } from '../services/accountStore.js'
import { ownerApp, OwnerAppError, type OwnerAppLink } from '../services/ownerApp.js'
import { lavaConfigFromEnv } from '../services/lavaTop.js'
import { paymentConfigFromEnv, type PaymentStore } from '../services/paymentStore.js'
import type { AdminStore } from '../services/adminStore.js'

const BASE = '/v1/accounts/me/admin/payment-settings/lava'
const fields = {
  offerId: z.string().trim().uuid(),
  currency: z.enum(['USD', 'EUR']),
  rubRate: z.number().finite().positive().max(100_000),
  paymentMethod: z.enum(['', 'UNLIMINT', 'PAYPAL', 'STRIPE']),
}
const inputSchema = z.object(fields).strict()
// Explicit allowlist: even a malformed bridge reply cannot expose a secret to the browser.
const settingsSchema = z.object({ ...fields, rubRate: z.number().finite().min(0).max(100_000), hasApiKey: z.boolean(), hasWebhookKey: z.boolean() })

export function createPaymentSettingsRouter(accounts: AccountStore, payments: PaymentStore, admin?: AdminStore, suppliedLink?: OwnerAppLink) {
  const router = express.Router()
  const reads = new FixedWindowRateLimiter(120, 60_000)
  const writes = new FixedWindowRateLimiter(6, 60_000)
  const checks = new FixedWindowRateLimiter(3, 60_000)
  const link = suppliedLink ?? ownerApp()
  const owner = (limiter: FixedWindowRateLimiter, run: (req: express.Request, res: express.Response, actor: string) => Promise<void>) => async (req: express.Request, res: express.Response) => {
    res.set('Cache-Control', 'no-store')
    const id = accounts.authenticate(bearer(req.get('authorization')))
    if (!id) { res.status(401).json({ error: 'Требуется вход в аккаунт' }); return }
    const email = accounts.isOwner(id) ? accounts.emailOf(id) : undefined
    if (!email) { res.status(404).json({ error: 'Не найдено' }); return }
    const retry = limiter.hit(id)
    if (retry) { res.set('Retry-After', String(retry)).status(429).json({ error: 'Слишком много запросов. Подождите минуту.' }); return }
    if (!link.available) { res.status(409).json({ error: 'Настройки оплаты доступны, когда сервер запущен из приложения владельца.' }); return }
    try { await run(req, res, email) } catch (error) {
      if (error instanceof z.ZodError) { res.status(400).json({ error: 'Проверьте параметры оплаты. Ключи меняются только в приложении.' }); return }
      // Bridge errors are controlled by the app; do not include request bodies or upstream credentials.
      res.status(error instanceof OwnerAppError ? 409 : 502).json({ error: 'Приложение не выполнило запрос. Проверьте, что Raid OS запущен и хранилище ключей доступно.' })
    }
  }
  router.get(BASE, owner(reads, async (_req, res) => {
    const settings = settingsSchema.parse(await link.request('payments:lava:get'))
    res.json({ settings, configured: Boolean(payments.lava) })
  }))
  router.put(BASE, owner(writes, async (req, res, actor) => {
    const input = inputSchema.parse(req.body)
    const result = await link.request<{ settings: unknown; env: NodeJS.ProcessEnv }>('payments:lava:set', input)
    const settings = settingsSchema.parse(result.settings)
    payments.configureLava(lavaConfigFromEnv(result.env))
    admin?.audit(actor, 'payments.lava-settings', undefined, {
      offerId: input.offerId, currency: input.currency, rubRate: input.rubRate, paymentMethod: input.paymentMethod,
    })
    res.json({ settings, configured: Boolean(payments.lava) })
  }))
  router.post(`${BASE}/test`, owner(checks, async (_req, res, actor) => {
    const result = z.object({ ok: z.boolean(), message: z.string().max(1000), publicUrl: z.enum(['ok', 'unreachable', 'unexpected', 'skipped']) }).parse(await link.request('payments:lava:test', undefined, 25_000))
    admin?.audit(actor, 'payments.lava-test', undefined, { ok: result.ok, publicUrl: result.publicUrl })
    res.json(result)
  }))
  const yooBase = '/v1/accounts/me/admin/payment-settings/yookassa'
  const yooFields = { shopId: z.string().trim().regex(/^\d{1,12}$/), monthPrice: z.number().finite().min(1).max(100_000), receipts: z.boolean(), streamerPercent: z.number().finite().min(0).max(100), autopay: z.boolean() }
  const yooInput = z.object(yooFields).strict()
  const yooSettings = z.object({ ...yooFields, shopId: z.string().regex(/^\d{0,12}$/), monthPrice: z.number().finite().min(0).max(100_000), hasKey: z.boolean() })
  const yooWrites = new FixedWindowRateLimiter(6, 60_000)
  router.get(yooBase, owner(reads, async (_req, res) => {
    res.json({ settings: yooSettings.parse(await link.request('payments:yookassa:get')), configured: Boolean(payments.config) })
  }))
  router.put(yooBase, owner(yooWrites, async (req, res, actor) => {
    const input = yooInput.parse(req.body)
    const result = await link.request<{ settings: unknown; env: NodeJS.ProcessEnv }>('payments:yookassa:set', input)
    const settings = yooSettings.parse(result.settings)
    const publicUrl = payments.config?.publicUrl
    payments.configureYookassa(paymentConfigFromEnv({ ...result.env, ...(publicUrl ? { TARKOV_PUBLIC_URL: publicUrl } : {}) }))
    admin?.audit(actor, 'payments.yookassa-settings', undefined, input)
    res.json({ settings, configured: Boolean(payments.config) })
  }))
  return router
}
