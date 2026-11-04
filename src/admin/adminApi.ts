import { isServerUnavailable, webServiceRequest } from '../sync/webAccount'
import type { SupportAttachment, SupportReportReply } from '../shared/supportChat'
import type { SupportImageUpload } from '../support/supportChatClient'
import { ownerDayAgo } from '../shared/ownerTime'
import { keepAnswer, keptAnswer } from './adminKeep'

export type PlanId = '1m' | '3m' | '6m' | '12m'
export type PaymentStatus = 'pending' | 'succeeded' | 'canceled' | 'refunded'
/** NULL on the server is ЮKassa; 'archive' is a payment service that is no longer connected (Lava.top, Boosty; 'lava': older servers). */
export type PaymentProvider = 'yookassa' | 'bezebee' | 'archive' | 'lava'
export type AdminUserFilter = 'all' | 'active' | 'trial' | 'inactive' | 'streamers' | 'blocked'
export type AdminUserRegion = 'all' | 'russia' | 'cis' | 'world' | 'none'
export type AdminRegionCounts = Record<AdminUserRegion, number>

export interface AdminRevenue { yookassa: number; lava: number; total: number; payments: number }
export interface AdminOverview {
  generatedAt: string
  users: { total: number; today: number; days7: number; days30: number; blocked: number }
  subscriptions: { active: number; trials: number; autopay: number; streamers: number }
  revenue: { today: AdminRevenue; month: AdminRevenue; all: AdminRevenue; lavaOriginal: Array<{ currency: string; amount: number }> }
  payouts: { paid: number; pending: number; pendingRequests: number; earned: number }
  /** Paid payments of each plan this month and all the time (servers of 20.10.2026 on). */
  plans?: { month: Record<PlanId, { count: number; revenue: number }>; all: Record<PlanId, { count: number; revenue: number }> }
  /** «Отряды»: created since `since`, disbanded, active now, players in them (servers of 20.10.2026 on). */
  squads?: { created: number; disbanded: number; active: number; players: number; created30: number; since: string | null }
}

export interface AdminOnlineDay { date: string; users: number; minimum: number; maximum: number; average: number; samples: number }
export interface AdminOnlineStats { generatedAt: string; windowMinutes: number; current: number; today: AdminOnlineDay | null; history: AdminOnlineDay[] }

/** «Регистрации и оплаты» of «Сводка» (server/src/services/adminStore.ts): the owner's days (Bangkok), months, years. */
export type StatsPeriod = 'day' | 'month' | 'year'
export type PlanCounts = Record<PlanId, { count: number; revenue: number }>
export interface AdminSeriesRow { period: string; registrations: number; payments: number; revenue: number; plans: PlanCounts }
export interface AdminCalendarDay { date: string; registrations: number; payments: number; revenue: number; plans: PlanCounts }
export interface AdminCalendar { month: string; today: string; days: AdminCalendarDay[] }
export interface AdminInviter { id: string; email?: string; nickname?: string; deleted?: true }
/** The window of a calendar day: who registered, the payments, the owner's grants, «Пригласи друга» rewards. */
export interface AdminDay {
  date: string
  totals: { registrations: number; payments: number; revenue: number; streamerEarnings: number; plans: PlanCounts }
  registrations: Array<{ id: string; email: string; kind: 'user' | 'streamer'; createdAt: string; referredBy?: string; invitedByFriend?: true; invitedBy?: AdminInviter }>
  payments: AdminPayment[]
  grants: Array<{ email: string; days: number; reason: string; actor: string; at: string }>
  invites: Array<{ inviter: string; inviterNickname?: string; friend?: string; friendNickname?: string; friendDeleted?: true; kind: string; days: number | 'lifetime'; status: string; createdAt: string; decidedAt?: string; comment?: string }>
}
/** GET /me/admin/stats, the part «Новые за …» reads: accounts created on the owner's days `from`..`to`. */
export interface AdminRangeStats { range: { from: string; to: string; timezone: string }; users: { total: number; new: number } }

