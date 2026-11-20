import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { RaidMode } from '../domain/types'
import type { AppLocale } from '../i18n/LocaleProvider'
import { readGameCache, writeGameCache } from '../data/gameDataCache'
import { adaptAmmo, adaptMods, adaptWeapons } from './gunQueries'
import { loadTarkovItemsDataset } from '../data/tarkovDataset'
import { buildLegacyAmmo, buildLegacyItems } from '../data/tarkovJsonAdapters'
import type { AmmoStats, GunCatalog, GunPart, Weapon } from './gunTypes'
import { applyPatchFixes } from './patchFixes'

const CACHE_PREFIX = 'raid-os-gun-catalog-v2'
/** A cached catalogue younger than this is used without asking tarkov.dev (the mod list is several MB). */
const FRESH_MS = 30 * 60_000
/** Offline copy of the builder catalogue (never past the entitlement in the players' app). */
const GUN_CACHE_MS = 3 * 24 * 60 * 60 * 1000

/** tarkov.dev GraphQL knows regular and pve; the Season shares the regular market (separate cache key all the same). */
export const graphqlGameMode = (mode: RaidMode) => mode === 'pve' ? 'pve' : 'regular'

interface CachedCatalog {
  savedAt: number
  weapons: Weapon[]
  mods: GunPart[]
  ammo: AmmoStats[]
  loadedAt: string
}

/** Live guns + mods + ammo for one mode and language. */
export async function fetchLiveGunCatalog(mode: RaidMode, locale: AppLocale): Promise<GunCatalog> {
  const bundle = await loadTarkovItemsDataset(mode, locale)
  const items = buildLegacyItems(bundle)
  const payload = { data: { items } }
  const weapons = adaptWeapons(payload)
  if (!weapons.length) throw new Error('Сервер данных: нет оружия в ответе')
  return { weapons, mods: adaptMods(payload), ammo: adaptAmmo({ data: { ammo: buildLegacyAmmo(bundle, items) } }), loadedAt: new Date().toISOString(), source: 'live' }
}

const fromCache = (cached: CachedCatalog, source: GunCatalog['source']): GunCatalog => ({
  weapons: cached.weapons, mods: new Map(cached.mods.map((part) => [part.id, part])), ammo: cached.ammo, loadedAt: cached.loadedAt, source,
})

/**
 * Like the main catalogue (src/data/tarkovJsonClient.ts): live first, IndexedDB cache when tarkov.dev is unreachable.
 * In addition a fresh cache (< 30 min) is used directly, so reopening the builder does not download the mods again.
 * An older cache opens the page at once too when `onNewer` is given (owner, 15.11.2026: «очень долго загружается сборка
 * оружия» — the page waited for the whole items file, ~20 MB, whenever its copy was over half an hour old): the new
 * catalogue is loaded behind it and handed to `onNewer`. The flea prices on the page are this minute's either way
 * (src/arsenal/liveGunPrices.ts).
 */
export async function fetchGunCatalog(mode: RaidMode, locale: AppLocale, onNewer?: (catalog: GunCatalog) => void): Promise<GunCatalog> {
  // Patch fixes go on top of tarkov.dev's data (src/arsenal/patchFixes.ts); the cache keeps tarkov.dev's own values.
  const fixed = (catalog: GunCatalog): GunCatalog => ({ ...catalog, mods: applyPatchFixes(catalog.mods) })
  return fixed(await loadGunCatalog(mode, locale, onNewer && ((catalog) => onNewer(fixed(catalog)))))
}

async function loadGunCatalog(mode: RaidMode, locale: AppLocale, onNewer?: (catalog: GunCatalog) => void): Promise<GunCatalog> {
  const key = `${CACHE_PREFIX}-${mode}-${locale}`
  const cached = await readGameCache<CachedCatalog>(key)
  if (cached && Date.now() - cached.savedAt < FRESH_MS) return fromCache(cached, 'cache')
  const live = async () => {
    const catalog = await fetchLiveGunCatalog(mode, locale)
    await writeGameCache(key, { savedAt: Date.now(), weapons: catalog.weapons, mods: [...catalog.mods.values()], ammo: catalog.ammo, loadedAt: catalog.loadedAt } satisfies CachedCatalog, GUN_CACHE_MS)
    return catalog
  }
  if (cached && onNewer) {
    // With tarkov.dev unreachable the cached copy simply stays, as it would without onNewer.
    live().then((newer) => onNewer(newer)).catch(() => undefined)
    return fromCache(cached, 'cache')
  }
  try {
    return await live()
  } catch (error) {
    if (cached) return fromCache(cached, 'cache')
    throw error
  }
}

/** Loaded only by the builder page (lazy): nothing is fetched until it is opened. */
/** `enabled`: false keeps it from loading (the tier list loads it on its «Оружие» tab only). */
export function useGunCatalog(mode: RaidMode, locale: AppLocale, enabled = true) {
  const client = useQueryClient()
  const queryKey = ['gun-builder-catalog', mode, locale]
  return useQuery({
    queryKey,
    queryFn: () => fetchGunCatalog(mode, locale, (newer) => client.setQueryData(queryKey, newer)),
    staleTime: FRESH_MS,
    gcTime: 1000 * 60 * 60,
    // a busy server (429 / 503 while it prepares the data) gets two more tries, 1 s and 2 s later
    retry: 2,
    refetchOnWindowFocus: false,
    enabled,
  })
}
