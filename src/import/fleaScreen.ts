import type { RaidMode } from '../domain/types.js'
import { gameUiBox } from './storyPaneLayout.js'
import { colourAt, currencyOf, decodeDigitShapes, FLEA_LIST, luminance, priceBand, priceGlyphs, readDigits, screenPoint, type DigitSample, type FleaCurrency, type FleaLayout, type FleaPixels } from './fleaDigits.js'
import { FLEA_DIGIT_SHAPES } from './fleaDigitShapes.js'
import type { GameLanguage } from './gameLanguage.js'
import { foldTurkishI } from '../shared/cjk.js'
import { languageWords, umlautForms } from './gameWordPatterns.js'

/**
 * The flea market on the player's screen → the lowest price of the items it shows (docs/flea-prices-from-players.md;
 * owner, 18.11.2026: «берётся верхняя, то есть самая низкая цена, которая обнаружена на экране»). Pure: a screen copy in,
 * what can be read from its pixels out — the tab, the sort, the list's place, each row's price by its digits' shapes
 * (fleaDigits.ts). The names and sellers are read by OCR by the caller (fleaRowParts) and decided on here (fleaSightings).
 * Laid out from the owner's screenshots of 18.11.2026 (1920×1080, PvE, PvP, Season).
 */

let samples: DigitSample[] | null = null
const digitSamples = () => (samples ??= decodeDigitShapes(FLEA_DIGIT_SHAPES))

/** The game's 16:9 menus on this screen: a wide screen has dark sides, its menus are those of a 16:9 one. */
export function fleaLayout(size: { width: number; height: number }): FleaLayout {
  const box = gameUiBox(size)
  return { left: box.x, top: box.y, unit: box.height / 1080 }
}

function meanLuminance(pixels: FleaPixels, layout: FleaLayout, x0: number, y0: number, x1: number, y1: number) {
  const [left, top] = screenPoint(layout, x0, y0)
  const [right, bottom] = screenPoint(layout, x1, y1)
  let sum = 0, count = 0
  for (let y = top; y < bottom; y += 1) for (let x = left; x < right; x += 1) { sum += luminance(pixels, x, y); count += 1 }
  return count ? sum / count : 0
}

export interface FleaScreenState {
  /** «БАРАХОЛКА» is the lit tab at the top (light box; «ТОРГОВЦЫ» beside it dark). */
  open: boolean
  /** The «Цена» column's chevron points up: cheapest first. */
  ascending: boolean
  /** The list is at its start (scrollbar at the top, or none: everything fits). */
  atTop: boolean
  /** «Покупать лоты других игроков… с 15 уровня»: the player's flea is locked, only traders' offers are listed. */
  locked: boolean
}

/** What the screen is, from a handful of pixels — cheap enough to look every 2 seconds while the game is in front. */
export function fleaScreenState(pixels: FleaPixels, layout = fleaLayout(pixels)): FleaScreenState {
  // Measured: the lit tab 204–222, the other 80–110.
  const open = meanLuminance(pixels, layout, 980, 20, 1148, 50) > 170 && meanLuminance(pixels, layout, 790, 20, 925, 50) < 140
  return { open, ascending: open && chevronUp(pixels, layout), atTop: open && scrolledToTop(pixels, layout), locked: open && bannerAt(pixels, layout, 0) }
}

/**
 * The chevron right of «Цена» (an outline): «^» spans little at its top row and widely at its bottom one (two legs), «v»
 * the other way round.
 */
function chevronUp(pixels: FleaPixels, layout: FleaLayout) {
  const [left, top] = screenPoint(layout, 1424, 112)
  const [right, bottom] = screenPoint(layout, 1446, 132)
  const spans: number[] = []
  for (let y = top; y < bottom; y += 1) {
    let first = -1, last = -1
    for (let x = left; x < right; x += 1) {
      if (luminance(pixels, x, y) <= 150) continue
      if (first < 0) first = x
      last = x
    }
    if (first >= 0) spans.push(last - first + 1)
  }
  return spans.length >= 3 && spans[0]! * 2 < spans[spans.length - 1]!
}

