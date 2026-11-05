/**
 * «Эта таблица должна в режиме онлайн пополняться» (owner, 05.11.2026): GET /v1/accounts/me/admin/requests/events, the long
 * polling the owner app has had for «Заявки» (server/src/routes/bugReports.ts). One request waits on the server and is
 * answered the moment something changes, or after ~25 s. A new report and the owner's buttons wake it at once; what Claude's
 * script wrote shows in the next answer, through `stamp`.
 */
export const REPORT_EVENTS_PATH = '/v1/accounts/me/admin/requests/events'

export interface ReportEvent {
  /** Reports that wait for the owner. */
  open: number
  unreadChats: number
  /** The newest report's number (0 from a server before the table). */
  latest: number
}

/** Pause after a failed wait (no server, an older server without the route, not the owner's session). */
const RETRY_MS = 30_000
/** An unchanged answer that came at once is not a reason to ask again right away. */
const QUICK_ANSWER_MS = 2_000
const QUICK_PAUSE_MS = 5_000

const safeNumber = (value: unknown) => (typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 0)

/**
 * Asks in a loop until `signal` aborts; `onEvent` gets every answer. `changed`: the table or the chats moved since the
 * previous answer.
 */
export async function watchReportEvents(ask: (path: string) => Promise<unknown>, onEvent: (event: ReportEvent, changed: boolean) => void, signal: AbortSignal, retryMs = RETRY_MS) {
  let version: number | undefined
  let stamp = 0
  const pause = (ms: number) => new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => { clearTimeout(timer); resolve() }, { once: true })
  })
  while (!signal.aborted) {
    try {
      const asked = Date.now()
      const answer = await ask(version === undefined ? REPORT_EVENTS_PATH : `${REPORT_EVENTS_PATH}?since=${version}`) as { version?: unknown; open?: unknown; unreadChats?: unknown; stamp?: unknown; latest?: unknown } | null
      if (signal.aborted) return
      const next = typeof answer?.version === 'number' && Number.isSafeInteger(answer.version) ? answer.version : undefined
      if (next === undefined || typeof answer?.open !== 'number') { await pause(retryMs); continue }
      const nextStamp = safeNumber(answer.stamp)
      const same = next === version
      const changed = version !== undefined && (!same || nextStamp !== stamp)
      version = next
      stamp = nextStamp
      onEvent({ open: answer.open, unreadChats: safeNumber(answer.unreadChats), latest: safeNumber(answer.latest) }, changed)
      if (same && Date.now() - asked < QUICK_ANSWER_MS) await pause(Math.min(QUICK_PAUSE_MS, retryMs))
    } catch {
      await pause(retryMs)
    }
  }
}
