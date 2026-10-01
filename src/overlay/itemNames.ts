import type { ItemNameVariant } from './tooltipMatch'
import { tarkovJson } from '../data/tarkovApi'
import { readGameCache, writeGameCache } from '../data/gameDataCache'

const CACHE_KEY = 'item-lookup-names-v1'
const CACHE_MS = 3 * 24 * 60 * 60 * 1000
const LANGUAGES = ['ru', 'en'] as const

type Names = Array<[string, ItemNameVariant[]]>

let loading: Promise<Map<string, ItemNameVariant[]>> | null = null

/**
 * Item names in both game languages (Russian and English), by item id. The game's tooltip shows the name in the
 * game's language, which need not be the app's, so the item card matches against both. Kept for a few days.
 */
export function loadItemNameVariants(): Promise<Map<string, ItemNameVariant[]>> {
  loading ??= (async () => {
    const cached = await readGameCache<{ at: number; names: Names }>(CACHE_KEY)
    if (cached && Date.now() - cached.at < CACHE_MS) return new Map(cached.names)
    // Through the server's data gateway in the players' app (src/data/tarkovApi.ts).
    const dictionaries = await Promise.all(LANGUAGES.map(async (lang) => (await tarkovJson<{ data?: Record<string, unknown> }>(`regular/items_${lang}`)).data ?? {}))
    const names = namesFromDictionaries(dictionaries)
    await writeGameCache(CACHE_KEY, { at: Date.now(), names: [...names.entries()] }, CACHE_MS)
    return names
  })().catch((error) => {
    loading = null
    // A cache older than a few days is still better than English-only or Russian-only matching.
    return readGameCache<{ at: number; names: Names }>(CACHE_KEY).then((cached) => {
      if (cached) return new Map(cached.names)
      throw error
    })
  })
  return loading
}

/** tarkov.dev translation dictionaries ("<id> Name", "<id> ShortName") → names per item id. */
export function namesFromDictionaries(dictionaries: Array<Record<string, unknown>>) {
  const names = new Map<string, ItemNameVariant[]>()
  for (const dictionary of dictionaries) {
    const byId = new Map<string, ItemNameVariant>()
    for (const [key, value] of Object.entries(dictionary)) {
      if (typeof value !== 'string' || !value.trim()) continue
      const match = /^(\S+) (Name|ShortName)$/.exec(key)
      if (!match) continue
      const variant = byId.get(match[1]!) ?? {}
      if (match[2] === 'Name') variant.name = value.trim()
      else variant.shortName = value.trim()
      byId.set(match[1]!, variant)
    }
    for (const [id, variant] of byId) {
      const list = names.get(id)
      if (list) list.push(variant)
      else names.set(id, [variant])
    }
  }
  return names
}
