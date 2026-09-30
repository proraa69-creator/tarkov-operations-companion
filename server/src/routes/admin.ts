/**
 * Owner-only API, mounted at `/v1/admin`: used by the owner's desktop app (Server → «Стримеры»), never by the website.
 * Requires `Authorization: Bearer <TARKOV_ADMIN_TOKEN>`; without that variable the whole router answers 404. The
 * desktop app's site server also refuses to forward /v1/admin from the public link (electron/localServer.ts).
 *
 *   GET  /streamers          -> { streamers: [{ email, code, stats }], invites: [{ code, expiresAt }] }
 *   POST /streamer-invites   { code } -> 201 { token, code, expiresAt }  (the site link is /streamer/<token>)
 */
import express from 'express'
import { timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { AccountError, type AccountStore } from '../services/accountStore.js'

export function createAdminRouter(accounts: AccountStore, adminToken = process.env.TARKOV_ADMIN_TOKEN) {
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
  return router
}
