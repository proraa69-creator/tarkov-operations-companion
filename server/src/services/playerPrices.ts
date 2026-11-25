import type { MirrorMode } from './tarkovDataMirror.js'

/**
 * Flea prices the players' apps read on their own screens (docs/flea-prices-from-players.md, stage 2; owner, 18.11.2026:
 * «берётся верхняя, то есть самая низкая цена, которая обнаружена на экране, и сразу же обновляется у нас в приложении»;
 * «приоритет цены будет с экрана пользователя»). An app sends what it read — mode, item, price in roubles, when seen —
 * and an accepted price stands in the minute prices every app asks for (routes/data.ts, layPlayerPrices): the first
 * PRIORITY_MS over whatever the other sources renewed meanwhile, then until they renew the item, HOLD_MS at most.
 * Anybody can send a request without the game, so a price is accepted at once only near the item's
 * price from the other sources (the reference: never a player's own earlier price, so nobody walks a price away step by
 * step); a jump waits for a second account to see about the same price. An account whose prices often fall outside the
 * band loses «at once». Accounts stay here only for the limits and the trust, in memory: a restart forgets them, and
 * the prices, which stand half an hour anyway.
 */
export const PLAYER_PRICE_RULES = {
  /** An accepted price stands over the other sources at most this long from when it was seen. */
  holdMs: 30 * 60_000,
  /**
   * The first this long it stands whatever the other sources renewed meanwhile; a price they renewed later than that is
   * fresher and stands instead (owner, 26.11.2026: «Первые 5 минут в приоритете наша цена с барахолки… если приходит цена
   * свежее, то обновляется»).
   */
  priorityMs: 5 * 60_000,
  /** Accepted at once between these shares of the reference price. */
  band: [0.5, 1.5] as const,
  /** A price outside the band, or with no reference, waits this long for another account's. */
  confirmMs: 15 * 60_000,
  /** Two accounts' prices this close (share of the higher) confirm each other. */
  confirmShare: 0.1,
  /** Per account and hour. */
  perHour: 120,
  /** One account's same item, mode and price again within this: left out (a changed price counts at once, owner 26.11.2026). */
  repeatMs: 2 * 60_000,
  /** Seen this long ago at most (an app sends at once), or this far ahead (clocks differ). */
  maxAgeMs: 10 * 60_000,
  maxAheadMs: 2 * 60_000,
  /** Outside the band this many times, and more than this share of the account's prices: no more «at once». */
  oddCount: 5,
  oddShare: 0.3,
  /** What is kept of an account's history. */
  keepMs: 7 * 24 * 60 * 60_000,
  /** Sightings in one request at most (a list on the screen holds 12 rows). */
  perRequest: 24,
}

const ITEM_ID = /^[a-z0-9]{16,48}$/
const MAX_PRICE = 100_000_000

export interface PlayerPriceReference {
  /** The item's price from the other sources now (tarkov.dev, the second source). */
  price?: number
  noFlea?: boolean
}

export interface LaidPrice { price: number; seen: number }

export type SightingOutcome = 'accepted' | 'pending' | 'rejected'

interface Pending { account: string; price: number; seen: number }
interface Account { sent: number[]; last: Map<string, { at: number; price: number }>; odd: number[]; fair: number[] }
interface Counts { received: number; accepted: number; pending: number; rejected: number }

export class PlayerPrices {
  private readonly laid = new Map<MirrorMode, Map<string, LaidPrice>>()
  private readonly pending = new Map<string, Pending[]>()
  private readonly accounts = new Map<string, Account>()
  private readonly counted: Array<{ at: number; mode: MirrorMode; outcome: SightingOutcome }> = []
  private version = 0

  constructor(private readonly now: () => number = Date.now) {}

