import { translateUiText } from './uiEnglish'
import { cleanQuestText } from '../shared/questText'

let language: 'ru' | 'en' = 'ru'
let catalog = new Map<string, string>()
export function setRenderLanguage(locale: 'ru' | 'en') { language = locale }
export function installCatalogTranslations(entries: Array<[string, string]>) {
  catalog = new Map(entries.flatMap(([ru, en]) => [[ru, en], [cleanQuestText(ru), cleanQuestText(en)]] as Array<[string, string]>))
  window.dispatchEvent(new Event('companion-translations-ready'))
}
/** Translate display values only. IDs, filters, persisted progress and event handlers stay intact. */
export function uiText<T>(value: T): T {
  if (language !== 'en') return value
  if (typeof value === 'string') {
    const exact = catalog.get(value.trim())
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
