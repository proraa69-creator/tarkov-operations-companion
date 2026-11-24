/**
 * The game's «Выбор профиля и режима» screen (owner's screenshot, 13.10.2026). The game shows it on every start: one card
 * per mode — «PvE Zone», «PvP Zone», «PvP Season» — each with «<ник> | <уровень>» under the character. Read on the
 * player's own computer (electron/screenOcr.ts; no picture leaves it), it gives the nickname and the level of every mode
 * at once («после обнаружения этого экрана, приложение моментально корректирует все данные по этим данным»).
 *
 * No guessing («что бы он не брал случайные цифры»): a level counts only when two independent readings agree — an OCR
 * reading of its line and its digits read from their shapes (src/import/levelDigits.ts) — and it is one the game has
 * (1–79). OCR alone is not enough (player's report, 14.10.2026: PvE 39 shown as 59): Tesseract takes the game's «3» for a
 * «5» about every other time, and the whole-screen pass, the close-up and two frames of this still screen all look at
 * the same pixels, so they agreed on «59». The nickname is confirmed on its own, whatever the level (audit P4e): when the
 * whole pass and the close-up read the same one, or — the whole pass missed the line — the close-ups of two frames did.
 */
import type { RaidMode } from '../domain/types.js'
import type { OcrWordBox, PaneRect } from './storyPaneLayout.js'
import { joinCjkWords } from '../shared/cjk.js'
import type { GameLanguage } from './gameLanguage.js'
import { languageWords } from './gameWordPatterns.js'

/** The highest character level in the game (src/profile/playerLevels.ts). */
export const MAX_PLAYER_LEVEL = 79
const NICKNAME = /^[A-Za-z0-9_-]{3,15}$/

export interface NameLevel { nickname: string; level: number }
/** A card's confirmed level and its confirmed nickname, each when two readings agreed on it; at least one of them. */
export interface ModeSelectCard { mode: RaidMode; level?: number; nickname?: string }

/** A card found on the screen: its mode, where its «ник | уровень» line is looked for and what the whole pass read. */
export interface ModeSelectHeader {
  mode: RaidMode
  /** The band under the card's title where the line is (the whole pass may have missed it). */
  band: PaneRect
  /** The line as the whole-screen pass read it, with its box. */
  full?: NameLevel & { box: PaneRect }
}

/** Cyrillic letters Tesseract («rus+eng») gives for the Latin ones they look like. */
const LOOKALIKES: Record<string, string> = {
  А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', У: 'Y', Х: 'X',
  а: 'a', е: 'e', к: 'k', м: 'm', о: 'o', р: 'p', с: 'c', т: 't', у: 'y', х: 'x', І: 'I', і: 'i',
}

export function latinize(text: string) {
  return text.replace(/[А-яІі]/g, (char) => LOOKALIKES[char] ?? char)
}

const token = (text: string) => latinize(text).toLowerCase().replace(/[^a-z0-9]/g, '')
const MODE = /^p[vyu]([ep])$/
const ZONE = /^[z2][o0][nh]e$/
const SEASON = /^s[ec]a[s5][o0][nh]$/
const JOINED = /^p[vyu]([ep])([z2][o0][nh]e|s[ec]a[s5][o0][nh])$/

/** The game's interface scales with the screen height (and with the width on screens narrower than 16:9). */
export function interfaceUnit(size: { width: number; height: number }) {
  return Math.min(size.height, size.width * 9 / 16)
}

/** «Raid_OS» and «Raid_0S», «RaidOS», «raid-os» are the same nickname to the eye of the OCR (I/l/1, O/0, S/5, _ and -). */
export function foldNickname(value: string) {
  return value.toLowerCase().replace(/[_\-\s]/g, '').replace(/0/g, 'o').replace(/[1l|]/g, 'i').replace(/5/g, 's')
}

/**
 * «♛ Raid_OS | 41» → Raid_OS, 41. The icon before the name (edition) reads as anything and is dropped; the bar between
 * the name and the level reads as «|», «l», «I», «1», «!» or not at all. Lines without a valid name and level give null.
 */
