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
/** A forced index refresh (the ~70 MB file) runs at most this often, however many players bind at once. */
const INDEX_REFRESH_MIN_AGE = 5 * 60_000
const LIVE_SEARCH_TIMEOUT_MS = 8_000
const LIVE_SEARCH_TTL = 60_000
const USER_AGENT = 'Raid OS/0.1 (+local desktop companion)'

type Cached<T> = { value: T; expiresAt: number }
const profileCache = new Map<string, Cached<PlayerProfileSnapshot>>()
const levelCache = new Map<RaidMode, Cached<PlayerLevelRow[]>>()
const indexCache = new Map<RaidMode, Cached<Map<string, number[]>>>()
const liveSearchCache = new Map<string, Cached<number[] | null>>()
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

  // A fresh index (younger than INDEX_REFRESH_MIN_AGE) is not downloaded again: tarkov.dev republishes it rarely.
  const fresh = cached && cached.expiresAt - INDEX_CACHE_TTL + INDEX_REFRESH_MIN_AGE > Date.now()
  const index = await fetchPlayerIndex(mode, Boolean(options?.refresh) && !fresh)
  return index.get(normalized) ?? []
}

/**
 * tarkov.dev's live name search (player.tarkov.dev/name/…, the one the tarkov.dev website uses): it asks the game's
 * servers, so a new character or a renamed one is found at once, while the published index lags behind. The website
 * sends a Cloudflare Turnstile token with it; we send none and never try to get one — if the service asks for it
 * (401/403), limits us (429) or is down, this answers null and the published index is used instead.
 */
export async function searchLiveNickname(mode: RaidMode, nickname: string): Promise<number[] | null> {
  const wanted = nickname.trim().toLowerCase()
  if (!/^[a-z0-9_-]{3,15}$/.test(wanted)) return null
  const key = `${mode}:${wanted}`
  const cached = liveSearchCache.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.value
  let value: number[] | null = null
  try {
    const response = await fetch(`https://player.tarkov.dev/name/${encodeURIComponent(wanted)}?gameMode=${UPSTREAM_MODE[mode]}`, {
      signal: AbortSignal.timeout(LIVE_SEARCH_TIMEOUT_MS),
      headers: { accept: 'application/json', 'user-agent': USER_AGENT },
    })
    if (response.ok) {
      const rows = await response.json() as unknown
      if (Array.isArray(rows)) {
        value = rows
          .filter((row): row is { aid: unknown; name: unknown } => Boolean(row) && typeof row === 'object')
          .filter((row) => typeof row.name === 'string' && row.name.toLowerCase() === wanted)
          .map((row) => Number(row.aid))
          .filter((aid) => Number.isSafeInteger(aid) && aid > 0)
      }
    }
  } catch {
    value = null
  }
  if (liveSearchCache.size > 500) liveSearchCache.clear()
  liveSearchCache.set(key, { value, expiresAt: Date.now() + LIVE_SEARCH_TTL })
  return value
}

export interface ResolvedPlayer {
  accountId: number
  nickname: string
  level: number
  faction: PlayerProfileSnapshot['faction']
  mode: RaidMode
  snapshot?: PlayerProfileSnapshot
  /**
   * The account is known (game logs or tarkov.dev's live search) but its profile is not published yet — a new
   * character after a wipe or a renamed one. The nickname is bound now; the minute profile refresh fills the level in.
   */
  pending?: boolean
}

const notPublished = (error: unknown) => error instanceof Error && (error as Error & { status?: number }).status === 404

/**
 * Nickname → account, in this order: the account id from the player's own game logs (the desktop app reads them),
 * tarkov.dev's live search, the published index. A profile tarkov.dev has not published yet is bound as `pending`.
 */
export async function resolvePlayerByNickname(mode: RaidMode, rawNickname: string, accountIdHint?: number): Promise<ResolvedPlayer> {
  const nickname = rawNickname.trim()
  const wanted = nickname.toLowerCase()
  const hint = Number.isSafeInteger(accountIdHint) && accountIdHint! > 0 ? accountIdHint : undefined
  const found = (snapshot: PlayerProfileSnapshot): ResolvedPlayer => ({ accountId: snapshot.accountId, nickname: snapshot.nickname, level: snapshot.level, faction: snapshot.faction, mode, snapshot })
  const pending = (accountId: number): ResolvedPlayer => ({ accountId, nickname, level: 0, faction: 'unknown', mode, pending: true })
  const profile = async (accountId: number) => {
    clearPlayerSnapshotCache(mode, [accountId])
    try { return await fetchPlayerProfile(mode, accountId) } catch (error) { if (notPublished(error)) return null; throw error }
  }

  if (hint) {
    const snapshot = await profile(hint).catch(() => undefined)
    if (snapshot && snapshot.nickname.toLowerCase() === wanted) return found(snapshot)
  }

  let ids = await searchLiveNickname(mode, nickname) ?? []
  if (!ids.length) ids = await resolveAccountIdsByNickname(mode, nickname, { refresh: true }).catch(() => [] as number[])
  if (hint) ids = [...ids.filter((id) => id === hint), ...ids.filter((id) => id !== hint)]

  let unpublished: number | undefined
  let lastError: Error | undefined
  for (const accountId of ids.slice(0, 5)) {
    if (accountId === hint) { unpublished ??= hint; continue }
    try {
      const snapshot = await profile(accountId)
      if (!snapshot) { unpublished ??= accountId; continue }
      if (snapshot.nickname.toLowerCase() === wanted) return found(snapshot)
      // The published profile still carries the old nickname: the account was renamed, tarkov.dev not updated yet.
      unpublished ??= accountId
    } catch (error) {
      lastError = humanizeNetworkError(error)
    }
  }
  // The live search or the index named this account, or the game logs did (a new or renamed character).
  if (unpublished) return pending(unpublished)
  if (hint) return pending(hint)
  if (lastError) throw lastError
  throw Object.assign(new Error(`Ник «${nickname}» пока не найден. Запустите игру этим персонажем: приложение возьмёт аккаунт из логов игры и привяжет ник сразу.`), { status: 404 })
}

export function clearPlayerProfileCache(mode?: RaidMode) {
  liveSearchCache.clear()
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
    if (response.status === 404) throw Object.assign(new Error('Профиль этого режима пока не опубликован. Повторите позже или закройте окно крестиком и выберите другой режим.'), { status: 404 })
    if (response.status === 429) throw new Error('Сервер профилей временно ограничил запросы. Повторите через минуту.')
    if (!response.ok) throw new Error(`Сервер профилей недоступен: HTTP ${response.status}`)
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
    if (response.status === 404) throw new Error('Индекс профилей этого режима пока не опубликован. Повторите позже.')
    if (response.status === 429) throw new Error('Сервер профилей временно ограничил запросы. Повторите через минуту.')
    if (!response.ok) throw new Error(`Сервер профилей недоступен: HTTP ${response.status}`)
    return response.text()
  } catch (error) {
    throw humanizeNetworkError(error)
  }
}

export function humanizeNetworkError(error: unknown): Error {
  if (!(error instanceof Error)) return new Error('Не удалось связаться с сервером профилей')
  const name = error.name
  const message = error.message
  if (name === 'TimeoutError' || /aborted due to timeout|The operation was aborted/i.test(message)) {
    return new Error('Сервер профилей отвечает слишком долго. Проверьте интернет и нажмите «Найти профиль» ещё раз.')
  }
  if (name === 'AbortError') {
    return new Error('Запрос профиля прерван. Повторите поиск профиля.')
  }
  return error
}
