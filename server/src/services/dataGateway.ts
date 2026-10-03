/**
 * Game data gateway (docs/subscription-protection.md): the players' app (client edition) gets tarkov.dev data only
 * through this server, and only with an active subscription / trial / streamer / owner account (routes/data.ts).
 *
 * - GraphQL: POST /v1/data/graphql {query, variables?} is forwarded to https://api.tarkov.dev/graphql when the query
 *   is a single read-only operation (no mutation / subscription / introspection) and EITHER its operation name is in
 *   ALLOWED_OPERATIONS OR every top-level field is in SAFE_TOP_LEVEL_FIELDS. New app queries: name them and add the name
 *   to ALLOWED_OPERATIONS (or keep to the safe fields).
 * - JSON: GET /v1/data/json/<regular|pve|pvp-season>/<endpoint> is forwarded to https://json.tarkov.dev for the
 *   endpoints in JSON_ENDPOINTS (and their `_<lang>` translation dictionaries).
 * - One shared cache for all players, keyed by the query text + variables (gameMode included): trader restock times
 *   1 minute, prices 10 minutes, static data 6 hours. Identical requests in flight share one upstream call. Answers above `maxResponseBytes` are refused, the
 *   cache as a whole keeps at most `maxCacheBytes` (oldest entries go first).
 */
import { createHash } from 'node:crypto'

export const GRAPHQL_UPSTREAM = 'https://api.tarkov.dev/graphql'
export const JSON_UPSTREAM = 'https://json.tarkov.dev'

/**
 * Operation names of the app's own GraphQL queries (`query RaidOsGuns(...) {...}`). The single list to extend when a
 * feature adds a named query; anonymous queries pass only with SAFE_TOP_LEVEL_FIELDS.
 */
export const ALLOWED_OPERATIONS: string[] = [
  'RaidOsBosses',
  'RaidOsGuns', 'RaidOsMods', 'RaidOsAmmo',
  'RaidOsEconomy', 'RaidOsPriceHistory',
  'RaidOsBallistics', 'RaidOsRaidPrep',
]

/** Read-only public game data: a query using only these top-level fields is allowed whatever its name. */
export const SAFE_TOP_LEVEL_FIELDS: ReadonlySet<string> = new Set([
  'items', 'item', 'tasks', 'task', 'traders', 'maps', 'barters', 'crafts', 'hideoutStations', 'ammo',
  'historicalItemPrices', 'bosses', 'playerLevels', 'itemPrices', 'fleaMarket',
])

/** Fields whose answers carry market prices: cached for PRICE_TTL_MS, everything else for STATIC_TTL_MS. */
const PRICE_FIELDS = new Set(['items', 'item', 'itemPrices', 'historicalItemPrices', 'barters', 'crafts', 'fleaMarket', 'ammo'])
export const PRICE_TTL_MS = 10 * 60 * 1000
export const STATIC_TTL_MS = 6 * 60 * 60 * 1000
/** Trader restock times (`traders { resetTime }`) move every few hours per trader: a minute. */
const SHORT_FIELDS = new Set(['traders'])
export const SHORT_TTL_MS = 60 * 1000

/** json.tarkov.dev endpoints the app reads (catalog, translations, goon reports, item names). */
export const JSON_ENDPOINTS: ReadonlySet<string> = new Set(['tasks', 'items', 'maps', 'traders', 'hideout', 'barters', 'crafts', 'mobs', 'handbook'])
const JSON_PATH = /^(regular|pve|pvp-season)\/([a-z]+)(?:_([a-z]{2}))?$/
/** Of the JSON endpoints, these change often (prices, goon reports): short cache. */
const JSON_PRICE_ENDPOINTS = new Set(['items', 'maps', 'barters', 'crafts'])

export const MAX_QUERY_LENGTH = 20_000
export const MAX_VARIABLES_LENGTH = 4_000
export const DEFAULT_MAX_RESPONSE_BYTES = 48 * 1024 * 1024
/** The answer cache is held in memory (Cyrillic text takes about 2 bytes per character there): 384 MB filled the laptop's RAM up to 800 MB and made the guardian restart the server (auto-report #4). */
export const DEFAULT_MAX_CACHE_BYTES = 96 * 1024 * 1024