export function parseNameLevel(line: string): NameLevel | null {
  const text = latinize(line).replace(/[«»"'`“”]/g, ' ').replace(/\s+/g, ' ').trim()
  const name = '([A-Za-z0-9_-]{3,15})'
  const patterns = [
    new RegExp(`${name} [|lI1!/\\\\]+ (\\d{1,2})$`), // «Raid_OS | 41»
    new RegExp(`${name} ?[|!/\\\\](\\d{1,2})$`), // «Raid_OS |41», «Raid_OS|41»
    new RegExp(`${name} [lI](\\d{1,2})$`), // «Raid_OS l41»
    new RegExp(`${name} 1(\\d{2})$`), // «Raid_OS 141»: the bar read as «1» and joined to the level
    new RegExp(`${name} (\\d{1,2})$`), // the bar not read at all
  ]
  for (const [index, pattern] of patterns.entries()) {
    const match = pattern.exec(text)
    if (!match) continue
    const nickname = match[1]!
    const level = Number(match[2])
    // «141» is the bar and 41 only when 141 cannot be a level (it never can: the cap is 79).
    if (index === 3 && Number(`1${match[2]}`) <= MAX_PLAYER_LEVEL) continue
    if (!NICKNAME.test(nickname) || !/[A-Za-z]/.test(nickname) || !Number.isInteger(level) || level < 1 || level > MAX_PLAYER_LEVEL) continue
    return { nickname, level }
  }
  return null
}

/** The first line of a block of OCR text that is a card's «ник | уровень». */
export function findNameLevel(text: string): NameLevel | null {
  for (const line of text.split(/\r?\n/)) {
    const found = parseNameLevel(line)
    if (found) return found
  }
  return null
}

/**
 * The modes' names as a German, Japanese or Chinese game writes them («PVE-ZONE», «PVE区域»: the game's localisation,
 * src/import/gameWords.ts) turned into the English «pve zone» / «pvp zone» the readers look for. Russian and English
 * text, and every other word, stay as they are.
 */
export function withEnglishModes(text: string, language?: GameLanguage | null) {
  const words = languageWords(language)
  if (!words) return text
  let out = text
  for (const [mode, names] of [['pve', words.words.modes.pve], ['pvp', words.words.modes.pvp]] as const) {
    if (names.length) out = out.replace(new RegExp(words.any(names), 'giu'), `${mode} zone`)
  }
  // The Chinese cards' «区域» (zone) read apart from «PVE».
  if (words.language === 'zh') out = out.replace(/区域/g, ' zone')
  return out
}

/** The screen's own words: its title or at least two mode cards. */
export function isModeSelectText(text: string, language?: GameLanguage | null) {
  const latin = latinize(withEnglishModes(text, language)).toLowerCase()
  const title = /выбор\s+профил[а-я]*\s+и\s+режим/i.test(text) || /profile\s+and\s+mode|select\s+(a\s+)?(profile|mode)/.test(latin)
  const modes = new Set<string>()
  for (const match of latin.matchAll(/p[vyu]([ep])\s*([z2][o0][nh]e|s[ec]a[s5][o0][nh])/g)) modes.add(`${match[1]}${match[2]![0] === 's' ? 's' : 'z'}`)
  return modes.size >= 2 || (title && modes.size >= 1)
}

const middleOf = (box: OcrWordBox['bbox']) => (box.y0 + box.y1) / 2

function clampRect(rect: PaneRect, size: { width: number; height: number }): PaneRect {
  const x = Math.max(0, Math.min(size.width - 1, Math.round(rect.x)))
  const y = Math.max(0, Math.min(size.height - 1, Math.round(rect.y)))
  return { x, y, width: Math.max(1, Math.min(size.width - x, Math.round(rect.width))), height: Math.max(1, Math.min(size.height - y, Math.round(rect.height))) }
}

/**
 * The mode cards of the screen from the whole-screen pass's words: each title («PvE Zone», «PvP Zone», «PvP Season»), the
 * band under it where the card's «ник | уровень» line is (measured on the owner's screenshot: the line is about half an
 * interface unit under the title, the card about a third of a unit wide) and that line, when the pass read it.
 * Two titles of one mode, or titles at different heights, are not this screen: nothing is returned.
 */
export function modeSelectHeaders(words: OcrWordBox[], size: { width: number; height: number }, language?: GameLanguage | null): ModeSelectHeader[] {
  const unit = interfaceUnit(size)
  const found: Array<{ mode: RaidMode; x0: number; middle: number }> = []
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]!
    const first = token(withEnglishModes(word.text, language))
    let mode: RaidMode | undefined
    const joined = JOINED.exec(first)
    // «STREFA PVE», «ZONA PVE», «ZONE JcE», «PVE BÖLGESİ»: two words of the game's own name of the mode, its zone word first
    // or last (src/import/gameWords.ts); the next word on the same row is read with it.
    const pair = language && words[index + 1] && Math.abs(middleOf(words[index + 1]!.bbox) - middleOf(word.bbox)) <= Math.max(6, word.bbox.y1 - word.bbox.y0)
      ? JOINED.exec(token(withEnglishModes(`${word.text} ${words[index + 1]!.text}`, language))) : null
    if (joined) mode = joined[2]![0] === 's' ? 'seasonal' : joined[1] === 'e' ? 'pve' : 'pvp'
    else if (pair) {
      mode = pair[2]![0] === 's' ? 'seasonal' : pair[1] === 'e' ? 'pve' : 'pvp'
      index += 1
    } else {
      const head = MODE.exec(first)
      const next = words[index + 1]
      if (!head || !next || Math.abs(middleOf(next.bbox) - middleOf(word.bbox)) > Math.max(6, word.bbox.y1 - word.bbox.y0)) continue
      const second = token(withEnglishModes(next.text, language))
      if (SEASON.test(second)) mode = 'seasonal'
      else if (ZONE.test(second)) mode = head[1] === 'e' ? 'pve' : 'pvp'
    }
    if (!mode) continue
    if (found.some((entry) => entry.mode === mode)) return []
    found.push({ mode, x0: word.bbox.x0, middle: middleOf(word.bbox) })
  }
  if (!found.length || found.some((entry) => Math.abs(entry.middle - found[0]!.middle) > unit * 0.04)) return []
  return found.map(({ mode, x0, middle }) => {
    const column = { x0: x0 - unit * 0.075, x1: x0 + unit * 0.28 }
    const band = clampRect({ x: column.x0, y: middle + unit * 0.4, width: column.x1 - column.x0, height: unit * 0.18 }, size)
    const full = lineInBand(words, band)
    return { mode, band, ...(full ? { full: { ...full.reading, box: clampRect(padBox(full.box, unit), size) } } : {}) }
  })
}

