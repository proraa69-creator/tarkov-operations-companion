import type { RaidMode } from '../domain/types'
import { installCatalogTranslations } from './renderText'
import { tarkovJson } from '../data/tarkovApi'
import { readGameCache, writeGameCache } from '../data/gameDataCache'

const DAY_MS = 24 * 60 * 60 * 1000

const loaded = new Map<string, Promise<Array<[string, string]>>>()
let requestedMode: RaidMode
export async function loadEnglishCatalog(mode: RaidMode) {
  requestedMode = mode
  const upstream = mode === 'pve' ? 'pve' : mode === 'seasonal' ? 'pvp-season' : 'regular'
  if (!loaded.has(upstream)) loaded.set(upstream, (async () => {
    const key = `display-translations-v2-${upstream}`
    const cached = await readGameCache<{ at: number; entries: Array<[string, string]> }>(key)
    if (cached && Date.now() - cached.at < DAY_MS) return cached.entries
    const groups = await Promise.all(['tasks', 'items', 'maps', 'traders', 'hideout'].map(async (endpoint) => {
      // Through the server's data gateway in the players' app (src/data/tarkovApi.ts).
      const dictionaries = await Promise.all(['ru', 'en'].map(async (lang) => (await tarkovJson<{ data: Record<string, string> }>(`${upstream}/${endpoint}_${lang}`, undefined, 30_000)).data))
      return Object.entries(dictionaries[0]).flatMap(([id, ru]) => typeof ru === 'string' && typeof dictionaries[1][id] === 'string' ? [[ru, dictionaries[1][id]] as [string, string]] : [])
    }))
    const entries = groups.flat()
    await writeGameCache(key, { at: Date.now(), entries }, DAY_MS)
    return entries
  })())
  try {
    const entries = await loaded.get(upstream)!
    if (requestedMode === mode) installCatalogTranslations(entries)
  } catch { loaded.delete(upstream) }
}
