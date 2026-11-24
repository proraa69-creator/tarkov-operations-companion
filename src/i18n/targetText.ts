import { cleanQuestText } from '../shared/questText'
import type { TargetLanguage } from './languages'
import { mappedUiDictionary, type UiDictionary } from './uiEnglish'

/**
 * German, Japanese and Chinese over the English interface (src/i18n/languages.ts).
 *
 * - The interface phrases: src/i18n/locales/<language>.json, English → that language, one entry per distinct English text
 *   of the dictionary (src/i18n/uiEnglish*.ts) and of the English written right in the screens. A text with numbers is
 *   looked up with them as `{0}`, `{1}`… («Completed {0} of {1}»), a template of the dictionary with its `$1`.
 * - The game's own names (quests, items, maps, traders, hideout): tarkov.dev's dictionaries in that language, installed by
 *   src/i18n/catalogTranslations.ts, by English and by Russian name.
 * Whatever has no text in the language stays English: never Russian, never a half-translated word.
 */
let active: TargetLanguage | null = null
let table: ReadonlyMap<string, string> = new Map()
let dictionary: UiDictionary | null = null
let catalogEnglish = new Map<string, string>()
let catalogRussian = new Map<string, string>()
let catalogLanguage: TargetLanguage | null = null

const LOADERS: Record<TargetLanguage, () => Promise<{ default: Record<string, string> }>> = {
  de: () => import('./locales/de.json'),
  ja: () => import('./locales/ja.json'),
  zh: () => import('./locales/zh.json'),
}
const loaded = new Map<TargetLanguage, Promise<ReadonlyMap<string, string>>>()
const compiled = new Map<TargetLanguage, { table: ReadonlyMap<string, string>; dictionary: UiDictionary }>()

const announce = () => { if (typeof window !== 'undefined') window.dispatchEvent(new Event('companion-translations-ready')) }

/** The language drawn over the English now, or none (Russian, English). */
export function activeTarget() { return active }

/**
 * Switches the language drawn over the English. Its phrases come in their own file: until it is there the screens stay
 * English, then everything is drawn again (`companion-translations-ready`).
 */
export function setTargetLanguage(language: TargetLanguage | null) {
  if (language === active && (language === null || dictionary)) return
  active = language
  if (!language) { table = new Map(); dictionary = null; return }
  const ready = compiled.get(language)
  if (ready) { table = ready.table; dictionary = ready.dictionary; return }
  table = new Map()
  dictionary = null
  void loadTargetTable(language).then(() => {
    if (active !== language) return
    const done = compiled.get(language)!
    table = done.table
    dictionary = done.dictionary
    announce()
  }).catch(() => { /* stays English; the next switch tries again */ loaded.delete(language) })
}

/** The phrase file of a language, compiled once (also for tests). */
export function loadTargetTable(language: TargetLanguage): Promise<ReadonlyMap<string, string>> {
  let promise = loaded.get(language)
  if (!promise) {
    promise = LOADERS[language]().then((module) => {
      const map = new Map(Object.entries(module.default).filter(([english, text]) => english && typeof text === 'string' && text.trim()))
      compiled.set(language, { table: map, dictionary: mappedUiDictionary((english) => phrase(map, english) ?? english) })
      return map
    })
    loaded.set(language, promise)
  }
  return promise
}

/** The interface dictionary in the active language (Russian → that language), once its file is there. */
export function targetUiDictionary(): UiDictionary | null { return dictionary }

/** The game's names in a language: [English, text] and [Russian, text] pairs (tarkov.dev's dictionaries by id). */
export function installTargetCatalog(language: TargetLanguage, english: Array<[string, string]>, russian: Array<[string, string]>) {
  const clean = (pairs: Array<[string, string]>) => new Map(pairs.flatMap(([from, to]) => [[from.trim(), to.trim()], [cleanQuestText(from).trim(), cleanQuestText(to).trim()]] as Array<[string, string]>).filter(([from, to]) => from && to))
  catalogEnglish = clean(english)
  catalogRussian = clean(russian)
  catalogLanguage = language
  if (language === active) announce()
}

const NUMBER = /\d+(?:[.,:]\d+)*/g
const SEPARATORS = /( · | — | – |, |; |: | \/ | \| |\n)/
const PUNCTUATION = /^(.*?)([:.…!?]+)$/s

/** One phrase of a table: as is, with its numbers as {0}, {1}…, or without the punctuation at its end. */
function phrase(map: ReadonlyMap<string, string>, text: string): string | undefined {
  const key = text.trim()
  if (!key) return undefined
  const exact = map.get(key)
  if (exact !== undefined) return exact
  const numbers = key.match(NUMBER)
  if (numbers) {
    let index = 0
    const template = map.get(key.replace(NUMBER, () => `{${index++}}`))
    if (template !== undefined) return template.replace(/\{(\d+)\}/g, (_, at: string) => numbers[Number(at)] ?? '')
  }
  const ending = PUNCTUATION.exec(key)
  if (ending && ending[1]) {
    const bare = map.get(ending[1].trim())
    if (bare !== undefined) return `${bare}${ending[2]}`
  }
  return undefined
}

/** The game's own name first (the official text), then the interface phrases. */
function lookup(text: string): string | undefined {
  if (catalogLanguage === active) {
    const named = catalogEnglish.get(text.trim()) ?? catalogEnglish.get(cleanQuestText(text).trim())
    if (named !== undefined) return named
  }
  return phrase(table, text)
}

/**
 * English text in the active language: the whole text, else each part between « · », «, », « — »… that has a text of
 * its own. Anything else stays as it is.
 */
export function targetText(text: string): string {
  if (!active || !text || !/[A-Za-z]/.test(text)) return text
  const whole = lookup(text)
  if (whole !== undefined) return text.replace(text.trim(), whole)
  const parts = text.split(SEPARATORS)
  if (parts.length < 2) return text
  let changed = false
  const output = parts.map((part, index) => {
    if (index % 2 === 1) return part
    const found = lookup(part)
    if (found === undefined) return part
    changed = true
    return part.replace(part.trim(), found)
  })
  return changed ? output.join('') : text
}

/** A game name written in Russian (the Russian catalog), in the active language. */
export function targetFromRussian(text: string): string | undefined {
  if (!active || catalogLanguage !== active) return undefined
  return catalogRussian.get(text.trim()) ?? catalogRussian.get(cleanQuestText(text).trim())
}