/** The scrollbar right of the list (x 1870 at 1080p, light): absent, or its thumb starts where the list starts. */
function scrolledToTop(pixels: FleaPixels, layout: FleaLayout) {
  const [, trackTop] = screenPoint(layout, 0, 140)
  const [, trackBottom] = screenPoint(layout, 0, FLEA_LIST.bottom)
  const [left] = screenPoint(layout, 1862, 0)
  const [right] = screenPoint(layout, 1880, 0)
  for (let y = trackTop; y < trackBottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      // The first light pixel down the track is the thumb's top.
      if (luminance(pixels, x, y) > 150) return y - trackTop <= 14 * layout.unit
    }
  }
  return true
}

/** The orange «from level 15» banner over a row's price band. */
function bannerAt(pixels: FleaPixels, layout: FleaLayout, row: number) {
  const band = priceBand(layout, row)
  let orange = 0, count = 0
  for (let y = band.y0; y < band.y1; y += 3) {
    for (let x = band.x0; x < band.x1; x += 3) {
      const [r, g, b] = colourAt(pixels, x, y)
      if (r > 170 && g > 60 && g < 150 && b < 80) orange += 1
      count += 1
    }
  }
  return orange > count * 0.5
}

export type FleaPrice =
  | { kind: 'empty' }
  | { kind: 'banner' }
  /** Grey «ЗАКРЫТО»: a trader's level not reached, an item above the player's flea level. Not read. */
  | { kind: 'dim' }
  | { kind: 'price'; value: number; currency: FleaCurrency; sure: boolean; digits: string }

/** The list's rows that fit above the menu bar (in the menus' own 1080p units, the same on any screen). */
export function fleaRowCount() {
  return Math.floor((FLEA_LIST.bottom - 50 - FLEA_LIST.firstRowTop) / FLEA_LIST.rowHeight) + 1
}

/** One row's price, read from its digits' shapes. */
export function readFleaPrice(pixels: FleaPixels, row: number, layout = fleaLayout(pixels), shapes = digitSamples()): FleaPrice {
  if (bannerAt(pixels, layout, row)) return { kind: 'banner' }
  const band = priceBand(layout, row)
  const glyphs = priceGlyphs(pixels, band, layout.unit)
  if (glyphs.length < 2) {
    // No ink: an empty row past the list's end, or a dim one (its digits ~60–100, the row's background ~5–30).
    let brightest = 0
    for (let y = band.y0; y < band.y1; y += 2) for (let x = band.x0; x < band.x1; x += 2) brightest = Math.max(brightest, luminance(pixels, x, y))
    return { kind: brightest > 55 ? 'dim' : 'empty' }
  }
  const read = readDigits(glyphs, shapes)
  return { kind: 'price', value: Number(read.digits), currency: currencyOf(glyphs[glyphs.length - 1]!.colour), sure: read.sure, digits: read.digits }
}

export function readFleaPrices(pixels: FleaPixels, layout = fleaLayout(pixels)): FleaPrice[] {
  return Array.from({ length: fleaRowCount() }, (_, row) => readFleaPrice(pixels, row, layout))
}

/** The parts of a row the caller reads by OCR (one line each), in screen pixels. */
export function fleaRowParts(layout: FleaLayout, row: number) {
  const top = FLEA_LIST.firstRowTop + row * FLEA_LIST.rowHeight
  const rect = (x0: number, y0: number, x1: number, y1: number) => fleaRect(layout, { x: x0, y: top + y0, width: x1 - x0, height: y1 - y0 })
  return {
    /** The seller: a player's nickname, or a trader's name («Прапор») beside the trader's level badge. */
    seller: rect(640, 6, 860, 28),
    /** The item's name (a long one cut with «…»; «Неизвестный предмет» for one the player has not examined). */
    name: rect(905, 8, 1330, 30),
    /** «Всего 1 ⚒ 40/40», a trader's «Всего 1670000 (лимит 3)». */
    info: rect(905, 30, 1330, 48),
  }
}

/** The version line at the bottom left (1080p): «1.3.0.2.48779 | PvE». */
export const FLEA_VERSION_LINE = { x: 0, y: 1018, width: 260, height: 32 }

/** A part of the menus (1080p) in screen pixels. */
export function fleaRect(layout: FleaLayout, part: { x: number; y: number; width: number; height: number }) {
  const [x, y] = screenPoint(layout, part.x, part.y)
  const [right, bottom] = screenPoint(layout, part.x + part.width, part.y + part.height)
  return { x, y, width: right - x, height: bottom - y }
}

/**
 * The filter chips above the list («Валюта EUR ×», «Сост. от 100 ×», «Кроме бартера ×»): each ends in a light «×» box
 * (13 px at 1080p, its top at y 60, the chip's words below it, y 74–86). Found by those boxes; the rects of the chips'
 * words, left to right, for the caller's OCR (fleaFilterAllows).
 */
