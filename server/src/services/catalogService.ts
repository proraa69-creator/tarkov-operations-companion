import type { AppDataset, RaidMode } from '../../../src/domain/types'
import { fetchLiveCatalog } from '../../../src/data/catalogSource'
import { fetchPlayerProfile, resolveAccountIdsByNickname } from '../../../electron/playerProfileService'
import { createCatalogCache, type CatalogLocale } from './catalogCache.js'

/** Refresh period, last-good fallback and back-off: services/catalogCache.ts. */
const catalogCache = createCatalogCache(fetchLiveCatalog)

/** The catalog of one mode, Russian (with the wiki details) or English (tarkov.dev's own English text). */
export function getCatalogSnapshot(mode: RaidMode, locale: CatalogLocale = 'ru'): Promise<AppDataset> {
  return catalogCache.get(mode, locale)
}
/**
 * Non-blocking read for summaries: the last snapshot (even if older than the cache window), or undefined.
 * A missing or stale snapshot starts a background refresh; errors are swallowed (the summary just omits Kappa).
 */
export function peekCatalogSnapshot(mode: RaidMode): AppDataset | undefined {
  return catalogCache.peek(mode)
}
export async function resolvePlayer(mode: RaidMode, nickname: string) {
  const matches = await resolveAccountIdsByNickname(mode, nickname, { refresh: true })
  if (!matches.length) throw Object.assign(new Error('Профиль этого режима пока не опубликован в Tarkov.dev'), { status: 404 })
  if (matches.length > 1) throw Object.assign(new Error('Найдено несколько профилей. Требуется идентификатор из журналов игры.'), { status: 409 })
  const snapshot = await fetchPlayerProfile(mode, matches[0])
  if (snapshot.nickname.toLowerCase() !== nickname.toLowerCase()) throw Object.assign(new Error('Индекс ников устарел. Повторите позднее.'), { status: 409 })
  return { accountId: snapshot.accountId, nickname: snapshot.nickname, mode, level: snapshot.level, faction: snapshot.faction, snapshot }
}
