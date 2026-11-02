import { useQuery } from '@tanstack/react-query'
import type { Item, PriceQuote, RaidMode } from '../domain/types'
import { FLEA_SOURCE, quoteKind, steadyFleaPrice } from '../domain/itemPrices'
import { dataRoute, gatewayRequest } from './tarkovApi'
import type { MinutePrice, MinutePriceSnapshot } from './tarkovJsonAdapters'

/**
 * The flea prices of one mode, fresh every minute (owner, 02.11.2026: «в тир листах цены на предметы не соответствуют
 * барахолке, возьми цены актуальные, и они тоже должны меняться в реальном времени»; the weapon builds too: «цена
 * изменилась на барахолке, сборка тоже изменилась»). Our server's price mirror renews `/v1/data/prices/:mode` every
 * minute (server/src/services/priceMirror.ts, ~90 KB compressed), while the whole catalog comes every 10 minutes
 * (catalogRefresh.ts). Only through our server: a development build keeps the catalog's prices.
 */
export const LIVE_PRICES_MS = 60_000

export interface LivePrices {
  /** When the server took these prices (ms). */
  updatedAt?: number
  items: ReadonlyMap<string, MinutePrice>
}

const MODE_KEY: Record<RaidMode, string> = { pvp: 'regular', pve: 'pve', seasonal: 'pvp-season' }
const positive = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined

/** The server's minute snapshot of one mode, or null when it is another mode's or empty. */
export function parseLivePrices(body: unknown, mode: RaidMode): LivePrices | null {
  const root = (body && typeof body === 'object' ? (body as { data?: unknown }).data ?? body : {}) as MinutePriceSnapshot
  if (root.mode && root.mode !== MODE_KEY[mode]) return null
  const items = new Map<string, MinutePrice>()
  for (const [id, price] of Object.entries(root.items ?? {})) if (price && typeof price === 'object') items.set(id, price)
  if (!items.size) return null
  const at = root.updatedAt ? Date.parse(root.updatedAt) : Number.NaN
  return { items, ...(Number.isFinite(at) ? { updatedAt: at } : {}) }
}

/** This mode's minute prices while a page that shows them is open (null until the first answer, or off the server). */
export function useLivePrices(mode: RaidMode, enabled = true): LivePrices | null {
  const { data } = useQuery({
    queryKey: ['live-prices', mode],
    queryFn: async () => parseLivePrices(await gatewayRequest('GET', `/v1/data/prices/${mode}`), mode),
    enabled: enabled && dataRoute() === 'gateway',
    refetchInterval: LIVE_PRICES_MS,
    staleTime: LIVE_PRICES_MS / 2,
    retry: 1,
  })
  return data ?? null
}

/** The item with this mode's flea quote at the minute's price: the lowest offer now, else the 24-hour average (steadyFleaPrice). */
export function withLivePrice(item: Item, mode: RaidMode, live: LivePrices | null): Item {
  const price = live?.items.get(item.id)
  if (!price) return item
  const quotes = item.prices ?? []
  const index = quotes.findIndex((quote) => quote.mode === mode && quoteKind(quote) === 'flea')
  const steady = price.noFlea ? undefined : steadyFleaPrice(positive(price.lastLowPrice), positive(price.avg24hPrice))
  if (!steady) return index === -1 ? item : { ...item, prices: quotes.filter((_, at) => at !== index) }
  const { price: value, basis } = steady
  const known = index === -1 ? undefined : quotes[index]
  if (known && known.price === value && known.basis === basis) return item
  const updatedAt = live?.updatedAt ? new Date(live.updatedAt).toISOString() : known?.updatedAt ?? new Date().toISOString()
  const quote: PriceQuote = { source: known?.source ?? FLEA_SOURCE, kind: 'flea', mode, price: value, basis, updatedAt }
  return { ...item, prices: known ? quotes.map((entry, at) => at === index ? quote : entry) : [...quotes, quote] }
}

/** The catalog's items at the minute's flea prices of this mode (the same array when there are none). */
export function withLivePrices(items: Item[], mode: RaidMode, live: LivePrices | null): Item[] {
  return live ? items.map((item) => withLivePrice(item, mode, live)) : items
}