export function fleaFilterChips(pixels: FleaPixels, layout: FleaLayout) {
  const [left, edgeTop] = screenPoint(layout, 600, 61)
  const [right, edgeBottom] = screenPoint(layout, 1180, 71)
  const boxes: Array<[number, number]> = []
  let start = -1
  for (let x = left; x <= right; x += 1) {
    // The box's top and bottom edges are solid (its × is dark inside): both light in a column of the box.
    const box = x < right && luminance(pixels, x, edgeTop) > 170 && luminance(pixels, x, edgeBottom) > 170
    if (box && start < 0) start = x
    if (!box && start >= 0) {
      if (x - start >= 8 * layout.unit && x - start <= 18 * layout.unit) boxes.push([start, x - 1])
      start = -1
    }
  }
  const [, wordsTop] = screenPoint(layout, 0, 72)
  const [, wordsBottom] = screenPoint(layout, 0, 88)
  const [first] = screenPoint(layout, 608, 0)
  return boxes.map(([boxLeft], index) => {
    const x = index ? boxes[index - 1]![1] + Math.round(4 * layout.unit) : first
    return { x, y: wordsTop, width: Math.max(1, boxLeft - x), height: wordsBottom - wordsTop }
  })
}

/**
 * A chip that leaves the cheapest offer of an item on top: a condition from N (hides worn copies only — the whole ones
 * are what is priced), and «Кроме бартера» (barters have no price). Any other — «Валюта EUR» (offers in other
 * currencies hidden), a price or a count range — may hide a cheaper offer: the list then gives no price at all. By its
 * first word, as the OCR reads it on the owner's frames («Kpome» on Season's green).
 */
export function fleaFilterAllows(chip: string, language?: GameLanguage | null) {
  if (/^\W*(сост|cond|кром|kpom|kpoм|крom|excl|without|no barter)/i.test(chip.trim())) return true
  // A German, Japanese or Chinese game: its own «Zustand von:» / «状態:» and «Tauschangebote ignorieren» / «物々交換を除外».
  const words = languageWords(language)
  if (!words) return false
  const firsts = [...words.words.flea.condition, ...words.words.flea.noBarter].map((word) => word.split(/\s+/)[0]!).filter(Boolean)
  return firsts.length > 0 && new RegExp(`^[^\\p{L}\\p{N}]*${words.any(firsts)}`, 'iu').test(chip.trim())
}

/** Cyrillic letters the OCR (Russian and English at once) reads the Latin «PvE» / «PvP S» as: «РУЕ», «РУР 5». */
const LOOKALIKES: Record<string, string> = { р: 'p', у: 'v', е: 'e', с: 'c', в: 'b', 5: 's', $: 's' }

/**
 * The mode the version line at the bottom left names: «1.3.0.2.48779 | PvE», «… | PvP S» (Season), nothing after the
 * version in plain PvP (the owner's frames of 18.11.2026; the app's engine reads them «РУЕ», «РУР 5»). Only a check: the
 * mode itself is the one the app follows from the game's logs (screenReadingMode.ts) — a label naming another mode
 * keeps the reading out. Null when no version was read, or what follows it is none of the three.
 */
export function fleaModeFromLabel(text: string): RaidMode | null {
  const version = /\d[.,:']\d+[.,:']\d+[.,:']\d+[.,:']\d{4,}/.exec(text)
  if (!version) return null
  const suffix = Array.from(text.slice(version.index + version[0].length).toLowerCase(), (char) => LOOKALIKES[char] ?? char).join('').replace(/[^a-z]/g, '')
  if (!suffix) return 'pvp'
  if (suffix === 'pve') return 'pve'
  if (suffix === 'pvps') return 'seasonal'
  return null
}

/** The traders who sell on the flea too (Russian and English names), folded as fold() does. */
const TRADERS = new Set(['прапор', 'терапевт', 'скупщик', 'лыжник', 'миротворец', 'механик', 'барахольщик', 'егерь', 'реф', 'смотритель', 'prapor', 'therapist', 'fence', 'skier', 'peacekeeper', 'mechanic', 'ragman', 'jaeger', 'ref', 'lightkeeper'])
const fold = (text: string) => text.toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я]/g, '')
/** A trader's stock: «Всего 1670000», «Всего 580000»; a player's offer is a few, a stack at most some thousands. */
const TRADER_STOCK = 100_000

