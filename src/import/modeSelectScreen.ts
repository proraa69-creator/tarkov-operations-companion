/**
 * The game's «Выбор профиля и режима» screen (owner's screenshot, 13.10.2026). The game shows it on every start: one card
 * per mode — «PvE Zone», «PvP Zone», «PvP Season» — each with «<ник> | <уровень>» under the character. Read on the
 * player's own computer (electron/screenOcr.ts; no picture leaves it), it gives the nickname and the level of every mode
 * at once («после обнаружения этого экрана, приложение моментально корректирует все данные по этим данным»).
 *
 * No guessing («что бы он не брал случайные цифры»): a card counts only when two independent readings agree — the
 * whole-screen pass and a close-up of its line, or close-ups of two frames — and the level is one the game has (1–79).
 */
import type { RaidMode } from '../domain/types.js'
import type { OcrWordBox, PaneRect } from './storyPaneLayout.js'

/** The highest character level in the game (src/profile/playerLevels.ts). */
export const MAX_PLAYER_LEVEL = 79
const NICKNAME = /^[A-Za-z0-9_-]{3,15}$/

export interface NameLevel { nickname: string; level: number }
export interface ModeSelectCard extends NameLevel { mode: RaidMode }

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

export const sameNameLevel = (a: NameLevel, b: NameLevel) => a.level === b.level && foldNickname(a.nickname) === foldNickname(b.nickname)

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

/** The screen's own words: its title or at least two mode cards. */
export function isModeSelectText(text: string) {
  const latin = latinize(text).toLowerCase()
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
export function modeSelectHeaders(words: OcrWordBox[], size: { width: number; height: number }): ModeSelectHeader[] {
  const unit = interfaceUnit(size)
  const found: Array<{ mode: RaidMode; x0: number; middle: number }> = []
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]!
    const first = token(word.text)
    let mode: RaidMode | undefined
    const joined = JOINED.exec(first)
    if (joined) mode = joined[2]![0] === 's' ? 'seasonal' : joined[1] === 'e' ? 'pve' : 'pvp'
    else {
      const head = MODE.exec(first)
      const next = words[index + 1]
      if (!head || !next || Math.abs(middleOf(next.bbox) - middleOf(word.bbox)) > Math.max(6, word.bbox.y1 - word.bbox.y0)) continue
      const second = token(next.text)
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

/** One card's readings in one frame: the whole-screen pass and the close-up of its line. */
export interface CardReadings { mode: RaidMode; full?: NameLevel; line?: NameLevel }

/**
 * The cards two readings agree on: the whole pass and the close-up of this frame, or a close-up (or whole pass) of this
 * frame and the last frame's. `seen` is what this frame read, for the next one.
 */
export function confirmCards(readings: CardReadings[], previous: Partial<Record<RaidMode, NameLevel>>) {
  const confirmed: ModeSelectCard[] = []
  const seen: Partial<Record<RaidMode, NameLevel>> = {}
  for (const { mode, full, line } of readings) {
    const current = line ?? full
    if (current) seen[mode] = current
    const before = previous[mode]
    const agreed = full && line && sameNameLevel(full, line) ? line
      : line && before && sameNameLevel(line, before) ? line
        : full && before && sameNameLevel(full, before) ? full
          : undefined
    if (agreed) confirmed.push({ mode, nickname: agreed.nickname, level: agreed.level })
  }
  return { confirmed, seen }
}

/**
 * The nickname the cards show: one name on every card (the same character name in every mode). The spelling the app
 * already knows wins when the screen shows the same name (OCR may read «Raid_0S»); cards that disagree give null.
 */
export function screenNickname(cards: Array<Pick<ModeSelectCard, 'nickname'>>, known?: string | null) {
  if (!cards.length) return null
  const folded = foldNickname(cards[0]!.nickname)
  if (cards.some((card) => foldNickname(card.nickname) !== folded)) return null
  if (known && foldNickname(known) === folded) return known
  const counts = new Map<string, number>()
  for (const card of cards) counts.set(card.nickname, (counts.get(card.nickname) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0]
}

// ------------------------------------------------------------------------------------------------------------
// The traders' screen (owner's screenshot, 13.10.2026: «на этом экране торговцы, можешь брать актуальный уровень и ник,
// игроки часто бывают в этом экране»): top right «Raid_OS (вы)», the level by the portrait and «Текущее отношение:
// LVL 12» — the level of the mode the game is in now. «Следующий УЛ: LVL 6» is a trader's requirement, never read.
// ------------------------------------------------------------------------------------------------------------

/** The traders' screen: the standing line and the player's own name marked «(вы)» / «(you)». */
export function isTraderScreenText(text: string) {
  return /текущее\s+отношени|current\s+standing/i.test(text) && YOU_MARK.test(text)
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
export function traderScreenParts(words: OcrWordBox[], size: { width: number; height: number }) {
  const unit = interfaceUnit(size)
  const sameRow = (a: OcrWordBox, b: OcrWordBox) => Math.abs(middleOf(a.bbox) - middleOf(b.bbox)) <= Math.max(5, (a.bbox.y1 - a.bbox.y0) * 0.7)
  let nickname: { value: string; box: PaneRect } | undefined
  let level: { value: number; box: PaneRect } | undefined
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]!
    // «(вы)» (or «(you)»), maybe split as «(вы» «)»; the name is the word before it on the same row.
    if (!nickname && YOU_WORD.test(word.text.trim())) {
      const before = words[index - 1]
      const name = before ? before.text.replace(/[^A-Za-z0-9_-]/g, '') : ''
      if (before && sameRow(before, word) && NICKNAME.test(latinize(name)) && /[A-Za-z]/.test(latinize(name))) {
        nickname = { value: latinize(name), box: clampRect(padBox(before.bbox, unit), size) }
      }
    }
    // «Текущее отношение» … «LVL» «12» on one row.
    if (!level && /^(текущее|current)$/i.test(word.text.replace(/[^A-Za-zА-яЁё]/g, ''))) {
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

/** The nickname a close-up of «Raid_OS» reads (the icon or «(вы)» around it dropped). */
export function parseTraderNickname(text: string) {
  const words = latinize(text).replace(/\((вы|ву|you)\)/gi, ' ').split(/\s+/).map((part) => part.replace(/[^A-Za-z0-9_-]/g, '')).filter((part) => NICKNAME.test(part) && /[A-Za-z]/.test(part))
  return words.at(-1) ?? null
}

/** What the traders' screen gives once the whole pass and the close-ups agree. */
export interface TraderScreenReading { nickname?: string; level?: number }
