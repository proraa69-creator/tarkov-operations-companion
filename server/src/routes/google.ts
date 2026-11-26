/**
 * «Войти через Google» (services/googleSignIn.ts), mounted at `/v1/accounts`:
 *   POST /google  { credential, country?, referralCode? }
 *     -> 200 { token, created, referralApplied, account }     signed in (an existing account, or a new one with `country`)
 *     -> 409 { needCountry: true, error }                      a new address: ask the country and send again with it
 *     -> 401 { error }                                         the token is not a valid Google sign-in for Raid OS
 *     -> 403 { error }                                         Russia, a blocked account, the owner's address
 * A visitor from a Russian address (services/russianNetworks.ts, RIPE NCC's list) gets 403 before the token is checked,
 * signed in before or not (owner, 25.11.2026).
 * Responses are personal (`Cache-Control: no-store`); the token and the body are never logged.
 */
import express from 'express'
import type { Request, Response } from 'express'
import { AccountError, FixedWindowRateLimiter, GOOGLE_RUSSIA_MESSAGE, type AccountStore } from '../services/accountStore.js'
import { createGoogleVerifier, GoogleTokenError, type GoogleVerifier } from '../services/googleSignIn.js'
import type { RussianAddressCheck } from '../services/russianNetworks.js'

const NEED_COUNTRY_MESSAGE = 'Укажите страну, чтобы создать аккаунт.'
const FAILED_MESSAGE = 'Не удалось войти через Google. Попробуйте ещё раз.'

export function createGoogleRouter(accounts: AccountStore, options: { verify?: GoogleVerifier; limiter?: FixedWindowRateLimiter; russia?: RussianAddressCheck } = {}) {
  const verifyToken = options.verify ?? createGoogleVerifier()
  const limiter = options.limiter ?? new FixedWindowRateLimiter(20, 10 * 60 * 1000)
  const router = express.Router()

  router.post('/google', async (req: Request, res: Response) => {
    res.set('Cache-Control', 'no-store')
    const wait = limiter.hit(`google:${req.ip ?? 'unknown'}`)
    if (wait) { res.set('Retry-After', String(wait)).status(429).json({ error: 'Слишком много попыток. Попробуйте позже.' }); return }
    if (options.russia?.isRussianAddress(req.ip) === true) { res.status(403).json({ error: GOOGLE_RUSSIA_MESSAGE }); return }
    const body = (req.body ?? {}) as { credential?: unknown; country?: unknown; referralCode?: unknown }
    try {
      const identity = await verifyToken(body.credential)
      const result = await accounts.googleSignIn(identity.email, {
        ...(typeof body.country === 'string' ? { country: body.country } : {}),
        ...(typeof body.referralCode === 'string' && body.referralCode.length <= 64 ? { referralCode: body.referralCode } : {}),
        ...(req.ip ? { ip: req.ip } : {}),
      })
      if ('needCountry' in result) { res.status(409).json({ needCountry: true, error: NEED_COUNTRY_MESSAGE }); return }
      res.status(200).json({ token: result.token, created: result.created, referralApplied: result.referralApplied, account: accounts.view(accounts.authenticate(result.token)!) })
    } catch (error) {
      if (error instanceof GoogleTokenError) { res.status(401).json({ error: FAILED_MESSAGE }); return }
      if (error instanceof AccountError) { res.status(error.status).json({ error: error.message }); return }
      res.status(502).json({ error: FAILED_MESSAGE })
    }
  })
  return router
}
