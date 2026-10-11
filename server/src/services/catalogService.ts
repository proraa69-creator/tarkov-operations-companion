import type { AppDataset, RaidMode } from '../../../src/domain/types'
import { fetchLiveCatalog } from '../../../src/data/catalogSource'
import { resolvePlayerByNickname } from '../../../electron/playerProfileService'
import { createCatalogCache, type CatalogLocale } from './catalogCache.js'
import { withCachedItemImages } from './itemImageCache.js'
import type { MirrorStorage } from './mirrorStorage.js'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { PriceSnapshot } from './priceMirror.js'

/** Refresh period, last-good fallback and back-off: services/catalogCache.ts. */
let catalogLoader = fetchLiveCatalog
let mirrorStorage: MirrorStorage | undefined
const catalogCache = createCatalogCache((mode, locale) => catalogLoader(mode, locale))

/** Make the server-owned catalog read tarkov.dev datasets from RaidNVMe instead of the network. */
export function configureCatalogMirror(storage: MirrorStorage) {
  mirrorStorage = storage
  const mirroredFetch: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    if (url.hostname === 'json.tarkov.dev') {
      const match = /^\/(regular|pve|pvp-season)\/([a-z]+(?:_(?:ru|en))?)$/.exec(url.pathname)
      const name = match?.[2]
      const bytes = match && name ? await storage.read(`dataset-${match[1]}`, `${name}.json`) : undefined
      return bytes ? new Response(bytes, { status: 200, headers: { 'content-type': 'application/json' } }) : new Response('', { status: 503 })
    }
    if ((url.hostname === 'raidos.app' && url.pathname === '/v1/map-tiles/maps.json') || (url.hostname === 'raw.githubusercontent.com' && url.pathname.endsWith('/src/data/maps.json'))) {
      const bytes = await readFile(join(storage.root, 'maps.json')).catch(() => undefined)
      return bytes ? new Response(bytes, { status: 200, headers: { 'content-type': 'application/json' } }) : new Response('', { status: 503 })
    }
    return fetch(input, init)
  }
  catalogLoader = (mode, locale) => fetchLiveCatalog(mode, locale, mirroredFetch)
}

async function withMirroredPrices(catalog: AppDataset, mode: RaidMode) {
  if (!mirrorStorage) return catalog
  const upstream = mode === 'pve' ? 'pve' : mode === 'seasonal' ? 'pvp-season' : 'regular'
  const bytes = await mirrorStorage.read(`prices-${upstream}`, 'prices.json')
  if (!bytes) return catalog
  try {
    const snapshot = JSON.parse(bytes.toString('utf8')) as PriceSnapshot
    if (snapshot.mode !== upstream) return catalog
    return {
      ...catalog,
      items: catalog.items.map((item) => {
        const price = snapshot.items[item.id]
        const fleaPrice = price?.lastLowPrice ?? price?.avg24hPrice
        return price ? { ...item, fleaPrice, fleaPriceBasis: price.lastLowPrice ? 'last-low' as const : fleaPrice ? 'avg-24h' as const : undefined } : item
      }),
      metadata: { ...catalog.metadata!, fleaMarket: { enabled: snapshot.fleaMarket.enabled, offerFeeRate: snapshot.fleaMarket.sellOfferFeeRate, requirementFeeRate: snapshot.fleaMarket.sellRequirementFeeRate } },
    }
  } catch { return catalog }
}

/** The catalog of one mode, Russian (with the wiki details) or English (tarkov.dev's own English text). */
export async function getCatalogSnapshot(mode: RaidMode, locale: CatalogLocale = 'ru'): Promise<AppDataset> {
  return withCachedItemImages(await withMirroredPrices(await catalogCache.get(mode, locale), mode))
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