function padBox(box: OcrWordBox['bbox'], unit: number): PaneRect {
  return { x: box.x0 - unit * 0.03, y: box.y0 - unit * 0.012, width: box.x1 - box.x0 + unit * 0.06, height: box.y1 - box.y0 + unit * 0.024 }
}

/** The nickname's letters are this high (the players' screenshots: 13–16 px at 1080p). */
const NAME_HEIGHT = 0.015

/**
 * The nickname's box as high as its row: the whole pass sometimes gives the name the height of the emblem beside it (36 px
 * on the French traders' screenshot, its letters 13), and a close-up of that reads nothing. Middle kept.
 */
function nameRowBox(box: OcrWordBox['bbox'], unit: number): OcrWordBox['bbox'] {
  if (box.y1 - box.y0 <= unit * NAME_HEIGHT * 2) return box
  const middle = (box.y0 + box.y1) / 2
  return { ...box, y0: middle - (unit * NAME_HEIGHT) / 2, y1: middle + (unit * NAME_HEIGHT) / 2 }
}

/** The whole pass's words inside the band, row by row (left to right), and the first row that is «ник | уровень». */
function lineInBand(words: OcrWordBox[], band: PaneRect): { reading: NameLevel; box: OcrWordBox['bbox'] } | null {
  const inside = words.filter((word) => {
    const x = (word.bbox.x0 + word.bbox.x1) / 2
    const y = middleOf(word.bbox)
    return x >= band.x && x <= band.x + band.width && y >= band.y && y <= band.y + band.height
  }).sort((a, b) => middleOf(a.bbox) - middleOf(b.bbox))
  const rows: OcrWordBox[][] = []
  for (const word of inside) {
    const row = rows.at(-1)
    const last = row?.at(-1)
    if (row && last && Math.abs(middleOf(word.bbox) - middleOf(last.bbox)) <= Math.max(4, (last.bbox.y1 - last.bbox.y0) * 0.6)) row.push(word)
    else rows.push([word])
  }
  for (const row of rows) {
    row.sort((a, b) => a.bbox.x0 - b.bbox.x0)
    const reading = parseNameLevel(row.map((word) => word.text).join(' '))
    if (!reading) continue
    return {
      reading,
      box: { x0: Math.min(...row.map((word) => word.bbox.x0)), y0: Math.min(...row.map((word) => word.bbox.y0)), x1: Math.max(...row.map((word) => word.bbox.x1)), y1: Math.max(...row.map((word) => word.bbox.y1)) },
    }
  }
  return null
}

