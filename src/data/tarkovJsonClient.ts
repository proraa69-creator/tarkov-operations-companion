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
/** An unchanged catalog is written to the cache again only after this long (its expiry moves on with the entitlement). */
export const CATALOG_REWRITE_MS = 6 * 60 * 60 * 1000
const CONTENT_VERSION = /^[a-f0-9]{40}$/
/** When this session last wrote each catalog to the cache. */
const written = new Map<string, number>()

/**
 * The catalog of a mode. `previous`: the catalog the app shows now (DataProvider). Desktop app: its content version
 * goes along (`v=`, electron/serviceGateway.ts) and while the server's catalog is the same nothing comes back. Then, or
 * when a full answer carries the same version, `previous` itself is returned: nothing is copied, parsed, rewritten to
 * the encrypted cache or re-rendered (the main process used to stringify and encrypt the whole catalog synchronously on
 * every refresh). A failed refresh keeps showing `previous`, marked as from the cache, without reading the cache back.
 */
export async function fetchTarkovCatalog(mode: RaidMode, locale: AppLocale = 'ru', previous?: AppDataset): Promise<AppDataset> {
  const cacheKey = `${CACHE_PREFIX}-${mode}-${locale}`
  const route = dataRoute()
  const shown = previous && isDataset(previous, mode) ? previous : undefined
  try {
    // Players' app: the catalog comes only from our server, for an account with a subscription (402 otherwise).
    if (route === 'gateway') {
      const known = askedVersion(shown)
      const answer = await gatewayRequest('GET', `/v1/catalog/${mode}${locale === 'en' ? '?lang=en' : ''}${known ? `${locale === 'en' ? '&' : '?'}v=${known}` : ''}`)
      if (known && shown && isNotModified(answer)) return shown
      if (!isDataset(answer, mode)) throw new Error('Сервис каталога временно недоступен')
      return await keepCatalog(cacheKey, answer, shown, route)
    }
    // Server first (its shared cache avoids every client hitting tarkov.dev); a server that is not running
    // or answers garbage falls back to the direct fetch below.
    const service = locale !== 'ru' ? undefined
      : window.tarkovDesktop ? await window.tarkovDesktop.serviceRequest('GET', `/v1/catalog/${mode}`).catch(() => null)
        // The phone app asks its server too (https://raidos.app, or the one its QR sign-in brought).
        : usesWebAccount() ? await webServiceRequest('GET', `/v1/catalog/${mode}`).catch(() => null) : undefined
    let dataset: AppDataset
    if (isDataset(service, mode)) dataset = service
    else if (import.meta.env.VITE_COMPANION_API_URL && locale === 'ru') {
      const response = await fetch(`${import.meta.env.VITE_COMPANION_API_URL}/v1/catalog/${mode}`, { signal: AbortSignal.timeout(45_000) })
      if (!response.ok) throw new Error('Сервис каталога временно недоступен')
      dataset = await response.json() as AppDataset
    } else dataset = await fetchLiveCatalog(mode, locale)
    return await keepCatalog(cacheKey, dataset, shown, route)
  } catch (error) {
    // No subscription / device switched off: no cached copy either (the paywall takes over).
    if (error instanceof DataAccessError) throw error
    // The catalog on screen is the newest copy there is (the cache holds the same one): it stays, marked as not fresh.
    if (shown?.metadata) return shown.metadata.source === 'cache' ? shown : { ...shown, metadata: { ...shown.metadata, source: 'cache' } }
    const cached = await readGameCache<AppDataset>(cacheKey, route)
    if (cached) return { ...cached, metadata: { ...cached.metadata!, source: 'cache' } }
    throw error
  }
}

/** The version to ask with: only the desktop bridge understands it, and only for a catalog the server sent (not the cache). */
function askedVersion(shown: AppDataset | undefined) {
  const version = shown?.metadata?.contentVersion
  if (!version || !CONTENT_VERSION.test(version) || shown.metadata?.source === 'cache') return undefined
  return typeof window !== 'undefined' && window.tarkovDesktop?.serviceRequest ? version : undefined
}

function isNotModified(answer: unknown) {
  return Boolean(answer && typeof answer === 'object' && (answer as { notModified?: unknown }).notModified === true)
}

/**
 * A full answer with the version of the catalog on screen is the same catalog: the one on screen stays (same object, no
 * re-render) and the cache is not written again unless the last write is old. Anything else is stored and returned.
 */
async function keepCatalog(cacheKey: string, answer: AppDataset, shown: AppDataset | undefined, route: ReturnType<typeof dataRoute>) {
  const version = answer.metadata?.contentVersion
  const same = Boolean(shown && version && shown.metadata?.contentVersion === version && shown.metadata.source !== 'cache')
  const last = written.get(cacheKey)
  if (!same || last === undefined || Date.now() - last >= CATALOG_REWRITE_MS) {
    await writeGameCache(cacheKey, answer, CATALOG_CACHE_MS, route)
    written.set(cacheKey, Date.now())
  }
  return same ? shown! : answer
}

/** Tests: forget which catalogs were written. */
export function forgetCatalogWrites() {
  written.clear()
}

/** Minimal shape check for a catalog that came from the API server. */
export function isDataset(value: unknown, mode: RaidMode): value is AppDataset {
  if (!value || typeof value !== 'object') return false
  const data = value as Partial<AppDataset>
  return Array.isArray(data.quests) && Array.isArray(data.items) && Array.isArray(data.maps) && Array.isArray(data.markers)
    && Array.isArray(data.hideout) && Array.isArray(data.traders) && data.quests.length > 0 && (!data.metadata || data.metadata.mode === mode)
}
