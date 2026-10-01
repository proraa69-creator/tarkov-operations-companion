import cors from 'cors'
import express from 'express'
import { timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { fetchPlayerProfile } from '../../electron/playerProfileService'
import { getCatalogSnapshot, peekCatalogSnapshot, resolvePlayer } from './services/catalogService.js'
import type { ProgressStore } from './services/progressStore.js'
import { createGoonsRouter } from './routes/goons.js'
import { createAccountsRouter } from './routes/accounts.js'
import { createLoginCodesRouter } from './routes/loginCodes.js'
import { createPhoneRouter } from './routes/phone.js'
import { PhoneAuthService } from './services/phoneAuth.js'
import { LoginCodeStore } from './services/loginCodes.js'
import { AccountStore } from './services/accountStore.js'
import { createMeRouter, type CatalogPeek } from './routes/me.js'
import { createPaymentsRouter } from './routes/payments.js'
import { createAdminRouter } from './routes/admin.js'
import { PaymentStore } from './services/paymentStore.js'
import { createPayoutsRouter } from './routes/payouts.js'
import { createOwnerAdminRouter } from './routes/ownerAdmin.js'
import { AdminStore } from './services/adminStore.js'
import { PayoutStore } from './services/payoutStore.js'
import { MemoryGoonStore, type GoonStore } from './services/goonStore.js'
import { UserDataStore } from './services/userDataStore.js'
import { openDatabase } from './services/database.js'

const modeSchema = z.enum(['pvp', 'pve', 'seasonal'])
const syncSchema = z.object({
  mode: modeSchema, accountId: z.number().int().positive(), characterId: z.string().regex(/^[a-f0-9]{24}$/i),
  events: z.array(z.object({ taskId: z.string().regex(/^[a-f0-9]{24}$/i), status: z.enum(['active', 'completed', 'failed']), timestamp: z.string().datetime().transform((date) => new Date(date).toISOString()) })).max(2000),
})

export interface ApiOptions {
  /** Goon sightings storage; index.ts passes the SQLite store, tests default to memory. */
  goons?: GoonStore
  /** Per-user documents (Collector, position, settings); defaults to a private in-memory database. */
  userData?: UserDataStore
  /** Already-loaded catalog for summaries (Kappa / Collector totals). Defaults to the server catalog cache. */
  catalog?: CatalogPeek
  /** ЮKassa subscriptions; defaults to switched-off payments on a private in-memory database. */
  payments?: PaymentStore
  /** Streamer payouts; defaults to a ledger on the payments' database. */
  payouts?: PayoutStore
  /** One-time QR / device sign-in codes (in memory, 2 minutes). */
  loginCodes?: LoginCodeStore
  /** Phone numbers and SMS codes; defaults to switched off (no SMS provider). */
  phones?: PhoneAuthService
}

/**
 * Origins allowed by default: the app renderer dev server, the website, and the phone app's WebView
 * (Capacitor: https://localhost on Android, capacitor://localhost on iOS). Personal routes still need a Bearer token.
 */
export const DEFAULT_WEB_ORIGINS = 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:5202,http://127.0.0.1:5202,https://localhost,capacitor://localhost'

export function createApi(store: ProgressStore, token?: string, accounts = new AccountStore(), options: ApiOptions = {}) {
  const userData = options.userData ?? new UserDataStore(openDatabase(':memory:'))
  const app = express()
  app.disable('x-powered-by')
  // The API listens on 127.0.0.1 and the public link reaches it through the app's site server (electron/localServer.ts),
  // which puts the visitor's address into X-Forwarded-For. Trusting only loopback proxies keeps per-IP rate limits per
  // visitor instead of one shared bucket for everybody, while a remote client still cannot fake its address.
  app.set('trust proxy', 'loopback')
  // WEB_ORIGIN may list several origins separated by commas (app renderer, website).
  app.use(cors({ origin: (process.env.WEB_ORIGIN ?? DEFAULT_WEB_ORIGINS).split(',').map((origin) => origin.trim()).filter(Boolean) }))
  app.use(express.json({ limit: '1mb' }))
  app.use('/v1/goons', createGoonsRouter(options.goons ?? new MemoryGoonStore()))
  // Payments share the accounts' database: the owner's admin panel joins accounts with payments and payouts.
  const payments = options.payments ?? new PaymentStore(accounts.database, undefined)
  const payouts = options.payouts ?? new PayoutStore(payments.database, payments)
  app.use('/v1/payments', createPaymentsRouter(accounts, payments))
  // «Админ-панель» (owner only); first, so it can also write the owner's older actions to the audit log.
  if (payments.database === accounts.database) app.use('/v1/accounts', createOwnerAdminRouter(accounts, new AdminStore(accounts, payments)))
  app.use('/v1/accounts', createAccountsRouter(accounts))
  app.use('/v1/accounts', createPayoutsRouter(accounts, payouts))
  app.use('/v1/accounts', createLoginCodesRouter(accounts, options.loginCodes ?? new LoginCodeStore()))
  const phones = options.phones ?? new PhoneAuthService(accounts)
  app.use('/v1/accounts', createPhoneRouter(accounts, phones))
  app.use('/v1/admin', createAdminRouter(accounts, undefined, phones))
  app.use('/v1/me', createMeRouter(accounts, store, userData, { catalog: options.catalog ?? peekCatalogSnapshot }))
  app.get('/health', (_req, res) => res.json({ ok: true, service: 'tarkov-operations-api', version: '0.3.0', syncRequiresToken: true, accounts: true }))
  app.post('/v1/sync/events', (req, res) => {
    const supplied = req.get('authorization')?.replace(/^Bearer /, '') ?? ''
    if (!token || Buffer.byteLength(token) !== Buffer.byteLength(supplied) || !timingSafeEqual(Buffer.from(token), Buffer.from(supplied))) {
      res.status(401).json({ error: 'Требуется авторизация устройства' }); return
    }
    // Development owner only. Public accounts require per-user sessions before deployment.
    res.json(store.sync('local-development', syncSchema.parse(req.body)))
  })
  app.get('/v1/catalog/:mode', async (req, res) => res.json(await getCatalogSnapshot(modeSchema.parse(req.params.mode))))
  app.post('/v1/players/resolve', async (req, res) => {
    const body = z.object({ mode: modeSchema, nickname: z.string().trim().regex(/^[a-zA-Z0-9_-]{3,15}$/) }).parse(req.body)
    res.json(await resolvePlayer(body.mode, body.nickname))
  })
  app.get('/v1/players/:mode/:accountId', async (req, res) => res.json(await fetchPlayerProfile(modeSchema.parse(req.params.mode), z.coerce.number().int().positive().parse(req.params.accountId))))
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    void _next
    const status = error instanceof z.ZodError ? 400 : typeof error === 'object' && error && 'status' in error ? Number(error.status) : 502
    res.status(status >= 400 && status < 600 ? status : 502).json({ error: error instanceof z.ZodError ? 'Некорректные данные запроса' : error instanceof Error ? error.message : 'Сервис временно недоступен' })
  })
  return app
}
