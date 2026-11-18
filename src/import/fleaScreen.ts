import type { RaidMode } from '../domain/types'
import { gameUiBox } from './storyPaneLayout'
import { colourAt, currencyOf, decodeDigitShapes, FLEA_LIST, luminance, priceBand, priceGlyphs, readDigits, screenPoint, type DigitSample, type FleaCurrency, type FleaLayout, type FleaPixels } from './fleaDigits'
import { FLEA_DIGIT_SHAPES } from './fleaDigitShapes'

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
  const rect = (x0: number, y0: number, x1: number, y1: number) => {
    const [x, y] = screenPoint(layout, x0, top + y0)
    const [right, bottom] = screenPoint(layout, x1, top + y1)
    return { x, y, width: right - x, height: bottom - y }
  }
  return {
    /** The seller: a player's nickname, or a trader's name («Прапор») beside the trader's level badge. */
    seller: rect(640, 6, 860, 28),
    /** The item's name (a long one cut with «…»; «Неизвестный предмет» for one the player has not examined). */
    name: rect(905, 8, 1330, 30),
    /** «Всего 1 ⚒ 40/40», a trader's «Всего 1670000 (лимит 3)». */
    info: rect(905, 30, 1330, 48),
  }
}

/**
 * The mode the version line at the bottom left names: «1.3.0.2.48779 | PvE», «… | PvP S» (Season), nothing after the
 * version in plain PvP (the owner's frames of 18.11.2026). Only a check: the mode itself is the one the app follows from
 * the game's logs (screenReadingMode.ts). Null when no version was read.
 */
export function fleaModeFromLabel(text: string): RaidMode | null {
  if (!/\d[.,:']\d+[.,:']\d+[.,:']\d+[.,:']\d{4,}/.test(text)) return null
  if (/p\s*v\s*e/i.test(text)) return 'pve'
  if (/p\s*v\s*p[\s.:,]*s/i.test(text)) return 'seasonal'
  if (/p\s*v\s*p/i.test(text)) return null
  return 'pvp'
}

/** The traders who sell on the flea too (Russian and English names), folded as fold() does. */
const TRADERS = new Set(['прапор', 'терапевт', 'скупщик', 'лыжник', 'миротворец', 'механик', 'барахольщик', 'егерь', 'реф', 'смотритель', 'prapor', 'therapist', 'fence', 'skier', 'peacekeeper', 'mechanic', 'ragman', 'jaeger', 'ref', 'lightkeeper'])
const fold = (text: string) => text.toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я]/g, '')

/** A trader's row: its seller is a trader, or its offer has a trader's «(лимит N)». */
export function isTraderRow(seller: string, info: string) {
  return TRADERS.has(fold(seller)) || /лимит|limit/i.test(info)
}

/** «⚒ 40/40» of the info line: the item's condition, null when the line names none (a stack has none). */
export function fleaCondition(info: string) {
  const match = /(\d+)\s*\/\s*(\d+)/.exec(info)
  return match ? { now: Number(match[1]), max: Number(match[2]) } : null
}

export interface FleaRow {
  price: FleaPrice
  /** OCR of fleaRowParts' seller and info lines. */
  seller: string
  info: string
  /** The catalog item its name (fleaRowParts' name, OCR) is, or null when it names none for sure. */
  itemId: string | null
}

/** The catalog ids of the game's money: their handbook price is the game's rate in roubles. */
export const DOLLARS_ID = '5696686a4bdc2da3298b456a'
export const EUROS_ID = '569668774bdc2da2298b4568'

/** Roubles for one dollar and one euro in the player's mode (0 or absent: not known, such an offer gives no price). */
export interface FleaRates { '$'?: number; '€'?: number }

/**
 * The game's rates of this mode from its catalog: the handbook price of «Доллары» and «Евро» (tarkov.dev `basePrice`),
 * the rate the flea itself sorts the offers of every currency by (owner, 18.11.2026: «все цены указаны в рублях только.
 * Если предмет в евро, значит, переводи евро на рубли согласно курсу игры»).
 */
export function fleaRates(basePriceOf: (itemId: string) => number | undefined): FleaRates {
  const rate = (id: string) => { const value = basePriceOf(id); return value && Number.isFinite(value) && value > 0 ? value : undefined }
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
 * its cheapest offer in roubles is unknown. `exclude`: items whose copies differ (weapons, armour, keys…: docs/trading.md).
 */
export function fleaSightings(rows: FleaRow[], exclude: (itemId: string) => boolean = () => false, rates: FleaRates = {}): FleaSightingResult {
  const sightings: FleaSighting[] = []
  const seen = new Set<string>()
  for (const [row, entry] of rows.entries()) {
    const { price } = entry
    if (price.kind === 'empty') return { sightings, stoppedAt: { row, reason: 'end' } }
    if (price.kind === 'banner') return { sightings, stoppedAt: { row, reason: 'banner' } }
    if (isTraderRow(entry.seller, entry.info)) continue
    if (price.kind === 'dim') return { sightings, stoppedAt: { row, reason: 'dim' } }
    if (!price.sure) return { sightings, stoppedAt: { row, reason: 'unsure' } }
    if (!entry.itemId) return { sightings, stoppedAt: { row, reason: 'unknown-item' } }
    const itemId = entry.itemId
    if (seen.has(itemId)) continue
    seen.add(itemId)
    const condition = fleaCondition(entry.info)
    if (exclude(itemId) || (condition && condition.now !== condition.max)) continue
    const roubles = inRoubles(price.value, price.currency, rates)
    if (roubles === null) continue
    sightings.push({ itemId, price: roubles, row, ...(price.currency === '₽' ? {} : { listed: { value: price.value, currency: price.currency } }) })
  }
  return { sightings, stoppedAt: null }
}