  /**
   * One request of an app: its sightings, each judged on its own. `reference` gives the item's price from the other
   * sources in this mode (undefined: not known).
   */
  submit(account: string, mode: MirrorMode, input: unknown, reference: (itemId: string) => PlayerPriceReference | undefined) {
    const at = this.now()
    this.prune(at)
    const list = Array.isArray(input) ? input.slice(0, PLAYER_PRICE_RULES.perRequest) : []
    const result = { accepted: 0, pending: 0, rejected: 0 }
    const who = this.accounts.get(account) ?? { sent: [], last: new Map(), odd: [], fair: [] }
    this.accounts.set(account, who)
    for (const raw of list) {
      const outcome = this.judge(account, who, mode, raw, reference, at)
      result[outcome] += 1
      this.counted.push({ at, mode, outcome })
    }
    return result
  }

  private judge(account: string, who: Account, mode: MirrorMode, raw: unknown, reference: (itemId: string) => PlayerPriceReference | undefined, at: number): SightingOutcome {
    const row = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
    const itemId = typeof row.itemId === 'string' ? row.itemId : ''
    const price = row.price
    const seen = row.seenAt
    if (!ITEM_ID.test(itemId) || typeof price !== 'number' || !Number.isInteger(price) || price < 1 || price > MAX_PRICE) return 'rejected'
    if (typeof seen !== 'number' || !Number.isFinite(seen) || seen < at - PLAYER_PRICE_RULES.maxAgeMs || seen > at + PLAYER_PRICE_RULES.maxAheadMs) return 'rejected'
    if (who.sent.filter((time) => time > at - 60 * 60_000).length >= PLAYER_PRICE_RULES.perHour) return 'rejected'
    const key = `${mode}:${itemId}`
    const last = who.last.get(key)
    if (last !== undefined && last.price === price && at - last.at < PLAYER_PRICE_RULES.repeatMs) return 'rejected'
    who.sent.push(at)
    who.last.set(key, { at, price })
    const ref = reference(itemId)
    if (ref?.noFlea) return 'rejected'
    const inBand = ref?.price !== undefined && price >= ref.price * PLAYER_PRICE_RULES.band[0] && price <= ref.price * PLAYER_PRICE_RULES.band[1]
    if (ref?.price !== undefined) (inBand ? who.fair : who.odd).push(at)
    // Another account saw about the same price lately: the two confirm each other, whatever the band says.
    const waiting = (this.pending.get(key) ?? []).filter((entry) => at - entry.seen <= PLAYER_PRICE_RULES.confirmMs)
    const confirmed = waiting.some((entry) => entry.account !== account && Math.abs(entry.price - price) <= Math.max(entry.price, price) * PLAYER_PRICE_RULES.confirmShare)
    const laidNow = this.laid.get(mode)?.get(itemId)
    const agreesWithLaid = laidNow !== undefined && at - laidNow.seen < PLAYER_PRICE_RULES.holdMs && Math.abs(laidNow.price - price) <= Math.max(laidNow.price, price) * PLAYER_PRICE_RULES.confirmShare
    if ((inBand && this.trusted(who)) || confirmed || agreesWithLaid) {
      this.lay(mode, itemId, { price, seen: Math.min(seen, at) })
      return 'accepted'
    }
    this.pending.set(key, [...waiting.filter((entry) => entry.account !== account), { account, price, seen: Math.min(seen, at) }])
    return 'pending'
  }

  private trusted(who: Account) {
    const odd = who.odd.length
    return odd < PLAYER_PRICE_RULES.oddCount || odd <= (odd + who.fair.length) * PLAYER_PRICE_RULES.oddShare
  }

  private lay(mode: MirrorMode, itemId: string, entry: LaidPrice) {
    const prices = this.laid.get(mode) ?? new Map<string, LaidPrice>()
    this.laid.set(mode, prices)
    const before = prices.get(itemId)
    if (before && before.seen > entry.seen) return
    prices.set(itemId, entry)
    this.version += 1
  }