export class GatewayError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

// ---------------------------------------------------------------------------------------------------------------
// GraphQL document check (no full parser: enough to find operations, top-level fields and forbidden parts)
// ---------------------------------------------------------------------------------------------------------------

type Token = { kind: 'name' | 'punct' | 'spread'; value: string }

function tokenize(query: string): Token[] {
  const tokens: Token[] = []
  let index = 0
  while (index < query.length) {
    const char = query[index]!
    if (char === '#') { while (index < query.length && query[index] !== '\n') index += 1; continue }
    if (char === ',' || char === '﻿' || /\s/.test(char)) { index += 1; continue }
    if (query.startsWith('"""', index)) {
      const end = query.indexOf('"""', index + 3)
      if (end < 0) throw new GatewayError(400, 'Некорректный запрос')
      index = end + 3
      tokens.push({ kind: 'punct', value: 'str' })
      continue
    }
    if (char === '"') {
      index += 1
      while (index < query.length && query[index] !== '"') { if (query[index] === '\\') index += 1; if (query[index] === '\n') break; index += 1 }
      if (query[index] !== '"') throw new GatewayError(400, 'Некорректный запрос')
      index += 1
      tokens.push({ kind: 'punct', value: 'str' })
      continue
    }
    if (query.startsWith('...', index)) { tokens.push({ kind: 'spread', value: '...' }); index += 3; continue }
    const name = /^[_A-Za-z][_0-9A-Za-z]*/.exec(query.slice(index, index + 200))
    if (name) { tokens.push({ kind: 'name', value: name[0] }); index += name[0].length; continue }
    const number = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(query.slice(index, index + 50))
    if (number) { tokens.push({ kind: 'punct', value: 'num' }); index += number[0].length; continue }
    if ('{}()[]:=@$!|&'.includes(char)) { tokens.push({ kind: 'punct', value: char }); index += 1; continue }
    throw new GatewayError(400, 'Некорректный запрос')
  }
  return tokens
}

export interface QueryShape { operationName?: string; fields: string[] }

/**
 * The single operation of a GraphQL document and its top-level field names; throws 400/403 for anything that is not a
 * plain read query (mutations, subscriptions, several operations, introspection, fragment spreads at the top level).
 */
export function inspectQuery(query: string): QueryShape {
  if (typeof query !== 'string' || !query.trim()) throw new GatewayError(400, 'Пустой запрос')
  if (query.length > MAX_QUERY_LENGTH) throw new GatewayError(413, 'Запрос слишком длинный')
  const tokens = tokenize(query)
  if (tokens.some((token) => token.kind === 'name' && (token.value === '__schema' || token.value === '__type'))) throw new GatewayError(403, 'Служебные запросы схемы недоступны')
  let operation: QueryShape | undefined
  let index = 0
  const skipBalanced = (open: string, close: string) => {
    let depth = 0
    do {
      const token = tokens[index]
      if (!token) throw new GatewayError(400, 'Некорректный запрос')
      if (token.value === open) depth += 1
      else if (token.value === close) depth -= 1
      index += 1
    } while (depth > 0)
  }
  while (index < tokens.length) {
    const token = tokens[index]!
    if (token.kind === 'name' && token.value === 'fragment') {
      // fragment Name on Type @directives { ... }
      while (index < tokens.length && tokens[index]!.value !== '{') index += 1
      skipBalanced('{', '}')
      continue
    }
    let name: string | undefined
    if (token.kind === 'name') {
      if (token.value === 'mutation' || token.value === 'subscription') throw new GatewayError(403, 'Изменяющие запросы недоступны')
      if (token.value !== 'query') throw new GatewayError(400, 'Некорректный запрос')
      index += 1
      if (tokens[index]?.kind === 'name') { name = tokens[index]!.value; index += 1 }
      if (tokens[index]?.value === '(') skipBalanced('(', ')')
      while (tokens[index]?.value === '@') { index += 2; if (tokens[index]?.value === '(') skipBalanced('(', ')') }
    }
    if (tokens[index]?.value !== '{') throw new GatewayError(400, 'Некорректный запрос')
    if (operation) throw new GatewayError(400, 'Один запрос — одна операция')
    operation = { ...(name ? { operationName: name } : {}), fields: topLevelFields() }
  }
  if (!operation) throw new GatewayError(400, 'Некорректный запрос')
  return operation

  function topLevelFields() {
    const fields: string[] = []
    index += 1 // {
    while (tokens[index] && tokens[index]!.value !== '}') {
      const token = tokens[index]!
      if (token.kind === 'spread') throw new GatewayError(403, 'Фрагменты на верхнем уровне запроса недоступны')
      if (token.kind !== 'name') throw new GatewayError(400, 'Некорректный запрос')
      let field = token.value
      index += 1
      if (tokens[index]?.value === ':') { // alias: field
        index += 1
        if (tokens[index]?.kind !== 'name') throw new GatewayError(400, 'Некорректный запрос')
        field = tokens[index]!.value
        index += 1
      }
      fields.push(field)
      if (tokens[index]?.value === '(') skipBalanced('(', ')')
      while (tokens[index]?.value === '@') { index += 2; if (tokens[index]?.value === '(') skipBalanced('(', ')') }
      if (tokens[index]?.value === '{') skipBalanced('{', '}')
    }
    if (!tokens[index]) throw new GatewayError(400, 'Некорректный запрос')
    index += 1 // }
    return fields
  }
}

