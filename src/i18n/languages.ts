/**
 * The interface languages (owner, 24.11.2026: «китайский, японский, немецкий … по нажатии на язык сверху будет
 * выдвигаться окно со списком всех языков»; then «подумай, какие еще языки нам стоит добавить»: Polish, Ukrainian, Spanish,
 * Brazilian Portuguese, French, Korean and Turkish — the players' countries beyond the CIS and the game's own languages).
 *
 * Russian is the source text and English the dictionary every screen already has (src/i18n/uiEnglish*.ts). Every other
 * language is drawn over the English: the app renders the English text and src/i18n/targetText.ts puts
 * each English phrase into the chosen language. So `locale` (what the code compares, 'ru' | 'en') stays the base text,
 * and `language` is what the player chose.
 */
export type AppLanguage = 'ru' | 'en' | 'de' | 'ja' | 'zh' | 'pl' | 'uk' | 'es' | 'pt' | 'fr' | 'ko' | 'tr'
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
  { code: 'pl', short: 'PL', name: 'Polski', tag: 'pl-PL' },
  { code: 'uk', short: 'UK', name: 'Українська', tag: 'uk-UA' },
  { code: 'es', short: 'ES', name: 'Español', tag: 'es-ES' },
  { code: 'pt', short: 'PT', name: 'Português (Brasil)', tag: 'pt-BR' },
  { code: 'fr', short: 'FR', name: 'Français', tag: 'fr-FR' },
  { code: 'ko', short: 'KO', name: '한국어', tag: 'ko-KR' },
  { code: 'tr', short: 'TR', name: 'Türkçe', tag: 'tr-TR' },
]

export const TARGET_LANGUAGES: readonly TargetLanguage[] = ['de', 'ja', 'zh', 'pl', 'uk', 'es', 'pt', 'fr', 'ko', 'tr']

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
