/**
 * Owner-only API, mounted at `/v1/admin`: used by the owner's desktop app (Server → «Стримеры»), never by the website.
 * Requires `Authorization: Bearer <TARKOV_ADMIN_TOKEN>`; without that variable the whole router answers 404. The
 * desktop app's site server also refuses to forward /v1/admin from the public link (electron/localServer.ts).
 *
 *   GET  /streamers          -> { streamers: [{ email, code, stats }], invites: [{ code, expiresAt }] }
 *   POST /streamer-invites   { code } -> 201 { token, code, expiresAt }  (the site link is /streamer/<token>)
 *   GET  /accounts?email=    -> { exists }  (the app checks an owner e-mail is registered before listing it)
 *   GET  /sms                -> { smsEnabled, provider, sentToday, dailyLimit, countries }
 *   POST /sms/test           { phone } -> { ok, provider, sentToday, dailyLimit }  («Отправить тестовое SMS»)
 *
 * SMS settings themselves are never changed over HTTP: the owner's app passes them to this process as environment
 * variables (electron/ownerAdmin.ts), so not even this router can redirect one-time codes.
 */
import express from 'express'
import { timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { AccountError, type AccountStore } from '../services/accountStore.js'
import type { PhoneAuthService } from '../services/phoneAuth.js'

export function createAdminRouter(accounts: AccountStore, adminToken = process.env.TARKOV_ADMIN_TOKEN, phones?: PhoneAuthService) {
  const router = express.Router()
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store')
    const supplied = req.get('authorization')?.replace(/^Bearer /, '') ?? ''
    if (!adminToken || adminToken.length < 32 || Buffer.byteLength(supplied) !== Buffer.byteLength(adminToken) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(adminToken))) {
      res.status(404).json({ error: 'Not found' }); return
    }
    next()
  })
  const guard = (run: (req: express.Request, res: express.Response) => void) => (req: express.Request, res: express.Response) => {
    try {
      run(req, res)
    } catch (error) {
      if (error instanceof AccountError) { res.status(error.status).json({ error: error.message }); return }
      if (error instanceof z.ZodError) { res.status(400).json({ error: 'Некорректные данные запроса' }); return }
      throw error
    }
  }
  router.get('/streamers', guard((_req, res) => { res.json(accounts.streamers()) }))
  router.post('/streamer-invites', guard((req, res) => {
    const { code } = z.object({ code: z.string().trim().max(24) }).parse(req.body)
    res.status(201).json(accounts.createStreamerInvite(code))
  }))
  router.get('/accounts', guard((req, res) => {
    const { email } = z.object({ email: z.string().trim().max(254).email() }).parse(req.query)
    res.json({ exists: accounts.hasAccount(email) })
  }))
  router.get('/sms', guard((_req, res) => {
    res.json({ smsEnabled: Boolean(phones?.enabled), provider: phones?.provider ?? null, sentToday: phones?.sentToday() ?? 0, dailyLimit: phones?.limits.dailyLimit ?? 0, countries: phones?.limits.countries ?? [] })
  }))
  router.post('/sms/test', async (req, res) => {
    const parsed = z.object({ phone: z.string().max(32) }).safeParse(req.body)
    if (!parsed.success) { res.status(400).json({ error: 'Укажите номер телефона' }); return }
    if (!phones) { res.status(503).json({ error: 'SMS не настроены' }); return }
    try {
      res.json(await phones.sendTest(parsed.data.phone))
    } catch (error) {
      if (error instanceof AccountError) { res.status(error.status).json({ error: error.message }); return }
      throw error
    }
  })
  return router
}
