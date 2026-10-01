/**
 * Local cache of the game data (catalog, translations, gateway answers), docs/subscription-protection.md.
 *
 * - Players' desktop app (data through the gateway): the main process keeps it encrypted with safeStorage, with an
 *   expiry tied to the signed entitlement (electron/gameDataCache.ts). Nothing readable is written by the page.
 * - Phone app / browser of the players' edition: in memory plus IndexedDB (the WebView's private storage), every entry
 *   with an expiry no later than the entitlement's; without a valid entitlement nothing is read back.
 * - Owner's app and development: IndexedDB as before (no expiry).
 *
 * Old plaintext caches from earlier versions are removed at start in the players' edition (`purgeLegacyPlaintextCaches`).
 */
import { del, get, keys, set } from 'idb-keyval'
import { dataRoute, type DataRoute } from './tarkovApi'
import { webEntitlementExpiry } from '../sync/webEntitlement'

const WEB_PREFIX = 'raidos-gdc-v1:'
/** IndexedDB may be missing or throw at once (private mode, tests): never let the cache break a data load. */
async function safely<T>(run: () => Promise<T>): Promise<T | undefined> {
  try { return await run() } catch { return undefined }
}
const memory = new Map<string, { exp: number; value: unknown }>()

interface WebEntry { exp: number; value: unknown }

export async function readGameCache<T>(key: string, route: DataRoute = dataRoute()): Promise<T | undefined> {
  if (route === 'direct') return await safely(() => get<T>(key))
  const desktop = typeof window !== 'undefined' ? window.tarkovDesktop : undefined
  if (desktop) {
    const text = await desktop.dataCache?.get(key).catch(() => null)
    if (!text) return undefined
    try { return JSON.parse(text) as T } catch { return undefined }
  }
  const limit = webEntitlementExpiry()
  const now = Date.now()
  if (!limit || limit <= now) return undefined
  const cached = memory.get(key) ?? await safely(() => get<WebEntry>(`${WEB_PREFIX}${key}`))
  if (!cached || cached.exp <= now) {
    memory.delete(key)
    await safely(() => del(`${WEB_PREFIX}${key}`))
    return undefined
  }
  return cached.value as T
}

export async function writeGameCache(key: string, value: unknown, maxAgeMs: number, route: DataRoute = dataRoute()): Promise<void> {
  if (route === 'direct') { await safely(() => set(key, value)); return }
  const desktop = typeof window !== 'undefined' ? window.tarkovDesktop : undefined
  if (desktop) { await desktop.dataCache?.set(key, JSON.stringify(value), maxAgeMs).catch(() => false); return }
  const limit = webEntitlementExpiry()
  const exp = Math.min(Date.now() + maxAgeMs, limit ?? 0)
  if (exp <= Date.now()) return
  const entry: WebEntry = { exp, value }
  memory.set(key, entry)
  await safely(() => set(`${WEB_PREFIX}${key}`, entry))
}

/** IndexedDB / localStorage keys of the plaintext caches older versions (and the owner's app) write. */
export const LEGACY_PLAINTEXT_CACHE = /^(?:tarkov-operations-catalog-|display-translations-|item-lookup-names-|tarkov-operations-economy-|raid-os-gun-catalog-)/
const LEGACY_LOCAL_STORAGE = ['toc.bosses.graphql.v1', 'toc.bosses.graphql.v2']

/** Players' edition: no readable quest / catalog JSON left on disk from earlier versions. */
export async function purgeLegacyPlaintextCaches(route: DataRoute = dataRoute()) {
  if (route !== 'gateway') return 0
  let removed = 0
  try {
    for (const key of await keys()) {
      if (typeof key === 'string' && LEGACY_PLAINTEXT_CACHE.test(key)) { await del(key); removed += 1 }
    }
  } catch { /* IndexedDB unavailable */ }
  for (const key of LEGACY_LOCAL_STORAGE) {
    try { if (localStorage.getItem(key) !== null) { localStorage.removeItem(key); removed += 1 } } catch { /* storage unavailable */ }
  }
  return removed
}
