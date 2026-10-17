/**
 * A small client of Boosty's UNOFFICIAL internal API (api.boosty.to), only for reading the owner's own blog
 * subscribers (owner's decision: automatic issuance through the unofficial API, the risk accepted; docs/payments/
 * payment-regions-and-announcements.md «Automatic issuance»). Boosty documents none of this: the paths and fields follow
 * the public unofficial clients (github.com/krasnovmv/boosty-api, github.com/BazZziliuS/boostylib,
 * github.com/ath31st/boosty_api_rs) and may change without notice — every field is read defensively.
 *
 *   GET  https://api.boosty.to/v1/blog/{blog}/subscribers?limit=&offset=   Authorization: Bearer <accessToken>
 *        -> { data: Subscriber[], total, offset, limit }   (numeric offset; the next page until offset >= total)
 *   POST https://api.boosty.to/oauth/token/   application/x-www-form-urlencoded: device_id, device_os=web,
 *        grant_type=refresh_token, refresh_token -> { access_token, refresh_token, expires_in (s) }
 *
 * Secrets: the seed comes from the environment (BOOSTY_AUTH — the `auth` value of boosty.to's localStorage, a JSON
 * string { accessToken, refreshToken, expiresAt } — and BOOSTY_CLIENT_ID, the `_clientId` device id). Refreshed tokens
 * are kept in the server's data directory (mode 600) so that a restart keeps working; a new BOOSTY_AUTH (another
 * fingerprint) replaces them. No token, device id or response body is ever logged, thrown or returned: errors carry a
 * fixed text, the HTTP status and at most a short error code (sanitizeBoostyError).
 */
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export const BOOSTY_API = 'https://api.boosty.to'
/** What the unofficial clients send; Boosty's web API is used by browsers only. */
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
const PAGE_SIZE = 100
const MAX_PAGES = 100
const REFRESH_MARGIN_MS = 5 * 60 * 1000
export const BOOSTY_TOKEN_DEAD = 'Токен Boosty истёк — обновите BOOSTY_AUTH'

export interface BoostyTokens { accessToken: string; refreshToken: string; expiresAt: number }
export interface BoostyCredentials { auth: string; clientId: string; blog: string }

/** The environment of the job: primary names and the accepted aliases. Undefined (the job stays off) without both. */
export function boostyCredentialsFromEnv(env: NodeJS.ProcessEnv = process.env): BoostyCredentials | undefined {
  const auth = (env.BOOSTY_AUTH || env.BOOSTY_AUTH_JSON || '').trim()
  const clientId = (env.BOOSTY_CLIENT_ID || env.BOOSTY_DEVICE_ID || env.BOOSTY_CLIENTID || '').trim()
  if (!auth || !clientId) return undefined
  const blog = (env.BOOSTY_BLOG || 'raidosapp').trim()
  return { auth, clientId, blog: /^[A-Za-z0-9_.-]{1,64}$/.test(blog) ? blog : 'raidosapp' }
}

/** Poll period, minutes (BOOSTY_SYNC_MINUTES, 2–120, default 5). */
export function boostyPeriodMs(value: string | undefined) {
  const minutes = Number(value)
  return (Number.isFinite(minutes) && minutes >= 2 && minutes <= 120 ? minutes : 5) * 60 * 1000
}

/** expiresAt of the localStorage value is milliseconds, of the token answer seconds; both become milliseconds. */
const toMs = (value: unknown) => {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : typeof value === 'number' ? value : NaN
  if (!Number.isFinite(number) || number <= 0) return 0
  return number > 1e12 ? number : number * 1000
}
const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

/**
 * The `auth` value as the owner copied it: JSON (camelCase from localStorage, snake_case from the clients' auth.json),
 * possibly URL-encoded (the cookie of the same name). Undefined when no access and refresh token are in it.
 */
