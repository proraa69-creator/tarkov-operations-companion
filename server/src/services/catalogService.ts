import type { AppDataset, RaidMode } from '../../../src/domain/types'
import { fetchLiveCatalog } from '../../../src/data/catalogSource'
import { fetchPlayerProfile, resolveAccountIdsByNickname } from '../../../electron/playerProfileService'

type CatalogLocale = 'ru' | 'en'
const cache = new Map<string, { data: AppDataset; expires: number }>()
const pending = new Map<string, Promise<AppDataset>>()
/** The catalog of one mode, Russian (with the wiki details) or English (tarkov.dev's own English text). */
export function getCatalogSnapshot(mode: RaidMode, locale: CatalogLocale = 'ru'): Promise<AppDataset> {
  const key = `${mode}:${locale}`
  const entry = cache.get(key)
  if (entry && entry.expires > Date.now()) return Promise.resolve(entry.data)
  const existing = pending.get(key)
  if (existing) return existing
  const request = fetchLiveCatalog(mode, locale).then((data) => {
    cache.set(key, { data, expires: Date.now() + 60_000 })
    return data
  }).catch((error) => {
    if (entry) return { ...entry.data, metadata: { ...entry.data.metadata!, source: 'cache' as const } }
    throw error
  }).finally(() => pending.delete(key))
  pending.set(key, request)
  return request
}
/**
 * Non-blocking read for summaries: the last snapshot (even if older than the cache window), or undefined.
 * A missing or stale snapshot starts a background refresh; errors are swallowed (the summary just omits Kappa).
 */
export function peekCatalogSnapshot(mode: RaidMode): AppDataset | undefined {
  const entry = cache.get(`${mode}:ru`)
  if (!entry || entry.expires <= Date.now()) void getCatalogSnapshot(mode).catch(() => undefined)
  return entry?.data
}
export async function resolvePlayer(mode: RaidMode, nickname: string) {
  const matches = await resolveAccountIdsByNickname(mode, nickname, { refresh: true })
  if (!matches.length) throw Object.assign(new Error('Профиль этого режима пока не опубликован в Tarkov.dev'), { status: 404 })
  if (matches.length > 1) throw Object.assign(new Error('Найдено несколько профилей. Требуется идентификатор из журналов игры.'), { status: 409 })
  const snapshot = await fetchPlayerProfile(mode, matches[0])
  if (snapshot.nickname.toLowerCase() !== nickname.toLowerCase()) throw Object.assign(new Error('Индекс ников устарел. Повторите позднее.'), { status: 409 })
  return { accountId: snapshot.accountId, nickname: snapshot.nickname, mode, level: snapshot.level, faction: snapshot.faction, snapshot }
}