/**
 * One card's readings in one frame: the whole-screen pass, the close-up of its line, and `digits` — the number the
 * level's glyphs in the close-up show by their shapes (src/import/levelDigits.ts), for each count of digits the OCR
 * readings have (null: the shapes could not be read).
 */
export interface CardReadings { mode: RaidMode; full?: NameLevel; line?: NameLevel; digits?: Partial<Record<number, number | null>> }

/** An OCR reading of a level that the digits' shapes confirm. */
function shapedLevel(level: number | null | undefined, digits: CardReadings['digits']) {
  return typeof level === 'number' && digits?.[String(level).length] === level ? level : undefined
}

/**
 * Each card's level and nickname, each confirmed on its own (audit P4e: a clear «Raid_OS» next to a «39» whose shapes
 * could not be read gave nothing at all before). The level: an OCR reading (the close-up or the whole pass) the digits'
 * shapes agree on — two OCR readings agreeing are not enough, nor the same close-up in two frames: the screen does not
 * move, so they look at the same pixels and share a misread «3». The nickname: the whole pass and the close-up read it
 * alike; when the whole pass missed the line, the close-up and the previous frame's close-up of that card (`earlier`)
 * did. A name has no look-alike digit to share (foldNickname folds what OCR mixes up), and the newest reading wins later.
 */
export function confirmCards(readings: CardReadings[], earlier: Partial<Record<RaidMode, string>> = {}): ModeSelectCard[] {
  const confirmed: ModeSelectCard[] = []
  for (const { mode, full, line, digits } of readings) {
    const level = shapedLevel(line?.level, digits) ?? shapedLevel(full?.level, digits)
    const before = earlier[mode]
    const nickname = !line ? undefined
      : full ? (foldNickname(full.nickname) === foldNickname(line.nickname) ? line.nickname : undefined)
        : before && foldNickname(before) === foldNickname(line.nickname) ? line.nickname : undefined
    if (level === undefined && !nickname) continue
    confirmed.push({ mode, ...(level !== undefined ? { level } : {}), ...(nickname ? { nickname } : {}) })
  }
  return confirmed
}

/**
 * The nickname the cards show: one name on every card that has one (the same character name in every mode). The
 * spelling the app already knows wins when the screen shows the same name (OCR may read «Raid_0S»); cards that disagree
 * give null.
 */
export function screenNickname(cards: Array<Pick<ModeSelectCard, 'nickname'>>, known?: string | null) {
  const names = cards.map((card) => card.nickname).filter((name): name is string => Boolean(name))
  if (!names.length) return null
  const folded = foldNickname(names[0]!)
  if (names.some((name) => foldNickname(name) !== folded)) return null
  if (known && foldNickname(known) === folded) return known
  const counts = new Map<string, number>()
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0]
}

/** The words of each line of a Tesseract result (its `blocks` output), Japanese and Chinese runs one word each. */
export function ocrLines(blocks: Array<{ paragraphs: Array<{ lines: Array<{ words: OcrWordBox[] }> }> }> | null | undefined): OcrWordBox[][] {
  return (blocks ?? []).flatMap((block) => block.paragraphs.flatMap((paragraph) => paragraph.lines.map((line) => joinCjkWords(line.words))))
}

