import type { AppDataset, RaidMode } from '../../../src/domain/types'
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

/** The mirrored flea prices over a catalog: the cheapest current offer, else the 24-hour average (flagged), and the mode's flea fees. */
export function applyMirroredPrices(catalog: AppDataset, snapshot: PriceSnapshot): AppDataset {
  return {
    ...catalog,
    items: catalog.items.map((item) => {
      const price = snapshot.items[item.id]
      const fleaPrice = price?.lastLowPrice ?? price?.avg24hPrice
      return price ? { ...item, fleaPrice, fleaPriceBasis: price.lastLowPrice ? 'last-low' as const : fleaPrice ? 'avg-24h' as const : undefined } : item
    }),
    metadata: { ...catalog.metadata!, fleaMarket: { enabled: snapshot.fleaMarket.enabled, offerFeeRate: snapshot.fleaMarket.sellOfferFeeRate, requirementFeeRate: snapshot.fleaMarket.sellRequirementFeeRate } },
  }
}