/**
 * A trader's row: its seller is a trader — the name beside the trader's level badge, which the OCR reads as a word of
 * its own («99 Прапор», «EF Прапор», «Егерь Е:») — or its offer has a trader's «(лимит N)» (read «numut», «rum» too) or a
 * trader's stock. A nickname is one word: «Prapor_fan» is no trader.
 */
export function isTraderRow(seller: string, info: string, language?: GameLanguage | null) {
  const words = seller.split(/\s+/).map(fold).filter(Boolean)
  if (words.some((word) => TRADERS.has(word)) && words.every((word) => TRADERS.has(word) || word.length <= 3)) return true
  const stock = /(?:всего|total)\s*(\d+)/i.exec(info)
  if (/лимит|limit|numut/i.test(info) || (stock !== null && Number(stock[1]) >= TRADER_STOCK)) return true
  // A German, Japanese or Chinese game: its traders' names («Jäger»), «Gesamt» / «合計» and «Limit» / «上限».
  const own = languageWords(language)
  if (!own) return false
  const names = new Set(Object.values(own.words.traders).flatMap(umlautForms).map(foldAll))
  const sellerWords = seller.split(/\s+/).map(foldAll).filter(Boolean)
  if (sellerWords.some((word) => names.has(word)) && sellerWords.every((word) => names.has(word) || TRADERS.has(word) || word.length <= 3)) return true
  const total = own.words.flea.total.length ? new RegExp(`${own.any(own.words.flea.total)}\\s*(\\d+)`, 'iu').exec(info) : null
  return (own.words.flea.limit.length > 0 && new RegExp(own.any(own.words.flea.limit), 'iu').test(info)) || (total !== null && Number(total[1]) >= TRADER_STOCK)
}

/** A word of another script folded: lower case, its letters only (umlauts, characters). */
const foldAll = (text: string) => foldTurkishI(text).toLowerCase().replace(/[^\p{L}]/gu, '')

/** «⚒ 40/40» of the info line: the item's condition, null when the line names none (a stack has none). */
export function fleaCondition(info: string) {
  const match = /(\d+)\s*\/\s*(\d+)/.exec(info)
  return match ? { now: match[1]!, max: match[2]! } : null
}

/** Digits the OCR reads the game's small 0 as (owner's frames: «40/48», «49/40», «100/190», «180/100»). */
const ZERO_LIKE = /[689]/g

/**
 * Whole by its info line: no condition named, or both numbers the same — allowing for a 0 read as 8, 9 or 6. A number
 * read with a digit more («90/980», «358/38») is not taken for whole.
 */
export function wholeCondition(info: string) {
  const condition = fleaCondition(info)
  if (!condition) return true
  return condition.now.replace(ZERO_LIKE, '0') === condition.max.replace(ZERO_LIKE, '0')
}

/**
 * A key offered with all its uses (owner, 18.11.2026: «если у него 40 использований, должно быть 40 использований. Если
 * у него там 8 из 10 использований, значит, его не рассматриваем»): the info line names its uses, both numbers the same
 * (a 0 read as 8, 9 or 6 allowed for), and the most the catalog's — `uses` (0 or unknown: not checked).
 */
export function keyAllUses(info: string, uses?: number) {
  const condition = fleaCondition(info)
  if (!condition || !wholeCondition(info)) return false
  return !uses || condition.max.replace(ZERO_LIKE, '0') === String(uses).replace(ZERO_LIKE, '0')
}

export interface FleaRow {
  price: FleaPrice
  /** OCR of fleaRowParts' seller and info lines. */
  seller: string
  info: string
  /** The catalog item its name (fleaRowParts' name, OCR) is, or null when it names none for sure. */
  itemId: string | null
}

/** The catalog ids of the game's money. */
export const DOLLARS_ID = '5696686a4bdc2da3298b456a'
export const EUROS_ID = '569668774bdc2da2298b4568'

/** Roubles for one dollar and one euro in the player's mode (absent: not known, such an offer gives no price). */
export interface FleaRates { '$'?: number; '€'?: number }