/** Throws unless the query may go upstream; returns its shape (for the cache lifetime). */
export function checkQueryAllowed(query: string, allowedOperations: readonly string[] = ALLOWED_OPERATIONS): QueryShape {
  const shape = inspectQuery(query)
  const named = shape.operationName !== undefined && allowedOperations.includes(shape.operationName)
  const safe = shape.fields.length > 0 && shape.fields.every((field) => field === '__typename' || SAFE_TOP_LEVEL_FIELDS.has(field))
  if (!named && !safe) throw new GatewayError(403, 'Этот запрос данных не разрешён')
  return shape
}

// ---------------------------------------------------------------------------------------------------------------
// Upstream + cache
// ---------------------------------------------------------------------------------------------------------------

export interface DataGatewayOptions {
  fetch?: typeof fetch
  now?: () => number
  maxResponseBytes?: number
  maxCacheBytes?: number
  timeoutMs?: number
}

interface Entry { body: string; expires: number; bytes: number }

export class DataGateway {
  private readonly fetcher: typeof fetch
  private readonly now: () => number
  private readonly maxResponseBytes: number
  private readonly maxCacheBytes: number
  private readonly timeoutMs: number
  private readonly cache = new Map<string, Entry>()
  private readonly pending = new Map<string, Promise<string>>()
  private cacheBytes = 0
  /** Upstream calls made (tests and the owner's statistics). */
  upstreamCalls = 0

  constructor(options: DataGatewayOptions = {}) {
    this.fetcher = options.fetch ?? fetch
    this.now = options.now ?? Date.now
    this.maxResponseBytes = options.maxResponseBytes ?? (Number(process.env.TARKOV_DATA_MAX_BYTES) || DEFAULT_MAX_RESPONSE_BYTES)
    this.maxCacheBytes = options.maxCacheBytes ?? DEFAULT_MAX_CACHE_BYTES
    this.timeoutMs = options.timeoutMs ?? 60_000
  }

