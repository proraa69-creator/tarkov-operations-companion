import { get, set } from 'idb-keyval'
import { useQuery } from '@tanstack/react-query'
import type { RaidMode } from '../domain/types'
import type { AppLocale } from '../i18n/LocaleProvider'
import { adaptAmmo, adaptMods, adaptWeapons, AMMO_QUERY, GUNS_QUERY, MODS_QUERY } from './gunQueries'
import type { AmmoStats, GunCatalog, GunPart, Weapon } from './gunTypes'

const GRAPHQL_URL = 'https://api.tarkov.dev/graphql'
const CACHE_PREFIX = 'raid-os-gun-catalog-v1'
/** A cached catalogue younger than this is used without asking tarkov.dev (the mod list is several MB). */
const FRESH_MS = 30 * 60_000
const REQUEST_TIMEOUT = 60_000

/** tarkov.dev GraphQL knows regular and pve; the Season shares the regular market (separate cache key all the same). */
export const graphqlGameMode = (mode: RaidMode) => mode === 'pve' ? 'pve' : 'regular'

interface CachedCatalog {
  savedAt: number
  weapons: Weapon[]
  mods: GunPart[]
  ammo: AmmoStats[]
  loadedAt: string
}

async function graphql(query: string, variables: Record<string, string>) {
  const response = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT),
  })
  if (!response.ok) throw new Error(`tarkov.dev GraphQL: HTTP ${response.status}`)
  const payload = await response.json() as { errors?: Array<{ message?: string }> }
  if (payload.errors?.length && !(payload as { data?: unknown }).data) throw new Error(payload.errors[0]?.message ?? 'GraphQL error')
  return payload
}

/** Live guns + mods + ammo for one mode and language. */
export async function fetchLiveGunCatalog(mode: RaidMode, locale: AppLocale): Promise<GunCatalog> {
  const variables = { lang: locale, gameMode: graphqlGameMode(mode) }
  const [guns, mods, ammo] = await Promise.all([
    graphql(GUNS_QUERY, variables),
    graphql(MODS_QUERY, variables),
    graphql(AMMO_QUERY, variables).catch(() => ({ data: { ammo: [] } })),
  ])
  const weapons = adaptWeapons(guns)
  if (!weapons.length) throw new Error('tarkov.dev: no weapons in the answer')
  return { weapons, mods: adaptMods(mods), ammo: adaptAmmo(ammo), loadedAt: new Date().toISOString(), source: 'live' }
}

const fromCache = (cached: CachedCatalog, source: GunCatalog['source']): GunCatalog => ({
  weapons: cached.weapons, mods: new Map(cached.mods.map((part) => [part.id, part])), ammo: cached.ammo, loadedAt: cached.loadedAt, source,
})

/**
 * Like the main catalogue (src/data/tarkovJsonClient.ts): live first, IndexedDB cache when tarkov.dev is unreachable.
 * In addition a fresh cache (< 30 min) is used directly, so reopening the builder does not download the mods again.
 */
export async function fetchGunCatalog(mode: RaidMode, locale: AppLocale): Promise<GunCatalog> {
  const key = `${CACHE_PREFIX}-${mode}-${locale}`
  const cached = await get<CachedCatalog>(key).catch(() => undefined)
  if (cached && Date.now() - cached.savedAt < FRESH_MS) return fromCache(cached, 'cache')
  try {
    const live = await fetchLiveGunCatalog(mode, locale)
    await set(key, { savedAt: Date.now(), weapons: live.weapons, mods: [...live.mods.values()], ammo: live.ammo, loadedAt: live.loadedAt } satisfies CachedCatalog).catch(() => {})
    return live
  } catch (error) {
    if (cached) return fromCache(cached, 'cache')
    throw error
  }
}

/** Loaded only by the builder page (lazy): nothing is fetched until it is opened. */
export function useGunCatalog(mode: RaidMode, locale: AppLocale) {
  return useQuery({
    queryKey: ['gun-builder-catalog', mode, locale],
    queryFn: () => fetchGunCatalog(mode, locale),
    staleTime: FRESH_MS,
    gcTime: 1000 * 60 * 60,
    retry: 1,
    refetchOnWindowFocus: false,
  })
}
