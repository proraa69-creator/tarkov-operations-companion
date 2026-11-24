import { CJK_CHAR } from '../shared/cjk.js'
import { extraGameLanguage, type ExtraGameLanguage, type GameLanguage } from './gameLanguage.js'
import { GAME_WORDS, type GameWords } from './gameWords.js'

/**
 * The game's words in German, Japanese or Chinese (src/import/gameWords.ts, from the game's own localisation) as the
 * patterns the screen readers look for, beside their Russian and English ones. Russian and English games have none: their
 * readers stay as they were.
 *
 * A word is looked for as the OCR gives it: any case, its spaces optional, «!» / «:» at its end optional, its brackets
 * ASCII or full-width («(Du)», «（你）»). A Latin word stands alone (not inside a longer word); a Japanese or Chinese one
 * may touch its neighbours (those languages put no spaces between words).
 */
export interface LanguageWords {
  language: ExtraGameLanguage
  words: GameWords
  /** The status cells by status (src/import/questOcr.ts rowStatus). */
  status: { ready: RegExp; active: RegExp; failed: RegExp; locked: RegExp; available: RegExp }
  /** Any status word. */
  statusWord: string
  /** «Any location». */
  anyLocation: string
  /** The map names. */
  maps: string
  /** Lines of the screens around the Tasks table that are no quest's title (menus, column heads, headers, statuses). */
  chromeLine: RegExp
  /** The traders' screen and a trader's own Tasks tab (never the table of current quests). */
  traderScreen: RegExp
  /** Screens that name quests and are not the Tasks list (messenger, flea, trading). */
  notTasks: RegExp
  /** A pattern source for one of the game's words. */
  word: (text: string) => string
}

/**
 * A word with its umlauts as the OCR may give them: as written («Jäger»), without the dots («Jager»), spelt out
 * («Jaeger»). A word without them is itself alone.
 */
export function umlautForms(word: string): string[] {
  if (!/[äöüßÄÖÜ]/.test(word)) return [word]
  const bare = word.replace(/ß/g, 'ss').normalize('NFD').replace(/\p{M}/gu, '')
  const spelt = word.replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue').replace(/ß/g, 'ss')
  return [...new Set([word, bare, spelt])]
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** One word or phrase of the game as a pattern source (see above). */
export function gameWordPattern(text: string) {
  const cleaned = text.trim().replace(/[!！:：]+$/u, '').trim()
  if (!cleaned) return ''
  const body = escape(cleaned.toLowerCase())
    .replace(/\\\(|（/g, '[(（]\\s*')
    .replace(/\\\)|）/g, '\\s*[)）]')
    .replace(/\s+/g, '\\s*')
  const cjkStart = CJK_CHAR.test(cleaned[0]!)
  const cjkEnd = CJK_CHAR.test(cleaned.at(-1)!)
  const before = cjkStart ? '' : '(?<![\\p{L}\\p{N}])'
  const after = cjkEnd ? '' : '(?![\\p{L}])'
  return `${before}${body}[!！:：]?${after}`
}

const alternation = (list: readonly string[]) => {
  const parts = [...new Set(list.map(gameWordPattern).filter(Boolean))]
  return parts.length ? `(?:${parts.join('|')})` : '(?!)'
}

const cache = new Map<ExtraGameLanguage, LanguageWords>()

/** The patterns of a game language; null for Russian and English (and an unknown language). */
export function languageWords(language: GameLanguage | null | undefined): LanguageWords | null {
  const extra = extraGameLanguage(language)
  if (!extra) return null
  const known = cache.get(extra)
  if (known) return known
  const words = GAME_WORDS[extra]
  const flags = 'iu'
  const status = {
    ready: new RegExp(alternation([words.status.ready]), flags),
    active: new RegExp(alternation([words.status.active]), flags),
    failed: new RegExp(alternation([words.status.failed]), flags),
    locked: new RegExp(alternation([words.status.locked]), flags),
    available: new RegExp(alternation([words.status.available]), flags),
  }
  const statusWord = alternation([words.status.active, words.status.ready, words.status.failed, words.status.locked, words.status.available])
  const chrome = [
    ...words.columns, ...words.tasks, words.operational, ...words.taskItems, ...words.paneHeadings, ...words.menu, ...words.notTasks,
    words.anyLocation, ...Object.values(words.status), words.trader.attitude, words.trader.loyalty, words.trader.showLocked,
    ...Object.values(words.maps),
  ]
  const entry: LanguageWords = {
    language: extra,
    words,
    status,
    statusWord,
    anyLocation: alternation([words.anyLocation]),
    maps: alternation(Object.values(words.maps)),
    chromeLine: new RegExp(`^${alternation(chrome)}$`, flags),
    traderScreen: new RegExp(alternation([words.trader.attitude, words.trader.loyalty, words.trader.showLocked, words.trader.nextLevel, words.trader.you]), flags),
    notTasks: new RegExp(alternation(words.notTasks), flags),
    word: gameWordPattern,
  }
  cache.set(extra, entry)
  return entry
}