/** «Стримеры» (server/src/routes/accounts.ts, ownerAdmin.ts, payouts.ts), as on the site. Money in roubles. */
export interface StreamerStats { visits: number; registrations: number; activeSubscriptions: number; revenue?: { amount: number; currency: string }; earnings: { amount: number; currency: string } }
export interface OwnerStreamers { streamers: Array<{ email: string; code: string; createdAt?: string; stats: StreamerStats }>; invites: Array<{ code: string; expiresAt: string }> }
export interface StreamerSeriesRow { period: string; visits: number; registrations: number; payments: number; months: Record<PlanId, number>; revenue?: number; earnings: number }
export interface OwnerStreamerStats { code: string; period: StatsPeriod; rows: StreamerSeriesRow[]; campaigns: Array<{ campaign: string; visits: number; visits30d: number; lastVisitDay: string }> }
export interface AdminStreamerSettings { defaultPercent: number; streamers: Array<{ code: string; email: string; percent: number; custom: boolean; linkEnabled: boolean; linkDisabledAt?: string }> }
export interface CreatedStreamerInvite { token: string; code: string; expiresAt: string }
export type PayoutStatus = 'pending' | 'paid' | 'rejected'
export interface OwnerPayout {
  id: string; amount: number; status: PayoutStatus; auto: boolean; createdAt: string; decidedAt?: string; comment?: string; destination: string
  code: string; email: string; phone: string; bank: string; recipient: string
}
export interface OwnerPayouts { payouts: OwnerPayout[]; limits: { min: number; max: number } }

/**
 * «Пригласи друга» (server/src/services/invites.ts adminReferrals, the session «Привлечение друзей»): every account that
 * brought friends, with the totals. An older server answers 404: the app does not show the button then.
 */
export type ReferralSort = 'invited' | 'paid' | 'days' | 'recent'
export type InviteRewardStatus = 'pending' | 'review' | 'granted' | 'canceled'
export interface AdminReferrer {
  id: string; email?: string; nickname?: string; code?: string; streamer?: true; deleted?: true; blocked?: true
  /** Registered with the code (deleted accounts too): `paid` + `unpaid` = `invited`. */
  invited: number; paid: number; unpaid: number; friendsDeleted: number; lastInvitedAt?: string; confirmed: number
  rank?: { id: string; title: string }
  /** Days granted, on hold (granted when the hold is over), waiting for the owner's decision. */
  days: { granted: number; pending: number; review: number }
  lifetime?: true; rewards: Partial<Record<InviteRewardStatus, number>>; waitingEft: number; nextReleaseAt?: string
}
export interface AdminReferralSummary {
  withCode: number; referrers: number; invited: number; paid: number; unpaid: number; friendsDeleted: number
  top?: { id: string; invited: number; email?: string; nickname?: string }
  days: { granted: number; pending: number; review: number }; rewards: Partial<Record<InviteRewardStatus, number>>
  waitingEft: number; lifetime: number; rewardDays: number; holdDays: number; discountPercent: number
  ranks: Array<{ id: string; title: string; friends: number; bonusDays: number | 'lifetime' }>
}
export interface AdminReferrals { summary: AdminReferralSummary; referrers: AdminReferrer[]; total: number }
export interface AdminReferralReward {
  id: number; kind: string; days: number | 'lifetime'; status: InviteRewardStatus; createdAt: string; releaseAt?: string; decidedAt?: string
  waitingEft?: true; flags?: string[]; comment?: string; friend?: string
}
export interface AdminReferralFriend {
  id: string; email?: string; nickname?: string; deleted?: true; blocked?: true; invitedAt: string
  paid: boolean; payments: number; amount: number; refunded?: true; eftBound: boolean
  first?: { amount: number; plan: string; provider: string; status: string; discountPercent?: number; paidAt?: string }
  reward?: AdminReferralReward
}
export interface AdminReferrerDetail { referrer: AdminReferrer; friends: AdminReferralFriend[]; rewards: AdminReferralReward[] }

