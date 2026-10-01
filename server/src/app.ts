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
import { createEmailRouter } from './routes/email.js'
import { EmailAuthService } from './services/emailAuth.js'
import { LoginCodeStore } from './services/loginCodes.js'
import { AccountStore, FixedWindowRateLimiter } from './services/accountStore.js'
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
import { createServerGuard, type ServerGuardOptions } from './routes/serverGuard.js'
import { createSelfUpdateRouter } from './routes/selfUpdate.js'
import { reportErrorToOwnerApp, type OwnerAppLink } from './services/ownerApp.js'

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
  /** E-mail one-time codes; defaults to switched off (no e-mail provider: registration works without codes). */
  emails?: EmailAuthService
  /** Requests per minute and IP for the public endpoints without sign-in (defaults: PUBLIC_RATE_LIMITS). */
  rateLimits?: Partial<typeof PUBLIC_RATE_LIMITS>
  /** «Страж сервера» (routes/serverGuard.ts): bans, health detail, backups. */
  guard?: ServerGuardOptions
  /** The owner app's main process (services/ownerApp.ts): «Обновление» tab, error reports. Default: process.parentPort. */
  ownerApp?: OwnerAppLink
}

/**
 * Per-IP limits (per minute) of the public endpoints that need no sign-in and each cost an upstream lookup or a large
 * answer: the catalog, and the player lookups (resolve + profile share one bucket). Generous for real clients.
 */
export const PUBLIC_RATE_LIMITS = { catalog: 120, players: 30 }

/**
 * Origins allowed by default: the app renderer dev server, the website, and the phone app's WebView
 * (Capacitor: https://localhost on Android, capacitor://localhost on iOS). Personal routes still need a Bearer token.
 */
export const DEFAULT_WEB_ORIGINS = 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:5202,http://127.0.0.1:5202,https://localhost,capacitor://localhost'

/** What a client sees for any 5xx: the details go to the server log only. */
export const INTERNAL_ERROR = 'Внутренняя ошибка сервера'

/**
 * Which app build started this server (the owner app passes TARKOV_APP_* to the API process, electron/localServer.ts):
 * lets the owner app see an old server still holding the port. Absent when the server runs on its own.
 */
function buildInfo() {
  const env = process.env
  if (!env.TARKOV_APP_VERSION && !env.TARKOV_APP_COMMIT && !env.TARKOV_APP_BUILD) return {}
  return { build: { version: env.TARKOV_APP_VERSION ?? '', build: Number(env.TARKOV_APP_BUILD) || 0, commit: env.TARKOV_APP_COMMIT ?? '', edition: env.TARKOV_APP_EDITION ?? '' } }
}

const LOOPBACK = /^(?:127(?:\.\d{1,3}){3}|::1|::ffff:127(?:\.\d{1,3}){3})$/

/**
 * A request made on this PC straight to the API port: loopback socket and no forwarding header. Everything through the
 * website server (electron/siteProxy.ts always sets X-Forwarded-For) or the public link counts as from outside.
 */
export function directLocalRequest(req: express.Request) {
  if (req.get('x-forwarded-for') !== undefined || req.get('forwarded') !== undefined || req.get('cf-connecting-ip') !== undefined) return false
  return LOOPBACK.test(req.socket.remoteAddress ?? '')
}

