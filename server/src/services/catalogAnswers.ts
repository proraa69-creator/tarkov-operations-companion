import { BASE_PRICE_SOURCE, FLEA_SOURCE, quoteKind, steadyFleaPrice } from '../../../src/domain/itemPrices.js'
import type { AppDataset, Item, PriceQuote, RaidMode } from '../../../src/domain/types'
import { catalogEtag, type CatalogLocale } from './catalogCache.js'
import type { MirrorStorage } from './mirrorStorage.js'
import type { PriceSnapshot } from './priceMirror.js'

/** A prepared answer of GET /v1/catalog/:mode: the JSON bytes as sent and their ETag. */
export interface CatalogAnswer { body: Buffer; etag: string }

export interface CatalogAnswerSources {
  /** The quest base snapshot of a mode and language (a new object for each new version: services/questBase.ts). */
  snapshot: (mode: RaidMode, locale: CatalogLocale) => Promise<AppDataset>
  /** The mode's mirrored prices: a version that moves only when the price file changed, and the parsed prices. */
  prices?: (mode: RaidMode) => Promise<{ version: string; snapshot?: PriceSnapshot }>
  /** Everything else the answer depends on (the item image set the links point to). */
  inputsVersion?: () => string
  /** The served catalog: the snapshot with the prices, the item images and the guide images. */
  decorate?: (catalog: AppDataset, prices: PriceSnapshot | undefined) => AppDataset
}

interface Prepared { snapshot: AppDataset; prices: string; inputs: string; answer: Promise<CatalogAnswer> }

/**
 * The catalog answers, prepared once per (mode, language, quest base version, price version, image set): the prices
 * and image links laid over the base, the JSON (about 19 MB) and its ETag are made once and kept as bytes. A request
 * then costs a few comparisons: an unchanged catalog answers If-None-Match from the kept ETag (304) and a full answer
 * sends the kept bytes — nothing is stringified or hashed per request. The prices move about once a minute, so each
 * answer is prepared at most about once a minute, by the first request after the move, whatever the number of players.
 */
export function createCatalogAnswers(sources: CatalogAnswerSources) {
  const prepared = new Map<string, Prepared>()
  let preparations = 0

  const get = async (mode: RaidMode, locale: CatalogLocale): Promise<CatalogAnswer> => {
    const snapshot = await sources.snapshot(mode, locale)
    const prices = sources.prices ? await sources.prices(mode) : undefined
    const priceVersion = prices?.version ?? ''
    const inputs = sources.inputsVersion?.() ?? ''
    const slot = `${mode}:${locale}`
    const current = prepared.get(slot)
    if (current && current.snapshot === snapshot && current.prices === priceVersion && current.inputs === inputs) return current.answer
    const answer = Promise.resolve().then(() => {
      preparations += 1
      const text = JSON.stringify(sources.decorate ? sources.decorate(snapshot, prices?.snapshot) : snapshot)
      return { body: Buffer.from(text), etag: catalogEtag(text) }
    })
    const entry: Prepared = { snapshot, prices: priceVersion, inputs, answer }
    prepared.set(slot, entry)
    // A failed preparation is not kept: the next request tries again.
    answer.catch(() => { if (prepared.get(slot) === entry) prepared.delete(slot) })
    return answer
  }

  return {
    get,
    /** How many answers were prepared so far (tests, the benchmark). */
    preparations: () => preparations,
  }
}

const upstreamOf = (mode: RaidMode) => (mode === 'pve' ? 'pve' : mode === 'seasonal' ? 'pvp-season' : 'regular')

/**
 * The prices of the price mirror (services/priceMirror.ts) per mode. The file of a price generation (about 1 MB of
 * JSON) is read and parsed once, when the mirror publishes a new generation; until then every request reuses it. The
 * version is the generation id, found through the mirror's active manifest, itself read again only when replaced.
 */
export class MirroredPrices {
  private readonly cache = new Map<string, { generation: string; snapshot?: PriceSnapshot }>()
  private readCount = 0

  constructor(private readonly storage: MirrorStorage, private readonly log?: (message: string) => void) {}

  /** Price files read and parsed so far. */
  reads() { return this.readCount }

