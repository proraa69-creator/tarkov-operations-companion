import type { AppDataset, RaidMode } from '../../../src/domain/types'
import { fetchLiveCatalog } from '../../../src/data/catalogSource'
import { fetchPlayerProfile, resolveAccountIdsByNickname } from '../../../electron/playerProfileService'

const cache = new Map<RaidMode, { data: AppDataset; expires: number }>()
const pending = new Map<RaidMode, Promise<AppDataset>>()
export function getCatalogSnapshot(mode: RaidMode): Promise<AppDataset> {
  const entry = cache.get(mode)
  if (entry && entry.expires > Date.now()) return Promise.resolve(entry.data)
  const existing = pending.get(mode)
  if (existing) return existing
  const request = fetchLiveCatalog(mode).then((data) => {
    cache.set(mode, { data, expires: Date.now() + 60_000 })
    return data
  }).catch((error) => {
    if (entry) return { ...entry.data, metadata: { ...entry.data.metadata!, source: 'cache' as const } }
    throw error
  }).finally(() => pending.delete(mode))
  pending.set(mode, request)
  return request
}
export async function resolvePlayer(mode: RaidMode, nickname: string) {
  const matches = await resolveAccountIdsByNickname(mode, nickname, { refresh: true })
  if (!matches.length) throw Object.assign(new Error('Профиль этого режима пока не опубликован в Tarkov.dev'), { status: 404 })
  if (matches.length > 1) throw Object.assign(new Error('Найдено несколько профилей. Требуется идентификатор из журналов игры.'), { status: 409 })
  const snapshot = await fetchPlayerProfile(mode, matches[0])
  if (snapshot.nickname.toLowerCase() !== nickname.toLowerCase()) throw Object.assign(new Error('Индекс ников устарел. Повторите позднее.'), { status: 409 })
  return { accountId: snapshot.accountId, nickname: snapshot.nickname, mode, level: snapshot.level, faction: snapshot.faction, snapshot }
}
