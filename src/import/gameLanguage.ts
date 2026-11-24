/**
 * The language the game itself runs in (not the app's): the screen readers read its words and names. Russian and English
 * are read as before (one engine for both); German, Japanese and Simplified Chinese each with their own model beside the
 * English one, since the game keeps many English words in those languages (map names, «EXFIL», the traders).
 *
 * The game keeps its choice in %APPDATA%\Battlestate Games\Escape from Tarkov\Settings\Game.ini (JSON, "Language") with
 * its own codes: «ge» German, «jp» Japanese, «ch» Chinese. Any other language the game has (French, Polish…) is read with
 * the English words and models: its menus share their Latin letters, and its names are not known to the app.
 */
export type GameLanguage = 'ru' | 'en' | 'de' | 'ja' | 'zh'
/** The player's choice in the app's settings: the game's own language, or one picked by hand. */
export type GameLanguageSetting = 'auto' | GameLanguage
/** The game languages beyond Russian and English: their words and names are added to the Russian and English ones. */
export type ExtraGameLanguage = Exclude<GameLanguage, 'ru' | 'en'>

export const GAME_LANGUAGES: readonly GameLanguage[] = ['ru', 'en', 'de', 'ja', 'zh']
export const GAME_LANGUAGE_SETTINGS: readonly GameLanguageSetting[] = ['auto', ...GAME_LANGUAGES]

/** The game's own codes in Game.ini. */
const GAME_CODES: Record<string, GameLanguage> = { ru: 'ru', en: 'en', ge: 'de', de: 'de', jp: 'ja', ja: 'ja', ch: 'zh', zh: 'zh', cn: 'zh' }

export function isGameLanguage(value: unknown): value is GameLanguage {
  return typeof value === 'string' && (GAME_LANGUAGES as readonly string[]).includes(value)
}

export function isGameLanguageSetting(value: unknown): value is GameLanguageSetting {
  return typeof value === 'string' && (GAME_LANGUAGE_SETTINGS as readonly string[]).includes(value)
}

/** The game's language code («ge», «jp», «ch», «fr»…) as a language the app reads: an unknown one counts as English. */
export function gameLanguageFromCode(code: string): GameLanguage | null {
  const value = code.trim().toLowerCase()
  if (!value) return null
  return GAME_CODES[value] ?? 'en'
}

/** "Language" of the game's Game.ini (JSON; a damaged file is searched for the key alone); null when it names none. */
export function parseGameIniLanguage(text: string): GameLanguage | null {
  const body = text.replace(/^\uFEFF/, '')
  let code: unknown
  try {
    code = (JSON.parse(body) as Record<string, unknown>).Language
  } catch {
    code = /"Language"\s*:\s*"([^"]*)"/.exec(body)?.[1]
  }
  return typeof code === 'string' ? gameLanguageFromCode(code) : null
}

/** The language the readers use: the player's choice, else the game's own, else Russian (the reading as it always was). */
export function resolveGameLanguage(setting: GameLanguageSetting | undefined, detected: GameLanguage | null): GameLanguage {
  if (setting && setting !== 'auto') return setting
  return detected ?? 'ru'
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
