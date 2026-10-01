/**
 * Phone numbers and SMS one-time codes (services/phoneAuth.ts), mounted at `/v1/accounts`.
 *
 *   GET  /auth-config                     -> { smsEnabled, codeLength, codeTtlSeconds, resendSeconds, countries,
 *                                            emailEnabled, email: { codeLength, codeTtlSeconds, resendSeconds } }
 *   POST /phone/login/start   { phone }   -> 200 { challengeId, expiresAt, resendSeconds }   (same answer for any number)
 *   POST /phone/login         { challengeId, code }            -> 200 { token, account } | 400
 *   POST /phone/reset/start   { phone }   -> 200 { challengeId, expiresAt, resendSeconds }   (same answer for any number)
 *   POST /phone/reset         { challengeId, code, password }  -> 200 { token, account } (all other sessions end) | 400
 *   POST /me/phone/start      Bearer { phone, password }       -> 200 { challengeId, expiresAt, resendSeconds }
 *   POST /me/phone/confirm    Bearer { challengeId, code }     -> 200 account view (with the masked number)
 *   POST /me/phone/remove     Bearer { password }              -> 200 account view
 *
 * With no SMS provider configured every route but /auth-config and /me/phone/remove answers 503.
 * Responses are personal: `Cache-Control: no-store`. Request bodies (numbers, codes, passwords) are never logged.
 */
import express from 'express'
import type { Request, Response } from 'express'
import type { AccountsRequest, AccountsResponse, AccountStore } from '../services/accountStore.js'
import { createPhoneHandlers, type PhoneAuthService, type PhoneHandlerOptions } from '../services/phoneAuth.js'

export function createPhoneRouter(accounts: AccountStore, phones: PhoneAuthService, options: PhoneHandlerOptions = {}) {
  const handlers = createPhoneHandlers(accounts, phones, options)
  const router = express.Router()
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next() })

  const adapt = (handler: (req: AccountsRequest) => Promise<AccountsResponse>) => async (req: Request, res: Response) => {
    const result = await handler({ body: req.body, ip: req.ip, authorization: req.get('authorization') })
    if (result.headers) res.set(result.headers)
    res.status(result.status).json(result.body)
  }

  router.get('/auth-config', adapt(handlers.config))
  router.post('/phone/login/start', adapt(handlers.loginStart))
  router.post('/phone/login', adapt(handlers.login))
  router.post('/phone/reset/start', adapt(handlers.resetStart))
  router.post('/phone/reset', adapt(handlers.reset))
  router.post('/me/phone/start', adapt(handlers.bindStart))
  router.post('/me/phone/confirm', adapt(handlers.bindConfirm))
  router.post('/me/phone/remove', adapt(handlers.remove))
  return router
}
