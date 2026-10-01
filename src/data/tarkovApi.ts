/**
 * The single way the app reads tarkov.dev (docs/subscription-protection.md).
 *
 * - The players' app (client edition: the packaged exe, the phone app, any production build that is not the owner's)
 *   never talks to tarkov.dev itself: every GraphQL query and every json.tarkov.dev file goes through our server's data
 *   gateway (POST /v1/data/graphql, GET /v1/data/json/…) with the account session — 402 «Нужна подписка» without one.
 * - The owner's app and development runs keep the direct requests (and the server first, where it exists).
 *
 * Feature code calls `tarkovGraphql()` / `tarkovJson()`. Code that still calls `fetch('https://api.tarkov.dev/graphql')`
 * or `fetch('https://json.tarkov.dev/…')` directly is routed through the same functions by `installTarkovFetchGuard()`
 * (installed at start in src/main.tsx), so a newly added query cannot bypass the gateway by accident; requests to
 * players.tarkov.dev are refused there (player lookups go through /v1/players/*). The Electron main process cancels any
 * request that still reaches those hosts (electron/main.ts).
 */
import { appEdition, type AppEdition } from '../app/buildEdition'
import { cleanIpcError, usesWebAccount } from '../sync/serverSync'
import { webServiceRequest } from '../sync/webAccount'

export const GRAPHQL_URL = 'https://api.tarkov.dev/graphql'
export const JSON_URL = 'https://json.tarkov.dev'
const REQUEST_TIMEOUT = 60_000

export type DataRoute = 'gateway' | 'direct'

/**
 * Pure routing decision. The desktop main process says whether this exe is gateway-only (`desktopGateway`: the
 * packaged players' exe); elsewhere every non-owner production build is.
 */
export function resolveDataRoute(input: { edition: AppEdition; dev: boolean; desktopGateway?: boolean; forceGateway?: boolean }): DataRoute {
  if (input.forceGateway) return 'gateway'
  if (input.edition === 'owner') return 'direct'
  if (input.desktopGateway !== undefined) return input.desktopGateway ? 'gateway' : 'direct'
  return input.dev ? 'direct' : 'gateway'
}

let routeOverride: DataRoute | null = null
/** Tests only. */
export function setDataRouteForTests(route: DataRoute | null) { routeOverride = route }

export function dataRoute(): DataRoute {
  if (routeOverride) return routeOverride
  const desktop = typeof window !== 'undefined' ? window.tarkovDesktop : undefined
  return resolveDataRoute({
    edition: appEdition(),
    dev: Boolean(import.meta.env.DEV),
    desktopGateway: desktop ? desktop.dataGateway === true : undefined,
    forceGateway: import.meta.env.VITE_DATA_GATEWAY === '1',
  })
}

export const usesDataGateway = () => dataRoute() === 'gateway'

/** «Нужна подписка» (402), a switched-off device (403) or no account: the app shows the paywall (src/account/Paywall.tsx). */
export class DataAccessError extends Error {
  readonly kind: 'subscription' | 'device' | 'signed-out'
  constructor(kind: DataAccessError['kind'], message: string) {
    super(message)
    this.kind = kind
  }
}
export const DATA_ACCESS_EVENT = 'raidos-data-access-denied'

function accessError(message: string) {
  if (/Нужна подписка/i.test(message)) return new DataAccessError('subscription', 'Нужна подписка')
  if (/устройство/i.test(message)) return new DataAccessError('device', message)
  if (/Сессия истекла|Требуется вход/i.test(message)) return new DataAccessError('signed-out', 'Войдите в аккаунт')
  return null
}

/** A request to our server's gateway with the account session (desktop: the main process adds it and the device id). */
export async function gatewayRequest(method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
  const desktop = typeof window !== 'undefined' ? window.tarkovDesktop : undefined
  try {
    if (desktop?.serviceRequest) return await desktop.serviceRequest(method, path, body)
    if (usesWebAccount() || typeof window !== 'undefined') return await webServiceRequest(method, path, body)
  } catch (error) {
    const message = cleanIpcError(error)
    const denied = accessError(message)
    if (denied) {
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(DATA_ACCESS_EVENT, { detail: denied.kind }))
      throw denied
    }
    throw new Error(message, { cause: error })
  }
  throw new DataAccessError('signed-out', 'Войдите в аккаунт')
}

export interface GraphqlPayload<T> { data?: T; errors?: Array<{ message?: string }> }

