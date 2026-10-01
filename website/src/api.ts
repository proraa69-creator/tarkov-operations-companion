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
  /** When the e-mail was confirmed with a code; absent = not confirmed («Подтвердите e-mail»). */
  emailVerifiedAt?: string
}

/**
 * GET /v1/accounts/auth-config: whether e-mail codes work on this server. `emailEnabled` is missing on older servers
 * (= off). The site signs in by e-mail only; the server's SMS fields in this answer are not used.
 */
export interface AuthConfig {
  emailEnabled?: boolean; email?: { codeLength: number; codeTtlSeconds: number; resendSeconds: number }
}
/** A code was requested: what the next step sends back. The e-mail itself holds the code. */
export interface CodeChallenge { challengeId: string; expiresAt: string; resendSeconds: number }

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

/**
 * The message for an error answer without the server's own text: always with the HTTP status and a hint, so the owner
 * can tell an old server version (404) from a server that is not running (502/503/504).
 */
export function fallbackMessage(status: number) {
  if (status === 401) return 'Требуется вход в аккаунт'
  if (status === 429) return 'Слишком много попыток. Подождите немного и попробуйте снова.'
  if (status === 404 || status === 405) return `Сервер ответил ${status} — возможно, на сервере старая версия. Обновите и перезапустите приложение-сервер.`
  if (status === 502 || status === 503 || status === 504 || status === 530) return `Сервер ответил ${status} — сервер аккаунтов не запущен или перезапускается. Попробуйте через минуту.`
  if (status >= 500) return `На сервере произошла ошибка (HTTP ${status}). Попробуйте позже.`
  return `Не удалось выполнить запрос (HTTP ${status})`
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
/**
 * POST /register while the server sends e-mail codes: no account yet. The same answer for every address (the server
 * never says whether it is already registered); POST /register/confirm with the code creates the account.
 */
export interface PendingRegistration { pending: true; message: string; challengeId: string; expiresAt: string; resendSeconds: number }

/** «Админ-панель» (owner only; server/src/routes/ownerAdmin.ts, services/adminStore.ts). Money in roubles. */
export interface AdminRevenue { yookassa: number; lava: number; total: number; payments: number }
export interface AdminOverview {
  generatedAt: string
  users: { total: number; today: number; days7: number; days30: number; blocked: number }
  subscriptions: { active: number; trials: number; autopay: number; streamers: number }
  revenue: { today: AdminRevenue; month: AdminRevenue; all: AdminRevenue; lavaOriginal: Array<{ currency: string; amount: number }> }
  payouts: { paid: number; pending: number; pendingRequests: number; earned: number }
}
export interface AdminSeriesRow { period: string; registrations: number; payments: number; revenue: number; yookassa: number; lava: number; plans: Record<PlanId, { count: number; revenue: number }> }
export interface AdminPayment {
  id: string; email: string; plan: PlanId; provider: PaymentProvider; status: PaymentStatus; amount: number
  original?: { amount: number; currency: string }; createdAt: string; paidAt?: string; renewal?: true; referralCode?: string; streamerEarning?: number
}
export interface AdminPaymentFilter { from?: string; to?: string; status?: PaymentStatus; provider?: PaymentProvider; plan?: PlanId; q?: string }
export interface AdminPayments { payments: AdminPayment[]; total: number; totals: { succeeded: number; revenue: number; yookassa: number; lava: number; streamerEarnings: number } }
export type AdminUserFilter = 'all' | 'active' | 'trial' | 'inactive' | 'streamers' | 'blocked'
export interface AdminUser {
  id: string; email: string; kind: AccountKind; owner?: true; createdAt: string; referredBy?: string; referralCode?: string
  subscription: { status: SubscriptionStatus; paidUntil?: string; trialEndsAt?: string; lifetime?: true }
  autopay: { provider: string; status: string; plan: string } | null
  lastSeenAt?: string; blockedAt?: string; payments: { count: number; total: number }
}
export interface AdminUserDetail { user: AdminUser; payments: AdminPayment[]; grants: Array<{ days: number; reason: string; actor: string; at: string; paidUntil: string }>; revoked?: number }
export interface AdminStreamerSettings { defaultPercent: number; streamers: Array<{ code: string; email: string; percent: number; custom: boolean; linkEnabled: boolean; linkDisabledAt?: string }> }
export interface AdminSalesSettings {
  enabled: boolean
  providers: PaymentProviders
  plans: Plan[]
  yookassa: { monthPrice: number; receipts: boolean; autopay: boolean; publicUrl: string | null } | null
  lava: { currency: string; rubRate: number; paymentMethod: string | null; offerId: string } | null
  streamerPercent: number
  trialDays: number
}
export interface AdminAuditEntry { id: number; at: string; actor: string; action: string; target?: string; details?: Record<string, unknown> }

function adminQuery(params: Record<string, string | number | undefined>) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== '') query.set(key, String(value))
  const text = query.toString()
  return text ? `?${text}` : ''
}

