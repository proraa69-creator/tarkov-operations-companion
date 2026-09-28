import { API_URL } from './config'

export type AccountKind = 'user' | 'streamer'
export type AccountMode = 'pvp' | 'pve' | 'seasonal'

export interface ReferralStats {
  visits: number
  registrations: number
  activeSubscriptions: number
  earnings: { amount: number; currency: string }
}

/** Mirrors AccountView in server/src/services/accountStore.ts */
export interface Account {
  email: string
  kind: AccountKind
  createdAt: string
  referralCode?: string
  referredBy?: string
  nicknames: Partial<Record<AccountMode, string>>
  subscription: { status: 'trial' | 'inactive'; trialEndsAt?: string }
  stats?: ReferralStats
}

export const NETWORK_ERROR_MESSAGE = 'Сервер аккаунтов сейчас недоступен. Проверьте подключение к интернету и попробуйте ещё раз через минуту.'

export class ApiError extends Error {
  readonly status: number
  readonly network: boolean
  constructor(status: number, message: string, network = false) {
    super(message)
    this.status = status
    this.network = network
  }
}

function fallbackMessage(status: number) {
  if (status === 401) return 'Требуется вход в аккаунт'
  if (status === 429) return 'Слишком много попыток. Подождите немного и попробуйте снова.'
  if (status >= 500) return 'На сервере произошла ошибка. Попробуйте позже.'
  return 'Не удалось выполнить запрос'
}

/** Per-mode data the app sent to the server (GET /v1/me/summary, mirrors server/src/routes/me.ts). */
export interface ModeSummary {
  quests: { completed: number; active: number; failed: number }
  kappa: { completed: number; total: number } | null
  collector: { collected: number; total: number | null; updatedAt: string | null }
  lastSyncAt: string | null
  lastPosition: { at: string; receivedAt: string; map?: string } | null
}

export interface AccountSummary {
  account: { email: string; kind: AccountKind; nicknames: Partial<Record<AccountMode, string>> }
  modes: Record<AccountMode, ModeSummary>
  generatedAt: string
}

async function request<T>(path: string, options: { method?: string; body?: unknown; token?: string | null; root?: string } = {}): Promise<T> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 12_000)
  let response: Response
  try {
    response = await fetch(`${API_URL}${options.root ?? '/v1/accounts'}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    })
  } catch {
    throw new ApiError(0, NETWORK_ERROR_MESSAGE, true)
  } finally {
    window.clearTimeout(timer)
  }
  if (response.status === 204) return undefined as T
  let data: unknown
  try { data = await response.json() } catch { data = undefined }
  if (!response.ok) {
    const message = data && typeof data === 'object' && 'error' in data && typeof data.error === 'string' ? data.error : fallbackMessage(response.status)
    throw new ApiError(response.status, message)
  }
  if (data === undefined) throw new ApiError(response.status, 'Сервер вернул неожиданный ответ')
  return data as T
}

export interface AuthResult { token: string; account: Account; referralApplied?: boolean }

export const api = {
  register: (email: string, password: string, referralCode?: string) =>
    request<AuthResult>('/register', { method: 'POST', body: { email, password, ...(referralCode ? { referralCode } : {}) } }),
  login: (email: string, password: string) => request<AuthResult>('/login', { method: 'POST', body: { email, password } }),
  logout: (token: string) => request<void>('/logout', { method: 'POST', token }),
  me: (token: string) => request<Account>('/me', { token }),
  applyReferral: (token: string, code: string) => request<Account>('/me/referral', { method: 'POST', token, body: { code } }),
  setNicknames: (token: string, nicknames: Partial<Record<AccountMode, string>>) => request<Account>('/me/nicknames', { method: 'PUT', token, body: nicknames }),
  referralVisit: (code: string) => request<{ ok: true; code: string }>('/referral-visits', { method: 'POST', body: { code } }),
  summary: (token: string) => request<AccountSummary>('/summary', { token, root: '/v1/me' }),
}

export function errorMessage(error: unknown) {
  return error instanceof ApiError ? error.message : 'Что-то пошло не так. Обновите страницу и попробуйте снова.'
}
