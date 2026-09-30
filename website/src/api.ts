import { API_URL } from './config'

export type AccountKind = 'user' | 'streamer'
export type AccountMode = 'pvp' | 'pve' | 'seasonal'

export interface ReferralStats {
  visits: number
  registrations: number
  activeSubscriptions: number
  /** Sum of confirmed payments by users who came through the streamer's code. Owner view only: never sent to the streamer. */
  revenue?: { amount: number; currency: string }
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
  /** `lifetime`: streamers use the service free of charge, for good. */
  subscription: { status: SubscriptionStatus; paidUntil?: string; trialEndsAt?: string; lifetime?: true }
  stats?: ReferralStats
  /** The service owner (server-side check of TARKOV_OWNER_EMAILS): sees the owner section. */
  owner?: true
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

/** Mirrors PlanView / PaymentView / AutopayView in server/src/services/paymentStore.ts. Plan prices are in roubles. */
export type PlanId = '1m' | '3m' | '6m' | '12m'
/** `price` is null when only foreign payments (Lava.top) are on. */
export interface Plan { id: PlanId; months: number; price: number | null; currency: 'RUB'; discountPercent: number }
export interface PaymentProviders { yookassa: boolean; lava: boolean; autopay: boolean; lavaCurrency?: 'USD' | 'EUR' }
export interface PlansResponse {
  enabled: boolean
  plans: Plan[]
  /** Missing on an older server: then only ЮKassa, without autopayments. */
  providers?: PaymentProviders
  /** Lava.top prices per plan (major units); `prices: null` — shown on the Lava.top page. */
  foreign?: { currency: 'USD' | 'EUR'; prices: Partial<Record<PlanId, number>> | null } | null
}
export type PaymentStatus = 'pending' | 'succeeded' | 'canceled'
export type PaymentProvider = 'yookassa' | 'lava'
export interface Payment { id: string; plan: PlanId; amount: number; currency: string; status: PaymentStatus; createdAt: string; paidAt?: string; provider?: PaymentProvider; renewal?: true }
export interface Autopay {
  provider: PaymentProvider
  plan: PlanId
  status: 'active' | 'canceled' | 'failed'
  amount: number
  currency: string
  nextChargeAt?: string
  /** End of the paid period, only while it still runs. */
  paidUntil?: string
  method?: string
  consentVersion: string
  consentAt: string
  canceledAt?: string
}
/** «Россия и СНГ» (ЮKassa) or «Другие страны» (Lava.top). */
export type PaymentRegion = 'ru' | 'intl'
export interface PaymentOptions { region: PaymentRegion; /** The separate autopayment consent (LEGAL_VERSION) — only when ticked. */ autopayVersion?: string; language: 'ru' | 'en' }
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
  /** Owner view only. */
  revenue?: number
  earnings: number
}
export interface ReferralSeries { period: StatsPeriod; rows: ReferralSeriesRow[] }

/** Secret one-time streamer invitation (POST /v1/accounts/streamer-invite). */
export interface StreamerInvite { code: string; expiresAt: string }
export const STREAMER_INVITE_PATTERN = /^[A-Za-z0-9_-]{32}$/

/** Visits per campaign label of the audience links (/r/CODE?c=youtube). */
export interface CampaignStats { campaign: string; visits: number; visits30d: number; lastVisitDay: string }

/** Owner section (GET /v1/accounts/me/admin/…; the server answers 404 to non-owners). */
export interface OwnerStreamer { email: string; code: string; createdAt?: string; stats: ReferralStats }
export interface OwnerStreamers { streamers: OwnerStreamer[]; invites: Array<{ code: string; expiresAt: string }> }
export interface OwnerStreamerStats { code: string; period: StatsPeriod; rows: ReferralSeriesRow[]; campaigns: CampaignStats[] }
export interface CreatedStreamerInvite { token: string; code: string; expiresAt: string }

/** Streamer payouts (server/src/routes/payouts.ts). Amounts in roubles. */
export type PayoutStatus = 'pending' | 'paid' | 'rejected'
export interface PayoutItem { id: string; amount: number; status: PayoutStatus; auto: boolean; createdAt: string; decidedAt?: string; comment?: string; destination: string }
export interface PayoutOverview {
  percent: number
  earned: number
  paidOut: number
  pending: number
  available: number
  minimum: number
  currency: 'RUB'
  details: { phone: string; bank: string; recipient: string } | null
  autoPayout: { enabled: boolean; intervalDays: number; limits: { min: number; max: number }; nextAt: string | null }
  payouts: PayoutItem[]
}
export interface PayoutSettingsInput { phone?: string; bank?: string; recipient?: string; auto?: boolean; intervalDays?: number }
export interface OwnerPayout extends PayoutItem { code: string; email: string; phone: string; bank: string; recipient: string }
export interface OwnerPayouts { payouts: OwnerPayout[]; limits: { min: number; max: number } }

