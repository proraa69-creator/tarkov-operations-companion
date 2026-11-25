import type { RaidMode } from '../domain/types.js'
import type { FleaPixels } from './fleaDigits.js'
import type { GameLanguage } from './gameLanguage.js'
import { FLEA_VERSION_LINE, fleaFilterChips, fleaLayout, fleaModeFromLabel, fleaRect, fleaRowParts, fleaScreenState, isTraderRow, readFleaPrices, type FleaPrice, type FleaScreenState } from './fleaScreen.js'

/**
 * The flea market followed on the player's screen (docs/flea-prices-from-players.md, «Когда включается»): the quest
 * scanner's copy of the game's screen, taken anyway while the game is in front outside a raid, is looked at here first —
 * a few thousand pixels. Not the flea: nothing more happens. The flea, cheapest first, at the list's start: each row's
 * price by its digits' shapes (~2 ms); and once the same prices were seen on two looks in a row (the list has finished
 * loading) and they are not the ones read last, the filter chips above the list are read (kept with the reading; none
 * stops it), then the rows' seller, info and name lines by OCR (~30 ms a line, only down to the first row that ends
 * the reading) with the version line. What the rows name is decided in the app
 * (src/fleaPrices/screenPrices.ts), which holds the catalog and the mode the game is in.
 */

export interface FleaRect { x: number; y: number; width: number; height: number }

/** OCR of one line of the screen copy (the item card's engine, at background priority). */
export type FleaLineReader = (rect: FleaRect, unit: number) => Promise<string>

export interface FleaReadRow {
  price: FleaPrice
  seller: string
  info: string
  /** Empty for a trader's row and for the row that ends the reading (its name is not needed). */
  name: string
}

export interface FleaReading {
  /** When the screen was copied (ms). */
  at: number
  /** The filter chips above the list as read («Сост. от 100», «Кроме бартера», «Поиск по предмету …», «Валюта EUR»). */
  filters: string[]
  /** The version line and the mode it names (only a check of the mode the app follows). */
  label: string
  labelMode: RaidMode | null
  /** From the list's top down to the row that ends the reading. */
  rows: FleaReadRow[]
  /** The game's language the rows were read in (src/import/gameLanguage.ts). */
  language?: GameLanguage
}

export interface FleaLook {
  /** The flea market is the screen: the quest scanner has nothing to read on it. */
  flea: boolean
  state?: FleaScreenState
  /** A list read now (new prices, settled). */
  reading?: FleaReading
}

/** A row's prices, as a key: the same list seen again is not read again. */
const priceKey = (prices: FleaPrice[]) => prices.map((price) => price.kind === 'price' ? `${price.digits}${price.currency}${price.sure ? '' : '?'}` : price.kind).join(',')

/** `language`: the game's language now (its traders' names and chips: src/import/gameWords.ts). */
export function createFleaWatch(ocr: FleaLineReader, now: () => number = Date.now, language: () => GameLanguage | null | undefined = () => null) {
  /** The prices of the last look (read when the next look shows them again) and of the list read last. */
  let seen = ''
  let read = ''

  async function look(pixels: FleaPixels): Promise<FleaLook> {
    const layout = fleaLayout(pixels, language())
    const state = fleaScreenState(pixels, layout)
    if (!state.open) { seen = ''; return { flea: false } }
    // Not sorted cheapest first, scrolled down, or the player's flea locked: the top row is not the lowest price.
    if (!state.ascending || !state.atTop || state.locked) { seen = ''; return { flea: true, state } }
    const at = now()
    const prices = readFleaPrices(pixels, layout)
    const key = priceKey(prices)
    const settled = key === seen
    seen = key
    if (!settled || key === read) return { flea: true, state }
    read = key
    // Behind any chip (owner, 26.11.2026: «Он должен искать по любой вот этой строке сверху»): «Поиск по предмету»,
    // «Сост. от», «Кроме бартера» keep the item's lowest offer on top; behind «Валюта …» or a price range the top row may
    // be a dearer one, which our server weighs against the other sources (server/src/services/playerPrices.ts).
    const filters: string[] = []
    for (const chip of fleaFilterChips(pixels, layout)) filters.push(await ocr(chip, layout.unit))
    const rows: FleaReadRow[] = []
    for (const [row, price] of prices.entries()) {
      if (price.kind === 'empty' || price.kind === 'banner') { rows.push({ price, seller: '', info: '', name: '' }); break }
      const parts = fleaRowParts(layout, row)
      const seller = await ocr(parts.seller, layout.unit)
      const info = await ocr(parts.info, layout.unit)
      if (isTraderRow(seller, info, language())) { rows.push({ price, seller, info, name: '' }); continue }
      // A player's row not read for sure ends the reading: a lower price of a later item could hide there.
      if (price.kind !== 'price' || !price.sure) { rows.push({ price, seller, info, name: '' }); break }
      rows.push({ price, seller, info, name: await ocr(parts.name, layout.unit) })
    }
    const label = await ocr(fleaRect(layout, FLEA_VERSION_LINE), layout.unit)
    const lang = language()
    return { flea: true, state, reading: { at, filters, label, labelMode: fleaModeFromLabel(label), rows, ...(lang ? { language: lang } : {}) } }
  }

  return {
    look,
    /** Forget the lists seen (a new game window, another profile): the next list is read again. */
    reset() { seen = ''; read = '' },
  }
}
