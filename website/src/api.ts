import { API_URL } from './config'
import { siteLocale, tr } from './i18n'

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
  /** Came with a friend's code: the first month is discounted until the first payment. */
  invitedByFriend?: true
  /** The Escape from Tarkov nickname, one for all modes (owner, 10.10.2026). Missing on a server before it. */
  nickname?: string
  /** The same nickname under every mode (older servers: one per mode). */
  nicknames: Partial<Record<AccountMode, string>>
  /**
   * The country named at registration (ISO 3166-1 alpha-2, src/shared/countries.ts; owner, 13.10.2026). Missing for
   * accounts from before it until «Страна» in the cabinet is set, and on older servers.
   */
  country?: string
  /** «XX»: the country typed by hand in «Укажите страну» (src/shared/countries.ts MANUAL_COUNTRY_CODE). */
  countryOther?: string
  /** No country yet: the cabinet shows «Укажите страну» until it is set (components/CountryGateDialog.tsx). */
  needsCountry?: true
  /**
   * `lifetime`: streamers use the service free of charge, for good. `trialPendingDays`: the free period starts with the
   * first sign-in in the app (status stays 'inactive' until then; owner, 12.10.2026).
   */
  subscription: { status: SubscriptionStatus; paidUntil?: string; trialEndsAt?: string; lifetime?: true; trialPendingDays?: number }
  stats?: ReferralStats
  /** The service owner (server-side check of TARKOV_OWNER_EMAILS): sees the owner section. */
  owner?: true
  /** When the e-mail was confirmed with a code; absent = not confirmed («Подтвердите e-mail»). */
  emailVerifiedAt?: string
  /** The Escape from Tarkov account the desktop app found in the game logs, masked («••••289»). */
  eftAccount?: { masked: string; boundAt: string }
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

const SERVER_OUTDATED = 'Сервер ответил {status} — возможно, на сервере старая версия. Обновите и перезапустите приложение-сервер.'
const SERVER_DOWN = 'Сервер ответил {status} — сервер аккаунтов не запущен или перезапускается. Попробуйте через минуту.'
const SERVER_FAILED = 'На сервере произошла ошибка (HTTP {status}). Попробуйте позже.'
const REQUEST_FAILED = 'Не удалось выполнить запрос (HTTP {status})'

/**
 * The message for an error answer without the server's own text: always with the HTTP status and a hint, so the owner
 * can tell an old server version (404) from a server that is not running (502/503/504).
 */
export function fallbackMessage(status: number) {
  if (status === 401) return 'Требуется вход в аккаунт'
  if (status === 429) return 'Слишком много попыток. Подождите немного и попробуйте снова.'
  const fill = (template: string) => template.replace('{status}', String(status))
  if (status === 404 || status === 405) return fill(SERVER_OUTDATED)
  if (status === 502 || status === 503 || status === 504 || status === 530) return fill(SERVER_DOWN)
  if (status >= 500) return fill(SERVER_FAILED)
  return fill(REQUEST_FAILED)
}

/**
 * Error texts with a value in them (the fallbacks above and the server's own, server/src/services/*.ts). Errors keep the
 * Russian text (EmailAuth's retryAfter reads «через N с» from it); the English is looked up by these templates when
 * the error is shown (src/i18n/phrasesAuth.ts).
 */
const ERROR_TEMPLATES = [SERVER_OUTDATED, SERVER_DOWN, SERVER_FAILED, REQUEST_FAILED, 'Новый код можно запросить через {seconds} с.', 'Код {code} уже занят']
  .map((template) => {
    const names: string[] = []
    const source = template.split(/\{(\w+)\}/).map((part, index) => {
      if (index % 2) { names.push(part); return '(.+?)' }
      return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    }).join('')
    return { template, pattern: new RegExp(`^${source}$`), names }
  })