export function parseBoostyAuth(raw: string): BoostyTokens | undefined {
  const attempts = [raw.trim()]
  try { attempts.push(decodeURIComponent(raw.trim())) } catch { /* not URL-encoded */ }
  for (const attempt of attempts) {
    try {
      let parsed: unknown = JSON.parse(attempt)
      if (typeof parsed === 'string') parsed = JSON.parse(parsed)
      if (!parsed || typeof parsed !== 'object') continue
      const value = parsed as Record<string, unknown>
      const accessToken = text(value.accessToken ?? value.access_token)
      const refreshToken = text(value.refreshToken ?? value.refresh_token)
      if (!accessToken || !refreshToken) continue
      return { accessToken, refreshToken, expiresAt: toMs(value.expiresAt ?? value.expires_at) }
    } catch { /* the next form */ }
  }
  return undefined
}

/** A fingerprint of the seed (never the seed): a changed BOOSTY_AUTH / BOOSTY_CLIENT_ID replaces the stored tokens. */
const fingerprint = (credentials: BoostyCredentials) => createHash('sha256').update(`raidos-boosty\n${credentials.auth}\n${credentials.clientId}`).digest('hex').slice(0, 32)

/**
 * The rotated tokens on disk (the server's data directory, mode 600). `file` undefined: memory only (tests, a database
 * in memory). The file holds the tokens and the seed's fingerprint; it is never served or logged.
 */
export class BoostyTokenStore {
  constructor(private readonly file: string | undefined) {}

  load(credentials: BoostyCredentials): BoostyTokens | undefined {
    const seed = parseBoostyAuth(credentials.auth)
    if (this.file && existsSync(this.file)) {
      try {
        const saved = JSON.parse(readFileSync(this.file, 'utf8')) as Record<string, unknown>
        if (saved.seed === fingerprint(credentials) && typeof saved.accessToken === 'string' && typeof saved.refreshToken === 'string' && saved.accessToken && saved.refreshToken) {
          return { accessToken: saved.accessToken, refreshToken: saved.refreshToken, expiresAt: toMs(saved.expiresAt) }
        }
      } catch { /* unreadable: the seed again */ }
    }
    return seed
  }

  save(credentials: BoostyCredentials, tokens: BoostyTokens) {
    if (!this.file) return
    mkdirSync(dirname(this.file), { recursive: true })
    const temporary = `${this.file}.${process.pid}.tmp`
    writeFileSync(temporary, JSON.stringify({ seed: fingerprint(credentials), ...tokens }), { mode: 0o600 })
    chmodSync(temporary, 0o600)
    renameSync(temporary, this.file)
  }
}

/** A failed Boosty call: a fixed message, the HTTP status, a short code. Never a token or a response body. */
export class BoostyApiError extends Error {
  constructor(message: string, readonly status?: number, readonly code?: string, readonly tokenDead = false) {
    super(message)
    this.name = 'BoostyApiError'
  }
}

/** Anything thrown during a sync as a short, secret-free line for the owner's panel and the server log. */
export function sanitizeBoostyError(error: unknown, secrets: readonly string[] = []): string {
  let message = error instanceof BoostyApiError ? error.message
    : error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError') ? 'Boosty не ответил вовремя'
      : error instanceof TypeError && /fetch failed|network|ECONN|ENOTFOUND|socket/i.test(error.message) ? 'Нет связи с Boosty'
        : 'Ошибка синхронизации с Boosty'
  for (const secret of secrets) if (secret && secret.length >= 6) message = message.split(secret).join('…')
  // Anything long and token-like that slipped into a message.
  return message.replace(/[A-Za-z0-9_\-.+/=]{24,}/g, '…').slice(0, 200)
}

/** A short code from Boosty's error answer ({ error: 'invalid_grant' }), nothing else of the body. */
async function errorCode(response: Response) {
  try {
    const body = await response.json() as Record<string, unknown>
    const code = typeof body.error === 'string' ? body.error : typeof body.error_code === 'string' ? body.error_code : ''
    return /^[a-z_]{1,40}$/i.test(code) ? code : undefined
  } catch { return undefined }
}