export interface AdminPayment {
  id: string
  email: string
  plan: PlanId
  provider: PaymentProvider
  status: PaymentStatus
  amount: number
  original?: { amount: number; currency: string }
  createdAt: string
  paidAt?: string
  renewal?: true
  referralCode?: string
  streamerEarning?: number
  /** The payer's game nickname (servers of 17.10.2026 on). */
  nickname?: string
  /** Paid with the friend's discount: its percent and the inviter's e-mail. */
  friendDiscount?: { percent: number; inviter?: string; inviterDeleted?: true }
  /** Who invited the payer with a friend link (deleted: that account is gone, no e-mail). */
  invitedBy?: { id: string; email?: string; nickname?: string; deleted?: true }
  /** The owner changed the amount by hand: the amount before the first change and when. */
  amountEdited?: { before: number; at: string }
  /** Roubles left after the commission, when it was given with a confirmation by hand. */
  netAmount?: number
}

export interface AdminPayments {
  payments: AdminPayment[]
  total: number
  totals: { succeeded: number; revenue: number; yookassa: number; lava: number; streamerEarnings: number; net?: number; plans?: Record<PlanId, { count: number; revenue: number }> }
}

export interface AdminUser {
  id: string
  email: string
  kind: 'user' | 'streamer'
  owner?: true
  createdAt: string
  referredBy?: string
  referralCode?: string
  subscription: { status: 'active' | 'trial' | 'inactive'; paidUntil?: string; trialEndsAt?: string; lifetime?: true }
  autopay: { provider: string; status: string; plan: string } | null
  lastSeenAt?: string
  blockedAt?: string
  country?: string
  nickname?: string
  payments: { count: number; total: number }
}

export interface AdminUserDetail {
  user: AdminUser
  payments: AdminPayment[]
  grants: Array<{ days: number; reason: string; actor: string; at: string; paidUntil: string }>
}

export type BugReportStatus = 'open' | 'closed'
export interface BugReportSummary {
  id: number; kind?: 'bug' | 'idea'; accountId?: string; email?: string; topic: string; appVersion: string; platform: string; status: BugReportStatus
  createdAt: string; closedAt?: string; files: number; rewardDays?: number
}
export interface BugReportFile { idx: number; mime: string; size: number }
export interface BugReportDetail extends Omit<BugReportSummary, 'files'> { description: string; files: BugReportFile[] }
export interface BugReportList { reports: BugReportSummary[]; total: number; counts: Record<BugReportStatus, number> }

export interface AdminSupportMessage { id: number; author: 'user' | 'owner'; text: string; createdAt: string; read: boolean; attachments?: SupportAttachment[]; report?: SupportReportReply }
export interface AdminSupportThread {
  accountId: string; email: string; nickname?: string; lastMessage: AdminSupportMessage; lastAt: string; unread: number
}
export interface AdminSupportThreads { threads: AdminSupportThread[]; total: number; unread: number }
export interface AdminSupportDetail { account: { id: string; email: string; nickname?: string }; messages: AdminSupportMessage[] }

export type AdminPaymentPeriod = 'today' | 'yesterday' | '7d' | '30d' | 'month' | 'all' | 'custom'

function query(values: Record<string, string | number | undefined>) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(values)) if (value !== undefined && value !== '') params.set(key, String(value))
  const suffix = params.toString()
  return suffix ? `?${suffix}` : ''
}

/**
 * The owner's days (Bangkok, src/shared/ownerTime.ts) of a payments period, as the site sends them; `custom`: the dates
 * the owner chose (either may be empty).
 */