const hasDigit = (word: OcrWordBox) => /\d/.test(word.text)

/**
 * Where the level is in a close-up of a card: the last word with digits on the line that reads «ник | уровень». When the
 * close-up is of that line alone (`lineOnly`), its last word with digits even if the rest of it was misread.
 */
export function cardLevelWord(lines: OcrWordBox[][], lineOnly: boolean): OcrWordBox | null {
  const named = lines.find((words) => parseNameLevel(words.map((word) => word.text).join(' ')))
  const words = named ?? (lineOnly ? lines.flat() : [])
  return words.filter(hasDigit).at(-1) ?? null
}

// ------------------------------------------------------------------------------------------------------------
// The traders' screen (owner's screenshot, 13.10.2026: «на этом экране торговцы, можешь брать актуальный уровень и ник,
// игроки часто бывают в этом экране»): top right «Raid_OS (вы)», the level by the portrait and «Текущее отношение:
// LVL 12» — the level of the mode the game is in now. «Следующий УЛ: LVL 6» is a trader's requirement, never read.
// ------------------------------------------------------------------------------------------------------------

/** The traders' screen: the standing line and the player's own name marked «(вы)» / «(you)». */
export function isTraderScreenText(text: string, language?: GameLanguage | null) {
  // The English game says «Current attitude:» (owner's PvE screenshot, 14.10.2026).
  if (/текущее\s+отношени|current\s+(?:standing|attitude)/i.test(text) && YOU_MARK.test(text)) return true
  // German, Japanese, Chinese: «Aktuelles Ansehen:» and «(Du)», «現在の状態:» and «(あなた)», «商人当前态度:» and «(你)».
  const marks = traderMarks(language)
  return Boolean(marks && marks.attitude.test(text) && (marks.you.test(text) || marks.youLoose?.test(text)))
}

/**
 * A Japanese or Chinese «(あなた)» / «(你)» after the nickname, one character of it misread («(あなだ)», «(从»: the
 * pictures of scripts/ocr/language-fixtures.mjs): a Latin name, then a bracket and one to four other characters.
 */
const CJK_YOU = /[A-Za-z0-9_-]{2,15}\s*[(（]\s*[^\s()（）A-Za-z0-9]{1,4}\s*[)）]?/u

/** The traders' screen's words in a German, Japanese or Chinese game (the game's localisation); null in the others. */
function traderMarks(language?: GameLanguage | null) {
  const words = languageWords(language)
  if (!words) return null
  const { attitude, you } = words.words.trader
  // «(Du)» → «Du»; «(내 정보)» → «내 정보» (the OCR makes two words of it: «(내» and «정보)»).
  const bare = you.map((mark) => mark.replace(/[()（）]/g, '').trim()).filter(Boolean)
  const firsts = bare.map((mark) => mark.split(/\s+/)[0]!)
  const starts = attitude.map((phrase) => phrase.split(/\s+/)[0]!.replace(/[:：]+$/, '')).filter(Boolean)
  return {
    attitude: new RegExp(words.any(attitude), 'iu'),
    you: new RegExp(words.any(you), 'iu'),
    /** «(Du)» as one word, maybe its brackets split off or lost; a mark of two words by its first. */
    // A Japanese closing bracket may come out as «〕» or «」» («SHAUUURMA (あなた〕» on the players' screenshots).
    youWord: new RegExp(`^[(（]?\\s*${words.any(firsts)}\\s*[)）〕」]?$`, 'iu'),
    youInText: new RegExp(`[(（]\\s*${words.any(bare)}\\s*[)）〕」]`, 'giu'),
    /** The standing row's first word («Aktuelles»), or the whole phrase as the Japanese and Chinese OCR give it. */
    attitudeStart: new RegExp(`^${words.any(starts)}`, 'iu'),
    /**
     * A Japanese or Chinese standing phrase the OCR cut in pieces («商人» «当前态度»): a word of two characters or more
     * that starts the phrase.
     */
    attitudePiece: (text: string) => {
      const piece = text.replace(/[^\p{L}]/gu, '')
      return (words.language === 'ja' || words.language === 'zh') && piece.length >= 2 && starts.some((phrase) => phrase.replace(/[^\p{L}]/gu, '').startsWith(piece))
    },
    youLoose: words.language === 'ja' || words.language === 'zh' ? CJK_YOU : null,
  }
}

