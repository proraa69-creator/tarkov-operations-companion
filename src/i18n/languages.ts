/**
 * The interface languages (owner, 24.11.2026: «китайский, японский, немецкий … по нажатии на язык сверху будет
 * выдвигаться окно со списком всех языков»).
 *
 * Russian is the source text and English the dictionary every screen already has (src/i18n/uiEnglish*.ts). German,
 * Japanese and Chinese are drawn over the English: the app renders the English text and src/i18n/targetText.ts puts
 * each English phrase into the chosen language. So `locale` (what the code compares, 'ru' | 'en') stays the base text,
 * and `language` is what the player chose.
 */
export type AppLanguage = 'ru' | 'en' | 'de' | 'ja' | 'zh'
/** The language of the source the screens are written in: Russian, or English for every other language. */
export type BaseLocale = 'ru' | 'en'
/** A language drawn over the English text. */
export type TargetLanguage = Exclude<AppLanguage, BaseLocale>

export interface LanguageOption {
  code: AppLanguage
  /** In the picker's button: two letters. */
  short: string
  /** The language's own name, the way its speakers write it. */
  name: string
  /** What `lang` and the date/number formats use. */
  tag: string
}

export const LANGUAGES: readonly LanguageOption[] = [
  { code: 'ru', short: 'RU', name: 'Русский', tag: 'ru-RU' },
  { code: 'en', short: 'EN', name: 'English', tag: 'en-US' },
  { code: 'de', short: 'DE', name: 'Deutsch', tag: 'de-DE' },
  { code: 'ja', short: 'JA', name: '日本語', tag: 'ja-JP' },
  { code: 'zh', short: 'ZH', name: '简体中文', tag: 'zh-CN' },
]

export const TARGET_LANGUAGES: readonly TargetLanguage[] = ['de', 'ja', 'zh']

export function isAppLanguage(value: unknown): value is AppLanguage {
  return typeof value === 'string' && LANGUAGES.some((language) => language.code === value)
}

export function isTargetLanguage(value: unknown): value is TargetLanguage {
  return typeof value === 'string' && (TARGET_LANGUAGES as readonly string[]).includes(value)
}

export function baseLocale(language: AppLanguage): BaseLocale {
  return language === 'ru' ? 'ru' : 'en'
}

export function languageOption(language: AppLanguage): LanguageOption {
  return LANGUAGES.find((option) => option.code === language) ?? LANGUAGES[0]!
}
