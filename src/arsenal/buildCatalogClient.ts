import type { RaidMode } from '../domain/types'
import { serviceClient } from '../account/nicknameBinding'
import { cleanIpcError } from '../sync/serverSync'

/**
 * «Топ сборок»: builds players published from «Сборка оружия» (server/src/routes/buildCatalog.ts), per game mode — PvP,
 * PvE and Season lists never mix. Every call needs the signed-in account.
 */
export interface SharedBuild {
  id: string
  mode: RaidMode
  weaponId: string
  name: string
  code: string
  author?: string
  likes: number
  liked: boolean
  mine: boolean
  createdAt: string
}

export interface SharedBuildPage { builds: SharedBuild[]; total: number; pageSize: number }
export type CatalogSort = 'top' | 'new'

export const SIGN_IN_FIRST = 'Войдите в аккаунт, чтобы открыть каталог сборок'

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const client = serviceClient()
  if (!client) throw new Error(SIGN_IN_FIRST)
  let answer: unknown
  try { answer = await client(method, path, body) } catch (error) { throw new Error(cleanIpcError(error), { cause: error }) }
  if (!answer) throw new Error(SIGN_IN_FIRST)
  return answer as T
}

export function listSharedBuilds(mode: RaidMode, options: { weaponId?: string; sort?: CatalogSort; offset?: number } = {}) {
  const query = [`mode=${mode}`, options.weaponId ? `weapon=${options.weaponId}` : '', options.sort ? `sort=${options.sort}` : '', options.offset ? `offset=${options.offset}` : ''].filter(Boolean).join('&')
  return request<SharedBuildPage>('GET', `/v1/builds?${query}`)
}

export async function publishBuild(mode: RaidMode, build: { weaponId: string; name: string; code: string }) {
  return (await request<{ build: SharedBuild }>('POST', '/v1/builds', { mode, ...build })).build
}

export function toggleBuildLike(id: string) {
  return request<{ likes: number; liked: boolean }>('POST', `/v1/builds/${id}/like`)
}

export function removeSharedBuild(id: string) {
  return request<{ removed: true }>('POST', `/v1/builds/${id}/remove`)
}
