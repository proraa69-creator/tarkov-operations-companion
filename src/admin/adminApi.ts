import { webServiceRequest } from '../sync/webAccount'
import type { SupportAttachment } from '../shared/supportChat'
import type { SupportImageUpload } from '../support/supportChatClient'

export type PlanId = '1m' | '3m' | '6m' | '12m'
export type PaymentStatus = 'pending' | 'succeeded' | 'canceled' | 'refunded'
/** NULL on the server is ЮKassa; 'archive' is a payment service that is no longer connected ('lava': older servers). */
export type PaymentProvider = 'yookassa' | 'boosty' | 'archive' | 'lava'
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
  /** Roubles left after the commission (the owner's second sum on «Подтвердить оплату Boosty»). */
  netAmount?: number
}

export interface AdminPayments {
  payments: AdminPayment[]
  total: number
  totals: { succeeded: number; revenue: number; yookassa: number; lava: number; streamerEarnings: number; net?: number; plans?: Record<PlanId, { count: number; revenue: number }> }
}

/** «Подтвердить оплату Boosty» (server/src/routes/ownerAdmin.ts): months or days, the sum paid and the sum after the commission. */
export interface AdminBoostyConfirm {
  email: string; offer: 'standard' | 'friend'; region: 'CIS' | 'WORLD'; months?: 1 | 3 | 6 | 12; days?: number
  amount?: number; netAmount?: number; reference?: string; recalculate?: boolean
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

export interface AdminSupportMessage { id: number; author: 'user' | 'owner'; text: string; createdAt: string; read: boolean; attachments?: SupportAttachment[] }
export interface AdminSupportThread {
  accountId: string; email: string; nickname?: string; lastMessage: AdminSupportMessage; lastAt: string; unread: number
}
export interface AdminSupportThreads { threads: AdminSupportThread[]; total: number; unread: number }
export interface AdminSupportDetail { account: { id: string; email: string; nickname?: string }; messages: AdminSupportMessage[] }

export type AdminPaymentPeriod = 'today' | 'yesterday' | '7d' | '30d' | 'all'

function query(values: Record<string, string | number | undefined>) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(values)) if (value !== undefined && value !== '') params.set(key, String(value))
  const suffix = params.toString()
  return suffix ? `?${suffix}` : ''
}

function day(value: Date) {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const date = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${date}`
}

export function paymentDates(period: AdminPaymentPeriod, now = new Date()) {
  if (period === 'all') return {}
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const start = new Date(end)
  if (period === 'today') return { from: day(start), to: day(start) }
  if (period === 'yesterday') {
    start.setDate(start.getDate() - 1)
    return { from: day(start), to: day(start) }
  }
  start.setDate(start.getDate() - (period === '7d' ? 6 : 29))
  return { from: day(start), to: day(end) }
}

async function request<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown) {
  const result = await webServiceRequest(method, path, body)
  if (result === null) throw new Error('Войдите в аккаунт владельца')
  return result as T
}

export const adminApi = {
  overview: () => request<AdminOverview>('GET', '/v1/accounts/me/admin/overview'),
  online: async (days = 30) => {
    const [history, live] = await Promise.all([
      request<AdminOnlineStats>('GET', `/v1/accounts/me/admin/online-stats?days=${days}`),
      request<{ online: number }>('GET', '/v1/accounts/me/admin/online'),
    ])
    return { ...history, current: live.online }
  },
  users: (search: string, filter: AdminUserFilter, region: AdminUserRegion = 'all', limit = 100, offset = 0) => request<{ users: AdminUser[]; total: number; regions: AdminRegionCounts }>(
    'GET', `/v1/accounts/me/admin/users${query({ q: search.trim(), filter, region, limit, offset })}`,
  ),
  user: (id: string) => request<AdminUserDetail>('GET', `/v1/accounts/me/admin/users/${encodeURIComponent(id)}`),
  grant: (id: string, days: number, reason: string) => request<AdminUserDetail>(
    'POST', `/v1/accounts/me/admin/users/${encodeURIComponent(id)}/grant`, { days, reason },
  ),
  /** «Изменить сумму»: roubles (kopecks allowed) and an optional comment for the owner's log; the streamer's share follows. */
  setPaymentAmount: (id: string, amount: number, comment?: string) => request<AdminPayment>(
    'POST', `/v1/accounts/me/admin/payments/${encodeURIComponent(id)}/amount`, { amount, ...(comment ? { comment } : {}) },
  ),
  payments: (period: AdminPaymentPeriod, status: PaymentStatus | 'all', limit = 100, offset = 0) => request<AdminPayments>(
    'GET', `/v1/accounts/me/admin/payments${query({ ...paymentDates(period), status: status === 'all' ? undefined : status, limit, offset })}`,
  ),
  bugReports: (status: BugReportStatus, limit = 100, offset = 0) => request<BugReportList>(
    'GET', `/v1/accounts/me/admin/bug-reports${query({ status, limit, offset })}`,
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
    'GET', `/v1/accounts/me/admin/support/threads${query({ limit, offset })}`,
  ),
  supportThread: (accountId: string) => request<AdminSupportDetail>('GET', `/v1/accounts/me/admin/support/threads/${encodeURIComponent(accountId)}`),
  supportReply: (accountId: string, text: string, images: SupportImageUpload[] = []) => request<{ message: AdminSupportMessage }>(
    'POST', `/v1/accounts/me/admin/support/threads/${encodeURIComponent(accountId)}/messages`, { text, images },
  ),
  supportImage: async (attachmentId: string) => {
    const file = await request<{ mime: string; data: string }>('GET', `/v1/accounts/me/admin/support/attachments/${encodeURIComponent(attachmentId)}`)
    return `data:${file.mime};base64,${file.data}`
  },
  supportRead: (accountId: string) => request<void>('POST', `/v1/accounts/me/admin/support/threads/${encodeURIComponent(accountId)}/read`),
  boostyConfirm: (input: AdminBoostyConfirm) => request<{ payment: { email?: string; paidUntilAfter?: string }; recalculatedDays?: number }>('POST', '/v1/accounts/me/admin/boosty/payments', input),
  supportDelete: (accountId: string) => request<void>('DELETE', `/v1/accounts/me/admin/support/threads/${encodeURIComponent(accountId)}`),
}

/** Paid plans on this server use 30-day months (server/src/services/paymentStore.ts). */
export function monthsToDays(months: number) {
  return months * 30
}
