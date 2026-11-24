import { CJK_CHAR } from '../shared/cjk.js'
import { extraGameLanguage, type ExtraGameLanguage, type GameLanguage } from './gameLanguage.js'
import { GAME_WORDS, type GameWords } from './gameWords.js'

/**
 * The game's words in its languages beyond Russian and English (src/import/gameWords.ts, from the game's own
 * localisation) as the patterns the screen readers look for, beside their Russian and English ones. Russian and English
 * games have none: their readers stay as they were.
 *
 * A word is looked for as the OCR gives it: any case, its spaces optional, «!» / «:» at its end optional, its brackets
 * ASCII or full-width («(Du)», «（你）»), a Spanish «¡» before it optional (or read as «i», «!», «|»), a letter with an
 * accent or a mark also without it («Terminée» / «Terminee», «część» / «czesc»), the Turkish i in any of its forms (ı, İ,
 * I, i). A Latin, Cyrillic or Korean word stands alone (not inside a longer word); a Japanese or Chinese one may touch its
 * neighbours (those languages put no spaces between words).
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
  /** A pattern source for any of the game's wordings of a word. */
  any: (list: readonly string[]) => string
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

/** Letters whose base is not what Unicode's decomposition gives: the Polish ł, the Turkish dotless ı. */
const BASES: Record<string, string> = { ł: 'l', ı: 'i', ø: 'o', đ: 'd' }

/**
 * One letter of a (lower-case) word as a pattern: the Turkish i in every form (and the combining dot a lower-cased «İ»
 * leaves), a letter with an accent or a mark also without it, ß also as «ss»; any other character as it is (escaped).
 */
function letterPattern(char: string) {
  if (char === 'i' || char === 'ı') return '[iıİI]\\u0307?'
  if (char === 'ß') return '(?:ß|ss)'
  const base = BASES[char] ?? char.normalize('NFD').replace(/\p{M}/gu, '')
  if (base && base !== char && /^\p{L}$/u.test(base)) return `[${char}${base}]`
  return escape(char)
}

/** Japanese or Chinese at that end: no word boundary there. */
const touches = (char: string | undefined) => Boolean(char && CJK_CHAR.test(char))

/**
 * One word or phrase of the game as a pattern source (see above). `bang: 'required'`: its «!» must be read (Polish
 * «ukończone!» is ready to hand in, «ukończone» handed in).
 */
export function gameWordPattern(text: string, options: { bang?: 'required' } = {}) {
  const trimmed = text.trim()
  const lead = /^[¡¿]/.test(trimmed)
  const cleaned = trimmed.replace(/^[¡¿]+/, '').replace(/[\s!！:：]+$/u, '').trim()
  if (!cleaned) return ''
  // «İ» lower-cased by hand: toLowerCase() leaves «i» and a combining dot.
  const lower = cleaned.replace(/İ/g, 'i').toLowerCase()
  let body = ''
  for (const char of lower) {
    if (char === '(' || char === '（') body += '[(（]\\s*'
    else if (char === ')' || char === '）') body += '\\s*[)）]'
    else if (/\s/.test(char)) body += '\\s*'
    else body += letterPattern(char)
  }
  const before = touches(cleaned[0]) ? '' : '(?<![\\p{L}\\p{N}])'
  const after = touches(cleaned.at(-1)) ? '' : '(?![\\p{L}])'
  // A Spanish «¡» before the word: optional, and the OCR may read it as «i», «!», «|» or «l».
  const opening = lead ? '(?:[¡¿!|il1]\\s*)?' : ''
  // A required «!» right after the word: the OCR may read it as «|», «l» or «1», never as the digits of «100%».
  const ending = options.bang === 'required' ? '(?:[!！|]|[l1](?!\\d))' : '\\s*[!！:：]?'
  return `${before}${opening}${body}${ending}${after}`
}

/** Any of the wordings, as one pattern source (none: a pattern that never matches). */
export function anyGameWord(list: readonly string[], options: { bang?: 'required' } = {}) {
  const parts = [...new Set(list.map((word) => gameWordPattern(word, options)).filter(Boolean))]
  return parts.length ? `(?:${parts.join('|')})` : '(?!)'
}

/** The bare words of a list without their «!» («ukończone!» → «ukończone»), for comparing roles. */
const bare = (list: readonly string[]) => list.map((word) => word.trim().replace(/^[¡¿]+/, '').replace(/[\s!！]+$/u, '').toLowerCase())

const cache = new Map<ExtraGameLanguage, LanguageWords>()

/** The patterns of a game language; null for Russian and English (and an unknown language). */
export function languageWords(language: GameLanguage | null | undefined): LanguageWords | null {
  const extra = extraGameLanguage(language)
  if (!extra) return null
  const known = cache.get(extra)
  if (known) return known
  const words = GAME_WORDS[extra]
  const flags = 'iu'
  // «ukończone!» (ready) and «ukończone» (handed in): the ready one only with its «!».
  const readyNeedsBang = bare(words.status.ready).some((word) => bare(words.status.done).includes(word))
  const status = {
    ready: new RegExp(anyGameWord(words.status.ready, readyNeedsBang ? { bang: 'required' } : {}), flags),
    active: new RegExp(anyGameWord(words.status.active), flags),
    failed: new RegExp(anyGameWord(words.status.failed), flags),
    locked: new RegExp(anyGameWord(words.status.locked), flags),
    available: new RegExp(anyGameWord(words.status.available), flags),
  }
  const statusWord = `(?:${[status.active, status.ready, status.failed, status.locked, status.available].map((pattern) => pattern.source).join('|')})`
  const chrome = [
    ...words.columns.flat(), ...words.tasks, ...words.operational, ...words.taskItems, ...words.paneHeadings, ...words.menu, ...words.notTasks,
    ...words.anyLocation, ...Object.values(words.status).flat(), ...words.trader.attitude, ...words.trader.loyalty, ...words.trader.showLocked,
    ...Object.values(words.maps),
  ]
  const entry: LanguageWords = {
    language: extra,
    words,
    status,
    statusWord,
    anyLocation: anyGameWord(words.anyLocation),
    maps: anyGameWord(Object.values(words.maps)),
    chromeLine: new RegExp(`^${anyGameWord(chrome)}$`, flags),
    traderScreen: new RegExp(anyGameWord([...words.trader.attitude, ...words.trader.loyalty, ...words.trader.showLocked, ...words.trader.nextLevel, ...words.trader.you]), flags),
    notTasks: new RegExp(anyGameWord(words.notTasks), flags),
    word: (text) => gameWordPattern(text),
    any: (list) => anyGameWord(list),
  }
  cache.set(extra, entry)
  return entry
}
