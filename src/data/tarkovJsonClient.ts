import type { AppDataset, RaidMode } from '../domain/types'
import { fetchLiveCatalog } from './catalogSource'
import type { AppLocale } from '../i18n/LocaleProvider'
import { usesWebAccount } from '../sync/serverSync'
import { webServiceRequest } from '../sync/webAccount'
import { DataAccessError, dataRoute, gatewayRequest } from './tarkovApi'
import { readGameCache, writeGameCache } from './gameDataCache'

const CACHE_PREFIX = 'tarkov-operations-catalog-v11'
/** How long a cached catalog may be shown offline (and never longer than the signed entitlement in the players' app). */
export const CATALOG_CACHE_MS = 3 * 24 * 60 * 60 * 1000

export async function fetchTarkovCatalog(mode: RaidMode, locale: AppLocale = 'ru'): Promise<AppDataset> {
  const cacheKey = `${CACHE_PREFIX}-${mode}-${locale}`
  const route = dataRoute()
  try {
    // Players' app: the catalog comes only from our server, for an account with a subscription (402 otherwise).
    if (route === 'gateway') {
      const answer = await gatewayRequest('GET', `/v1/catalog/${mode}${locale === 'en' ? '?lang=en' : ''}`)
      if (!isDataset(answer, mode)) throw new Error('Сервис каталога временно недоступен')
      await writeGameCache(cacheKey, answer, CATALOG_CACHE_MS, route)
      return answer
    }
    // Server first (its shared cache avoids every client hitting tarkov.dev); a server that is not running
    // or answers garbage falls back to the direct fetch below.
    const service = locale !== 'ru' ? undefined
      : window.tarkovDesktop ? await window.tarkovDesktop.serviceRequest('GET', `/v1/catalog/${mode}`).catch(() => null)
        // The phone app asks the configured server too (Settings → «Адрес сервера»).
        : usesWebAccount() ? await webServiceRequest('GET', `/v1/catalog/${mode}`).catch(() => null) : undefined
    let dataset: AppDataset
    if (isDataset(service, mode)) dataset = service
    else if (import.meta.env.VITE_COMPANION_API_URL && locale === 'ru') {
      const response = await fetch(`${import.meta.env.VITE_COMPANION_API_URL}/v1/catalog/${mode}`, { signal: AbortSignal.timeout(45_000) })
      if (!response.ok) throw new Error('Сервис каталога временно недоступен')
      dataset = await response.json() as AppDataset
    } else dataset = await fetchLiveCatalog(mode, locale)
    await writeGameCache(cacheKey, dataset, CATALOG_CACHE_MS, route)
    return dataset
  } catch (error) {
    // No subscription / device switched off: no cached copy either (the paywall takes over).
    if (error instanceof DataAccessError) throw error
    const cached = await readGameCache<AppDataset>(cacheKey, route)
    if (cached) return { ...cached, metadata: { ...cached.metadata!, source: 'cache' } }
    throw error
  }
}

/** Minimal shape check for a catalog that came from the API server. */
export function isDataset(value: unknown, mode: RaidMode): value is AppDataset {
  if (!value || typeof value !== 'object') return false
  const data = value as Partial<AppDataset>
  return Array.isArray(data.quests) && Array.isArray(data.items) && Array.isArray(data.maps) && Array.isArray(data.markers)
    && Array.isArray(data.hideout) && Array.isArray(data.traders) && data.quests.length > 0 && (!data.metadata || data.metadata.mode === mode)
}