/** One subscriber as the job uses it; raw fields are read defensively (see the module comment). */
export interface BoostySubscriber {
  /** Boosty's user id of the subscriber. */
  userId: string
  email: string
  /** The paid level: id, name, price as Boosty sent them. */
  levelId: string
  levelName: string
  /** Price in roubles (the level's RUB price when Boosty lists several currencies). */
  price: number
  /** Active and subscribed to a paid level now. */
  active: boolean
  /** Paid until (Boosty's next payment date), ms; undefined when Boosty sent none. */
  paidUntil?: number
  /** Subscribed since, ms. */
  since?: number
}

const str = (value: unknown) => (typeof value === 'string' ? value : typeof value === 'number' && Number.isFinite(value) ? String(value) : '')
const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : undefined)

export function normalizeSubscriber(raw: unknown): BoostySubscriber | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const value = raw as Record<string, unknown>
  const level = value.level && typeof value.level === 'object' ? value.level as Record<string, unknown> : {}
  const userId = str(value.id ?? value.userId)
  if (!userId) return undefined
  const prices = level.currencyPrices && typeof level.currencyPrices === 'object' ? level.currencyPrices as Record<string, unknown> : {}
  const price = num(prices.RUB) ?? num(level.price) ?? num(value.price) ?? 0
  const status = str(value.status)
  const subscribed = value.subscribed !== false
  const paidUntil = toMs(value.nextPayTime ?? value.next_pay_time)
  const since = toMs(value.onTime ?? value.on_time)
  return {
    userId,
    email: str(value.email).trim().toLowerCase(),
    levelId: str(level.id ?? value.levelId ?? value.level_id),
    levelName: str(level.name).slice(0, 120),
    price,
    active: subscribed && (status === '' || status === 'active') && price > 0 && level.isFree !== true,
    ...(paidUntil ? { paidUntil } : {}),
    ...(since ? { since } : {}),
  }
}

export interface BoostyClientOptions {
  fetch?: typeof fetch
  now?: () => number
  /** Per-request timeout, ms (default 15 s). */
  timeoutMs?: number
  /** Pause between pages, ms (default 1 s): polite to Boosty. */
  pageDelayMs?: number
  sleep?: (ms: number) => Promise<void>
}

export class BoostyClient {
  private tokens: BoostyTokens | undefined
  private readonly fetch: typeof fetch
  private readonly now: () => number
  private readonly timeoutMs: number
  private readonly pageDelayMs: number
  private readonly sleep: (ms: number) => Promise<void>

  constructor(private readonly credentials: BoostyCredentials, private readonly store: BoostyTokenStore, options: BoostyClientOptions = {}) {
    this.fetch = options.fetch ?? fetch
    this.now = options.now ?? Date.now
    this.timeoutMs = options.timeoutMs ?? 15_000
    this.pageDelayMs = options.pageDelayMs ?? 1000
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
    this.tokens = store.load(credentials)
  }

  get blog() { return this.credentials.blog }

  /** Values that must never appear anywhere: the seed and the current tokens. */
  secrets(): string[] {
    return [this.credentials.auth, this.credentials.clientId, this.tokens?.accessToken ?? '', this.tokens?.refreshToken ?? ''].filter(Boolean)
  }

  /** Every subscriber of the blog, page by page. */
  async subscribers(): Promise<BoostySubscriber[]> {
    const all: BoostySubscriber[] = []
    let offset = 0
    for (let page = 0; page < MAX_PAGES; page += 1) {
      if (page > 0 && this.pageDelayMs > 0) await this.sleep(this.pageDelayMs)
      const answer = await this.get(`/v1/blog/${encodeURIComponent(this.credentials.blog)}/subscribers?limit=${PAGE_SIZE}&offset=${offset}`)
      const data = Array.isArray(answer.data) ? answer.data : []
      for (const item of data) {
        const subscriber = normalizeSubscriber(item)
        if (subscriber) all.push(subscriber)
      }
      const total = num(answer.total)
      offset += data.length
      if (!data.length || (total !== undefined && offset >= total) || (total === undefined && data.length < PAGE_SIZE)) break
    }
    return all
  }