/**
 * The game's rates: what a trader asks in roubles for a dollar (Peacekeeper) and a euro (Skier) — tarkov.dev's `buyFor`
 * of «Доллары» and «Евро», the flea itself left out. The flea sorts the offers of every currency by this: on the owner's
 * Season frame of 18.11.2026 336 € stood between 61 666 ₽ and 65 420 ₽ (183.5–194.7 ₽ a euro; Skier's euro 188 ₽ that
 * day, the handbook's 132 ₽ would have put it far higher up). Owner: «все цены указаны в рублях только. Если предмет в
 * евро, значит, переводи евро на рубли согласно курсу игры».
 */
export function fleaRates(items: ReadonlyArray<{ id?: unknown; buyFor?: ReadonlyArray<{ vendor?: { normalizedName?: unknown } | null; priceRUB?: unknown } | null> | null } | null>): FleaRates {
  const rate = (id: string) => {
    const offers = items.find((item) => item?.id === id)?.buyFor ?? []
    const prices = offers.flatMap((offer) => offer && offer.vendor?.normalizedName !== 'flea-market' && typeof offer.priceRUB === 'number' && Number.isFinite(offer.priceRUB) && offer.priceRUB > 0 ? [offer.priceRUB] : [])
    return prices.length ? Math.min(...prices) : undefined
  }
  const [dollar, euro] = [rate(DOLLARS_ID), rate(EUROS_ID)]
  return { ...(dollar ? { '$': dollar } : {}), ...(euro ? { '€': euro } : {}) }
}

/** A price in roubles: roubles as they are, dollars and euros at the game's rate; null when there is no rate (GP coins). */
export function inRoubles(value: number, currency: FleaCurrency, rates: FleaRates): number | null {
  if (currency === '₽') return value
  const rate = currency === '$' || currency === '€' ? rates[currency] : undefined
  return rate ? Math.round(value * rate) : null
}

export interface FleaSighting {
  itemId: string
  /** Always roubles (an offer in dollars or euros converted at the game's rate). */
  price: number
  row: number
  /** The offer as listed, when it was not in roubles. */
  listed?: { value: number; currency: FleaCurrency }
}

export interface FleaSightingResult {
  sightings: FleaSighting[]
  /** Why the reading stopped where it did (null: every row was read). */
  stoppedAt: { row: number; reason: 'end' | 'banner' | 'dim' | 'unsure' | 'unknown-item' } | null
}

/**
 * The lowest player's price in roubles of each item on a list sorted cheapest first, from its top (the caller has checked
 * fleaScreenState: open, ascending, atTop, not locked). Reading down: a trader's row is passed over (the traders sell on
 * the flea too, often cheaper); an item's first player's offer is its lowest price — as long as every row above it was
 * read for sure. So the reading stops at the first row it cannot read: a dim one, a price not sure, a name that names no
 * item. The flea sorts every currency by its value in roubles, so an item first offered in dollars or euros is priced at
 * the game's rate (`rates`, fleaRates); with no rate for its currency (GP coins), or worn («⚒ 30/40»), it gives no price:
 * its cheapest offer in roubles is unknown. `exclude`: items whose copies differ (weapons, armour…: docs/trading.md), by the
 * offer's info line (a key counts only with all its uses: screenFleaPrices.ts).
 */
export function fleaSightings(rows: FleaRow[], exclude: (itemId: string, info: string) => boolean = () => false, rates: FleaRates = {}, language?: GameLanguage | null): FleaSightingResult {
  const sightings: FleaSighting[] = []
  const seen = new Set<string>()
  for (const [row, entry] of rows.entries()) {
    const { price } = entry
    if (price.kind === 'empty') return { sightings, stoppedAt: { row, reason: 'end' } }
    if (price.kind === 'banner') return { sightings, stoppedAt: { row, reason: 'banner' } }
    if (isTraderRow(entry.seller, entry.info, language)) continue
    if (price.kind === 'dim') return { sightings, stoppedAt: { row, reason: 'dim' } }
    if (!price.sure) return { sightings, stoppedAt: { row, reason: 'unsure' } }
    if (!entry.itemId) return { sightings, stoppedAt: { row, reason: 'unknown-item' } }
    const itemId = entry.itemId
    if (seen.has(itemId)) continue
    seen.add(itemId)
    if (exclude(itemId, entry.info) || !wholeCondition(entry.info)) continue
    const roubles = inRoubles(price.value, price.currency, rates)
    if (roubles === null) continue
    sightings.push({ itemId, price: roubles, row, ...(price.currency === '₽' ? {} : { listed: { value: price.value, currency: price.currency } }) })
  }
  return { sightings, stoppedAt: null }
}
