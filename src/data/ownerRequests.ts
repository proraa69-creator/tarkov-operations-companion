import { useCallback, useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { serviceClient } from '../account/nicknameBinding'
import { isOwnerApp } from '../app/buildEdition'
import { useServerAccount } from '../sync/serverSync'
import type { QuestIssue, ReportCategory, ReportMode } from '../shared/reportCategories'

/**
 * «Заявки» in the owner app (owner, 13.10.2026: «в админ приложении добавь снизу слева кнопку заявки и если они
 * появляются, то там на этой кнопке будет появлятся красный маленький кружок с количеством заявок, я их проверяю и от
 * туда могу изменить базу в ручную и выдать человеку бонус в днях подписки»): the players' reports, ideas and quest
 * corrections (server/src/routes/bugReports.ts), the live count of open ones and the owner's actions.
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
/** Pause after a failed wait (no server, an older server without the route, not the owner's session). */
const RETRY_MS = 30_000
/** An unchanged count answered at once is not a reason to ask again right away. */
const QUICK_ANSWER_MS = 2_000
const QUICK_PAUSE_MS = 5_000

type Request = NonNullable<ReturnType<typeof serviceClient>>

/**
 * Long polling of GET /v1/accounts/me/admin/requests/events: `onCount` gets the number of open reports on every answer
 * (at once, then whenever a report arrives or is closed, or every ~25 s). Runs until `signal` aborts.
 */
export async function watchOwnerRequests(request: Request, onCount: (open: number) => void, signal: AbortSignal, retryMs = RETRY_MS) {
  let version: number | undefined
  const pause = (ms: number) => new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => { clearTimeout(timer); resolve() }, { once: true })
  })
  while (!signal.aborted) {
    try {
      const asked = Date.now()
      const answer = await request('GET', version === undefined ? '/v1/accounts/me/admin/requests/events' : `/v1/accounts/me/admin/requests/events?since=${version}`) as { version?: unknown; open?: unknown } | null
      if (signal.aborted) return
      const next = typeof answer?.version === 'number' && Number.isSafeInteger(answer.version) ? answer.version : undefined
      if (next === undefined || typeof answer?.open !== 'number') { await pause(retryMs); continue }
      const same = next === version
      version = next
      onCount(answer.open)
      if (same && Date.now() - asked < QUICK_ANSWER_MS) await pause(Math.min(QUICK_PAUSE_MS, retryMs))
    } catch {
      await pause(retryMs)
    }
  }
}

/** The owner app's «Заявки» count (null until known, or outside the owner app / signed out); re-reads the list on a change. */
export function useOwnerRequestCount() {
  const client = useQueryClient()
  const { status } = useServerAccount()
  const enabled = isOwnerApp() && Boolean(status?.signedIn)
  const [open, setOpen] = useState<number | null>(null)
  useEffect(() => {
    const request = enabled ? serviceClient() : undefined
    if (!request) return
    const stop = new AbortController()
    let last: number | undefined
    void watchOwnerRequests(request, (count) => {
      setOpen(count)
      if (last !== undefined && count !== last) void client.invalidateQueries({ queryKey: OWNER_REPORTS_KEY })
      last = count
    }, stop.signal)
    return () => { stop.abort(); setOpen(null) }
  }, [client, enabled])
  return enabled ? open : null
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
