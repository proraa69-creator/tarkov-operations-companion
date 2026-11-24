import type { RaidMode } from '../domain/types'
import { installCatalogTranslations } from './renderText'
import { installTargetCatalog } from './targetText'
import type { TargetLanguage } from './languages'
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

/**
 * The game's names in German, Japanese or Chinese (quests and their objectives, items, maps, traders, the hideout):
 * tarkov.dev's dictionaries in that language beside the English and Russian ones, matched by their keys. The screens show
 * the English catalog; src/i18n/targetText.ts puts each name into the language.
 */
const targetLoaded = new Map<string, Promise<{ english: Array<[string, string]>; russian: Array<[string, string]> }>>()
let requestedTarget = ''
/** tarkov.dev has the game's names in every language of the game; Ukrainian is not one (its names stay English). */
const CATALOG_LANGUAGES: Partial<Record<TargetLanguage, string>> = { de: 'de', ja: 'ja', zh: 'zh', pl: 'pl', es: 'es', pt: 'pt', fr: 'fr', ko: 'ko', tr: 'tr' }
export async function loadTargetCatalog(mode: RaidMode, language: TargetLanguage) {
  const code = CATALOG_LANGUAGES[language]
  if (!code) return
  const upstream = mode === 'pve' ? 'pve' : mode === 'seasonal' ? 'pvp-season' : 'regular'
  const slot = `${upstream}:${language}`
  requestedTarget = slot
  if (!targetLoaded.has(slot)) targetLoaded.set(slot, (async () => {
    const key = `display-translations-v1-${upstream}-${language}`
    const cached = await readGameCache<{ at: number; english: Array<[string, string]>; russian: Array<[string, string]> }>(key)
    if (cached && Date.now() - cached.at < DAY_MS) return cached
    const groups = await Promise.all(['tasks', 'items', 'maps', 'traders', 'hideout'].map(async (endpoint) => {
      const [english, russian, target] = await Promise.all(['en', 'ru', code].map(async (lang) => (await tarkovJson<{ data: Record<string, string> }>(`${upstream}/${endpoint}_${lang}`, undefined, 30_000)).data))
      const pairs = (from: Record<string, string>) => Object.entries(from).flatMap(([id, text]) => typeof text === 'string' && typeof target[id] === 'string' && target[id] ? [[text, target[id]] as [string, string]] : [])
      return { english: pairs(english), russian: pairs(russian) }
    }))
    const value = { at: Date.now(), english: groups.flatMap((group) => group.english), russian: groups.flatMap((group) => group.russian) }
    await writeGameCache(key, value, DAY_MS)
    return value
  })())
  try {
    const { english, russian } = await targetLoaded.get(slot)!
    if (requestedTarget === slot) installTargetCatalog(language, english, russian)
  } catch { targetLoaded.delete(slot) }
}