export interface AuthResult { token: string; account: Account; referralApplied?: boolean }

export const api = {
  register: (email: string, password: string, referralCode?: string) =>
    request<AuthResult>('/register', { method: 'POST', body: { email, password, ...(referralCode ? { referralCode } : {}) } }),
  login: (email: string, password: string) => request<AuthResult>('/login', { method: 'POST', body: { email, password } }),
  logout: (token: string) => request<void>('/logout', { method: 'POST', token }),
  me: (token: string) => request<Account>('/me', { token }),
  applyReferral: (token: string, code: string) => request<Account>('/me/referral', { method: 'POST', token, body: { code } }),
  setNicknames: (token: string, nicknames: Partial<Record<AccountMode, string>>) => request<Account>('/me/nicknames', { method: 'PUT', token, body: nicknames }),
  referralVisit: (code: string, campaign?: string) => request<{ ok: true; code: string }>('/referral-visits', { method: 'POST', body: { code, ...(campaign ? { campaign } : {}) } }),
  referralCampaigns: (token: string) => request<{ campaigns: CampaignStats[] }>('/me/referral-campaigns', { token }),
  /** Records that the signed-in user accepted the documents of `version` (website/src/legal/documents.ts). */
  recordConsent: (token: string, kind: 'registration' | 'payment', version: string) => request<unknown>('/me/consents', { method: 'POST', token, body: { kind, version } }),
  ownerStreamers: (token: string) => request<OwnerStreamers>('/me/admin/streamers', { token }),
  ownerStreamerStats: (token: string, code: string, period: StatsPeriod) => request<OwnerStreamerStats>(`/me/admin/streamer-stats?code=${encodeURIComponent(code)}&period=${period}`, { token }),
  ownerCreateStreamerInvite: (token: string, code: string) => request<CreatedStreamerInvite>('/me/admin/streamer-invites', { method: 'POST', token, body: { code } }),
  ownerPayouts: (token: string) => request<OwnerPayouts>('/me/admin/payouts', { token }),
  ownerDecidePayout: (token: string, id: string, status: 'paid' | 'rejected', comment?: string) => request<PayoutItem>('/me/admin/payouts/decide', { method: 'POST', token, body: { id, status, ...(comment ? { comment } : {}) } }),
  ownerSetPayoutLimits: (token: string, min: number, max: number) => request<{ limits: { min: number; max: number } }>('/me/admin/payout-limits', { method: 'PUT', token, body: { min, max } }),
  payouts: (token: string) => request<PayoutOverview>('/me/payouts', { token }),
  savePayoutSettings: (token: string, settings: PayoutSettingsInput) => request<PayoutOverview>('/me/payout-settings', { method: 'PUT', token, body: settings }),
  requestPayout: (token: string, amount: number) => request<PayoutItem>('/me/payouts', { method: 'POST', token, body: { amount } }),
  summary: (token: string) => request<AccountSummary>('/summary', { token, root: '/v1/me' }),
  referralSeries: (token: string, period: StatsPeriod) => request<ReferralSeries>(`/me/referral-stats?period=${period}`, { token }),
  streamerInvite: (inviteToken: string) => request<StreamerInvite>('/streamer-invite', { method: 'POST', body: { token: inviteToken } }),
  redeemStreamerInvite: (token: string, inviteToken: string) => request<Account>('/me/streamer-invite', { method: 'POST', token, body: { token: inviteToken } }),
  plans: () => request<PlansResponse>('/plans', { root: '/v1/payments' }),
  /** `consentVersion`: the offer / personal data documents the payer accepted with the checkbox. */
  createPayment: (token: string, plan: PlanId, consentVersion: string, options?: PaymentOptions) => request<CreatedPayment>('', {
    method: 'POST', token, root: '/v1/payments',
    body: { plan, consent: { version: consentVersion }, ...(options ? { region: options.region, language: options.language, ...(options.autopayVersion ? { autopay: { version: options.autopayVersion } } : {}) } : {}) },
  }),
  /** «Отменить автопродление»: ЮKassa — the saved method is deleted; Lava.top — the subscription is cancelled. */
  cancelAutopay: (token: string) => request<{ autopay: Autopay | null }>('/autopay/cancel', { method: 'POST', token, root: '/v1/payments' }),
  payment: (token: string, id: string) => request<Payment>(`/${encodeURIComponent(id)}`, { token, root: '/v1/payments' }),
  payments: (token: string) => request<{ payments: Payment[]; autopay?: Autopay | null }>('', { token, root: '/v1/payments' }),
}

export function errorMessage(error: unknown) {
  return error instanceof ApiError ? error.message : 'Что-то пошло не так. Обновите страницу и попробуйте снова.'
}
