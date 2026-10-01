/**
 * «Обновление» tab of the admin panel: the owner-only status of «Автообновление сервера» on the server laptop
 * (server/src/routes/selfUpdate.ts → electron/selfUpdate.ts). Only reading and two actions; nothing is uploaded here —
 * the laptop downloads and verifies releases itself.
 */
import { ApiError, NETWORK_ERROR_MESSAGE } from '../../api'
import { API_URL } from '../../config'

export interface BuildRef { version: string; build: number; commit: string }
export interface UpdateFile { name: string; size: number; done: number; state: 'pending' | 'downloading' | 'ok' | 'error' }
export interface UpdateCheck { label: string; ok: boolean; detail?: string }
export interface HistoryEntry { at: string; kind: 'update' | 'rollback'; from: BuildRef; to: BuildRef; result: 'ok' | 'rolled-back' | 'failed'; reason?: string }
export type UpdaterPhase = 'off' | 'idle' | 'checking' | 'downloading' | 'verifying' | 'ready' | 'installing' | 'error'
export interface SelfUpdateStatus {
  enabled: boolean
  repo: string
  window: 'any' | 'night'
  hasToken: boolean
  unsupported: string
  current: BuildRef
  previous: (BuildRef & { savedAt: string }) | null
  updater: { phase: UpdaterPhase; message: string; checkedAt?: string; latest?: BuildRef; files: UpdateFile[]; checks: UpdateCheck[]; error?: string; waitingForWindow?: boolean }
  restart: { kind: 'update' | 'rollback'; from: BuildRef; to: BuildRef; startedAt: string; deadlineAt: string; phase: string } | null
  history: HistoryEntry[]
  skipped: number[]
  nextCheckAt?: string
}
export type UpdateView = { available: true; status: SelfUpdateStatus } | { available: false; reason: string }

const BASE = '/v1/accounts/me/admin/update'

async function call(token: string, path: string, body?: unknown, timeoutMs = 25_000): Promise<UpdateView> {
  let response: Response
  try {
    response = await fetch(`${API_URL}${BASE}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch {
    throw new ApiError(0, NETWORK_ERROR_MESSAGE, true)
  }
  const data = await response.json().catch(() => undefined) as { error?: unknown } | undefined
  if (!response.ok) {
    const fallback = response.status === 404 ? 'Раздел доступен только владельцу (или сервер ещё не обновлён).'
      : response.status >= 502 ? 'Сервер не отвечает — возможно, он сейчас перезапускается после обновления. Подождите минуту.'
        : `Ошибка сервера (HTTP ${response.status})`
    throw new ApiError(response.status, typeof data?.error === 'string' ? data.error : fallback, response.status >= 502)
  }
  return data as UpdateView
}

export const updateApi = {
  view: (token: string) => call(token, '', undefined, 12_000),
  check: (token: string) => call(token, '/check', {}),
  rollback: (token: string) => call(token, '/rollback', { confirm: true }, 70_000),
}
