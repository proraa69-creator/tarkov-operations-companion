import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { ocrModel, parseGameIniLanguage, resolveGameLanguage, type GameLanguage, type GameLanguageSetting } from '../src/import/gameLanguage.js'

/**
 * The game's language, read from its own settings file (only read, never written): %APPDATA%\Battlestate Games\Escape from
 * Tarkov\Settings\Game.ini, "Language". The file is looked at again when it changed (its time and size), at most every
 * few seconds: every scan asks, and a player who switches the game's language is read in the new one from the next look.
 */
export interface GameLanguageState {
  /** The player's choice in the app's settings («Язык игры»). */
  setting: GameLanguageSetting
  /** What the game's settings file says; null when it was not found or names none. */
  detected: GameLanguage | null
  /** The language the readers use now. */
  language: GameLanguage
  /** Its OCR models («deu+eng»). */
  model: string
}

/** How often the file's time is checked again (a scan every few seconds asks each time). */
const CHECK_MS = 3000

export function gameSettingsFile(appData: string) {
  return join(appData, 'Battlestate Games', 'Escape from Tarkov', 'Settings', 'Game.ini')
}

/**
 * A reader of the game's language: `file()` the settings file's path, `setting()` the player's choice. The detected
 * language is kept with the file's time and size: an unchanged file is not read again.
 */
export function createGameLanguageReader(file: () => string, setting: () => GameLanguageSetting, now: () => number = Date.now) {
  let checkedAt = -Infinity
  let stamp = ''
  let detected: GameLanguage | null = null
  let pending: Promise<GameLanguage | null> | null = null

  const detect = async (): Promise<GameLanguage | null> => {
    const path = file()
    const info = await stat(path).catch(() => null)
    if (!info) { stamp = ''; detected = null; return null }
    const next = `${path}|${info.mtimeMs}|${info.size}`
    if (next === stamp) return detected
    const text = await readFile(path, 'utf8').catch(() => null)
    stamp = text === null ? '' : next
    detected = text === null ? null : parseGameIniLanguage(text)
    return detected
  }

  /** The language now: the player's choice, else the game's file (checked again after CHECK_MS or when `fresh`). */
  async function current(fresh = false): Promise<GameLanguageState> {
    const chosen = setting()
    if (fresh || now() - checkedAt >= CHECK_MS) {
      pending ??= detect().finally(() => { checkedAt = now(); pending = null })
      await pending
    }
    const language = resolveGameLanguage(chosen, detected)
    return { setting: chosen, detected, language, model: ocrModel(language) }
  }

  return { current, forget() { checkedAt = -Infinity; stamp = '' } }
}
