import { useCallback, useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { serviceClient } from '../account/nicknameBinding'
import { isOwnerApp } from '../app/buildEdition'
import { useServerAccount } from '../sync/serverSync'
import type { QuestIssue, ReportCategory, ReportMode } from '../shared/reportCategories'
import { cleanSupportMessage, cleanSupportMessages, type SupportMessage } from '../support/supportChatClient'

/**
 * «Заявки» in the owner app (owner, 13.10.2026: «в админ приложении добавь снизу слева кнопку заявки и если они
 * появляются, то там на этой кнопке будет появлятся красный маленький кружок с количеством заявок, я их проверяю и от
 * туда могу изменить базу в ручную и выдать человеку бонус в днях подписки»): the players' reports, ideas and quest
 * corrections (server/src/routes/bugReports.ts), the players' support chats (server/src/routes/supportChat.ts), the live
 * count of open reports and unread chats, and the owner's actions.
 */
export interface OwnerQuestReport {
  questId: string
  issue: QuestIssue
  mode?: ReportMode
  mapId?: string
  markerId?: string
  objectiveId?: string
  stageIndex?: number
  point?: { x: number; z: number; floor?: string }
  pointNote?: string
  questNote?: string
}

export interface OwnerReport {
  id: number
  kind: 'bug' | 'idea'
  category?: ReportCategory
  quest?: OwnerQuestReport
  /** Open quest reports that agree with this one, itself included. */
  matches?: number
  group?: string
  email?: string
  topic: string
  appVersion: string
  platform: string
  status: 'open' | 'closed'
  createdAt: string
  files: number
  rewardDays: number
}

export interface OwnerReportDetail extends Omit<OwnerReport, 'files'> { description: string; files: Array<{ idx: number; mime: string; size: number }> }

export const OWNER_REPORTS_KEY = ['owner-reports'] as const
export const OWNER_CHATS_KEY = ['owner-chats'] as const
/** Pause after a failed wait (no server, an older server without the route, not the owner's session). */
const RETRY_MS = 30_000
/** An unchanged count answered at once is not a reason to ask again right away. */
const QUICK_ANSWER_MS = 2_000
const QUICK_PAUSE_MS = 5_000

type Request = NonNullable<ReturnType<typeof serviceClient>>

/** Open reports and conversations with unseen messages (0 from a server before the support chat). */
export interface OwnerRequestCounts { open: number; unreadChats: number }

/**
 * Long polling of GET /v1/accounts/me/admin/requests/events: `onCount` gets the counts on every answer (at once, then
 * whenever a report arrives or is closed or a player writes, or every ~25 s); `changed`: the server says something moved
 * since the previous answer. Runs until `signal` aborts.
 */
export async function watchOwnerRequests(request: Request, onCount: (counts: OwnerRequestCounts, changed: boolean) => void, signal: AbortSignal, retryMs = RETRY_MS) {
  let version: number | undefined
  const pause = (ms: number) => new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => { clearTimeout(timer); resolve() }, { once: true })
  })
  while (!signal.aborted) {
    try {
      const asked = Date.now()
      const answer = await request('GET', version === undefined ? '/v1/accounts/me/admin/requests/events' : `/v1/accounts/me/admin/requests/events?since=${version}`) as { version?: unknown; open?: unknown; unreadChats?: unknown } | null
      if (signal.aborted) return
      const next = typeof answer?.version === 'number' && Number.isSafeInteger(answer.version) ? answer.version : undefined
      if (next === undefined || typeof answer?.open !== 'number') { await pause(retryMs); continue }
      const same = next === version
      const changed = version !== undefined && !same
      version = next
      onCount({ open: answer.open, unreadChats: typeof answer.unreadChats === 'number' && answer.unreadChats > 0 ? answer.unreadChats : 0 }, changed)
      if (same && Date.now() - asked < QUICK_ANSWER_MS) await pause(Math.min(QUICK_PAUSE_MS, retryMs))
    } catch {
      await pause(retryMs)
    }
  }
}

/**
 * The owner app's «Заявки» count: open reports plus conversations with unseen messages (null until known, or outside the
 * owner app / signed out). Re-reads the reports when their count moves and the chats on every change.
 */
export function useOwnerRequestCount() {
  const client = useQueryClient()
  const { status } = useServerAccount()
  const enabled = isOwnerApp() && Boolean(status?.signedIn)
  const [count, setCount] = useState<number | null>(null)
  useEffect(() => {
    const request = enabled ? serviceClient() : undefined
    if (!request) return
    const stop = new AbortController()
    let last: number | undefined
    void watchOwnerRequests(request, (counts, changed) => {
      setCount(counts.open + counts.unreadChats)
      if (last !== undefined && counts.open !== last) void client.invalidateQueries({ queryKey: OWNER_REPORTS_KEY })
      // A player wrote (or the owner read a conversation on another device): the list and the open one follow.
      if (changed) void client.invalidateQueries({ queryKey: OWNER_CHATS_KEY })
      last = counts.open
    }, stop.signal)
    return () => { stop.abort(); setCount(null) }
  }, [client, enabled])
  return enabled ? count : null
}

/** Open (or closed) reports, newest first, with the agreement counts of quest corrections. */
export function useOwnerReports(status: 'open' | 'closed') {
  return useQuery({
    queryKey: [...OWNER_REPORTS_KEY, status],
    queryFn: async () => {
      const request = serviceClient()
      if (!request) throw new Error('Нет связи с сервером')
      const answer = await request('GET', `/v1/accounts/me/admin/bug-reports?status=${status}&limit=${status === 'open' ? 200 : 50}`) as { reports?: OwnerReport[] } | null
      return answer?.reports ?? []
    },
    enabled: isOwnerApp(),
    staleTime: 30_000,
    retry: 1,
  })
}

