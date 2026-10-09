import type { Item, PriceQuote, RaidMode } from './types'
import { fleaMarketFee, type FleaFeeOptions } from './fleaFee'

/**
 * Prices of one catalog item in ONE game mode (PvP, PvE and Season are never mixed: every quote carries its mode and
 * only quotes of the asked mode are read).
 *
 * The catalog item (src/data/catalogSource.ts) has
 * - one flea quote: the current lowest offer (tarkov.dev `lastLowPrice`), or the 24-hour average (`avg24hPrice`) only
 *   when there is no current offer — then `basis: 'avg-24h'` and the pages say «среднее за 24 ч»;
 * - trader quotes: what each trader pays for the item (`sellToTrader[].priceRUB`);
 * - a «Базовая цена» quote only when there is nothing else (a reference value, not an offer).
 *
 * The flea quote is the listing price: the seller keeps it minus the flea fee (src/domain/fleaFee.ts). «Best sale»
 * therefore compares the flea price AFTER the fee with the traders' prices, never the bare listing price.
 */

export const FLEA_SOURCE = 'Барахолка'
export const BASE_PRICE_SOURCE = 'Базовая цена'

export type QuoteKind = 'flea' | 'trader' | 'base'

/** Quotes of older catalogs and of the demo data have no `kind`: the source name tells. */
export function quoteKind(quote: PriceQuote): QuoteKind {
  if (quote.kind) return quote.kind
  if (quote.source === FLEA_SOURCE) return 'flea'
  if (quote.source === BASE_PRICE_SOURCE) return 'base'
  return 'trader'
}

/** Quotes of this mode only (a quote without a mode is not trusted for any mode). */
export function modeQuotes(item: Pick<Item, 'prices'> | undefined, mode: RaidMode): PriceQuote[] {
  return (item?.prices ?? []).filter((quote) => quote.mode === mode && quote.price > 0)
}

/** The flea price of this mode: the current lowest offer (or, flagged `basis: 'avg-24h'`, the 24-hour average). */
export function fleaQuote(item: Pick<Item, 'prices'> | undefined, mode: RaidMode): PriceQuote | undefined {
  return modeQuotes(item, mode).find((quote) => quoteKind(quote) === 'flea')
}

/** What traders pay for the item in this mode, best first. */
export function traderQuotes(item: Pick<Item, 'prices'> | undefined, mode: RaidMode): PriceQuote[] {
  return modeQuotes(item, mode).filter((quote) => quoteKind(quote) === 'trader').sort((a, b) => b.price - a.price)
}

export function isAveragePrice(quote: PriceQuote | undefined) {
  return quote?.basis === 'avg-24h'
}

export interface SaleOption {
  source: string
  kind: 'flea' | 'trader'
  /** Listing price on the flea / what the trader pays, per item. */
  price: number
  /** What the seller keeps per item: the flea price minus the fee, the trader's price as is. */
  net: number
  fee?: number
  /** The flea price is the 24-hour average (no current offer). */
  average?: boolean
}

/** The flea quote as a sale: listing price, fee and what is left (fee needs the item's base price; without it no fee is assumed). */
export function fleaSale(item: Pick<Item, 'prices' | 'basePrice'> | undefined, mode: RaidMode, feeOptions: Omit<FleaFeeOptions, 'count'> = {}): SaleOption | undefined {
  const quote = fleaQuote(item, mode)
  if (!quote) return undefined
  const fee = item?.basePrice ? fleaMarketFee(item.basePrice, quote.price, feeOptions) : 0
  return { source: quote.source, kind: 'flea', price: quote.price, net: quote.price - fee, ...(fee ? { fee } : {}), ...(isAveragePrice(quote) ? { average: true } : {}) }
}

/** Where one item sells best in this mode, by what the seller keeps (flea after the fee vs the best trader). */
export function bestSale(item: Pick<Item, 'prices' | 'basePrice'> | undefined, mode: RaidMode, feeOptions: Omit<FleaFeeOptions, 'count'> = {}): SaleOption | undefined {
  const options: SaleOption[] = traderQuotes(item, mode).map((quote) => ({ source: quote.source, kind: 'trader' as const, price: quote.price, net: quote.price }))
  const flea = fleaSale(item, mode, feeOptions)
  if (flea && flea.net > 0) options.push(flea)
  return options.sort((a, b) => b.net - a.net)[0]
}

export interface DisplayPrice {
  source: string
  kind: QuoteKind
  price: number
  average?: boolean
}

/**
 * The one price a list shows for an item in this mode: the flea price (current lowest offer) when the item is on the
 * flea, otherwise the best trader price, otherwise the base price. Never the highest of all quotes: the old
 * `Math.max(...prices)` took the 24-hour flea average whenever it was above every trader, which is most items.
 */
export function displayPrice(item: Pick<Item, 'prices'> | undefined, mode: RaidMode): DisplayPrice | undefined {
  const flea = fleaQuote(item, mode)
  if (flea) return { source: flea.source, kind: 'flea', price: flea.price, ...(isAveragePrice(flea) ? { average: true } : {}) }
  const trader = traderQuotes(item, mode)[0]
  if (trader) return { source: trader.source, kind: 'trader', price: trader.price }
  const base = modeQuotes(item, mode).find((quote) => quoteKind(quote) === 'base')
  return base ? { source: base.source, kind: 'base', price: base.price } : undefined
}

/** Small caption under a price in lists (Russian; the interface translates it): where the number comes from. */
export function favoritePriceLabel(price: DisplayPrice | undefined): string {
  if (!price) return 'нет цены'
  if (price.kind === 'flea') return price.average ? 'барахолка, среднее за 24 ч' : 'барахолка, минимальное предложение'
  if (price.kind === 'base') return 'базовая цена'
  return `выкуп: ${price.source}`
}
