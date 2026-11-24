/**
 * The language the game itself runs in (not the app's): the screen readers read its words and names. The player picks it
 * in the app's settings («Язык игры»); the app never looks into the game or its files for it (owner, 24.11.2026: «нам в
 * игру нельзя внедряться … Пользователь сам выберет язык. Стандартный язык английский»).
 *
 * Russian and English are read as before, with one engine for both, so a Russian game keeps working under the default
 * «English»; German, Japanese and Simplified Chinese each get their own model beside the English one, since the game
 * keeps many English words in those languages (map names, «EXFIL», the traders).
 */
export type GameLanguage = 'en' | 'ru' | 'de' | 'ja' | 'zh'
/** The player's choice in the app's settings. */
export type GameLanguageSetting = GameLanguage
/** The game languages beyond Russian and English: their words and names are added to the Russian and English ones. */
export type ExtraGameLanguage = Exclude<GameLanguage, 'ru' | 'en'>

/** In the order of the settings' list: English first, the default. */
export const GAME_LANGUAGES: readonly GameLanguage[] = ['en', 'ru', 'de', 'ja', 'zh']
export const GAME_LANGUAGE_SETTINGS: readonly GameLanguageSetting[] = GAME_LANGUAGES
export const DEFAULT_GAME_LANGUAGE: GameLanguage = 'en'

export function isGameLanguage(value: unknown): value is GameLanguage {
  return typeof value === 'string' && (GAME_LANGUAGES as readonly string[]).includes(value)
}

export const isGameLanguageSetting = isGameLanguage

/** The language the readers use: the player's choice, else English (a setting from before, «auto», counts as none). */
export function resolveGameLanguage(setting: unknown): GameLanguage {
  return isGameLanguage(setting) ? setting : DEFAULT_GAME_LANGUAGE
}

/** German, Japanese or Chinese; null for Russian and English (read as before). */
export function extraGameLanguage(language: GameLanguage | null | undefined): ExtraGameLanguage | null {
  return language === 'de' || language === 'ja' || language === 'zh' ? language : null
}

/**
 * The Tesseract models for a game language: the language's own and English (the game keeps English words in every
 * language). Russian and English share one engine, as before.
 */
export function ocrModel(language: GameLanguage | null | undefined): string {
  switch (language) {
    case 'de': return 'deu+eng'
    case 'ja': return 'jpn+eng'
    case 'zh': return 'chi_sim+eng'
    default: return 'rus+eng'
  }
}

/** The model files a Tesseract language string needs («deu+eng» → deu, eng). */
export function ocrModelFiles(model: string): string[] {
  return model.split('+').map((part) => part.trim()).filter(Boolean)
}

/** Every model file the app ships (electron/tessdata, the phone's ocr/ folder). */
export const OCR_MODEL_FILES = ['rus', 'eng', 'deu', 'jpn', 'chi_sim'] as const

/** Written with Chinese characters or Japanese kana: the game's text in Japanese or Chinese. */
export const isCjkLanguage = (language: GameLanguage | null | undefined) => language === 'ja' || language === 'zh'