/** The owner's actions on a report; every one refreshes the list. */
export function useOwnerReportActions() {
  const client = useQueryClient()
  const call = useCallback(async (method: 'GET' | 'POST', path: string, body?: unknown) => {
    const request = serviceClient()
    if (!request) throw new Error('Нет связи с сервером')
    return request(method, path, body)
  }, [])
  const refresh = useCallback(() => client.invalidateQueries({ queryKey: OWNER_REPORTS_KEY }), [client])
  return {
    detail: async (id: number) => ((await call('GET', `/v1/accounts/me/admin/bug-reports/${id}`)) as { report: OwnerReportDetail }).report,
    /** A screenshot as a data URL (the gateway forwards JSON only). */
    image: async (id: number, idx: number) => {
      const file = await call('GET', `/v1/accounts/me/admin/bug-reports/${id}/files/${idx}/data`) as { mime: string; data: string }
      return `data:${file.mime};base64,${file.data}`
    },
    setStatus: async (ids: number[], status: 'open' | 'closed') => {
      for (const id of ids) await call('POST', `/v1/accounts/me/admin/bug-reports/${id}/status`, { status })
      await refresh()
    },
    /** Subscription days for each report's sender («+1 день» for a confirmed report). */
    reward: async (ids: number[], days: number) => {
      for (const id of ids) await call('POST', `/v1/accounts/me/admin/bug-reports/${id}/reward`, { days })
      await refresh()
    },
  }
}

/** «Заявки» → «Чаты»: a player's conversation in the list (server/src/routes/supportChat.ts). */
export interface OwnerChatThread {
  accountId: string
  email: string
  /** The Escape from Tarkov nickname (one for every mode), when the PC app has found it. */
  nickname?: string
  lastMessage: SupportMessage
  lastAt: string
  /** The player's messages the owner has not seen. */
  unread: number
}
export interface OwnerChatThreads { threads: OwnerChatThread[]; total: number; unread: number }
export interface OwnerChatDetail { account: { id: string; email: string; nickname?: string }; messages: SupportMessage[] }

const ACCOUNT_ID = /^[a-f0-9]{24}$/
const text = (value: unknown) => (typeof value === 'string' ? value : '')
const nicknameOf = (value: unknown) => (typeof value === 'string' && /^[a-zA-Z0-9_-]{3,15}$/.test(value) ? { nickname: value } : {})
const counted = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0)

function cleanThread(raw: unknown): OwnerChatThread | null {
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : null
  const lastMessage = cleanSupportMessage(value?.lastMessage)
  if (!value || typeof value.accountId !== 'string' || !ACCOUNT_ID.test(value.accountId) || !lastMessage) return null
  return { accountId: value.accountId, email: text(value.email), ...nicknameOf(value.nickname), lastMessage, lastAt: text(value.lastAt) || lastMessage.createdAt, unread: counted(value.unread) }
}

async function ownerCall(method: 'GET' | 'POST', path: string, body?: unknown) {
  const request = serviceClient()
  if (!request) throw new Error('Нет связи с сервером')
  return request(method, path, body)
}

/** The conversations, the latest message first; `unread`: conversations with unseen messages (the «Чаты» count). */
export function useOwnerChats(enabled = true) {
  return useQuery({
    queryKey: [...OWNER_CHATS_KEY, 'threads'],
    queryFn: async (): Promise<OwnerChatThreads> => {
      const answer = await ownerCall('GET', '/v1/accounts/me/admin/support/threads?limit=100') as { threads?: unknown; total?: unknown; unread?: unknown } | null
      const threads = (Array.isArray(answer?.threads) ? answer.threads : []).map(cleanThread).filter((thread): thread is OwnerChatThread => thread !== null)
      return { threads, total: counted(answer?.total), unread: counted(answer?.unread) }
    },
    enabled: isOwnerApp() && enabled,
    staleTime: 30_000,
    retry: 1,
  })
}

/** One conversation (its newest 200 messages); read again every minute while it is open, and on every change. */
export function useOwnerChat(accountId: string | null) {
  return useQuery({
    queryKey: [...OWNER_CHATS_KEY, 'thread', accountId ?? ''],
    queryFn: async (): Promise<OwnerChatDetail> => {
      const answer = await ownerCall('GET', `/v1/accounts/me/admin/support/threads/${accountId}`) as { account?: Record<string, unknown>; messages?: unknown } | null
      return { account: { id: accountId!, email: text(answer?.account?.email), ...nicknameOf(answer?.account?.nickname) }, messages: cleanSupportMessages(answer?.messages) }
    },
    enabled: isOwnerApp() && Boolean(accountId && ACCOUNT_ID.test(accountId)),
    refetchInterval: 60_000,
    retry: 1,
  })
}

/** The owner's answer and «прочитано»; both refresh the conversations. */
export function useOwnerChatActions() {
  const client = useQueryClient()
  const refresh = useCallback(() => client.invalidateQueries({ queryKey: OWNER_CHATS_KEY }), [client])
  return {
    reply: useCallback(async (accountId: string, message: string) => {
      const answer = await ownerCall('POST', `/v1/accounts/me/admin/support/threads/${accountId}/messages`, { text: message }) as { message?: unknown } | null
      await refresh()
      return cleanSupportMessage(answer?.message)
    }, [refresh]),
    markRead: useCallback(async (accountId: string) => {
      await ownerCall('POST', `/v1/accounts/me/admin/support/threads/${accountId}/read`)
      await refresh()
    }, [refresh]),
  }
}
