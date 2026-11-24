import { exactUiText, translateUiText } from './uiEnglish'
import { cleanQuestText } from '../shared/questText'
import { baseLocale, isTargetLanguage, languageOption, type AppLanguage } from './languages'
import { setTargetLanguage, targetFromRussian, targetText, targetUiDictionary } from './targetText'

let language: 'ru' | 'en' = 'ru'
let chosenTag = 'ru-RU'
let catalog = new Map<string, string>()
const CYRILLIC = /[А-Яа-яЁё]/
/**
 * The language the screens are drawn in. Russian and English as before; German, Japanese and Chinese are the English
 * text put into that language (src/i18n/targetText.ts).
 */
export function setRenderLanguage(locale: AppLanguage) {
  language = baseLocale(locale)
  chosenTag = languageOption(locale).tag
  setTargetLanguage(isTargetLanguage(locale) ? locale : null)
}
export function installCatalogTranslations(entries: Array<[string, string]>) {
  catalog = new Map(entries.flatMap(([ru, en]) => [[ru, en], [cleanQuestText(ru), cleanQuestText(en)]] as Array<[string, string]>))
  window.dispatchEvent(new Event('companion-translations-ready'))
}

/** English text (from the screens or the English dictionary) in German, Japanese or Chinese when one is chosen. */
const drawn = (english: string) => targetText(english)

/**
 * Russian text in the chosen language other than English: the game's own name, the dictionary's phrase in that language,
 * else the English put into it. Undefined when no such language is chosen.
 */
function inTarget(value: string): string | undefined {
  const target = targetUiDictionary()
  if (!target) return undefined
  const trimmed = value.trim()
  const named = targetFromRussian(trimmed)
  if (named) return value.replace(trimmed, named)
  const exact = target.exact.get(trimmed)
  if (exact) return value.replace(trimmed, exact)
  const english = catalog.get(trimmed)
  if (english) return value.replace(trimmed, targetText(english))
  const translated = translateUiText(value, target)
  if (!CYRILLIC.test(translated)) return translated
  return targetText(translateUiText(value))
}

/**
 * An interface label that is also the Russian name of a game item: the interface dictionary, never the catalog. The map
 * tool «Рулетка» read «MTape» in English (the measuring tape item, 13.10.2026), because uiText looks the catalog up first.
 */
export function uiLabel(value: string): string {
  if (language !== 'en') return value
  const target = targetUiDictionary()
  if (target) {
    if (!CYRILLIC.test(value)) return drawn(value)
    return exactUiText(value, target) ?? translateUiText(value, target)
  }
  return exactUiText(value) ?? translateUiText(value)
}
/** Translate display values only. IDs, filters, persisted progress and event handlers stay intact. */
export function uiText<T>(value: T): T {
  if (language !== 'en') return value
  if (typeof value === 'string') {
    if (!CYRILLIC.test(value)) return drawn(value) as T
    const target = inTarget(value)
    if (target !== undefined) return target as T
    // A whole phrase first: sentences with commas would otherwise be split into untranslatable pieces.
    const exact = catalog.get(value.trim()) ?? exactUiText(value)
    if (exact) return value.replace(value.trim(), exact) as T
    // Rendered templates often contain several independently localized names.
    return value.split(/( · | ×\d+|, )/).map((part) => {
      const translated = catalog.get(part.trim())
      return translated ? part.replace(part.trim(), translated) : translateUiText(part)
    }).join('') as T
  }
  if (Array.isArray(value)) return value.map((entry) => uiText(entry)) as T
  return value
}

/**
 * The format of dates and numbers for a base text (`locale`): Russian for Russian, else the chosen language's own
 * (English, German, Japanese, Chinese).
 */
export function languageTag(base: string): string {
  return base === 'ru' ? 'ru-RU' : chosenTag === 'ru-RU' ? 'en-US' : chosenTag
}