  private async get(path: string): Promise<Record<string, unknown>> {
    if (!this.tokens) throw new BoostyApiError(BOOSTY_TOKEN_DEAD, undefined, 'no_token', true)
    if (this.tokens.expiresAt && this.tokens.expiresAt - REFRESH_MARGIN_MS <= this.now()) await this.refresh()
    let response = await this.send(path)
    if (response.status === 401) {
      await this.refresh()
      response = await this.send(path)
      if (response.status === 401) throw new BoostyApiError(BOOSTY_TOKEN_DEAD, 401, await errorCode(response), true)
    }
    if (response.status === 403) throw new BoostyApiError('Boosty отказал в доступе к подписчикам блога (403): токен не владельца блога?', 403, await errorCode(response))
    if (response.status === 429) throw new BoostyApiError('Boosty просит подождать (429)', 429)
    if (!response.ok) throw new BoostyApiError(`Boosty ответил ошибкой ${response.status}`, response.status, await errorCode(response))
    try {
      const body = await response.json() as unknown
      if (!body || typeof body !== 'object') throw new Error('shape')
      return body as Record<string, unknown>
    } catch {
      throw new BoostyApiError('Boosty прислал ответ в незнакомом виде', response.status)
    }
  }

  private send(path: string) {
    return this.fetch(`${BOOSTY_API}${path}`, {
      method: 'GET',
      headers: { accept: 'application/json', authorization: `Bearer ${this.tokens?.accessToken ?? ''}`, 'user-agent': USER_AGENT, 'cache-control': 'no-cache' },
      signal: AbortSignal.timeout(this.timeoutMs),
    })
  }

  /** A new access token by the refresh token; the rotated pair is saved at once. A refused refresh: the token is dead. */
  async refresh() {
    if (!this.tokens?.refreshToken) throw new BoostyApiError(BOOSTY_TOKEN_DEAD, undefined, 'no_token', true)
    const body = new URLSearchParams({ device_id: this.credentials.clientId, device_os: 'web', grant_type: 'refresh_token', refresh_token: this.tokens.refreshToken })
    const response = await this.fetch(`${BOOSTY_API}/oauth/token/`, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded', 'user-agent': USER_AGENT },
      body: body.toString(),
      signal: AbortSignal.timeout(this.timeoutMs),
    })
    if (response.status === 400 || response.status === 401 || response.status === 403) throw new BoostyApiError(BOOSTY_TOKEN_DEAD, response.status, await errorCode(response), true)
    if (!response.ok) throw new BoostyApiError(`Boosty не обновил токен: ошибка ${response.status}`, response.status, await errorCode(response))
    let answer: Record<string, unknown>
    try { answer = await response.json() as Record<string, unknown> } catch { throw new BoostyApiError('Boosty прислал ответ в незнакомом виде', response.status) }
    const accessToken = text(answer.access_token ?? answer.accessToken)
    const refreshToken = text(answer.refresh_token ?? answer.refreshToken) || this.tokens.refreshToken
    if (!accessToken) throw new BoostyApiError(BOOSTY_TOKEN_DEAD, response.status, 'no_access_token', true)
    const expiresIn = num(answer.expires_in)
    const expiresAt = expiresIn !== undefined ? this.now() + expiresIn * 1000 : toMs(answer.expires_at ?? answer.expiresAt)
    this.tokens = { accessToken, refreshToken, expiresAt }
    try { this.store.save(this.credentials, this.tokens) } catch { console.warn('Boosty: could not save the refreshed tokens (the data directory is not writable)') }
  }
}
