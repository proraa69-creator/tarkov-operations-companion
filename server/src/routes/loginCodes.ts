/**
 * QR sign-in routes (services/loginCodes.ts), mounted at `/v1/accounts` next to the accounts router.
 * Responses are personal: `Cache-Control: no-store`. Request bodies are never logged.
 */
import express from 'express'
import type { Request, Response } from 'express'
import type { AccountsRequest, AccountsResponse, AccountStore } from '../services/accountStore.js'
import { createLoginCodeHandlers, type LoginCodeHandlerOptions, type LoginCodeStore } from '../services/loginCodes.js'

export function createLoginCodesRouter(accounts: AccountStore, codes: LoginCodeStore, options: LoginCodeHandlerOptions = {}) {
  const handlers = createLoginCodeHandlers(accounts, codes, options)
  const router = express.Router()
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next() })

  const adapt = (handler: (req: AccountsRequest & { agent?: string }) => Promise<AccountsResponse>) => async (req: Request, res: Response) => {
    const result = await handler({ body: req.body, ip: req.ip, authorization: req.get('authorization'), agent: req.get('user-agent') ?? '' })
    if (result.headers) res.set(result.headers)
    res.status(result.status).json(result.body)
  }

  router.post('/me/login-codes', adapt(handlers.createHandOff))
  router.post('/login-codes/redeem', adapt(handlers.redeemHandOff))
  router.post('/qr-login', adapt(handlers.createBrowserRequest))
  router.post('/qr-login/poll', adapt(handlers.poll))
  router.post('/me/qr-login/inspect', adapt(handlers.inspect))
  router.post('/me/qr-login/approve', adapt(handlers.approve))
  return router
}
