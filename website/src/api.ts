import { API_URL } from './config'

export type AccountKind = 'user' | 'streamer'
export type AccountMode = 'pvp' | 'pve' | 'seasonal'

export interface ReferralStats {
  visits: number
  registrations: number
  activeSubscriptions: number
  /** Sum of confirmed payments by users who came through the streamer's code. */
  revenue: { amount: number; currency: string }
  /** The streamer's share of that revenue. */
  earnings: { amount: number; currency: string }
}

export type SubscriptionStatus = 'active' | 'trial' | 'inactive'

/** Mirrors AccountView in server/src/services/accountStore.ts */
export interface Account {
  email: string
  kind: AccountKind
  createdAt: string
  referralCode?: string
  referredBy?: string
  nicknames: Partial<Record<AccountMode, string>>
  subscription: { status: SubscriptionStatus; paidUntil?: string; trialEndsAt?: string }
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

/** Mirrors PlanView / PaymentView in server/src/services/paymentStore.ts. Amounts are in roubles. */
export type PlanId = '1m' | '3m' | '6m' | '12m'
export interface Plan { id: PlanId; months: number; price: number; currency: 'RUB'; discountPercent: number }
export interface PlansResponse { enabled: boolean; plans: Plan[] }
export type PaymentStatus = 'pending' | 'succeeded' | 'canceled'
export interface Payment { id: string; plan: PlanId; amount: number; currency: 'RUB'; status: PaymentStatus; createdAt: string; paidAt?: string }
export interface CreatedPayment { paymentId: string; confirmationUrl: string }

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

/** Streamer statistics by period (GET /v1/accounts/me/referral-stats), mirrors ReferralSeriesRow. Amounts in roubles. */
export type StatsPeriod = 'day' | 'month' | 'year'
export interface ReferralSeriesRow {
  /** 2026-10-01 / 2026-10 / 2026 (Moscow time) */
  period: string
  visits: number
  registrations: number
  payments: number
  months: Record<PlanId, number>
  revenue: number
  earnings: number
}
export interface ReferralSeries { period: StatsPeriod; rows: ReferralSeriesRow[] }

/** Secret one-time streamer invitation (POST /v1/accounts/streamer-invite). */
export interface StreamerInvite { code: string; expiresAt: string }
export const STREAMER_INVITE_PATTERN = /^[A-Za-z0-9_-]{32}$/

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
  referralSeries: (token: string, period: StatsPeriod) => request<ReferralSeries>(`/me/referral-stats?period=${period}`, { token }),
  streamerInvite: (inviteToken: string) => request<StreamerInvite>('/streamer-invite', { method: 'POST', body: { token: inviteToken } }),
  redeemStreamerInvite: (token: string, inviteToken: string) => request<Account>('/me/streamer-invite', { method: 'POST', token, body: { token: inviteToken } }),
  plans: () => request<PlansResponse>('/plans', { root: '/v1/payments' }),
  createPayment: (token: string, plan: PlanId) => request<CreatedPayment>('', { method: 'POST', token, body: { plan }, root: '/v1/payments' }),
  payment: (token: string, id: string) => request<Payment>(`/${encodeURIComponent(id)}`, { token, root: '/v1/payments' }),
  payments: (token: string) => request<{ payments: Payment[] }>('', { token, root: '/v1/payments' }),
}

export function errorMessage(error: unknown) {
  return error instanceof ApiError ? error.message : 'Что-то пошло не так. Обновите страницу и попробуйте снова.'
}
