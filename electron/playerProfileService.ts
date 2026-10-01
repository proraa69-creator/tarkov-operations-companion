import type { PlayerProfileSnapshot, RaidMode } from '../src/domain/types.js'
import { normalizePlayerProfile, type PlayerLevelRow } from '../src/profile/playerProfileNormalizer.js'
import { FALLBACK_PLAYER_LEVELS } from './playerLevels.fallback.js'

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

const PROFILE_TIMEOUT_MS = 45_000
const INDEX_TIMEOUT_MS = 120_000
const LEVELS_TIMEOUT_MS = 90_000
const CACHE_TTL = 60_000
const LEVEL_CACHE_TTL = 6 * 60 * 60_000
const INDEX_CACHE_TTL = 30 * 60_000
const USER_AGENT = 'Raid OS/0.1 (+local desktop companion)'

type Cached<T> = { value: T; expiresAt: number }
const profileCache = new Map<string, Cached<PlayerProfileSnapshot>>()
const levelCache = new Map<RaidMode, Cached<PlayerLevelRow[]>>()
const indexCache = new Map<RaidMode, Cached<Map<string, number[]>>>()
const indexInFlight = new Map<RaidMode, Promise<Map<string, number[]>>>()
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

export async function resolveAccountIdsByNickname(mode: RaidMode, nickname: string, options?: { refresh?: boolean }): Promise<number[]> {
  const normalized = nickname.trim().toLowerCase()
  if (!normalized) return []

  const cached = indexCache.get(mode)
  if (!options?.refresh && cached && cached.expiresAt > Date.now()) {
    return cached.value.get(normalized) ?? []
  }

  if (cached && cached.expiresAt > Date.now()) {
    const hit = cached.value.get(normalized) ?? []
    if (hit.length) return hit
  }

  const index = await fetchPlayerIndex(mode, Boolean(options?.refresh))
  return index.get(normalized) ?? []
}

export function clearPlayerProfileCache(mode?: RaidMode) {
  if (mode) {
    for (const key of [...profileCache.keys()]) {
      if (key.startsWith(`${mode}:`)) profileCache.delete(key)
    }
    levelCache.delete(mode)
    indexCache.delete(mode)
    indexInFlight.delete(mode)
    for (const key of [...inFlight.keys()]) {
      if (key.startsWith(`${mode}:`)) inFlight.delete(key)
    }
    return
  }
  profileCache.clear()
  levelCache.clear()
  indexCache.clear()
  indexInFlight.clear()
  inFlight.clear()
}

export function clearPlayerSnapshotCache(mode: RaidMode, accountIds?: number[]) {
  if (!accountIds?.length) {
    for (const key of [...profileCache.keys()]) {
      if (key.startsWith(`${mode}:`)) profileCache.delete(key)
    }
    return
  }
  for (const accountId of accountIds) profileCache.delete(`${mode}:${accountId}`)
}

async function fetchAndNormalize(mode: RaidMode, accountId: number) {
  const [profile, levels] = await Promise.all([
    fetchJson(`https://players.tarkov.dev/${PROFILE_PATH[mode]}/${accountId}.json`, PROFILE_TIMEOUT_MS),
    fetchPlayerLevels(mode),
  ])
  const snapshot = normalizePlayerProfile(profile, levels)
  profileCache.set(`${mode}:${accountId}`, { value: snapshot, expiresAt: Date.now() + CACHE_TTL })
  return snapshot
}

async function fetchPlayerLevels(mode: RaidMode) {
  const cached = levelCache.get(mode)
  if (cached && cached.expiresAt > Date.now()) return cached.value

  // Local table is enough for level math; avoid blocking resolve on the 17MB items dump.
  levelCache.set(mode, { value: FALLBACK_PLAYER_LEVELS, expiresAt: Date.now() + LEVEL_CACHE_TTL })
  void refreshPlayerLevelsFromNetwork(mode)
  return FALLBACK_PLAYER_LEVELS
}

