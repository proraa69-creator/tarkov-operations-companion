/**
 * «Объявления» and «Опросы» tabs of the admin panel: the owner-only API of server/src/routes/notices.ts (and the support
 * chat's «Написать», routes/supportChat.ts). Kept apart from api.ts with the same error handling (ApiError, network
 * message), like bugReportsApi.ts.
 */
import { ApiError, NETWORK_ERROR_MESSAGE } from '../../api'
import { API_URL } from '../../config'

async function send(token: string, method: 'GET' | 'POST', path: string, body?: unknown) {
  try {
    return await fetch(`${API_URL}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      // A photo upload may take a while on a slow line.
      signal: AbortSignal.timeout(path.endsWith('/images') ? 90_000 : 30_000),
    })
  } catch {
    throw new ApiError(0, NETWORK_ERROR_MESSAGE, true)
  }
}

function refused(response: Response, data: { error?: unknown } | undefined) {
  return new ApiError(response.status, typeof data?.error === 'string' ? data.error : response.status === 404 ? 'Раздел доступен только владельцу (или сервер ещё не обновлён).' : `Ошибка сервера (HTTP ${response.status})`)
}

/** One owner call: the JSON answer, or ApiError with the server's reason. */
export async function ownerCall<T = unknown>(token: string, method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const response = await send(token, method, path, body)
  if (response.status === 204) return undefined as T
  const data = await response.json().catch(() => undefined) as { error?: unknown } | undefined
  if (!response.ok) throw refused(response, data)
  return data as T
}

/** «Выгрузить CSV»: the responses of a survey as a file (never a URL with the token in it). */
export async function surveyCsv(token: string, id: number): Promise<Blob> {
  const response = await send(token, 'GET', `/v1/accounts/me/admin/surveys/${id}/responses.csv`)
  if (!response.ok) throw refused(response, await response.json().catch(() => undefined) as { error?: unknown } | undefined)
  return response.blob()
}
