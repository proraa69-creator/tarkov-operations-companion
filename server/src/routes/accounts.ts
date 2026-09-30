/**
 * Website personal-account API, mounted at `/v1/accounts`.
 *
 * Backed by the SQLite `AccountStore` (survives restarts; single process). See server/src/services/accountStore.ts
 * for what is intentionally missing before public deployment (e-mail verification, password reset, payments/webhooks,
 * payouts).
 *
 * Routes:
 *   POST /register          { email, password, referralCode? }   -> 201 { token, referralApplied, account }
 *   POST /login             { email, password }                  -> 200 { token, account }
 *   POST /logout            Bearer                               -> 204
 *   GET  /me                Bearer                               -> 200 account view
 *   POST /me/referral       Bearer { code }                      -> 200 account view (ordinary users only, once)
 *   PUT  /me/nicknames      Bearer { pvp?, pve?, seasonal? }     -> 200 account view
 *   POST /referral-visits   { code }                             -> 200 | 404 (counts a `/r/<code>` landing visit)
 *   POST /streamer-invite   { token }                            -> 200 { code, expiresAt } | 404 (secret invitation page)
 *   POST /me/streamer-invite Bearer { token }                    -> 200 account view (the account becomes a streamer)
 *   GET  /me/referral-stats?period=day|month|year  Bearer        -> 200 { period, rows } (streamers only)
 *
 * Streamer status is never self-selected: an operator runs `npm --prefix server run promote -- <email> <code>`.
 * Request bodies (including passwords) are never logged here.
 * `req.ip` is the rate-limit key: behind a reverse proxy configure Express `trust proxy` accordingly.
 */
import express from 'express'
import type { Request, Response } from 'express'
import { createAccountsHandlers, type AccountsHandlerOptions, type AccountsRequest, type AccountsResponse, type AccountStore } from '../services/accountStore.js'

export function createAccountsRouter(store: AccountStore, options: AccountsHandlerOptions = {}) {
  const handlers = createAccountsHandlers(store, options)
  const router = express.Router()

  router.use((_req, res, next) => {
    // Account responses are personal: never cache them in shared caches.
    res.set('Cache-Control', 'no-store')
    next()
  })

  const adapt = (handler: (req: AccountsRequest) => Promise<AccountsResponse>) => async (req: Request, res: Response) => {
    const result = await handler({ body: req.body, ip: req.ip, authorization: req.get('authorization'), query: req.query })
    if (result.headers) res.set(result.headers)
    if (result.body === undefined) res.status(result.status).end()
    else res.status(result.status).json(result.body)
  }

  router.post('/register', adapt(handlers.register))
  router.post('/login', adapt(handlers.login))
  router.post('/logout', adapt(handlers.logout))
  router.get('/me', adapt(handlers.me))
  router.post('/me/referral', adapt(handlers.applyReferral))
  router.put('/me/nicknames', adapt(handlers.setNicknames))
  router.post('/referral-visits', adapt(handlers.referralVisit))
  router.post('/streamer-invite', adapt(handlers.streamerInvite))
  router.get('/me/referral-stats', adapt(handlers.referralSeries))
  router.post('/me/streamer-invite', adapt(handlers.redeemStreamerInvite))
  return router
}
