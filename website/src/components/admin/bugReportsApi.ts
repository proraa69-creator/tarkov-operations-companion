/**
 * «Отчёты» tab of the admin panel: the owner-only API of server/src/routes/bugReports.ts. Kept apart from api.ts;
 * the same error handling (ApiError, network message). Screenshots are fetched with the owner's token as blobs.
 */
import { ApiError, NETWORK_ERROR_MESSAGE } from '../../api'
import { API_URL } from '../../config'

export type BugReportStatus = 'open' | 'closed'
/** 'bug': «Сообщить об ошибке»; 'idea': «Ваши предложения» (owner, 13.10.2026). Absent from servers before that: a bug. */
export type ReportKind = 'bug' | 'idea'
/** A quest correction a player proposed (category «Квест», owner 13.10.2026; the app's «Заявки» groups them). */
export interface BugReportQuest {
  questId: string
  issue: string
  mode?: string
  mapId?: string
  markerId?: string
  objectiveId?: string
  stageIndex?: number
  point?: { x: number; z: number; floor?: string }
  pointNote?: string
  questNote?: string
}
export interface BugReportSummary {
  id: number
  kind?: ReportKind
  /** What the bug is about (src/shared/reportCategories.ts); absent on reports before 13.10.2026. */
  category?: string
  quest?: BugReportQuest
  /** Open quest reports agreeing with this one, itself included. */
  matches?: number
  email?: string
  /** The reporter's account (cleared when it is deleted): days can be granted only while it exists. */
  accountId?: string
  topic: string
  appVersion: string
  platform: string
  status: BugReportStatus
  createdAt: string
  closedAt?: string
  files: number
  /** Subscription days granted for the report («+1 день»); 0 = none yet. */
  rewardDays: number
  rewardedAt?: string
  /** When the report's PDF reached the owner's mailbox; the last error if it did not. */
  mailedAt?: string
  mailError?: string
}
export interface BugReportFile { idx: number; mime: string; size: number }
export interface BugReportDetail extends Omit<BugReportSummary, 'files'> { description: string; files: BugReportFile[] }
/** `counts`: open / closed of the listed kind; `kinds`: open reports of each kind. */
export interface BugReportList { reports: BugReportSummary[]; total: number; counts: Record<BugReportStatus, number>; kinds?: Record<ReportKind, number> }

const BASE = '/v1/accounts/me/admin/bug-reports'

async function send(token: string, path: string, body?: unknown) {
  try {
    return await fetch(`${API_URL}${BASE}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    })
  } catch {
    throw new ApiError(0, NETWORK_ERROR_MESSAGE, true)
  }
}

function refused(response: Response, data: { error?: unknown } | undefined) {
  return new ApiError(response.status, typeof data?.error === 'string' ? data.error : response.status === 404 ? 'Раздел доступен только владельцу (или сервер ещё не обновлён).' : `Ошибка сервера (HTTP ${response.status})`)
}

async function call<T>(token: string, path: string, body?: unknown): Promise<T> {
  const response = await send(token, path, body)
  const data = await response.json().catch(() => undefined) as { error?: unknown } | undefined
  if (!response.ok) throw refused(response, data)
  return data as T
}

export const bugReportsApi = {
  list: (token: string, status: BugReportStatus, limit: number, offset: number, kind: ReportKind = 'bug') =>
    call<BugReportList>(token, `?kind=${kind}&status=${status}&limit=${limit}&offset=${offset}`),
  get: (token: string, id: number) => call<{ report: BugReportDetail }>(token, `/${id}`),
  setStatus: (token: string, id: number, status: BugReportStatus) => call<{ report: BugReportDetail }>(token, `/${id}/status`, { status }),
  /** Grants the reporter `days` of subscription for this report (reason «Отчёт об ошибке №N» / «Предложение №N»). */
  reward: (token: string, id: number, days: number) => call<{ report: BugReportDetail }>(token, `/${id}/reward`, { days }),
  /** Sends the report's PDF to the owner's mailbox again. */
  mail: (token: string, id: number) => call<{ report: BugReportDetail }>(token, `/${id}/mail`, {}),
  /** The screenshot's bytes (never a URL with the token in it). */
  file: async (token: string, id: number, idx: number): Promise<Blob> => {
    const response = await send(token, `/${id}/files/${idx}`)
    if (!response.ok) throw refused(response, await response.json().catch(() => undefined) as { error?: unknown } | undefined)
    return response.blob()
  },
}
