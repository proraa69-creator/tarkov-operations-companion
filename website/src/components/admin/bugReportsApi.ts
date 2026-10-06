/**
 * «Баг-репорты» tab of the admin panel: the owner-only API of server/src/routes/bugReports.ts. Kept apart from api.ts;
 * the same error handling (ApiError, network message). Screenshots are fetched with the owner's token as blobs.
 */
import { ApiError, NETWORK_ERROR_MESSAGE } from '../../api'
import { API_URL } from '../../config'

export type BugReportStatus = 'open' | 'closed'
export interface BugReportSummary {
  id: number
  email?: string
  topic: string
  appVersion: string
  platform: string
  status: BugReportStatus
  createdAt: string
  closedAt?: string
  files: number
}
export interface BugReportFile { idx: number; mime: string; size: number }
export interface BugReportDetail extends Omit<BugReportSummary, 'files'> { description: string; files: BugReportFile[] }
export interface BugReportList { reports: BugReportSummary[]; total: number; counts: Record<BugReportStatus, number> }

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
  list: (token: string, status: BugReportStatus, limit: number, offset: number) =>
    call<BugReportList>(token, `?status=${status}&limit=${limit}&offset=${offset}`),
  get: (token: string, id: number) => call<{ report: BugReportDetail }>(token, `/${id}`),
  setStatus: (token: string, id: number, status: BugReportStatus) => call<{ report: BugReportDetail }>(token, `/${id}/status`, { status }),
  /** The screenshot's bytes (never a URL with the token in it). */
  file: async (token: string, id: number, idx: number): Promise<Blob> => {
    const response = await send(token, `/${id}/files/${idx}`)
    if (!response.ok) throw refused(response, await response.json().catch(() => undefined) as { error?: unknown } | undefined)
    return response.blob()
  },
}