async function refreshPlayerLevelsFromNetwork(mode: RaidMode) {
  try {
    const envelope = await fetchJson(`https://json.tarkov.dev/${UPSTREAM_MODE[mode]}/items`, LEVELS_TIMEOUT_MS) as { data?: { playerLevels?: PlayerLevelRow[] } }
    const levels = Array.isArray(envelope.data?.playerLevels) ? envelope.data.playerLevels : []
    if (!levels.length) return
    levelCache.set(mode, { value: levels, expiresAt: Date.now() + LEVEL_CACHE_TTL })
  } catch {
    // Keep fallback table.
  }
}

async function fetchPlayerIndex(mode: RaidMode, force = false) {
  if (!force) {
    const cached = indexCache.get(mode)
    if (cached && cached.expiresAt > Date.now()) return cached.value
    const pending = indexInFlight.get(mode)
    if (pending) return pending
  }

  const request = (async () => {
    const text = await fetchText(`https://players.tarkov.dev/${PROFILE_PATH[mode]}/index.json`, INDEX_TIMEOUT_MS)
    const byNickname = parseIndexText(text)
    indexCache.set(mode, { value: byNickname, expiresAt: Date.now() + INDEX_CACHE_TTL })
    return byNickname
  })().finally(() => indexInFlight.delete(mode))

  indexInFlight.set(mode, request)
  return request
}

function parseIndexText(text: string) {
  const byNickname = new Map<string, number[]>()
  // index.json is { "aid": "Nickname", ... } — avoid a second full JSON.parse when possible.
  const re = /"(\d+)"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/g
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    const accountId = Number(match[1])
    const nickname = match[2].replace(/\\"/g, '"').trim().toLowerCase()
    if (!nickname || !Number.isSafeInteger(accountId) || accountId <= 0) continue
    const list = byNickname.get(nickname) ?? []
    list.push(accountId)
    byNickname.set(nickname, list)
  }
  if (!byNickname.size) {
    const payload = JSON.parse(text) as Record<string, unknown>
    for (const [accountIdRaw, nicknameRaw] of Object.entries(payload)) {
      const accountId = Number(accountIdRaw)
      const nickname = typeof nicknameRaw === 'string' ? nicknameRaw.trim().toLowerCase() : ''
      if (!nickname || !Number.isSafeInteger(accountId) || accountId <= 0) continue
      const list = byNickname.get(nickname) ?? []
      list.push(accountId)
      byNickname.set(nickname, list)
    }
  }
  return byNickname
}

async function fetchJson(url: string, timeoutMs: number): Promise<unknown> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: 'application/json', 'user-agent': USER_AGENT },
    })
    if (response.status === 404) throw new Error('Tarkov.dev пока не опубликовал профиль этого режима. Повторите позже или закройте окно крестиком и выберите другой режим.')
    if (response.status === 429) throw new Error('Tarkov.dev временно ограничил запросы. Повторите через минуту.')
    if (!response.ok) throw new Error(`Tarkov.dev недоступен: HTTP ${response.status}`)
    return response.json()
  } catch (error) {
    throw humanizeNetworkError(error)
  }
}

async function fetchText(url: string, timeoutMs: number): Promise<string> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: 'application/json', 'user-agent': USER_AGENT },
    })
    if (response.status === 404) throw new Error('Tarkov.dev пока не опубликовал индекс этого режима. Повторите позже.')
    if (response.status === 429) throw new Error('Tarkov.dev временно ограничил запросы. Повторите через минуту.')
    if (!response.ok) throw new Error(`Tarkov.dev недоступен: HTTP ${response.status}`)
    return response.text()
  } catch (error) {
    throw humanizeNetworkError(error)
  }
}

export function humanizeNetworkError(error: unknown): Error {
  if (!(error instanceof Error)) return new Error('Не удалось связаться с Tarkov.dev')
  const name = error.name
  const message = error.message
  if (name === 'TimeoutError' || /aborted due to timeout|The operation was aborted/i.test(message)) {
    return new Error('Tarkov.dev отвечает слишком долго (индекс профилей большой). Проверьте интернет и нажмите «Найти профиль» ещё раз.')
  }
  if (name === 'AbortError') {
    return new Error('Запрос к Tarkov.dev прерван. Повторите поиск профиля.')
  }
  return error
}