/** A Russian error text (the server's or this file's) in the site's language. */
function translateError(message: string) {
  if (siteLocale() === 'ru') return message
  for (const { template, pattern, names } of ERROR_TEMPLATES) {
    const match = pattern.exec(message)
    if (match) return tr(template, Object.fromEntries(names.map((name, index) => [name, match[index + 1]])))
  }
  return tr(message)
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
/** `price` is null only from servers before 13.10.2026 that had no rouble price. */
export interface Plan { id: PlanId; months: number; price: number | null; currency: 'RUB'; discountPercent: number }
export type YooKassaPaymentMethod = 'sbp' | 'sberbank' | 'tinkoff_bank'
export interface PaymentProviders { yookassa: boolean; autopay: boolean; methods?: YooKassaPaymentMethod[] }
export interface PlansResponse {
  enabled: boolean
  plans: Plan[]
  /** Missing on an older server: then only ЮKassa, without autopayments. */
  providers?: PaymentProviders
  /** The visitor's region by Cloudflare's country: which tab «Подписка» opens on, never what an account may pay with. */
  regionHint?: 'RU' | 'CIS' | 'WORLD'
}
export type PaymentStatus = 'pending' | 'succeeded' | 'canceled' | 'refunded'
/**
 * 'boosty': CIS / WORLD (docs/payments/payment-regions-and-announcements.md); 'archive': a payment service that is no
 * longer connected (owner, 13.10.2026); its payments stay as history.
 */
export type PaymentProvider = 'yookassa' | 'boosty' | 'archive'
/** The payment region the server derives from the account's saved country (src/shared/paymentRegions.ts). */
export type PaymentRegion = 'RU' | 'CIS' | 'WORLD'
export type BoostyOffer = 'standard' | 'friend'
/** GET /v1/payments/boosty/public: every Boosty subscription for the public page raidos.app/boosty (no account). */
export interface BoostyPublicResponse {
  offers: Array<{ key: string; region: 'CIS' | 'WORLD'; kind: BoostyOffer; url: string }>
  regionHint?: PaymentRegion
}
/**
 * GET /v1/payments. `region` / `provider` / `boosty` are missing on an older server (then only ЮKassa); `region` null:
 * the account has no country yet — no payment until it is named. `boosty.offers`: never links, the server hands out the
 * link of the account's region only after the e-mail warning was acknowledged (api.boostyLink).
 */
export interface PaymentsOverview {
  payments: Payment[]
  autopay?: Autopay | null
  friendDiscount?: FriendDiscount | null
  region?: PaymentRegion | null
  provider?: 'yookassa' | 'boosty' | null
  boosty?: { offers: BoostyOffer[] } | null
}
/** `discountPercent`: the invitation discount (−20 % on the first month by a friend or streamer code). */
export interface Payment { id: string; plan: PlanId; amount: number; currency: string; status: PaymentStatus; createdAt: string; paidAt?: string; provider?: PaymentProvider; renewal?: true; discountPercent?: number }
/** GET /v1/payments → friendDiscount: the first payment by any invitation code is cheaper (plan 1m only). */
export interface FriendDiscount { percent: number; plan: '1m' }
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
export interface PaymentOptions { method?: YooKassaPaymentMethod; /** The separate autopayment consent (LEGAL_VERSION) — only when ticked. */ autopayVersion?: string }
export interface CreatedPayment { paymentId: string; confirmationUrl: string }

async function request<T>(path: string, options: { method?: string; body?: unknown; token?: string | null; root?: string; timeoutMs?: number } = {}): Promise<T> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), options.timeoutMs ?? 12_000)
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
export interface AdminRevenue { total: number; payments: number }
export interface AdminOverview {
  generatedAt: string
  users: { total: number; today: number; days7: number; days30: number; blocked: number }
  subscriptions: { active: number; trials: number; autopay: number; streamers: number }
  revenue: { today: AdminRevenue; month: AdminRevenue; all: AdminRevenue }
  payouts: { paid: number; pending: number; pendingRequests: number; earned: number }
}
export interface AdminSeriesRow { period: string; registrations: number; payments: number; revenue: number; plans: Record<PlanId, { count: number; revenue: number }> }
export interface AdminCalendarDay { date: string; registrations: number; payments: number; revenue: number; plans: Record<PlanId, { count: number; revenue: number }> }
export interface AdminCalendar { month: string; today: string; days: AdminCalendarDay[] }
/**
 * «Пригласи друга»: who invited a friend-invited account (servers before 14.10.2026 omit it). `deleted`: that account was
 * deleted since (no e-mail). `discount` (users list only): the friend's first-month discount — used, not used yet, or
 * lost (the first payment was made without it).
 */
