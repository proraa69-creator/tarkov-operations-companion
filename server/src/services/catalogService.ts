import type { AppDataset, RaidMode } from '../../../src/domain/types'
import { fetchLiveCatalog } from '../../../src/data/catalogSource'
import { resolvePlayerByNickname } from '../../../electron/playerProfileService'
import { createCatalogCache, type CatalogLocale } from './catalogCache.js'
import { withCachedItemImages } from './itemImageCache.js'

/** Refresh period, last-good fallback and back-off: services/catalogCache.ts. */
const catalogCache = createCatalogCache(fetchLiveCatalog)

/** The catalog of one mode, Russian (with the wiki details) or English (tarkov.dev's own English text). */
export async function getCatalogSnapshot(mode: RaidMode, locale: CatalogLocale = 'ru'): Promise<AppDataset> {
  return withCachedItemImages(await catalogCache.get(mode, locale))
}
/**
 * Non-blocking read for summaries: the last snapshot (even if older than the cache window), or undefined.
 * A missing or stale snapshot starts a background refresh; errors are swallowed (the summary just omits Kappa).
 */
export function peekCatalogSnapshot(mode: RaidMode): AppDataset | undefined {
  return catalogCache.peek(mode)
}
/**
 * «Привязать ник»: the account id from the player's game logs (sent by the desktop app), tarkov.dev's live search, then
 * the published index; a profile not published yet comes back `pending` and is bound anyway (electron/playerProfileService.ts).
 */
export async function resolvePlayer(mode: RaidMode, nickname: string, accountIdHint?: number) {
  return resolvePlayerByNickname(mode, nickname, accountIdHint)
}