const LEVEL_WORD = /^(lvl|lvi|lv1|lul|iv1|ivl)$/
/** «(вы)» after the player's own name («ву»: the Russian model's other reading), «(you)» in English. */
const YOU_MARK = /\(\s*(вы|ву|you)\s*\)/i
const YOU_WORD = /^\(?(вы|ву|you)\)?$/i

/**
 * Where the traders' screen shows the nickname and the level, from the whole pass's words: the word before «(вы)» and
 * the number after «LVL» on the row that starts «Текущее отношение» / «Current standing». Each comes with its box for a
 * close-up; what the pass read is checked against that close-up (electron/screenOcr.ts).
 */
export function traderScreenParts(words: OcrWordBox[], size: { width: number; height: number }, language?: GameLanguage | null) {
  const unit = interfaceUnit(size)
  const marks = traderMarks(language)
  const sameRow = (a: OcrWordBox, b: OcrWordBox) => Math.abs(middleOf(a.bbox) - middleOf(b.bbox)) <= Math.max(5, (a.bbox.y1 - a.bbox.y0) * 0.7)
  let nickname: { value: string; box: PaneRect } | undefined
  let level: { value: number; box: PaneRect } | undefined
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]!
    // «(вы)» (or «(you)»), maybe split as «(вы» «)»; the name is the word before it on the same row.
    if (!nickname && (YOU_WORD.test(word.text.trim()) || marks?.youWord.test(word.text.trim()))) {
      const before = words[index - 1]
      const name = before ? before.text.replace(/[^A-Za-z0-9_-]/g, '') : ''
      if (before && sameRow(before, word) && NICKNAME.test(latinize(name)) && /[A-Za-z]/.test(latinize(name))) {
        nickname = { value: latinize(name), box: clampRect(padBox(marks ? nameRowBox(before.bbox, unit) : before.bbox, unit), size) }
      }
    }
    // «Текущее отношение» … «LVL» «12» on one row.
    if (!level && (/^(текущее|current)$/i.test(word.text.replace(/[^A-Za-zА-яЁё]/g, '')) || marks?.attitudeStart.test(word.text.trim()) || marks?.attitudePiece(word.text))) {
      const row = words.slice(index + 1, index + 12).filter((other) => sameRow(other, word))
      for (let at = 0; at + 1 < row.length; at += 1) {
        if (!LEVEL_WORD.test(token(row[at]!.text))) continue
        const digits = row[at + 1]!.text.replace(/[^0-9]/g, '')
        const value = Number(digits)
        if (!/^\d{1,2}$/.test(digits) || value < 1 || value > MAX_PLAYER_LEVEL) break
        const a = row[at]!.bbox, b = row[at + 1]!.bbox
        level = { value, box: clampRect(padBox({ x0: a.x0, y0: Math.min(a.y0, b.y0), x1: b.x1, y1: Math.max(a.y1, b.y1) }, unit), size) }
        break
      }
      // A German, Polish… game (the players' screenshots, 24.11.2026): «LVL 69» read as one word, «wi69», «ıı69» — before any
      // lone number of the row. The close-up still has to read «LVL 69» and its digits' shapes agree (confirmTraderLevel).
      if (!level && marks) {
        // A letter of «LVL» in it, not digits only («125» is the standing «1.25»).
        const glued = row.find((other) => /^(?=[^\d]|1[^\d])[lvwiı1|]{1,3}\d{1,2}$/i.test(other.text.trim()))
        const digits = glued ? Number(/\d{1,2}$/.exec(glued.text.trim())![0]) : NaN
        if (glued && digits >= 1 && digits <= MAX_PLAYER_LEVEL) level = { value: digits, box: clampRect(padBox(glued.bbox, unit), size) }
      }
      // «LVL» itself misread («[J wi 41» in the English game): the row's first one- or two-digit word, with the word before
      // it, so the close-up still sees «LVL 41» and has to read it (confirmTraderLevel).
      // A game beyond Russian and English: never a number that starts with 0 (the Turkish standing «6.02» read «02»).
      const at = level ? -1 : row.findIndex((other) => (marks ? /^[1-9]\d?$/ : /^\d{1,2}$/).test(other.text.trim()))
      const value = at >= 1 ? Number(row[at]!.text.trim()) : NaN
      if (at >= 1 && value >= 1 && value <= MAX_PLAYER_LEVEL) {
        const a = row[at - 1]!.bbox, b = row[at]!.bbox
        level = { value, box: clampRect(padBox({ x0: a.x0, y0: Math.min(a.y0, b.y0), x1: b.x1, y1: Math.max(a.y1, b.y1) }, unit), size) }
      }
    }
  }
  // A German, Japanese… game whose «(Du)» / «(あなた)» the OCR misread («(257272)»): the name-like word right before an opening
  // bracket on its row, in the top right of the screen (not a trader's words below it: «watching you (…»). The close-up still
  // has to read the same name (electron/screenOcr.ts).
  if (!nickname && marks) {
    for (let index = 0; index + 1 < words.length; index += 1) {
      const word = words[index]!, next = words[index + 1]!
      const name = word.text.replace(/[^A-Za-z0-9_-]/g, '')
      if (word.bbox.y1 > size.height * 0.12 || word.bbox.x0 < size.width * 0.5 || !/^[(（]/.test(next.text.trim()) || !sameRow(word, next)) continue
      if (!NICKNAME.test(latinize(name)) || !/[A-Za-z]/.test(latinize(name))) continue
      nickname = { value: latinize(name), box: clampRect(padBox(nameRowBox(word.bbox, unit), unit), size) }
      break
    }
  }
  return { nickname, level }
}

