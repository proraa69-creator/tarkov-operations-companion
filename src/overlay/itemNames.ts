import { get, set } from 'idb-keyval'
import type { ItemNameVariant } from './tooltipMatch'

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
    const cached = await get<{ at: number; names: Names }>(CACHE_KEY).catch(() => undefined)
    if (cached && Date.now() - cached.at < CACHE_MS) return new Map(cached.names)
    const dictionaries = await Promise.all(LANGUAGES.map(async (lang) => {
      const response = await fetch(`https://json.tarkov.dev/regular/items_${lang}`, { signal: AbortSignal.timeout(45_000) })
      if (!response.ok) throw new Error(`Item names HTTP ${response.status}`)
      return ((await response.json()) as { data?: Record<string, unknown> }).data ?? {}
    }))
    const names = namesFromDictionaries(dictionaries)
    await set(CACHE_KEY, { at: Date.now(), names: [...names.entries()] }).catch(() => {})
    return names
  })().catch((error) => {
    loading = null
    // A cache older than a few days is still better than English-only or Russian-only matching.
    return get<{ at: number; names: Names }>(CACHE_KEY).then((cached) => {
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