export function createApi(store: ProgressStore, token?: string, accounts = new AccountStore(), options: ApiOptions = {}) {
  const userData = options.userData ?? new UserDataStore(openDatabase(':memory:'))
  const app = express()
  app.disable('x-powered-by')
  // The API listens on 127.0.0.1 and the public link reaches it through the app's site server (electron/localServer.ts),
  // which puts the visitor's address into X-Forwarded-For. Trusting only loopback proxies keeps per-IP rate limits per
  // visitor instead of one shared bucket for everybody, while a remote client still cannot fake its address.
  app.set('trust proxy', 'loopback')
  const guard = createServerGuard(accounts, options.guard)
  app.use(guard.middleware)
  // Answers are data, never pages: no MIME sniffing and no framing, on every response (errors and 404s included).
  app.use((_req, res, next) => { res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY' }); next() })
  // Everything under /v1/accounts is personal: set before any parsing, so unknown paths and errors are never cached.
  app.use('/v1/accounts', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next() })
  // WEB_ORIGIN may list several origins separated by commas (app renderer, website).
  app.use(cors({ origin: (process.env.WEB_ORIGIN ?? DEFAULT_WEB_ORIGINS).split(',').map((origin) => origin.trim()).filter(Boolean) }))
  app.use(express.json({ limit: '1mb' }))
  app.use(guard.router)
  app.use('/v1/goons', createGoonsRouter(options.goons ?? new MemoryGoonStore()))
  // Payments share the accounts' database: the owner's admin panel joins accounts with payments and payouts.
  const payments = options.payments ?? new PaymentStore(accounts.database, undefined)
  const payouts = options.payouts ?? new PayoutStore(payments.database, payments)
  app.use('/v1/payments', createPaymentsRouter(accounts, payments))
  const adminStore = payments.database === accounts.database ? new AdminStore(accounts, payments) : undefined
  // «Обновление» (owner only): status of the laptop's self-update and «Проверить сейчас» / «Откатить» (routes/selfUpdate.ts).
  app.use(createSelfUpdateRouter(accounts, { link: options.ownerApp, audit: (actor, action, details) => { try { adminStore?.audit(actor, action, undefined, details) } catch { /* the action itself already ran */ } } }))
  // «Админ-панель» (owner only); first, so it can also write the owner's older actions to the audit log.
  if (adminStore) app.use('/v1/accounts', createOwnerAdminRouter(accounts, adminStore))
  const emails = options.emails ?? new EmailAuthService(accounts)
  app.use('/v1/accounts', createAccountsRouter(accounts, { registrations: emails }))
  app.use('/v1/accounts', createPayoutsRouter(accounts, payouts))
  app.use('/v1/accounts', createLoginCodesRouter(accounts, options.loginCodes ?? new LoginCodeStore()))
  const phones = options.phones ?? new PhoneAuthService(accounts)
  app.use('/v1/accounts', createPhoneRouter(accounts, phones, { extraConfig: () => emails.publicConfig() }))
  app.use('/v1/accounts', createEmailRouter(accounts, emails))
  app.use('/v1/admin', createAdminRouter(accounts, undefined, phones, emails))
  app.use('/v1/me', createMeRouter(accounts, store, userData, { catalog: options.catalog ?? peekCatalogSnapshot }))
  // `database`: a cheap SELECT 1 on the accounts' database, for the owner app's status lamps (electron/serverWatchdog.ts).
  // Additive: `ok` stays true for older clients; a failing database answers 503 so monitors see it.
  // Build, version and flags only for this PC's own direct checks (electron/localServer.ts apiHealth); through the site
  // proxy / public link (X-Forwarded-For) only what the status lamps and clients read: ok, service, database.
  app.get('/health', (req, res) => {
    let database = true
    try { accounts.database.prepare('SELECT 1 AS ok').get() } catch { database = false }
    const status = database ? 200 : 503
    if (!directLocalRequest(req)) { res.status(status).json({ ok: database, service: 'tarkov-operations-api', database }); return }
    res.status(status).json({ ok: database, service: 'tarkov-operations-api', version: '0.3.0', syncRequiresToken: true, accounts: true, database, ...buildInfo() })
  })
  app.post('/v1/sync/events', (req, res) => {
    const supplied = req.get('authorization')?.replace(/^Bearer /, '') ?? ''
    if (!token || Buffer.byteLength(token) !== Buffer.byteLength(supplied) || !timingSafeEqual(Buffer.from(token), Buffer.from(supplied))) {
      res.status(401).json({ error: 'Требуется авторизация устройства' }); return
    }
    // Development owner only. Public accounts require per-user sessions before deployment.
    res.json(store.sync('local-development', syncSchema.parse(req.body)))
  })
  // Per IP (req.ip is the visitor behind the site proxy, see `trust proxy` above); counted before validation.
  const limits = { ...PUBLIC_RATE_LIMITS, ...options.rateLimits }
  const perIp = (name: keyof typeof PUBLIC_RATE_LIMITS): express.RequestHandler => {
    const limiter = new FixedWindowRateLimiter(limits[name], 60 * 1000)
    return (req, res, next) => {
      const retry = limiter.hit(`${name}:${req.ip ?? 'unknown'}`)
      if (retry) { res.set('Retry-After', String(retry)).status(429).json({ error: 'Слишком много запросов. Попробуйте позже.' }); return }
      next()
    }
  }
  const players = perIp('players')
  app.get('/v1/catalog/:mode', perIp('catalog'), async (req, res) => res.json(await getCatalogSnapshot(modeSchema.parse(req.params.mode))))
  app.post('/v1/players/resolve', players, async (req, res) => {
    const body = z.object({ mode: modeSchema, nickname: z.string().trim().regex(/^[a-zA-Z0-9_-]{3,15}$/) }).parse(req.body)
    res.json(await resolvePlayer(body.mode, body.nickname))
  })
  app.get('/v1/players/:mode/:accountId', players, async (req, res) => res.json(await fetchPlayerProfile(modeSchema.parse(req.params.mode), z.coerce.number().int().positive().parse(req.params.accountId))))
  app.use((error: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    void _next
    const raw = error instanceof z.ZodError ? 400 : typeof error === 'object' && error && 'status' in error ? Number(error.status) : 502
    const status = raw >= 400 && raw < 600 ? raw : 502
    if (status >= 500) {
      // Internal details (messages, paths, upstream answers) stay in the server log (api.log); request bodies are never logged.
      console.error(`API ${req.method} ${req.path} -> ${status}:`, error instanceof Error ? error.stack ?? error.message : error)
      // «Отчёты об ошибках (GitHub)»: the owner app sanitizes and deduplicates it (electron/errorReporter.ts).
      reportErrorToOwnerApp('5xx', error, { method: req.method, path: req.path, status })
      res.status(status).json({ error: INTERNAL_ERROR })
      return
    }
    res.status(status).json({ error: error instanceof z.ZodError ? 'Некорректные данные запроса' : error instanceof Error ? error.message : 'Сервис временно недоступен' })
  })
  return app
}