/** The level a close-up of «LVL 12» reads. */
export function parseTraderLevel(text: string) {
  const match = /(?:lvl|lvi|lv1|lul)\s*[:.]?\s*(\d{1,2})\b/i.exec(latinize(text).replace(/\s+/g, ' '))
  const value = match ? Number(match[1]) : NaN
  return Number.isInteger(value) && value >= 1 && value <= MAX_PLAYER_LEVEL ? value : null
}

/** Where the level is in a close-up of «LVL 12»: the word after «LVL» (or «LVL12» itself), else the first word with digits. */
export function traderLevelWord(lines: OcrWordBox[][]): OcrWordBox | null {
  const words = lines.flat()
  const at = words.findIndex((word) => /^(lvl|lvi|lv1|lul|iv1|ivl)/.test(token(word.text)))
  if (at >= 0) return words.slice(at).find(hasDigit) ?? null
  return words.find(hasDigit) ?? null
}

/**
 * The traders' level two readings agree on, one of them the digits' shapes (`digits`, by count of digits): the close-up
 * or the whole pass with the shapes. The whole pass and the close-up alone read the game's «39» as «59» together.
 */
export function confirmTraderLevel(whole: number | undefined, close: number | null, digits: CardReadings['digits']) {
  return shapedLevel(close, digits) ?? shapedLevel(whole, digits)
}

/** The nickname a close-up of «Raid_OS» reads (the icon or «(вы)» around it dropped). */
export function parseTraderNickname(text: string, language?: GameLanguage | null) {
  const marks = traderMarks(language)
  const words = latinize(marks ? text.replace(marks.youInText, ' ') : text).replace(/\((вы|ву|you)\)/gi, ' ').split(/\s+/)
    // A German, Portuguese… game: its mark read wrong is still in brackets («(vot)» for «(você)»), never the name.
    .map((part) => (marks ? part.replace(/[(（].*$/u, '').replace(/^.*[)）〕」]$/u, '') : part))
    .map((part) => part.replace(/[^A-Za-z0-9_-]/g, '')).filter((part) => NICKNAME.test(part) && /[A-Za-z]/.test(part))
  return words.at(-1) ?? null
}

/**
 * What the traders' screen gives once the whole pass and the close-ups agree; `loyalty`: each trader's loyalty level
 * from the badges two frames agree on (src/import/traderLoyalty.ts), by trader key.
 */
export interface TraderScreenReading { nickname?: string; level?: number; loyalty?: Record<string, number> }
