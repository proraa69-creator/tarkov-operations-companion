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
 *   POST /me/password       Bearer { currentPassword, newPassword } -> 200 { token, account } (all other sessions end)
 *   POST /me/sessions/revoke-all Bearer                          -> 200 { revoked } («Выйти на всех устройствах», this one too)
 *   POST /me/delete         Bearer { password } -> 200 { deleted: true } (personal data erased; 409 for the owner or an active autopayment)
 *   POST /me/referral       Bearer { code }                      -> 200 account view (ordinary users only, once)
 *   PUT  /me/nicknames      Bearer { pvp?, pve?, seasonal? }     -> 200 account view
 *   POST /referral-visits   { code }                             -> 200 | 404 (counts a `/r/<code>` landing visit)
 *   POST /streamer-invite   { token }                            -> 200 { code, expiresAt } | 404 (secret invitation page)
 *   POST /me/streamer-invite Bearer { token }                    -> 200 account view (the account becomes a streamer)
 *   GET  /me/referral-stats?period=day|month|year  Bearer        -> 200 { period, rows } (streamers only)
 *   GET  /me/referral-campaigns  Bearer                          -> 200 { campaigns } (streamers only; visits per ?c= label)
 *   POST /me/consents        Bearer { kind, version }            -> 200 { consents } (offer / personal data checkbox)
 *   GET  /me/admin/streamers Bearer (owner)                      -> 200 { streamers, invites } | 404 for non-owners
 *   GET  /me/admin/streamer-stats?code=&period= Bearer (owner)   -> 200 { code, period, rows, campaigns }
 *   POST /me/admin/streamer-invites Bearer (owner) { code }      -> 201 { token, code, expiresAt }
 *
 * The owner is whoever signs in with an e-mail listed in TARKOV_OWNER_EMAILS (set in the owner's desktop app); owner
 * rights are checked on the server for every request. A listed e-mail cannot be registered anew (see register()).
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
  router.post('/me/password', adapt(handlers.changePassword))
  router.post('/me/sessions/revoke-all', adapt(handlers.revokeAllSessions))
  router.post('/me/delete', adapt(handlers.deleteAccount))
  router.post('/me/referral', adapt(handlers.applyReferral))
  router.put('/me/nicknames', adapt(handlers.setNicknames))
  router.post('/referral-visits', adapt(handlers.referralVisit))
  router.post('/streamer-invite', adapt(handlers.streamerInvite))
  router.get('/me/referral-stats', adapt(handlers.referralSeries))
  router.post('/me/streamer-invite', adapt(handlers.redeemStreamerInvite))
  router.get('/me/referral-campaigns', adapt(handlers.referralCampaigns))
  router.post('/me/consents', adapt(handlers.recordConsent))
  // Owner section of the website (Bearer session of an account listed in TARKOV_OWNER_EMAILS; 404 for everybody else).
  router.get('/me/admin/streamers', adapt(handlers.ownerStreamers))
  router.get('/me/admin/streamer-stats', adapt(handlers.ownerStreamerStats))
  router.post('/me/admin/streamer-invites', adapt(handlers.ownerCreateStreamerInvite))
  return router
}