  /** JSON text of the GraphQL answer (cached). */
  async graphql(query: unknown, variables: unknown): Promise<string> {
    if (typeof query !== 'string') throw new GatewayError(400, 'Пустой запрос')
    const shape = checkQueryAllowed(query)
    if (variables !== undefined && variables !== null && (typeof variables !== 'object' || Array.isArray(variables))) throw new GatewayError(400, 'Некорректные переменные запроса')
    const vars = (variables ?? {}) as Record<string, unknown>
    for (const value of Object.values(vars)) {
      if (value !== null && !['string', 'number', 'boolean'].includes(typeof value) && !(Array.isArray(value) && value.every((entry) => typeof entry === 'string' || typeof entry === 'number'))) throw new GatewayError(400, 'Некорректные переменные запроса')
    }
    const varsText = JSON.stringify(Object.fromEntries(Object.entries(vars).sort(([a], [b]) => a.localeCompare(b))))
    if (varsText.length > MAX_VARIABLES_LENGTH) throw new GatewayError(413, 'Слишком много переменных запроса')
    const normalized = query.replace(/\s+/g, ' ').trim()
    // gameMode is part of the variables or of the query text itself: both are in the key.
    const key = `gql:${createHash('sha256').update(normalized).update('\u0000').update(varsText).digest('hex')}`
    const ttl = shape.fields.some((field) => SHORT_FIELDS.has(field)) ? SHORT_TTL_MS : shape.fields.some((field) => PRICE_FIELDS.has(field)) ? PRICE_TTL_MS : STATIC_TTL_MS
    return this.cached(key, ttl, async () => {
      const body = await this.upstream(GRAPHQL_UPSTREAM, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ query, ...(Object.keys(vars).length ? { variables: vars } : {}) }) })
      let parsed: { data?: unknown; errors?: unknown }
      try { parsed = JSON.parse(body) as typeof parsed } catch { throw new GatewayError(502, 'Источник данных вернул некорректный ответ') }
      if (!parsed || typeof parsed !== 'object' || parsed.data == null) throw new GatewayError(502, 'Источник данных временно недоступен')
      return body
    })
  }

  /** JSON text of a json.tarkov.dev endpoint (cached). */
  async json(path: string): Promise<string> {
    const match = JSON_PATH.exec(path)
    if (!match || !JSON_ENDPOINTS.has(match[2]!)) throw new GatewayError(404, 'Неизвестный набор данных')
    const ttl = !match[3] && JSON_PRICE_ENDPOINTS.has(match[2]!) ? PRICE_TTL_MS : STATIC_TTL_MS
    return this.cached(`json:${path}`, ttl, async () => {
      const body = await this.upstream(`${JSON_UPSTREAM}/${path}`, { headers: { accept: 'application/json' } })
      if (!body.startsWith('{')) throw new GatewayError(502, 'Источник данных вернул некорректный ответ')
      return body
    })
  }

  private async cached(key: string, ttl: number, load: () => Promise<string>) {
    const entry = this.cache.get(key)
    if (entry && entry.expires > this.now()) return entry.body
    const running = this.pending.get(key)
    if (running) return running
    const request = load().then((body) => {
      this.store(key, body, ttl)
      return body
    }).catch((error: unknown) => {
      // An expired copy is better than nothing while tarkov.dev is down.
      if (entry) return entry.body
      throw error
    }).finally(() => this.pending.delete(key))
    this.pending.set(key, request)
    return request
  }

  private store(key: string, body: string, ttl: number) {
    const bytes = Buffer.byteLength(body)
    const previous = this.cache.get(key)
    if (previous) { this.cacheBytes -= previous.bytes; this.cache.delete(key) }
    if (bytes > this.maxCacheBytes) return
    // Expired answers go first: they would only be refetched anyway.
    const now = this.now()
    for (const [oldKey, value] of this.cache) {
      if (value.expires > now) continue
      this.cache.delete(oldKey)
      this.cacheBytes -= value.bytes
    }
    while (this.cacheBytes + bytes > this.maxCacheBytes && this.cache.size) {
      const [oldest, value] = this.cache.entries().next().value as [string, Entry]
      this.cache.delete(oldest)
      this.cacheBytes -= value.bytes
    }
    this.cache.set(key, { body, expires: this.now() + ttl, bytes })
    this.cacheBytes += bytes
  }

  /** Response text with a hard size cap (read as a stream: an oversized answer is cut off, not buffered). */
  private async upstream(url: string, init: RequestInit) {
    this.upstreamCalls += 1
    let response: Response
    try {
      response = await this.fetcher(url, { ...init, signal: AbortSignal.timeout(this.timeoutMs) })
    } catch {
      throw new GatewayError(502, 'Источник данных временно недоступен')
    }
    if (!response.ok) throw new GatewayError(502, `Источник данных ответил ${response.status}`)
    const declared = Number(response.headers.get('content-length'))
    if (declared > this.maxResponseBytes) throw new GatewayError(502, 'Ответ источника данных слишком большой')
    if (!response.body) return ''
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > this.maxResponseBytes) {
        await reader.cancel().catch(() => undefined)
        throw new GatewayError(502, 'Ответ источника данных слишком большой')
      }
      chunks.push(value)
    }
    return Buffer.concat(chunks).toString('utf8')
  }
}