export function paymentDates(period: AdminPaymentPeriod, now = new Date(), custom: { from?: string; to?: string } = {}): { from?: string; to?: string } {
  const at = now.getTime()
  const today = ownerDayAgo(0, at)
  if (period === 'all') return {}
  if (period === 'custom') return { ...(custom.from ? { from: custom.from } : {}), ...(custom.to ? { to: custom.to } : {}) }
  if (period === 'today') return { from: today, to: today }
  if (period === 'yesterday') return { from: ownerDayAgo(1, at), to: ownerDayAgo(1, at) }
  if (period === 'month') return { from: `${today.slice(0, 7)}-01`, to: today }
  return { from: ownerDayAgo(period === '7d' ? 6 : 29, at), to: today }
}

/** «Платежи» filters beyond the period, as on the site: the status, the plan, the payer's e-mail; the dates of «Даты». */
export interface AdminPaymentQuery { status: PaymentStatus | 'all'; plan?: PlanId; q?: string; custom?: { from?: string; to?: string } }

/** The addresses of the answers the screens open with: also the keys they are kept under (adminKeep.ts). */
export const adminPaths = {
  overview: () => '/v1/accounts/me/admin/overview',
  /** «Статистика онлайна»: two requests, kept together. */
  online: () => 'online',
  users: (search: string, filter: AdminUserFilter, region: AdminUserRegion = 'all', limit = 100, offset = 0) => `/v1/accounts/me/admin/users${query({ q: search.trim(), filter, region, limit, offset })}`,
  payments: (period: AdminPaymentPeriod, filter: AdminPaymentQuery, limit = 100, offset = 0, now = new Date()) => `/v1/accounts/me/admin/payments${query({ ...paymentDates(period, now, filter.custom), status: filter.status === 'all' ? undefined : filter.status, plan: filter.plan, q: filter.q?.trim(), limit, offset })}`,
  bugReports: (status: BugReportStatus, limit = 100, offset = 0) => `/v1/accounts/me/admin/bug-reports${query({ status, limit, offset })}`,
  supportThreads: (limit = 100, offset = 0) => `/v1/accounts/me/admin/support/threads${query({ limit, offset })}`,
  calendar: (month: string) => `/v1/accounts/me/admin/calendar?month=${month}`,
  series: (period: StatsPeriod) => `/v1/accounts/me/admin/series?period=${period}`,
  rangeStats: (from: string, to: string) => `/v1/accounts/me/admin/stats?from=${from}&to=${to}`,
  referrals: (search: string, sort: ReferralSort) => `/v1/accounts/me/admin/referrals${query({ q: search.trim(), sort })}`,
}

/**
 * How the owner app asks the server (owner, 03.11.2026: «иногда пишет, что связи нет… долго загружает»). From Bangkok
 * a request to raidos.app costs ~0.3 s, a new connection ~1.2 s, and now and then one stalls. So the same GET asked at
 * once (the page, the bottom bar, the notifications) goes out once and its answer serves FRESH_MS more (every change and
 * «Обновить» forget it); a GET that got no answer is asked once more on a new connection after RETRY_MS; the answers the
 * screens open with are kept on the phone (adminKeep.ts) and shown at once next time.
 */
const FRESH_MS = 10_000
const RETRY_MS = 700
const inFlight = new Map<string, Promise<unknown>>()
const fresh = new Map<string, { at: number; value: unknown }>()

async function ask<T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown) {
  const result = await webServiceRequest(method, path, body)
  if (result === null) throw new Error('Войдите в аккаунт владельца')
  return result as T
}

function request<T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown, options: { keep?: boolean } = {}): Promise<T> {
  if (method !== 'GET') {
    fresh.clear()
    return ask<T>(method, path, body)
  }
  const recent = fresh.get(path)
  if (recent && Date.now() - recent.at < FRESH_MS) return Promise.resolve(recent.value as T)
  const pending = inFlight.get(path)
  if (pending) return pending as Promise<T>
  const run = (async () => {
    let value: T
    try {
      value = await ask<T>('GET', path)
    } catch (error) {
      if (!isServerUnavailable(error)) throw error
      await new Promise((resolve) => setTimeout(resolve, RETRY_MS))
      value = await ask<T>('GET', path)
    }
    fresh.set(path, { at: Date.now(), value })
    if (options.keep) keepAnswer(path, value)
    return value
  })().finally(() => inFlight.delete(path))
  inFlight.set(path, run)
  return run
}

