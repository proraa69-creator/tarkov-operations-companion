import { get, set } from 'idb-keyval'
import type { RaidMode } from '../domain/types'
import { installCatalogTranslations } from './renderText'

const loaded = new Map<string, Promise<Array<[string, string]>>>()
let requestedMode: RaidMode
export async function loadEnglishCatalog(mode: RaidMode) {
  requestedMode = mode
  const upstream = mode === 'pve' ? 'pve' : mode === 'seasonal' ? 'pvp-season' : 'regular'
  if (!loaded.has(upstream)) loaded.set(upstream, (async () => {
    const key = `display-translations-v2-${upstream}`
    const cached = await get<{ at: number; entries: Array<[string, string]> }>(key).catch(() => undefined)
    if (cached && Date.now() - cached.at < 24 * 60 * 60 * 1000) return cached.entries
    const groups = await Promise.all(['tasks', 'items', 'maps', 'traders', 'hideout'].map(async (endpoint) => {
      const dictionaries = await Promise.all(['ru', 'en'].map(async (lang) => {
        const response = await fetch(`https://json.tarkov.dev/${upstream}/${endpoint}_${lang}`, { signal: AbortSignal.timeout(30_000) })
        if (!response.ok) throw new Error(`Translation HTTP ${response.status}`)
        return (await response.json()).data as Record<string, string>
      }))
      return Object.entries(dictionaries[0]).flatMap(([id, ru]) => typeof ru === 'string' && typeof dictionaries[1][id] === 'string' ? [[ru, dictionaries[1][id]] as [string, string]] : [])
    }))
    const entries = groups.flat()
    await set(key, { at: Date.now(), entries }).catch(() => {})
    return entries
  })())
  try {
    const entries = await loaded.get(upstream)!
    if (requestedMode === mode) installCatalogTranslations(entries)
  } catch { loaded.delete(upstream) }
}