  async current(mode: RaidMode): Promise<{ version: string; snapshot?: PriceSnapshot }> {
    const upstream = upstreamOf(mode)
    const slot = `prices-${upstream}`
    const cached = this.cache.get(slot)
    try {
      const generation = await this.storage.currentGeneration(slot)
      if (!generation) return { version: '' }
      if (cached?.generation === generation) return { version: generation, snapshot: cached.snapshot }
      const bytes = await this.storage.readGeneration(generation, 'prices.json')
      if (!bytes) return cached ? { version: cached.generation, snapshot: cached.snapshot } : { version: '' }
      this.readCount += 1
      let snapshot: PriceSnapshot | undefined
      try {
        const parsed = JSON.parse(bytes.toString('utf8')) as PriceSnapshot
        // Another mode's prices, or a broken file: the catalog goes out with its own prices, as before.
        snapshot = parsed?.mode === upstream && parsed.items && typeof parsed.items === 'object' && parsed.fleaMarket && typeof parsed.fleaMarket === 'object' ? parsed : undefined
      } catch { snapshot = undefined }
      this.cache.set(slot, { generation, snapshot })
      return { version: generation, snapshot }
    } catch (error) {
      this.log?.(`catalog prices ${upstream}: ${error instanceof Error ? error.message : 'not readable'}`)
      return cached ? { version: cached.generation, snapshot: cached.snapshot } : { version: '' }
    }
  }
}

const MINUTE_MS = 60_000
const RAID_MODE: Record<PriceSnapshot['mode'], RaidMode> = { regular: 'pvp', pve: 'pve', 'pvp-season': 'seasonal' }
type SteadyPrice = ReturnType<typeof steadyFleaPrice>

/**
 * The item's quotes with this mode's flea quote at the minute's price and at that price's own time (`at`, whole minutes);
 * the quote goes when the item has no flea price now. The other modes' quotes and the traders' stay as they are.
 */
function withMinuteFleaQuote(item: Item, mode: RaidMode, steady: SteadyPrice, at: number | undefined, askedAt: string): PriceQuote[] {
  const quotes = item.prices ?? []
  const index = quotes.findIndex((quote) => quote.mode === mode && quoteKind(quote) === 'flea')
  const known = index === -1 ? undefined : quotes[index]
  if (!steady) {
    if (!known) return quotes
    const rest = quotes.filter((_, position) => position !== index)
    // Nothing else of this mode: the base price as a reference, as the catalog itself does (src/data/catalogSource.ts).
    return rest.some((quote) => quote.mode === mode) || !item.basePrice ? rest : [...rest, { source: BASE_PRICE_SOURCE, price: item.basePrice, mode, updatedAt: known.updatedAt, kind: 'base' }]
  }
  const unchanged = known !== undefined && known.price === steady.price && known.basis === steady.basis
  const updatedAt = at && at > 0 ? new Date(at * MINUTE_MS).toISOString() : unchanged ? known.updatedAt : askedAt
  const quote: PriceQuote = { source: known?.source ?? FLEA_SOURCE, kind: 'flea', mode, price: steady.price, basis: steady.basis, updatedAt }
  if (known) return quotes.map((entry, position) => (position === index ? quote : entry))
  // The flea price first; «Базовая цена» stands only where there is no offer.
  return [quote, ...quotes.filter((entry) => !(entry.mode === mode && quoteKind(entry) === 'base'))]
}

/**
 * The mirrored flea prices over a catalog, and the mode's flea fees. One rule for everything a page reads (owner,
 * 09.11.2026: «написано цена обновилась 2 минуты назад, смотрю цену а она очень сильно другая»): the lowest offer now, or
 * the 24-hour average when there is none or the offer is a lone listing (src/domain/itemPrices.ts steadyFleaPrice) — in
 * `fleaPrice` AND in the mode's flea quote of `prices`, which «Барахолка», the barters, the crafts and the on-screen item
 * card show. Until then the quote kept the price of the hourly data set the quest base was built from: a median of
 * 1.5 hours old, a quarter of the items more than 10% off the minute price (measured 09.11.2026). The quote's time is the
 * price's own, so a page can say how old each price is. PvP, PvE and Season never mix: only the quote of the prices' mode.
 */
export function applyMirroredPrices(catalog: AppDataset, snapshot: PriceSnapshot): AppDataset {
  const mode = RAID_MODE[snapshot.mode]
  const fleaOpen = snapshot.fleaMarket.enabled !== false
  return {
    ...catalog,
    items: catalog.items.map((item) => {
      const price = snapshot.items[item.id]
      if (!price) return item
      const steady = fleaOpen && !price.noFlea ? steadyFleaPrice(price.lastLowPrice, price.avg24hPrice) : undefined
      return { ...item, fleaPrice: steady?.price, fleaPriceBasis: steady?.basis, prices: mode ? withMinuteFleaQuote(item, mode, steady, price.at, snapshot.updatedAt) : item.prices }
    }),
    metadata: { ...catalog.metadata!, fleaMarket: { enabled: snapshot.fleaMarket.enabled, offerFeeRate: snapshot.fleaMarket.sellOfferFeeRate, requirementFeeRate: snapshot.fleaMarket.sellRequirementFeeRate } },
  }
}