/** The answer kept from the last time for an address of `adminPaths` (shown at once while the fresh one loads). */
export const adminKept = <T,>(key: string) => keptAnswer<T>(key)

const keep = { keep: true }
export const adminApi = {
  /** Answers asked again from the server, not from the last FRESH_MS («Обновить»). */
  forget: () => { fresh.clear() },
  overview: () => request<AdminOverview>('GET', adminPaths.overview(), undefined, keep),
  online: async (days = 30) => {
    const [history, live] = await Promise.all([
      request<AdminOnlineStats>('GET', `/v1/accounts/me/admin/online-stats?days=${days}`),
      request<{ online: number }>('GET', '/v1/accounts/me/admin/online'),
    ])
    const value = { ...history, current: live.online }
    if (days === 30) keepAnswer(adminPaths.online(), value)
    return value
  },
  users: (search: string, filter: AdminUserFilter, region: AdminUserRegion = 'all', limit = 100, offset = 0) => request<{ users: AdminUser[]; total: number; regions: AdminRegionCounts }>(
    'GET', adminPaths.users(search, filter, region, limit, offset), undefined, keep,
  ),
  user: (id: string) => request<AdminUserDetail>('GET', `/v1/accounts/me/admin/users/${encodeURIComponent(id)}`),
  grant: (id: string, days: number, reason: string) => request<AdminUserDetail>(
    'POST', `/v1/accounts/me/admin/users/${encodeURIComponent(id)}/grant`, { days, reason },
  ),
  /** «Изменить сумму»: roubles (kopecks allowed) and an optional comment for the owner's log; the streamer's share follows. */
  setPaymentAmount: (id: string, amount: number, comment?: string) => request<AdminPayment>(
    'POST', `/v1/accounts/me/admin/payments/${encodeURIComponent(id)}/amount`, { amount, ...(comment ? { comment } : {}) },
  ),
  payments: (period: AdminPaymentPeriod, filter: AdminPaymentQuery, limit = 100, offset = 0) => request<AdminPayments>(
    'GET', adminPaths.payments(period, filter, limit, offset), undefined, keep,
  ),
  /** «Отметить возврат»: the money went back past ЮKassa; the paid days, the streamer's share and the friend's reward go. */
  markRefunded: (id: string) => request<{ ok: true }>('POST', `/v1/accounts/me/admin/payments/${encodeURIComponent(id)}/refunded`, {}),
  calendar: (month: string) => request<AdminCalendar>('GET', adminPaths.calendar(month), undefined, keep),
  day: (date: string) => request<AdminDay>('GET', `/v1/accounts/me/admin/day?date=${date}`),
  series: (period: StatsPeriod) => request<{ period: StatsPeriod; rows: AdminSeriesRow[] }>('GET', adminPaths.series(period), undefined, keep),
  /** «Новые за …»: the owner's days `from`..`to`. */
  rangeStats: (from: string, to: string) => request<AdminRangeStats>('GET', adminPaths.rangeStats(from, to), undefined, keep),
  streamers: () => request<OwnerStreamers>('GET', '/v1/accounts/me/admin/streamers'),
  streamerStats: (code: string, period: StatsPeriod) => request<OwnerStreamerStats>('GET', `/v1/accounts/me/admin/streamer-stats?code=${encodeURIComponent(code)}&period=${period}`),
  createStreamerInvite: (code: string) => request<CreatedStreamerInvite>('POST', '/v1/accounts/me/admin/streamer-invites', { code }),
  streamerSettings: () => request<AdminStreamerSettings>('GET', '/v1/accounts/me/admin/streamer-settings'),
  /** null: back to the common percent. */
  setStreamerPercent: (code: string, percent: number | null) => request<AdminStreamerSettings>('PUT', `/v1/accounts/me/admin/streamers/${encodeURIComponent(code)}/percent`, { percent }),
  setStreamerLink: (code: string, enabled: boolean) => request<AdminStreamerSettings>('PUT', `/v1/accounts/me/admin/streamers/${encodeURIComponent(code)}/link`, { enabled }),
  revokeStreamer: (code: string) => request<AdminStreamerSettings>('POST', `/v1/accounts/me/admin/streamers/${encodeURIComponent(code)}/revoke`),
  payouts: () => request<OwnerPayouts>('GET', '/v1/accounts/me/admin/payouts'),
  decidePayout: (id: string, status: 'paid' | 'rejected', comment?: string) => request<OwnerPayout>('POST', '/v1/accounts/me/admin/payouts/decide', { id, status, ...(comment ? { comment } : {}) }),
  /** How often (days) streamers may choose their automatic payout. */
  setPayoutLimits: (min: number, max: number) => request<{ limits: { min: number; max: number } }>('PUT', '/v1/accounts/me/admin/payout-limits', { min, max }),
  referrals: (search: string, sort: ReferralSort) => request<AdminReferrals>('GET', adminPaths.referrals(search, sort), undefined, keep),
  referrer: (id: string) => request<AdminReferrerDetail>('GET', `/v1/accounts/me/admin/referrals/${encodeURIComponent(id)}`),
  bugReports: (status: BugReportStatus, limit = 100, offset = 0) => request<BugReportList>(
    'GET', adminPaths.bugReports(status, limit, offset), undefined, limit === 100 && offset === 0 ? keep : {},
  ),
  bugReport: (id: number) => request<{ report: BugReportDetail }>('GET', `/v1/accounts/me/admin/bug-reports/${id}`),
  bugReportImage: async (id: number, idx: number) => {
    const file = await request<{ mime: string; data: string }>('GET', `/v1/accounts/me/admin/bug-reports/${id}/files/${idx}/data`)
    return `data:${file.mime};base64,${file.data}`
  },
  setBugReportStatus: (id: number, status: BugReportStatus) => request<{ report: BugReportDetail }>(
    'POST', `/v1/accounts/me/admin/bug-reports/${id}/status`, { status },
  ),
  rewardReport: (id: number, days: number) => request<{ report: BugReportDetail }>('POST', `/v1/accounts/me/admin/bug-reports/${id}/reward`, { days }),
  supportThreads: (limit = 100, offset = 0) => request<AdminSupportThreads>(
    'GET', adminPaths.supportThreads(limit, offset), undefined, limit === 100 && offset === 0 ? keep : {},
  ),
  supportThread: (accountId: string) => request<AdminSupportDetail>('GET', `/v1/accounts/me/admin/support/threads/${encodeURIComponent(accountId)}`),
  /** `reportId`: the answer is about that report of this player (shown in the chat as «Ответ на заявку №N»). */
  supportReply: (accountId: string, text: string, images: SupportImageUpload[] = [], reportId?: number) => request<{ message: AdminSupportMessage }>(
    'POST', `/v1/accounts/me/admin/support/threads/${encodeURIComponent(accountId)}/messages`, { text, images, ...(reportId ? { reportId } : {}) },
  ),
  supportImage: async (attachmentId: string) => {
    const file = await request<{ mime: string; data: string }>('GET', `/v1/accounts/me/admin/support/attachments/${encodeURIComponent(attachmentId)}`)
    return `data:${file.mime};base64,${file.data}`
  },
  supportRead: (accountId: string) => request<void>('POST', `/v1/accounts/me/admin/support/threads/${encodeURIComponent(accountId)}/read`),
  supportDelete: (accountId: string) => request<void>('DELETE', `/v1/accounts/me/admin/support/threads/${encodeURIComponent(accountId)}`),
}

/** Paid plans on this server use 30-day months (server/src/services/paymentStore.ts). */
export function monthsToDays(months: number) {
  return months * 30
}