/** A tarkov.dev GraphQL query: through the gateway in the players' app, directly in the owner's app / development. */
export async function tarkovGraphql<T = unknown>(query: string, variables?: Record<string, unknown>, route: DataRoute = dataRoute()): Promise<GraphqlPayload<T>> {
  const body = { query, ...(variables && Object.keys(variables).length ? { variables } : {}) }
  if (route === 'gateway') return await gatewayRequest('POST', '/v1/data/graphql', body) as GraphqlPayload<T>
  const response = await directFetch(GRAPHQL_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT),
  })
  if (!response.ok) throw new Error(`tarkov.dev GraphQL: HTTP ${response.status}`)
  return await response.json() as GraphqlPayload<T>
}

const JSON_PATH = /^(regular|pve|pvp-season)\/[a-z]{2,20}(?:_[a-z]{2})?$/

/** A json.tarkov.dev file (`regular/items_en`): through the gateway in the players' app. */
export async function tarkovJson<T = unknown>(path: string, route: DataRoute = dataRoute(), timeoutMs = 45_000): Promise<T> {
  if (route === 'gateway') {
    if (!JSON_PATH.test(path)) throw new Error('Неизвестный набор данных')
    return await gatewayRequest('GET', `/v1/data/json/${path}`) as T
  }
  const response = await directFetch(`${JSON_URL}/${path}`, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error(`${JSON_URL}/${path}: HTTP ${response.status}`)
  return await response.json() as T
}

// ------------------------------------------------------------------------------------------------------------
// fetch guard
// ------------------------------------------------------------------------------------------------------------

/** The page's own fetch, before the guard wrapped it (the direct route uses it). */
let originalFetch: typeof fetch | null = null
const directFetch: typeof fetch = (input, init) => (originalFetch ?? globalThis.fetch)(input, init)

export type TarkovUrlKind = { kind: 'graphql' } | { kind: 'json'; path: string } | { kind: 'blocked' } | null

/** Which tarkov.dev request a URL is (null: anything else, images on assets.tarkov.dev included). */
export function classifyTarkovUrl(raw: string): TarkovUrlKind {
  let url: URL
  try { url = new URL(raw) } catch { return null }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  const host = url.hostname.toLowerCase()
  if (host === 'api.tarkov.dev') return url.pathname.replace(/\/+$/, '') === '/graphql' ? { kind: 'graphql' } : { kind: 'blocked' }
  if (host === 'json.tarkov.dev') return { kind: 'json', path: url.pathname.replace(/^\/+|\/+$/g, '') }
  if (host === 'players.tarkov.dev') return { kind: 'blocked' }
  return null
}

const jsonResponse = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

async function guardedRequest(kind: Exclude<TarkovUrlKind, null>, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  try {
    if (kind.kind === 'blocked') return jsonResponse(403, { errors: [{ message: 'Запрос недоступен: данные идут через сервер Raid OS' }] })
    if (kind.kind === 'json') return jsonResponse(200, await tarkovJson(kind.path, 'gateway'))
    const raw = init?.body ?? (input instanceof Request ? await input.clone().text() : undefined)
    const parsed = JSON.parse(typeof raw === 'string' ? raw : '{}') as { query?: unknown; variables?: unknown }
    if (typeof parsed.query !== 'string') return jsonResponse(400, { errors: [{ message: 'Пустой запрос' }] })
    const variables = parsed.variables && typeof parsed.variables === 'object' ? parsed.variables as Record<string, unknown> : undefined
    return jsonResponse(200, await tarkovGraphql(parsed.query, variables, 'gateway'))
  } catch (error) {
    const status = error instanceof DataAccessError ? (error.kind === 'subscription' ? 402 : error.kind === 'device' ? 403 : 401) : 502
    return jsonResponse(status, { errors: [{ message: error instanceof Error ? error.message : 'Сервер недоступен' }] })
  }
}

/** Players' app: every fetch to tarkov.dev's data hosts goes through the gateway instead (see the file comment). */
export function installTarkovFetchGuard(target: typeof globalThis = globalThis, route: DataRoute = dataRoute()) {
  if (route !== 'gateway' || originalFetch || typeof target.fetch !== 'function') return false
  const page = target.fetch.bind(target)
  originalFetch = page
  target.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const kind = classifyTarkovUrl(url)
    return kind ? guardedRequest(kind, input, init) : page(input, init)
  }) as typeof fetch
  return true
}

/** Tests only: undo the guard. */
export function uninstallTarkovFetchGuardForTests(target: typeof globalThis = globalThis) {
  if (originalFetch) target.fetch = originalFetch
  originalFetch = null
}
