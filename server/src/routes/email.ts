/**
 * E-mail one-time codes (services/emailAuth.ts), mounted at `/v1/accounts`.
 *
 *   POST /register             (routes/accounts.ts) while e-mail codes are on -> 202 { pending, message, challengeId,
 *                              expiresAt, resendSeconds } for EVERY address (new, existing, owner); no account yet
 *   POST /register/confirm     { challengeId, code }            -> 201 { token, referralApplied, account } | 400
 *   POST /register/resend      { challengeId }                  -> 200 { challengeId, expiresAt, resendSeconds }
 *   POST /email/login/start    { email }                        -> 200 { challengeId, expiresAt, resendSeconds } (same for any address)
 *   POST /email/login          { challengeId, code }            -> 200 { token, account } | 400
 *   POST /email/reset/start    { email }                        -> 200 { challengeId, expiresAt, resendSeconds } (same for any address)
 *   POST /email/reset          { challengeId, code, password }  -> 200 { token, account } (all other sessions end) | 400
 *   POST /me/email/start       Bearer                           -> 200 { challengeId, expiresAt, resendSeconds } | 409 already confirmed
 *   POST /me/email/confirm     Bearer { challengeId, code }     -> 200 account view (with emailVerifiedAt)
 *
 * With no e-mail provider configured every route answers 503 (and /register keeps working without codes).
 * Responses are personal: `Cache-Control: no-store`. Request bodies (addresses, codes, passwords) are never logged.
 */
import express from 'express'
import type { Request, Response } from 'express'
import type { AccountsRequest, AccountsResponse, AccountStore } from '../services/accountStore.js'
import { createEmailHandlers, type EmailAuthService, type EmailHandlerOptions } from '../services/emailAuth.js'

export function createEmailRouter(accounts: AccountStore, emails: EmailAuthService, options: EmailHandlerOptions = {}) {
  const handlers = createEmailHandlers(accounts, emails, options)
  const router = express.Router()
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next() })

  const adapt = (handler: (req: AccountsRequest) => Promise<AccountsResponse>) => async (req: Request, res: Response) => {
    const result = await handler({ body: req.body, ip: req.ip, authorization: req.get('authorization') })
    if (result.headers) res.set(result.headers)
    res.status(result.status).json(result.body)
  }

  router.post('/register/confirm', adapt(handlers.registerConfirm))
  router.post('/register/resend', adapt(handlers.registerResend))
  router.post('/email/login/start', adapt(handlers.loginStart))
  router.post('/email/login', adapt(handlers.login))
  router.post('/email/reset/start', adapt(handlers.resetStart))
  router.post('/email/reset', adapt(handlers.reset))
  router.post('/me/email/start', adapt(handlers.verifyStart))
  router.post('/me/email/confirm', adapt(handlers.verifyConfirm))
  return router
}