/** «Скачать CSV»: the file needs the session header, so it is fetched here and saved through a blob link. */
export async function downloadAdminPaymentsCsv(token: string, filter: AdminPaymentFilter) {
  let response: Response
  try {
    response = await fetch(`${API_URL}/v1/accounts/me/admin/payments.csv${adminQuery({ ...filter })}`, { headers: { authorization: `Bearer ${token}` } })
  } catch {
    throw new ApiError(0, NETWORK_ERROR_MESSAGE, true)
  }
  if (!response.ok) {
    const data = await response.json().catch(() => undefined) as { error?: unknown } | undefined
    throw new ApiError(response.status, typeof data?.error === 'string' ? data.error : fallbackMessage(response.status))
  }
  const blob = await response.blob()
  const name = /filename="([^"]+)"/.exec(response.headers.get('content-disposition') ?? '')?.[1] ?? 'raidos-payments.csv'
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export const api = {
  /** 201 AuthResult (e-mail codes off) or 202 PendingRegistration (e-mail codes on). */
  register: (email: string, password: string, referralCode?: string) =>
    request<AuthResult | PendingRegistration>('/register', { method: 'POST', body: { email, password, ...(referralCode ? { referralCode } : {}) } }),
  registerConfirm: (challengeId: string, code: string) => request<AuthResult>('/register/confirm', { method: 'POST', body: { challengeId, code } }),
  registerResend: (challengeId: string) => request<CodeChallenge>('/register/resend', { method: 'POST', body: { challengeId } }),
  /** The same answer whether or not the address has an account; the code goes only to an existing one. */
  emailLoginStart: (email: string) => request<CodeChallenge>('/email/login/start', { method: 'POST', body: { email } }),
  emailLogin: (challengeId: string, code: string) => request<AuthResult>('/email/login', { method: 'POST', body: { challengeId, code } }),
  emailResetStart: (email: string) => request<CodeChallenge>('/email/reset/start', { method: 'POST', body: { email } }),
  emailReset: (challengeId: string, code: string, password: string) => request<AuthResult>('/email/reset', { method: 'POST', body: { challengeId, code, password } }),
  emailVerifyStart: (token: string) => request<CodeChallenge>('/me/email/start', { method: 'POST', token, body: {} }),
  emailVerifyConfirm: (token: string, challengeId: string, code: string) => request<Account>('/me/email/confirm', { method: 'POST', token, body: { challengeId, code } }),
  login: (email: string, password: string) => request<AuthResult>('/login', { method: 'POST', body: { email, password } }),
  logout: (token: string) => request<void>('/logout', { method: 'POST', token }),
  me: (token: string) => request<Account>('/me', { token }),
  /** «Сменить пароль»: every other session ends; the answer holds a new session for this browser. */
  changePassword: (token: string, currentPassword: string, newPassword: string) => request<AuthResult>('/me/password', { method: 'POST', token, body: { currentPassword, newPassword } }),
  authConfig: () => request<AuthConfig>('/auth-config'),
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
  adminOverview: (token: string) => request<AdminOverview>('/me/admin/overview', { token }),
  adminSeries: (token: string, period: StatsPeriod) => request<{ period: StatsPeriod; rows: AdminSeriesRow[] }>(`/me/admin/series?period=${period}`, { token }),
  adminPayments: (token: string, filter: AdminPaymentFilter, limit: number, offset: number) => request<AdminPayments>(`/me/admin/payments${adminQuery({ ...filter, limit, offset })}`, { token }),
  adminUsers: (token: string, q: string, filter: AdminUserFilter, limit: number, offset: number) => request<{ users: AdminUser[]; total: number }>(`/me/admin/users${adminQuery({ q, filter, limit, offset })}`, { token }),
  adminUser: (token: string, id: string) => request<AdminUserDetail>(`/me/admin/users/${encodeURIComponent(id)}`, { token }),
  adminGrant: (token: string, id: string, days: number, reason: string) => request<AdminUserDetail>(`/me/admin/users/${encodeURIComponent(id)}/grant`, { method: 'POST', token, body: { days, reason } }),
  adminCancelAutopay: (token: string, id: string) => request<AdminUserDetail>(`/me/admin/users/${encodeURIComponent(id)}/cancel-autopay`, { method: 'POST', token, body: {} }),
  adminBlock: (token: string, id: string, blocked: boolean, reason?: string) => request<AdminUserDetail>(`/me/admin/users/${encodeURIComponent(id)}/${blocked ? 'block' : 'unblock'}`, { method: 'POST', token, body: blocked && reason ? { reason } : {} }),
  adminRevokeSessions: (token: string, id: string) => request<AdminUserDetail>(`/me/admin/users/${encodeURIComponent(id)}/revoke-sessions`, { method: 'POST', token, body: {} }),
  adminStreamerSettings: (token: string) => request<AdminStreamerSettings>('/me/admin/streamer-settings', { token }),
  adminSetStreamerPercent: (token: string, code: string, percent: number | null) => request<AdminStreamerSettings>(`/me/admin/streamers/${encodeURIComponent(code)}/percent`, { method: 'PUT', token, body: { percent } }),
  adminSetStreamerLink: (token: string, code: string, enabled: boolean) => request<AdminStreamerSettings>(`/me/admin/streamers/${encodeURIComponent(code)}/link`, { method: 'PUT', token, body: { enabled } }),
  adminSalesSettings: (token: string) => request<AdminSalesSettings>('/me/admin/sales-settings', { token }),
  adminAudit: (token: string, limit: number, offset: number) => request<{ entries: AdminAuditEntry[]; total: number }>(`/me/admin/audit${adminQuery({ limit, offset })}`, { token }),
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

/** «Отряд» (server/src/routes/squads.ts): members are shown only by the nickname of the chosen mode. */
export interface SquadMember { memberId: string; nickname: string | null; isYou: boolean; isOwner: boolean; joinedAt: string; hidden?: boolean; activeQuestIds?: string[]; lastSyncAt?: string | null }
export interface Squad { id: string; name: string; maxMembers: number; isOwner: boolean; createdAt: string; members: SquadMember[] }
export interface SquadInvitation { invitationId: string; squadName: string; from: string | null; members: number; expiresAt: string }
export interface SquadMine { squad: Squad | null; access: boolean; invitations: SquadInvitation[] }
export interface SquadOverview { squad: Squad; mode: AccountMode; sharedQuests: Array<{ questId: string; memberIds: string[] }>; items: Array<{ itemId: string }> | null }
export const SQUAD_CODE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{5}-?[0-9A-HJKMNP-TV-Z]{5}$/i
export const FRIEND_CODE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{4}-?[0-9A-HJKMNP-TV-Z]{4}$/i

export const squadApi = {
  mine: (token: string, mode: AccountMode) => request<SquadMine>(`/mine/${mode}`, { token, root: '/v1/squads' }),
  overview: (token: string, id: string, mode: AccountMode) => request<SquadOverview>(`/${encodeURIComponent(id)}/overview/${mode}`, { token, root: '/v1/squads' }),
  create: (token: string, name: string) => request<{ squad: Squad }>('', { method: 'POST', token, root: '/v1/squads', body: name.trim() ? { name: name.trim() } : {} }),
  join: (token: string, code: string) => request<{ squad: Squad }>('/join', { method: 'POST', token, root: '/v1/squads', body: { code } }),
  invite: (token: string, id: string) => request<{ code: string; expiresAt: string }>(`/${encodeURIComponent(id)}/invites`, { method: 'POST', token, root: '/v1/squads', body: {} }),
  leave: (token: string, id: string) => request<void>(`/${encodeURIComponent(id)}/leave`, { method: 'POST', token, root: '/v1/squads', body: {} }),
  disband: (token: string, id: string) => request<void>(`/${encodeURIComponent(id)}/disband`, { method: 'POST', token, root: '/v1/squads', body: {} }),
  answerInvitation: (token: string, id: string, accept: boolean) => request<{ squad: Squad } | undefined>(`/invitations/${encodeURIComponent(id)}/${accept ? 'accept' : 'decline'}`, { method: 'POST', token, root: '/v1/squads', body: {} }),
  /** Friends (server/src/routes/friends.ts): a request by code; the answer never says whether the code exists. */
  friendRequest: (token: string, code: string) => request<{ status: 'sent' | 'friends' }>('/requests', { method: 'POST', token, root: '/v1/friends', body: { code } }),
}

export function errorMessage(error: unknown) {
  return error instanceof ApiError ? error.message : 'Что-то пошло не так. Обновите страницу и попробуйте снова.'
}