export interface AdminInviter { id: string; email?: string; nickname?: string; deleted?: true; discount?: 'used' | 'unused' | 'lost' }
export interface AdminDayRegistration { id: string; email: string; kind: 'user' | 'streamer'; createdAt: string; referredBy?: string; invitedByFriend?: true; invitedBy?: AdminInviter }
export interface AdminDayGrant { email: string; days: number; reason: string; actor: string; at: string }
/** A «Пригласи друга» reward of the day: both accounts with their game nicknames (servers before 17.10.2026: the inviter only). */
export interface AdminDayInvite {
  inviter: string; inviterNickname?: string; friend?: string; friendNickname?: string; friendDeleted?: true
  kind: string; days: number | 'lifetime'; status: string; createdAt: string; decidedAt?: string; comment?: string
}
export interface AdminDay {
  date: string
  totals: { registrations: number; payments: number; revenue: number; streamerEarnings: number; plans: Record<PlanId, { count: number; revenue: number }> }
  registrations: AdminDayRegistration[]
  payments: AdminPayment[]
  grants: AdminDayGrant[]
  invites: AdminDayInvite[]
}
export interface AdminPayment {
  id: string; email: string; plan: PlanId; provider: PaymentProvider; status: PaymentStatus; amount: number
  original?: { amount: number; currency: string }; createdAt: string; paidAt?: string; renewal?: true; referralCode?: string; streamerEarning?: number
  /** Paid with the friend's discount: its percent and the inviter's e-mail (`inviterDeleted`: that account was deleted). */
  friendDiscount?: { percent: number; inviter?: string; inviterDeleted?: true }
  /** The payer's account and game nickname (servers before 17.10.2026 omit them). */
  accountId?: string; nickname?: string
  /** Who invited the payer with a friend link, with or without the discount on this payment. */
  invitedBy?: AdminInviter
  /** The owner changed the amount («Изменить сумму»): the amount before the first change and when. */
  amountEdited?: { before: number; at: string }
}
export interface AdminPaymentFilter { from?: string; to?: string; status?: PaymentStatus; plan?: PlanId; q?: string }
/** The owner's Boosty panel (server/src/routes/ownerAdmin.ts, services/boosty.ts, services/boostySync.ts). */
export type BoostyOfferKey = 'WORLD_STANDARD' | 'WORLD_FRIEND' | 'CIS_STANDARD' | 'CIS_FRIEND'
export interface AdminBoostySync {
  configured: boolean; paused: boolean; running: boolean; blog?: string; periodMinutes?: number
  lastSyncAt?: string; lastSuccessAt?: string; lastError?: string; tokenDead: boolean; nextRunAt?: string
  lastResult?: { subscribers: number; active: number; granted: number; adopted: number; review: number; unchanged: number }
}
export interface AdminBoostyReviewItem {
  id: number; reason: string; reasonText: string; email: string; accountId?: string; boostyUserId?: string; levelId?: string; levelName?: string
  offerKey?: BoostyOfferKey; price?: number; periodEnd?: string; status: 'open' | 'resolved' | 'dismissed'; createdAt: string; updatedAt: string
}
export interface AdminBoostyLevel { levelId: string; name: string; price: number; offerKey?: BoostyOfferKey; lastSeenAt: string; subscribers: number }
export interface AdminBoostyPanel {
  sync: AdminBoostySync
  review: { items: AdminBoostyReviewItem[]; total: number }
  levels: AdminBoostyLevel[]
  offers: Array<{ key: BoostyOfferKey; region: 'CIS' | 'WORLD'; kind: BoostyOffer; levelId: string }>
}
export interface AdminBoostyPayment {
  id: string; accountId: string; email?: string; region: PaymentRegion; offer: BoostyOffer; offerKey?: BoostyOfferKey; plan: PlanId; amount: number
  status: 'succeeded' | 'refunded'; source: 'auto' | 'manual'; confirmedAt: string; confirmedBy: string; periodEnd?: string; paidUntilAfter?: string; boostyUserId?: string; reference?: string
}
export interface AdminBoostyConfirm {
  email: string; offer: BoostyOffer; region?: 'CIS' | 'WORLD'; months?: 1 | 3 | 6 | 12; paidUntil?: string; amount?: number; reference?: string; reviewId?: number
}
export interface AdminPayments { payments: AdminPayment[]; total: number; totals: { succeeded: number; revenue: number; streamerEarnings: number } }
export type AdminUserFilter = 'all' | 'active' | 'trial' | 'inactive' | 'streamers' | 'blocked'
/** Billing regions of «Пользователи»: Russia, CIS without Russia, and the rest of the world. */
export type AdminUserRegion = 'all' | 'russia' | 'cis' | 'world' | 'none'
export interface AdminUser {
  id: string; email: string; kind: AccountKind; owner?: true; createdAt: string; referredBy?: string; referralCode?: string
  subscription: { status: SubscriptionStatus; paidUntil?: string; trialEndsAt?: string; lifetime?: true; trialPendingDays?: number }
  autopay: { provider: string; status: string; plan: string } | null
  /** lastSeenAt: the last request from anywhere; pcSeenAt: the last use of the PC app. */
  lastSeenAt?: string; pcSeenAt?: string; blockedAt?: string; payments: { count: number; total: number }
  /** The bound Escape from Tarkov account, masked (one game account — one Raid OS account; servers before 13.10.2026 omit it). */
  eftAccount?: { masked: string; boundAt: string }
  /** The country named at registration (ISO 3166-1 alpha-2); absent when the user has not named one. */
  country?: string
  /** «XX»: the country typed by hand in «Укажите страну» (counted in «Другие»). */
  countryOther?: string
  /** The Escape from Tarkov nickname the PC app found in the game logs; absent until it is found. */
  nickname?: string
  /** «Пригласи друга»: the player whose code this account used (a streamer's code stays in `referredBy`). */
  invitedBy?: AdminInviter
}
/** «Онлайн сейчас»: accounts in the PC or phone app within the last `windowMinutes` (server/src/services/presence.ts). */
export interface AdminOnline { online: number; pc: number; phone: number; windowMinutes: number; at: string }
/** `regions`: users per region tab within the search and the status filter (servers before the country omit it). */
export interface AdminUserList { users: AdminUser[]; total: number; regions?: Record<AdminUserRegion, number> }
/** Devices of an account (three active at most, docs/subscription-protection.md). */
export interface AdminDevice { id: string; name: string; createdAt: string; lastSeenAt: string; active: boolean; revokedAt?: string; revokedReason?: 'limit' | 'owner' | 'user' }
export interface AdminDevices { devices: AdminDevice[]; limit: number }
export interface AdminUserDetail { user: AdminUser; payments: AdminPayment[]; grants: Array<{ days: number; reason: string; actor: string; at: string; paidUntil: string }>; revoked?: number }
export interface AdminStreamerSettings { defaultPercent: number; streamers: Array<{ code: string; email: string; percent: number; custom: boolean; linkEnabled: boolean; linkDisabledAt?: string }> }
export interface AdminSalesSettings {
  enabled: boolean
  providers: PaymentProviders
  plans: Plan[]
  yookassa: { monthPrice: number; receipts: boolean; autopay: boolean; publicUrl: string | null } | null
  streamerPercent: number
  trialDays: number
  /** Free days every new account gets (servers before 12.10.2026 do not send it). */
  welcomeTrialDays?: number
}
export interface YookassaSettingsInput { shopId: string; monthPrice: number; receipts: boolean; streamerPercent: number; autopay: boolean }
export interface YookassaSettingsView { configured: boolean; settings: YookassaSettingsInput & { hasKey: boolean } }
/** «Пригласи друга» (server/src/services/invites.ts, routes/invites.ts). Only for accounts of kind 'user'. */
export type InviteRankId = 'scout' | 'operator' | 'squad-leader' | 'raid-commander' | 'legend'
export type InviteRewardStatus = 'pending' | 'review' | 'granted' | 'canceled'
export interface InviteRank { id: InviteRankId; title: string; friends: number; bonusDays: number | 'lifetime' }
export interface InviteReward {
  id: number
  kind: 'friend' | InviteRankId
  days: number | 'lifetime'
  status: InviteRewardStatus
  createdAt: string
  /** When a pending reward is granted at the earliest (after the 14-day check). */
  releaseAt?: string
  decidedAt?: string
  /** The friend's e-mail, masked (a***@mail.ru) in the cabinet, full in the admin panel. */
  friend?: string
  /** On hold until the friend's desktop app binds his Escape from Tarkov account. */
  waitingEft?: true
}
export interface InviteProgram {
  code: string
  discountPercent: number
  rewardDays: number
  holdDays: number
  /** Registered by the code. */
  invited: number
  /** Friends who paid (rewards pending, in review or granted). */
  paid: number
  /** Rewards granted after the check. */
  confirmed: number
  rank: { id: InviteRankId; title: string } | null
  next: InviteRank | null
  ranks: InviteRank[]
  rewards: InviteReward[]
}
export type InviteFlag = 'same-device' | 'same-address' | 'address-cluster' | 'same-card' | 'card-reused' | 'burst' | 'same-email' | 'eft-counted' | 'payment-or-account' | 'milestone'
export interface AdminInviteReward extends InviteReward {
  /** Both accounts with their game nicknames; `friendDeleted`: the friend's account was deleted (no e-mail). */
  inviterId?: string
  inviter: string
  inviterNickname?: string
  inviterDeleted?: true
  inviterCode?: string
  friendId?: string
  friendNickname?: string
  friendDeleted?: true
  /** The friend's payment; provider, plan, discount and paid time from servers of 17.10.2026 on. */
  payment?: { amount: number; status: string; provider?: PaymentProvider; plan?: string; discountPercent?: number; paidAt?: string }
  flags: string[]
  decidedBy?: string
  comment?: string
}
export interface AdminInviteRewards { rewards: AdminInviteReward[]; total: number; counts: Partial<Record<InviteRewardStatus, number>> }

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
  register: (email: string, password: string, referralCode?: string, country?: string) =>
    request<AuthResult | PendingRegistration>('/register', { method: 'POST', body: { email, password, ...(referralCode ? { referralCode } : {}), ...(country ? { country } : {}) } }),
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
  deleteAccount: (token: string, password: string) => request<{ deleted: true }>('/me/delete', { method: 'POST', token, body: { password } }),
  /** «Выйти на всех устройствах»: every session of the account ends, this browser's too (POST /me/sessions/revoke-all). */
  revokeAllSessions: (token: string) => request<{ revoked: number }>('/me/sessions/revoke-all', { method: 'POST', token, body: {} }),
  authConfig: () => request<AuthConfig>('/auth-config'),
  applyReferral: (token: string, code: string) => request<Account>('/me/referral', { method: 'POST', token, body: { code } }),
  /** «Страна» in the cabinet: sets or changes the country (ISO 3166-1 alpha-2). */
  setCountry: (token: string, country: string) => request<Account>('/me/country', { method: 'PUT', token, body: { country } }),
  /** «Укажите страну»: the first country of an account without one — a listed code or one typed by hand (409 once set). */
  setInitialCountry: (token: string, choice: { country: string } | { other: string }) => request<Account>('/me/initial-country', { method: 'POST', token, body: choice }),
  /** One nickname for all modes; '' removes it. */
  /** `kind`: whose code it is — a streamer's (3 days free) or a player's (friend: −20 % on the first month). Missing on older servers. */
  referralVisit: (code: string, campaign?: string) => request<{ ok: true; code: string; kind?: 'streamer' | 'friend' }>('/referral-visits', { method: 'POST', body: { code, ...(campaign ? { campaign } : {}) } }),
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
  adminOnline: (token: string) => request<AdminOnline>('/me/admin/online', { token }),
  adminCalendar: (token: string, month: string) => request<AdminCalendar>(`/me/admin/calendar?month=${month}`, { token }),
  adminDay: (token: string, date: string) => request<AdminDay>(`/me/admin/day?date=${date}`, { token }),
  adminSeries: (token: string, period: StatsPeriod) => request<{ period: StatsPeriod; rows: AdminSeriesRow[] }>(`/me/admin/series?period=${period}`, { token }),
  adminBoosty: (token: string) => request<AdminBoostyPanel>('/me/admin/boosty', { token }),
  adminBoostyPayments: (token: string, limit: number, offset: number) => request<{ payments: AdminBoostyPayment[]; total: number }>(`/me/admin/boosty/payments?limit=${limit}&offset=${offset}`, { token }),
  adminBoostyConfirm: (token: string, input: AdminBoostyConfirm) => request<{ payment: AdminBoostyPayment }>('/me/admin/boosty/payments', { method: 'POST', token, body: input }),
  adminBoostyDismiss: (token: string, id: number) => request<{ ok: true }>(`/me/admin/boosty/review/${id}/dismiss`, { method: 'POST', token, body: {} }),
  adminBoostyMapLevel: (token: string, levelId: string, offer: BoostyOfferKey | null) => request<{ levels: AdminBoostyLevel[] }>(`/me/admin/boosty/levels/${encodeURIComponent(levelId)}`, { method: 'PUT', token, body: { offer } }),
  adminBoostyPause: (token: string, paused: boolean) => request<{ sync: AdminBoostySync }>('/me/admin/boosty/pause', { method: 'PUT', token, body: { paused } }),
  adminBoostySession: (token: string, session: string) => request<{ sync: AdminBoostySync }>('/me/admin/boosty/session', { method: 'PUT', token, body: { session } }),
  adminBoostySync: (token: string) => request<{ sync: AdminBoostySync }>('/me/admin/boosty/sync', { method: 'POST', token, body: {} }),
  adminMarkRefunded: (token: string, id: string) => request<{ ok: true }>(`/me/admin/payments/${id}/refunded`, { method: 'POST', token, body: {} }),
  adminSetPaymentAmount: (token: string, id: string, amount: number, comment?: string) => request<AdminPayment>(`/me/admin/payments/${id}/amount`, { method: 'POST', token, body: { amount, ...(comment ? { comment } : {}) } }),
  adminPayments: (token: string, filter: AdminPaymentFilter, limit: number, offset: number) => request<AdminPayments>(`/me/admin/payments${adminQuery({ ...filter, limit, offset })}`, { token }),
  adminUsers: (token: string, q: string, filter: AdminUserFilter, limit: number, offset: number, region: AdminUserRegion = 'all') => request<AdminUserList>(`/me/admin/users${adminQuery({ q, filter, region: region === 'all' ? undefined : region, limit, offset })}`, { token }),
  adminUser: (token: string, id: string) => request<AdminUserDetail>(`/me/admin/users/${encodeURIComponent(id)}`, { token }),
  adminGrant: (token: string, id: string, days: number, reason: string) => request<AdminUserDetail>(`/me/admin/users/${encodeURIComponent(id)}/grant`, { method: 'POST', token, body: { days, reason } }),
  /** Takes paid days off the end of the subscription (never back past today); logged with the grants as −N. */
  adminRevoke: (token: string, id: string, days: number, reason: string) => request<AdminUserDetail>(`/me/admin/users/${encodeURIComponent(id)}/revoke`, { method: 'POST', token, body: { days, reason } }),
  adminCancelAutopay: (token: string, id: string) => request<AdminUserDetail>(`/me/admin/users/${encodeURIComponent(id)}/cancel-autopay`, { method: 'POST', token, body: {} }),
  adminBlock: (token: string, id: string, blocked: boolean, reason?: string) => request<AdminUserDetail>(`/me/admin/users/${encodeURIComponent(id)}/${blocked ? 'block' : 'unblock'}`, { method: 'POST', token, body: blocked && reason ? { reason } : {} }),
  adminRevokeSessions: (token: string, id: string) => request<AdminUserDetail>(`/me/admin/users/${encodeURIComponent(id)}/revoke-sessions`, { method: 'POST', token, body: {} }),
  adminUnbindEft: (token: string, id: string) => request<AdminUserDetail>(`/me/admin/users/${encodeURIComponent(id)}/eft-account/unbind`, { method: 'POST', token, body: {} }),
  adminDeleteUser: (token: string, id: string) => request<{ deleted: true }>(`/me/admin/users/${encodeURIComponent(id)}/delete`, { method: 'POST', token, body: {} }),
  adminDevices: (token: string, id: string) => request<AdminDevices>(`/me/admin/users/${encodeURIComponent(id)}/devices`, { token }),
  adminRevokeDevice: (token: string, id: string, deviceId: string) => request<AdminDevices>(`/me/admin/users/${encodeURIComponent(id)}/devices/${encodeURIComponent(deviceId)}/revoke`, { method: 'POST', token, body: {} }),
  adminStreamerSettings: (token: string) => request<AdminStreamerSettings>('/me/admin/streamer-settings', { token }),
  adminSetStreamerPercent: (token: string, code: string, percent: number | null) => request<AdminStreamerSettings>(`/me/admin/streamers/${encodeURIComponent(code)}/percent`, { method: 'PUT', token, body: { percent } }),
  adminSetStreamerLink: (token: string, code: string, enabled: boolean) => request<AdminStreamerSettings>(`/me/admin/streamers/${encodeURIComponent(code)}/link`, { method: 'PUT', token, body: { enabled } }),
  adminRevokeStreamer: (token: string, code: string) => request<AdminStreamerSettings>(`/me/admin/streamers/${encodeURIComponent(code)}/revoke`, { method: 'POST', token }),
  adminSalesSettings: (token: string) => request<AdminSalesSettings>('/me/admin/sales-settings', { token }),
  adminYookassaSettings: (token: string) => request<YookassaSettingsView>('/me/admin/payment-settings/yookassa', { token }),
  adminSaveYookassaSettings: (token: string, body: YookassaSettingsInput) => request<YookassaSettingsView>('/me/admin/payment-settings/yookassa', { method: 'PUT', token, body }),
  adminInviteRewards: (token: string, status: InviteRewardStatus | undefined, limit: number, offset: number) => request<AdminInviteRewards>(`/me/admin/invite-rewards${adminQuery({ status, limit, offset })}`, { token }),
  adminDecideInviteReward: (token: string, id: number, decision: 'approve' | 'cancel', comment?: string) => request<AdminInviteReward>(`/me/admin/invite-rewards/${id}/decide`, { method: 'POST', token, body: { decision, ...(comment ? { comment } : {}) } }),
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
    body: { plan, consent: { version: consentVersion }, ...(options?.method ? { method: options.method } : {}), ...(options?.autopayVersion ? { autopay: { version: options.autopayVersion } } : {}) },
  }),
  /** «Отменить автопродление»: ЮKassa — the saved method is deleted; an archived one answers 409 (support closes it). */
  cancelAutopay: (token: string) => request<{ autopay: Autopay | null }>('/autopay/cancel', { method: 'POST', token, root: '/v1/payments' }),
  payment: (token: string, id: string) => request<Payment>(`/${encodeURIComponent(id)}`, { token, root: '/v1/payments' }),
  payments: (token: string) => request<PaymentsOverview>('', { token, root: '/v1/payments' }),
  /** The Boosty link of the account's region (the server picks it); `acknowledged`: the e-mail warning was ticked. */
  boostyPublic: () => request<BoostyPublicResponse>('/boosty/public', { root: '/v1/payments' }),
  boostyLink: (token: string, offer: BoostyOffer) => request<{ url: string; region: PaymentRegion; offer: BoostyOffer }>('/boosty', { method: 'POST', token, root: '/v1/payments', body: { offer, acknowledged: true } }),
  /** «Пригласи друга»: players only (streamers get 403 — do not call it for them). */
  invites: (token: string) => request<InviteProgram>('/me/invites', { token }),
  setInviteCode: (token: string, code: string) => request<InviteProgram>('/me/invites/code', { method: 'PUT', token, body: { code } }),
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

/** The text to show for a failed request, in the site's language (src/i18n): the server answers in Russian. */
export function errorMessage(error: unknown) {
  return error instanceof ApiError ? translateError(error.message) : tr('Что-то пошло не так. Обновите страницу и попробуйте снова.')
}