  /** This mode's accepted prices still standing (seen less than HOLD_MS ago). */
  prices(mode: MirrorMode): ReadonlyMap<string, LaidPrice> {
    const at = this.now()
    const standing = new Map<string, LaidPrice>()
    for (const [id, entry] of this.laid.get(mode) ?? []) if (at - entry.seen < PLAYER_PRICE_RULES.holdMs) standing.set(id, entry)
    return standing
  }

  /** Changes with every accepted price (the prices route keeps its answer until then). */
  get revision() { return this.version }

  /** For the mirror status: how many sightings came in the last hour and what became of them, by mode. No accounts. */
  status() {
    const at = this.now()
    const modes: Partial<Record<MirrorMode, Counts & { standing: number }>> = {}
    for (const entry of this.counted) {
      if (at - entry.at > 60 * 60_000) continue
      const counts = modes[entry.mode] ??= { received: 0, accepted: 0, pending: 0, rejected: 0, standing: 0 }
      counts.received += 1
      counts[entry.outcome] += 1
    }
    for (const mode of this.laid.keys()) (modes[mode] ??= { received: 0, accepted: 0, pending: 0, rejected: 0, standing: 0 }).standing = this.prices(mode).size
    return { state: 'done', lastHour: modes }
  }

  private prune(at: number) {
    const keep = at - PLAYER_PRICE_RULES.keepMs
    for (const [account, who] of this.accounts) {
      who.sent = who.sent.filter((time) => time > at - 60 * 60_000)
      who.odd = who.odd.filter((time) => time > keep)
      who.fair = who.fair.filter((time) => time > keep)
      for (const [key, last] of who.last) if (at - last.at >= PLAYER_PRICE_RULES.repeatMs) who.last.delete(key)
      if (!who.sent.length && !who.odd.length && !who.fair.length) this.accounts.delete(account)
    }
    for (const [key, entries] of this.pending) {
      const fresh = entries.filter((entry) => at - entry.seen <= PLAYER_PRICE_RULES.confirmMs)
      if (fresh.length) this.pending.set(key, fresh)
      else this.pending.delete(key)
    }
    for (const prices of this.laid.values()) for (const [id, entry] of prices) if (at - entry.seen >= PLAYER_PRICE_RULES.holdMs) prices.delete(id)
    while (this.counted.length && at - this.counted[0]!.at > 60 * 60_000) this.counted.shift()
  }
}

interface PricesFile { items?: Record<string, { lastLowPrice?: number; avg24hPrice?: number; noFlea?: boolean; at?: number }> }

/**
 * The prices file of a mode with the players' prices over it: an accepted price is the item's lowest offer (it was seen
 * on a player's screen) whatever the other sources renewed within PRIORITY_MS after it was seen; a price they renewed
 * later than that is fresher and stays. HOLD_MS at most (prices()). Items the file has not, or the flea bans, stay as
 * they are. The body as it was when there is nothing to lay.
 */
export function layPlayerPrices(body: string, prices: ReadonlyMap<string, LaidPrice>): string {
  if (!prices.size) return body
  const file = JSON.parse(body) as PricesFile
  let changed = false
  for (const [id, entry] of prices) {
    const item = file.items?.[id]
    if (!item || item.noFlea) continue
    if (item.at !== undefined && item.at * 60_000 >= entry.seen + PLAYER_PRICE_RULES.priorityMs) continue
    item.lastLowPrice = entry.price
    item.at = Math.floor(entry.seen / 60_000)
    changed = true
  }
  return changed ? JSON.stringify(file) : body
}

/** The reference of each item from a mode's prices file (before any player's price is laid). */
export function priceReferences(body: string): Map<string, PlayerPriceReference> {
  const file = JSON.parse(body) as PricesFile
  const references = new Map<string, PlayerPriceReference>()
  for (const [id, item] of Object.entries(file.items ?? {})) {
    const price = item.lastLowPrice ?? item.avg24hPrice
    references.set(id, { ...(price && price > 0 ? { price } : {}), ...(item.noFlea ? { noFlea: true } : {}) })
  }
  return references
}
