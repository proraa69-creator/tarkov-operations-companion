import type { PlayerProfileSnapshot, RaidMode } from '../src/domain/types.js'
import { normalizePlayerProfile, type PlayerLevelRow } from '../src/profile/playerProfileNormalizer.js'

const UPSTREAM_MODE: Record<RaidMode, 'regular' | 'pve' | 'pvp-season'> = {
  pvp: 'regular',
  pve: 'pve',
  seasonal: 'pvp-season',
}

const PROFILE_PATH: Record<RaidMode, 'profile' | 'pve' | 'pvp-season'> = {
  pvp: 'profile',
  pve: 'pve',
  seasonal: 'pvp-season',
}
const CACHE_TTL = 60_000
const LEVEL_CACHE_TTL = 6 * 60 * 60_000
const USER_AGENT = 'Tarkov Operations Companion/0.1 (+local desktop companion)'

type Cached<T> = { value: T; expiresAt: number }
const profileCache = new Map<string, Cached<PlayerProfileSnapshot>>()
const levelCache = new Map<RaidMode, Cached<PlayerLevelRow[]>>()
const inFlight = new Map<string, Promise<PlayerProfileSnapshot>>()

export async function fetchPlayerProfile(mode: RaidMode, accountId: number): Promise<PlayerProfileSnapshot> {
  if (!Number.isSafeInteger(accountId) || accountId <= 0) throw new Error('Некорректный Tarkov ID')
  const key = `${mode}:${accountId}`
  const cached = profileCache.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.value
  const pending = inFlight.get(key)
  if (pending) return pending
  const request = fetchAndNormalize(mode, accountId).finally(() => inFlight.delete(key))
  inFlight.set(key, request)
  return request
}

export function clearPlayerProfileCache() {
  profileCache.clear()
  levelCache.clear()
  inFlight.clear()
}

async function fetchAndNormalize(mode: RaidMode, accountId: number) {
  const [profile, levels] = await Promise.all([
    fetchJson(`https://players.tarkov.dev/${PROFILE_PATH[mode]}/${accountId}.json`),
    fetchPlayerLevels(mode),
  ])
  const snapshot = normalizePlayerProfile(profile, levels)
  profileCache.set(`${mode}:${accountId}`, { value: snapshot, expiresAt: Date.now() + CACHE_TTL })
  return snapshot
}

async function fetchPlayerLevels(mode: RaidMode) {
  const cached = levelCache.get(mode)
  if (cached && cached.expiresAt > Date.now()) return cached.value
  const envelope = await fetchJson(`https://json.tarkov.dev/${UPSTREAM_MODE[mode]}/items`) as { data?: { playerLevels?: PlayerLevelRow[] } }
  const levels = Array.isArray(envelope.data?.playerLevels) ? envelope.data.playerLevels : []
  if (!levels.length) throw new Error('Tarkov.dev не вернул таблицу уровней')
  levelCache.set(mode, { value: levels, expiresAt: Date.now() + LEVEL_CACHE_TTL })
  return levels
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { accept: 'application/json', 'user-agent': USER_AGENT } })
  if (response.status === 404) throw new Error('Профиль не найден. Откройте его на Tarkov.dev и повторите синхронизацию.')
  if (response.status === 429) throw new Error('Tarkov.dev временно ограничил запросы. Повторите через минуту.')
  if (!response.ok) throw new Error(`Tarkov.dev недоступен: HTTP ${response.status}`)
  return response.json()
}
