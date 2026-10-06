import type { AppDataset, RaidMode } from '../../../src/domain/types'

export type CatalogLocale = 'ru' | 'en'

/** A served snapshot older than this is refreshed in the background (the players' apps poll every minute). */
export const CATALOG_FRESH_MS = 60_000
/** Older than this, a request waits for the refresh instead of getting the old copy at once (unless tarkov.dev is down). */
export const CATALOG_MAX_STALE_MS = 15 * 60_000
/** After failed refreshes in a row: 1, 2, 5, then 15 minutes before tarkov.dev is asked again (the last good copy is served meanwhile). */
export const CATALOG_RETRY_MS = [60_000, 2 * 60_000, 5 * 60_000, 15 * 60_000]

interface CacheEntry { data: AppDataset; loadedAt: number; failures: number; retryAt: number }

/**
 * A fetched catalog is accepted only with quests, maps and items: an empty or cut answer from tarkov.dev must not replace
 * the last good snapshot (the players would lose their quests until the next refresh).
 */
export function isUsableCatalog(data: AppDataset | undefined): data is AppDataset {
  return Boolean(data && data.quests?.length && data.maps?.length && data.items?.length && Array.isArray(data.markers))
}

/**
 * The server's catalog cache, one entry per game mode and language (PvP, PvE and Season are never mixed: the mode is
 * part of the key, and an answer labelled with another mode is refused).
 * - fresh (< CATALOG_FRESH_MS): served as is;
 * - older: the last good snapshot is served at once and refreshed in the background, so new quests and map markers reach
 *   the players within about a minute without an app update, and nobody waits for tarkov.dev;
 * - very old (> CATALOG_MAX_STALE_MS, e.g. after a quiet night): the request waits for the refresh;
 * - tarkov.dev down or answering an empty catalog: the last good snapshot stays (marked `source: 'cache'`), retried
 *   with back-off;
 * - nothing loaded yet: the request waits for tarkov.dev (and fails with it).
 */
export function createCatalogCache(load: (mode: RaidMode, locale: CatalogLocale) => Promise<AppDataset>, now: () => number = Date.now) {
  const cache = new Map<string, CacheEntry>()
  const pending = new Map<string, Promise<AppDataset>>()
  const served = (entry: CacheEntry): AppDataset => entry.failures > 0 ? { ...entry.data, metadata: { ...entry.data.metadata!, source: 'cache' as const } } : entry.data

  const refresh = (mode: RaidMode, locale: CatalogLocale, key: string): Promise<AppDataset> => {
    const running = pending.get(key)
    if (running) return running
    const request = load(mode, locale).then((data) => {
      if (!isUsableCatalog(data)) throw new Error('Источник данных вернул пустой каталог')
      if (data.metadata?.mode && data.metadata.mode !== mode) throw new Error('Источник данных вернул каталог другого режима')
      cache.set(key, { data, loadedAt: now(), failures: 0, retryAt: 0 })
      return data
    }).catch((error: unknown) => {
      const entry = cache.get(key)
      if (!entry) throw error
      entry.failures += 1
      entry.retryAt = now() + CATALOG_RETRY_MS[Math.min(entry.failures, CATALOG_RETRY_MS.length) - 1]
      return served(entry)
    }).finally(() => pending.delete(key))
    pending.set(key, request)
    return request
  }

  const get = (mode: RaidMode, locale: CatalogLocale = 'ru'): Promise<AppDataset> => {
    const key = `${mode}:${locale}`
    const entry = cache.get(key)
    if (!entry) return refresh(mode, locale, key)
    const age = now() - entry.loadedAt
    if (age < CATALOG_FRESH_MS) return Promise.resolve(entry.data)
    if (entry.failures > 0 && now() < entry.retryAt) return Promise.resolve(served(entry))
    const update = refresh(mode, locale, key)
    if (age > CATALOG_MAX_STALE_MS && entry.failures === 0) return update
    void update.catch(() => undefined)
    return Promise.resolve(served(entry))
  }

  return {
    get,
    /** The last snapshot (any age) without waiting; a missing or old one starts a background refresh. */
    peek(mode: RaidMode, locale: CatalogLocale = 'ru'): AppDataset | undefined {
      const entry = cache.get(`${mode}:${locale}`)
      if (!entry || now() - entry.loadedAt >= CATALOG_FRESH_MS) void get(mode, locale).catch(() => undefined)
      return entry?.data
    },
  }
}
