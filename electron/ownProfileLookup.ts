import type { PlayerProfileSnapshot, RaidMode } from '../src/domain/types.js'
import { normalizePlayerProfile } from '../src/profile/playerProfileNormalizer.js'
import { FALLBACK_PLAYER_LEVELS } from './playerLevels.fallback.js'

/**
 * Tarkov.dev player profiles, asked from the player's own computer and never from our server (owner, 13.10.2026: Cloudflare
 * in front of players.tarkov.dev answers our VPS «403», so no new player got a nickname — «запросы с сервера не делаем, а
 * только с пк пользователя»). Only player profiles: the catalogue and all other game data still go through the server
 * (docs/subscription-protection.md). No Electron imports (tests).
 */
const PROFILE_PATH: Record<RaidMode, string> = { pvp: 'profile', pve: 'pve', seasonal: 'pvp-season' }

export const ownProfileUrl = (mode: RaidMode, accountId: number) => `https://players.tarkov.dev/${PROFILE_PATH[mode]}/${accountId}.json`

export type JsonFetch = (url: string) => Promise<{ status: number; json(): Promise<unknown> }>

/** The profile, or null: not published (404), refused here too (403), limited (429), another account, broken JSON. */
export async function fetchOwnProfile(mode: RaidMode, accountId: number, fetcher: JsonFetch): Promise<PlayerProfileSnapshot | null> {
  if (!Number.isSafeInteger(accountId) || accountId <= 0) return null
  try {
    const response = await fetcher(ownProfileUrl(mode, accountId))
    if (response.status !== 200) return null
    const snapshot = normalizePlayerProfile(await response.json(), FALLBACK_PLAYER_LEVELS)
    return snapshot.accountId === accountId ? snapshot : null
  } catch {
    return null
  }
}

/** A found profile is kept 10 minutes, a missing one 2: the profile page asks every minute, Tarkov.dev updates rarely. */
export const FOUND_TTL_MS = 10 * 60_000
export const MISSING_TTL_MS = 2 * 60_000

export function cachedProfileLookup(fetcher: JsonFetch, now: () => number = Date.now) {
  const cache = new Map<string, { at: number; snapshot: PlayerProfileSnapshot | null }>()
  return async (mode: RaidMode, accountId: number) => {
    const key = `${mode}:${accountId}`
    const kept = cache.get(key)
    if (kept && now() - kept.at < (kept.snapshot ? FOUND_TTL_MS : MISSING_TTL_MS)) return kept.snapshot
    const snapshot = await fetchOwnProfile(mode, accountId, fetcher)
    if (cache.size > 200) cache.clear()
    cache.set(key, { at: now(), snapshot })
    return snapshot
  }
}
