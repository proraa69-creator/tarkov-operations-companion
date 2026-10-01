/**
 * «Безопасность» tab of the admin panel: the owner-only API of «Страж сервера» (server/src/routes/serverGuard.ts).
 * Kept apart from api.ts; the same error handling (ApiError, network message).
 */
import { ApiError, NETWORK_ERROR_MESSAGE } from '../../api'
import { API_URL } from '../../config'

export type GuardReason =
  | 'scanner' | 'traversal' | 'injection' | 'not-found' | 'auth-fail' | 'rate-limited' | 'login-fail'
  | 'credential-stuffing' | 'webhook-signature' | 'oversized'

export interface SecurityEvent { id: number; at: string; firstAt: string; ip: string; reason: GuardReason; path: string; detail?: string; count: number; points: number }
export interface SecurityBan { id: number; ip: string; reason: string; level: number; source: 'auto' | 'manual'; actor?: string; createdAt: string; until: string; active: boolean; liftedAt?: string; liftedBy?: string }
export interface AllowEntry { id: string; ip: string; note?: string; createdAt: string; source: 'admin' | 'env' }
export interface ErrorWindow { requests: number; errors: number; rate: number }
export interface SeriesRow { at: string; requests: number; errors: number }
export interface BackupFile { name: string; kind: 'daily' | 'before-restart' | 'manual'; at: string; bytes: number }

export interface SecurityView {
  at: string
  uptimeSec: number
  requests: { last5m: ErrorWindow; last15m: ErrorWindow; last60m: ErrorWindow; last24h?: ErrorWindow }
  eventLoop: { meanMs: number; p99Ms: number; maxMs: number }
  memory: { rssMb: number; heapUsedMb: number; heapTotalMb: number }
  unhandled: { total: number; exceptions60m: number; rejections60m: number; last?: { at: string; kind: string; message: string } }
  database: { bytes: number; walBytes: number; quickCheck?: { ok: boolean; at: string; result: string } }
  backups: { enabled: boolean; lastAt?: string; lastFile?: string; lastKind?: string; count: number; totalBytes: number; lastError?: string; lastErrorAt?: string }
  security: { activeBans: number; bans24h: number; bans1h: number; blockedSinceStart: number; events1h: number; events24h: number; byReason24h: Partial<Record<GuardReason, number>>; credentialStuffing1h: number; lastBanAt?: string }
  series: SeriesRow[]
  recentSeries: SeriesRow[]
  bans: SecurityBan[]
  allowlist: AllowEntry[]
  events: SecurityEvent[]
  backupFiles: BackupFile[]
}

const BASE = '/v1/accounts/me/admin/security'

async function call<T>(token: string, path: string, body?: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_URL}${BASE}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(12_000),
    })
  } catch {
    throw new ApiError(0, NETWORK_ERROR_MESSAGE, true)
  }
  const data = await response.json().catch(() => undefined) as { error?: unknown } | undefined
  if (!response.ok) throw new ApiError(response.status, typeof data?.error === 'string' ? data.error : response.status === 404 ? 'Раздел доступен только владельцу (или сервер ещё не обновлён).' : `Ошибка сервера (HTTP ${response.status})`)
  return data as T
}

export const securityApi = {
  view: (token: string) => call<SecurityView>(token, ''),
  events: (token: string, limit: number, offset: number, reason?: GuardReason) =>
    call<{ events: SecurityEvent[]; total: number }>(token, `/events?limit=${limit}&offset=${offset}${reason ? `&reason=${reason}` : ''}`),
  ban: (token: string, ip: string, hours: number, note?: string) => call<{ bans: SecurityBan[] }>(token, '/bans', { ip, hours, ...(note ? { note } : {}) }),
  unban: (token: string, id: number) => call<{ bans: SecurityBan[] }>(token, `/bans/${id}/unban`, {}),
  allow: (token: string, ip: string, note?: string) => call<{ allowlist: AllowEntry[]; bans: SecurityBan[] }>(token, '/allowlist', { ip, ...(note ? { note } : {}) }),
  disallow: (token: string, id: string) => call<{ allowlist: AllowEntry[] }>(token, `/allowlist/${id}/remove`, {}),
}

export const REASON_LABEL: Record<GuardReason, string> = {
  scanner: 'Сканирование уязвимостей',
  traversal: 'Обход путей (../)',
  injection: 'SQL / скрипт-инъекции',
  'not-found': 'Перебор адресов (404)',
  'auth-fail': 'Отказы в доступе (401/403)',
  'rate-limited': 'Превышение лимитов (429)',
  'login-fail': 'Неудачные входы',
  'credential-stuffing': 'Подбор паролей по многим e-mail',
  'webhook-signature': 'Поддельные уведомления об оплате',
  oversized: 'Слишком большие запросы',
}
