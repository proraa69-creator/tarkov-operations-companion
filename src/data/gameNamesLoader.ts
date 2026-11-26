import { useSyncExternalStore } from 'react'
import { tarkovJson } from './tarkovApi'
import { readGameCache, writeGameCache } from './gameDataCache'
import { exitNameKey, gameNames, setGameNames, setWantedGameLanguage, subscribeGameNames, wantedGameNames, type GameNames, type ItemNames } from './gameNames'
import type { ExtraGameLanguage, GameLanguage } from '../import/gameLanguage'

/**
 * Loads the game's names in its language (src/data/gameNames.ts) when the game runs in German, Japanese or Chinese:
 * tarkov.dev's dictionaries of that language — quests, items, maps (their exits and transits) — through the same path as
 * the Russian and English ones (src/data/tarkovApi.ts: the server's data gateway in the players' app), with the English
 * and Russian map dictionaries to know which exit each name is. Kept for a few days.
 */
const CACHE_MS = 3 * 24 * 60 * 60 * 1000
const cacheKey = (language: ExtraGameLanguage) => `game-names-v1-${language}`

interface CachedNames { at: number; quests: Array<[string, string]>; items: Array<[string, ItemNames]>; exits: Array<[string, string]> }

type Dictionary = Record<string, unknown>

/** The game's names from tarkov.dev's dictionaries of the language (`tasks`, `items`, `maps`) and the English and Russian maps. */
export function gameNamesFromDictionaries(language: ExtraGameLanguage, dictionaries: { tasks: Dictionary; items: Dictionary; maps: Dictionary; mapsEn: Dictionary; mapsRu: Dictionary }): GameNames {
  const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')
  const quests = new Map<string, string>()
  for (const [key, value] of Object.entries(dictionaries.tasks)) {
    const match = /^(\S+) name$/.exec(key)
    if (match && text(value)) quests.set(match[1]!, text(value))
  }
  const items = new Map<string, ItemNames>()
  for (const [key, value] of Object.entries(dictionaries.items)) {
    const match = /^(\S+) (Name|ShortName)$/.exec(key)
    if (!match || !text(value)) continue
    const entry = items.get(match[1]!) ?? {}
    if (match[2] === 'Name') entry.name = text(value)
    else entry.shortName = text(value)
    items.set(match[1]!, entry)
  }
  // Exits and transits: the same key in every language's map dictionary («ex_customs_pmc_zb1011», «Gate 3», «…_DESC»).
  const exits = new Map<string, string>()
  for (const [key, value] of Object.entries(dictionaries.maps)) {
    if (/^[0-9a-f]{24} (?:Name|Description)$/.test(key) || !text(value)) continue
    for (const known of [dictionaries.mapsEn[key], dictionaries.mapsRu[key]]) {
      const name = text(known)
      if (name && !exits.has(exitNameKey(name))) exits.set(exitNameKey(name), text(value))
    }
  }
  return { language, quests, items, exits }
}

/** One language's names: the cache when fresh, else the dictionaries (the cache however old when they cannot be had). */
export async function loadGameNames(language: ExtraGameLanguage): Promise<GameNames> {
  const fromCache = (cached: CachedNames): GameNames => ({ language, quests: new Map(cached.quests), items: new Map(cached.items), exits: new Map(cached.exits) })
  const cached = await readGameCache<CachedNames>(cacheKey(language))
  if (cached && Date.now() - cached.at < CACHE_MS) return fromCache(cached)
  try {
    const get = async (name: string) => (await tarkovJson<{ data?: Dictionary }>(`regular/${name}`, undefined, 60_000)).data ?? {}
    const [tasks, items, maps, mapsEn, mapsRu] = await Promise.all([`tasks_${language}`, `items_${language}`, `maps_${language}`, 'maps_en', 'maps_ru'].map(get))
    const names = gameNamesFromDictionaries(language, { tasks: tasks!, items: items!, maps: maps!, mapsEn: mapsEn!, mapsRu: mapsRu! })
    await writeGameCache(cacheKey(language), { at: Date.now(), quests: [...names.quests], items: [...names.items], exits: [...names.exits] } satisfies CachedNames, CACHE_MS)
    return names
  } catch (error) {
    if (cached) return fromCache(cached)
    throw error
  }
}

const loading = new Map<ExtraGameLanguage, Promise<void>>()
const failedAt = new Map<ExtraGameLanguage, number>()
/** A load that failed is tried again after this. */
const RETRY_MS = 60_000

/**
 * The game's language as a reader saw it (a frame, a lookup, the exit list, the settings): a German, Japanese or Chinese
 * game's names are loaded once, a Russian or English game's are dropped.
 */
export function noteGameLanguage(language: GameLanguage | null | undefined) {
  setWantedGameLanguage(language)
  const wanted = wantedGameNames()
  if (!wanted || gameNames()?.language === wanted || loading.has(wanted)) return
  if (Date.now() - (failedAt.get(wanted) ?? 0) < RETRY_MS) return
  const job = loadGameNames(wanted)
    .then((names) => { failedAt.delete(wanted); setGameNames(names) })
    .catch(() => { failedAt.set(wanted, Date.now()) })
    .finally(() => { loading.delete(wanted) })
  loading.set(wanted, job)
}

/** The names of a language once loaded (the stash photo waits for them); null when they cannot be had. */
export async function loadedGameNames(language: GameLanguage): Promise<GameNames | null> {
  noteGameLanguage(language)
  const wanted = wantedGameNames()
  if (!wanted) return null
  await loading.get(wanted)
  const names = gameNames()
  return names?.language === wanted ? names : null
}

/** The game's names now (null: none): what is worked out from them (the item matcher, the exits on a map) follows them. */
export function useGameNames() {
  return useSyncExternalStore(subscribeGameNames, gameNames, gameNames)
}
