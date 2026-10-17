/**
 * Boosty payments for CIS and WORLD (owner's spec: docs/payments/payment-regions-and-announcements.md).
 *
 * The region comes from the country saved in the account (src/shared/paymentRegions.ts), never from the request:
 *   RU    — no Boosty link at all (ЮKassa SBP, routes/payments.ts);
 *   CIS   — only the CIS offers; WORLD — only the international offers;
 *   none  — no country yet: nothing until «Укажите страну» (409 COUNTRY_REQUIRED).
 *
 * The friend-discount offer is for an account that came with a friend's code («Пригласи друга», services/invites.ts) and
 * has not spent the discount yet — the same rule as the ЮKassa price (InviteProgram.discountPercent). It is spent by the
 * first payment that activates the subscription (any first payment spends it, as with ЮKassa), so it never comes back
 * on a reload.
 *
 * A link is handed out only after the payer acknowledged the e-mail warning (BOOSTY_EMAIL_WARNING); every hand-out is
 * kept (boosty_link_requests) so the owner sees which offer of which region the player opened.
 *
 * Issuing the subscription — one code path, `grant()`, for both:
 *   - the automatic sync (services/boostySync.ts: Boosty's unofficial API lists the blog's subscribers): each active paid
 *     subscriber is matched by e-mail (case-insensitive) to an account and by level to an offer (BOOSTY_OFFER_TABLE, the
 *     owner's level mapping, BOOSTY_LEVEL_MAP) and paid until Boosty's next payment date + 1 day;
 *   - the owner's «Подтвердить оплату Boosty» (e-mail, offer, period).
 * The same checks every time: the offer's region must be the account's payment region (a CIS offer of a WORLD account,
 * Russia, no country — refused); the friend offer needs an open friend discount (and spends it). The automatic sync
 * never grants a refused case: it goes to the owner's review list (boosty_review) with the reason, as do an unknown
 * e-mail, an unknown level and a subscriber without a paid-until date. Idempotent: one payment per Boosty subscriber and
 * period (boosty_subscribers.last_period_end, the payment's provider_id), a longer existing subscription is never
 * shortened (PaymentStore.extendTo).
 */
import type { DatabaseSync } from 'node:sqlite'
import { AccountError, type AccountStore } from './accountStore.js'
import { FRIEND_DISCOUNT_PERCENT, type InviteProgram } from './invites.js'
import { PaymentError, type PaymentStore, type PaymentView, type PlanId } from './paymentStore.js'
import type { BoostySubscriber } from './boostyClient.js'
import { paymentRegionOf, type BoostyOffer, type PaymentRegion } from '../../../src/shared/paymentRegions.js'

export type BoostyRegion = Exclude<PaymentRegion, 'RU'>
export type BoostyOfferKey = 'WORLD_STANDARD' | 'WORLD_FRIEND' | 'CIS_STANDARD' | 'CIS_FRIEND'
export interface BoostyOfferDef { key: BoostyOfferKey; region: BoostyRegion; kind: BoostyOffer; levelId: string; url: string }

/**
 * The owner's four Boosty offers (public links) — the config table of the sync, keyed by level id: the number in a
 * purchase link is the level id. Russia has none on purpose.
 */
export const BOOSTY_OFFER_TABLE: readonly BoostyOfferDef[] = [
  { key: 'WORLD_STANDARD', region: 'WORLD', kind: 'standard', levelId: '4136082', url: 'https://boosty.to/raidosapp/purchase/4136082?ssource=DIRECT&share=subscription_link' },
  { key: 'WORLD_FRIEND', region: 'WORLD', kind: 'friend', levelId: '4136112', url: 'https://boosty.to/raidosapp/purchase/4136112?ssource=DIRECT&share=subscription_link' },
  { key: 'CIS_STANDARD', region: 'CIS', kind: 'standard', levelId: '4136107', url: 'https://boosty.to/raidosapp/purchase/4136107?ssource=DIRECT&share=subscription_link' },
  { key: 'CIS_FRIEND', region: 'CIS', kind: 'friend', levelId: '4136111', url: 'https://boosty.to/raidosapp/purchase/4136111?ssource=DIRECT&share=subscription_link' },
]
export const BOOSTY_OFFER_KEYS = BOOSTY_OFFER_TABLE.map((offer) => offer.key) as [BoostyOfferKey, ...BoostyOfferKey[]]
const offerByKey = (key: string) => BOOSTY_OFFER_TABLE.find((offer) => offer.key === key)
export const offerOf = (region: BoostyRegion, kind: BoostyOffer) => BOOSTY_OFFER_TABLE.find((offer) => offer.region === region && offer.kind === kind)!

export const BOOSTY_LINKS: Readonly<Record<BoostyRegion, Readonly<Record<BoostyOffer, string>>>> = {
  WORLD: { standard: offerOf('WORLD', 'standard').url, friend: offerOf('WORLD', 'friend').url },
  CIS: { standard: offerOf('CIS', 'standard').url, friend: offerOf('CIS', 'friend').url },
}

/** The link of an offer for a region; undefined for Russia (never a Boosty link). */
export function boostyLink(region: PaymentRegion, offer: BoostyOffer): string | undefined {
  return region === 'RU' ? undefined : BOOSTY_LINKS[region][offer]
}

export const COUNTRY_REQUIRED = 'COUNTRY_REQUIRED'
export const COUNTRY_REQUIRED_MESSAGE = 'Укажите страну в личном кабинете — без неё оплата недоступна'
/** Boosty's paid-until + this: a renewal charged a little late does not switch the subscription off for a moment. */
export const BOOSTY_GRACE_MS = 24 * 60 * 60 * 1000
/** How far back the countries an account was seen from count for a suspected region. */
const SEEN_WINDOW_MS = 60 * 24 * 60 * 60 * 1000
/** A manual confirmation this recent, not yet tied to a Boosty subscriber, is the subscriber's first period (adopt). */
const ADOPT_WINDOW_MS = 40 * 24 * 60 * 60 * 1000
/** A paid-until moved less than this is the same period (Boosty's own rounding), not a renewal. */
const SAME_PERIOD_MS = 2 * 24 * 60 * 60 * 1000
const SYNC_ACTOR = 'boosty-sync'

/** What the cabinet may offer this account: the region, how it pays, and the Boosty offers (no links). */
export interface PaymentChoice {
  region: PaymentRegion | null
  provider: 'yookassa' | 'boosty' | null
  boosty: { offers: BoostyOffer[] } | null
}

export interface BoostyLinkRequest { offer: BoostyOffer; region: PaymentRegion; at: string }

/** Why a Boosty payment was not issued (the review list; also the `code` of a refused manual confirmation). */
export type BoostyReviewReason = 'unknown_email' | 'no_country' | 'region_mismatch' | 'region_suspect' | 'friend_without_referral' | 'unknown_level' | 'no_period'
export const REVIEW_REASON_TEXT: Record<BoostyReviewReason, string> = {
  unknown_email: 'Нет аккаунта Raid OS с e-mail подписчика Boosty',
  no_country: 'У аккаунта не указана страна: регион оплаты неизвестен',
  region_mismatch: 'Предложение Boosty другого региона, чем страна аккаунта',
  region_suspect: 'Страна аккаунта — СНГ, но аккаунт заходит только из других стран: проверьте регион',
  friend_without_referral: 'Скидка друга без действующего приглашения (или уже использована)',
  unknown_level: 'Неизвестный уровень Boosty: сопоставьте его с предложением',
  no_period: 'Boosty не прислал дату следующего платежа',
}

/** Refused by the grant rules: the reason travels as `code` to the owner. */
export class BoostyGrantError extends AccountError {
  constructor(readonly reason: BoostyReviewReason, message = REVIEW_REASON_TEXT[reason]) {
    super(reason === 'unknown_email' ? 404 : 409, message)
  }
}

/** A Boosty payment as the owner's tools list it (GET /v1/accounts/me/admin/boosty/payments). */
export interface BoostyPaymentRecord {
  id: string
  accountId: string
  /** Absent once the account was deleted (its e-mail is gone). */
  email?: string
  region: PaymentRegion
  /** Which offer was paid: the standard one or the one-time friend discount. */
  offer: BoostyOffer
  offerKey?: BoostyOfferKey
  plan: PlanId
  /** Roubles (the owner's figure, or the level's RUB price from Boosty; 0 when unknown). */
  amount: number
  status: 'succeeded' | 'refunded'
  /** `auto`: the Boosty sync; `manual`: «Подтвердить оплату Boosty». */
  source: 'auto' | 'manual'
  /** When it was issued (the subscription was set then). */
  confirmedAt: string
  confirmedBy: string
  /** Boosty's paid-until of this period (when known). */
  periodEnd?: string
  /** The account's paid-until right after this payment. */
  paidUntilAfter?: string
  boostyUserId?: string
  reference?: string
}

export interface BoostyReviewItem {
  id: number
  reason: BoostyReviewReason
  reasonText: string
  email: string
  accountId?: string
  boostyUserId?: string
  levelId?: string
  levelName?: string
  offerKey?: BoostyOfferKey
  price?: number
  periodEnd?: string
  status: 'open' | 'resolved' | 'dismissed'
  createdAt: string
  updatedAt: string
  resolvedAt?: string
  resolvedBy?: string
}

export interface BoostyLevelSeen { levelId: string; name: string; price: number; offerKey?: BoostyOfferKey; lastSeenAt: string; subscribers: number }

export interface BoostySyncResult { subscribers: number; active: number; granted: number; adopted: number; review: number; unchanged: number }

type Row = Record<string, unknown>
const iso = (ms: unknown) => new Date(Number(ms)).toISOString()
const optionalText = <K extends string>(key: K, value: unknown) => (value == null || value === '' ? {} : { [key]: String(value) } as Record<K, string>)

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS boosty_link_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id TEXT NOT NULL,
    region TEXT NOT NULL,
    offer TEXT NOT NULL,
    created_at INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS boosty_link_requests_account ON boosty_link_requests(account_id, created_at);
  CREATE TABLE IF NOT EXISTS boosty_grants (
    payment_id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    account_id TEXT NOT NULL,
    offer_key TEXT NOT NULL,
    boosty_user_id TEXT,
    level_id TEXT,
    period_end INTEGER,
    paid_until_after INTEGER,
    actor TEXT NOT NULL,
    created_at INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS boosty_grants_account ON boosty_grants(account_id, created_at);
  CREATE TABLE IF NOT EXISTS boosty_seen_countries (
    account_id TEXT NOT NULL,
    country TEXT NOT NULL,
    first_at INTEGER NOT NULL,
    last_at INTEGER NOT NULL,
    hits INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (account_id, country));
  CREATE TABLE IF NOT EXISTS boosty_subscribers (
    boosty_user_id TEXT PRIMARY KEY,
    account_id TEXT,
    level_id TEXT,
    last_period_end INTEGER NOT NULL,
    updated_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS boosty_review (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,
    reason TEXT NOT NULL,
    email TEXT NOT NULL,
    account_id TEXT,
    boosty_user_id TEXT,
    level_id TEXT,
    level_name TEXT,
    offer_key TEXT,
    price REAL,
    period_end INTEGER,
    status TEXT NOT NULL DEFAULT 'open',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    resolved_at INTEGER,
    resolved_by TEXT);
  CREATE INDEX IF NOT EXISTS boosty_review_status ON boosty_review(status, updated_at);
  CREATE TABLE IF NOT EXISTS boosty_levels (
    level_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    price REAL NOT NULL,
    offer_key TEXT,
    subscribers INTEGER NOT NULL DEFAULT 0,
    last_seen_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS boosty_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL);
`

/**
 * Extra level rules from BOOSTY_LEVEL_MAP (JSON): { "<level id>": "CIS_STANDARD", "name:<level name>": "WORLD_FRIEND",
 * "price:<roubles>": "WORLD_STANDARD" }. Unknown offers are ignored.
 */
export function parseLevelMap(raw: string | undefined) {
  const rules = { ids: new Map<string, BoostyOfferKey>(), names: new Map<string, BoostyOfferKey>(), prices: new Map<number, BoostyOfferKey>() }
  if (!raw?.trim()) return rules
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    for (const [key, value] of Object.entries(parsed ?? {})) {
      const offer = typeof value === 'string' ? offerByKey(value.trim().toUpperCase())?.key : undefined
      if (!offer) continue
      if (key.startsWith('name:')) rules.names.set(key.slice(5).trim().toLowerCase(), offer)
      else if (key.startsWith('price:') && Number.isFinite(Number(key.slice(6)))) rules.prices.set(Number(key.slice(6)), offer)
      else if (/^\d{1,20}$/.test(key.trim())) rules.ids.set(key.trim(), offer)
    }
  } catch { console.warn('BOOSTY_LEVEL_MAP is not valid JSON: ignored') }
  return rules
}

export class BoostyPayments {
  private readonly db: DatabaseSync
  private readonly now: () => number
  private readonly levelMap: ReturnType<typeof parseLevelMap>
  private readonly worldPriceRub: number | undefined

  /** `worldPriceRub`: the WORLD standard level's price in roubles until the sync has seen a WORLD subscriber (BOOSTY_WORLD_PRICE_RUB). */
  constructor(private readonly accounts: AccountStore, private readonly payments: PaymentStore, private readonly invites?: InviteProgram, options: { now?: () => number; levelMap?: string; worldPriceRub?: number } = {}) {
    this.db = payments.database
    this.now = options.now ?? Date.now
    this.levelMap = parseLevelMap(options.levelMap)
    this.worldPriceRub = options.worldPriceRub !== undefined && Number.isFinite(options.worldPriceRub) && options.worldPriceRub > 0 ? options.worldPriceRub : undefined
    this.db.exec(SCHEMA)
  }

  /** The account's payment region from its saved country; undefined without one. */
  region(accountId: string): PaymentRegion | undefined {
    return paymentRegionOf(this.accounts.countryOf(accountId))
  }

  /** The friend-discount offer is still open for this account (a friend's code, nothing paid with or without it yet). */
  friendAvailable(accountId: string) {
    return (this.invites?.discountPercent(accountId) ?? 0) > 0
  }

  choice(accountId: string): PaymentChoice {
    const region = this.region(accountId)
    if (!region) return { region: null, provider: null, boosty: null }
    if (region === 'RU') return { region, provider: 'yookassa', boosty: null }
    return { region, provider: 'boosty', boosty: { offers: this.friendAvailable(accountId) ? ['standard', 'friend'] : ['standard'] } }
  }

  /**
   * The Boosty link of `offer` for this account's region, after the payer acknowledged the e-mail warning. 409 without a
   * country (COUNTRY_REQUIRED) and for Russia; 403 for the friend offer without an open friend discount.
   */
  link(accountId: string, offer: BoostyOffer) {
    const region = this.region(accountId)
    if (!region) throw new PaymentError(409, COUNTRY_REQUIRED_MESSAGE)
    if (region === 'RU') throw new PaymentError(409, 'Для России оплата — через СБП')
    if (offer === 'friend' && !this.friendAvailable(accountId)) throw new PaymentError(403, 'Скидка друга недоступна для этого аккаунта')
    const url = boostyLink(region, offer)
    if (!url) throw new PaymentError(409, 'Для России оплата — через СБП')
    this.db.prepare('INSERT INTO boosty_link_requests (account_id, region, offer, created_at) VALUES (?, ?, ?, ?)').run(accountId, region, offer, this.now())
    return { url, region, offer }
  }

  /** The owner's view of one account before confirming: region, the open friend discount and the links it opened. */
  ownerView(accountId: string) {
    const region = this.region(accountId) ?? null
    const requests = (this.db.prepare('SELECT region, offer, created_at FROM boosty_link_requests WHERE account_id = ? ORDER BY created_at DESC, id DESC LIMIT 20').all(accountId) as Row[])
      .map((row): BoostyLinkRequest => ({ offer: String(row.offer) as BoostyOffer, region: String(row.region) as PaymentRegion, at: iso(row.created_at) }))
    return { region, friendAvailable: region !== null && region !== 'RU' && this.friendAvailable(accountId), friendPercent: FRIEND_DISCOUNT_PERCENT, requests, seenCountries: this.seenCountries(accountId), regionSuspect: this.regionSuspect(accountId) }
  }

  /**
   * Why `offer` cannot be issued to this account now, or undefined. The one rule set of grant(). `crossRegion`: a level of
   * the other Boosty region issued for what it is worth (crossRegionShare); `manual`: the owner's confirmation, which
   * settles a suspected region by itself.
   */
  refusal(accountId: string, offer: BoostyOfferDef, subscriberId?: string, options: { crossRegion?: boolean; manual?: boolean } = {}): BoostyReviewReason | undefined {
    const region = this.region(accountId)
    if (!region) return 'no_country'
    if (region !== offer.region && !(options.crossRegion && region !== 'RU')) return 'region_mismatch'
    if (!options.manual && offer.region === 'CIS' && this.regionSuspect(accountId)) return 'region_suspect'
    if (offer.kind === 'friend' && !this.friendAvailable(accountId) && !this.friendRenewal(accountId, offer, subscriberId)) return 'friend_without_referral'
    return undefined
  }

  /**
   * Where the account is seen from (Cloudflare's country of the visitor, owner 17.10.2026): the cabinet and the Boosty
   * link note it, so that a «СНГ» account that only ever comes from elsewhere is checked by the owner before its CIS
   * level is issued.
   */
  noteCountry(accountId: string, country: string | undefined) {
    if (!country || !/^[A-Z]{2}$/.test(country) || country === 'XX' || country === 'T1') return
    const now = this.now()
    this.db.prepare(`INSERT INTO boosty_seen_countries (account_id, country, first_at, last_at, hits) VALUES (?, ?, ?, ?, 1)
      ON CONFLICT(account_id, country) DO UPDATE SET last_at = excluded.last_at, hits = hits + 1`).run(accountId, country, now, now)
  }

  /** A «СНГ» account seen in the last 60 days, and only from countries outside the CIS (Russia counts as CIS here). */
  regionSuspect(accountId: string) {
    if (this.region(accountId) !== 'CIS') return false
    const rows = this.db.prepare('SELECT country FROM boosty_seen_countries WHERE account_id = ? AND last_at >= ?').all(accountId, this.now() - SEEN_WINDOW_MS) as Row[]
    if (!rows.length) return false
    return rows.every((row) => paymentRegionOf(String(row.country)) === 'WORLD')
  }

  /** The countries the account was seen from (newest first), for the owner's review. */
  seenCountries(accountId: string) {
    return (this.db.prepare('SELECT country, hits, last_at FROM boosty_seen_countries WHERE account_id = ? ORDER BY last_at DESC LIMIT 10').all(accountId) as Row[])
      .map((row) => ({ country: String(row.country), hits: Number(row.hits), lastAt: iso(row.last_at) }))
  }

  /**
   * A level of the other Boosty region (owner, 17.10.2026: a foreign account that buys the cheaper CIS level gets what it
   * paid for, not a month): the share of a period it is worth — the price paid over the price of the same kind of level
   * of the account's own region, at most 1 (a CIS account that pays the WORLD level gets the whole period). Undefined
   * when it cannot be priced (the review list as before) or for Russia (no Boosty at all).
   */
  crossRegionShare(accountId: string, offer: BoostyOfferDef, paidRub: number): number | undefined {
    const region = this.region(accountId)
    if (!region || region === 'RU' || region === offer.region || !(paidRub > 0)) return undefined
    if (region === 'CIS') return 1
    const own = this.levelPrice(offerOf('WORLD', offer.kind)) ?? this.levelPrice(offerOf('WORLD', 'standard')) ?? this.worldPriceRub
    return own ? Math.min(1, paidRub / own) : undefined
  }

  /** The price in roubles the sync has seen for an offer's level. */
  private levelPrice(offer: BoostyOfferDef): number | undefined {
    const price = Number((this.db.prepare('SELECT price FROM boosty_levels WHERE level_id = ?').get(offer.levelId) as Row | undefined)?.price)
    return price > 0 ? price : undefined
  }

  /**
   * A later period of a friend-offer subscription that was already issued once (the same Boosty subscriber AND the same
   * Raid OS account; that first grant spent the referral): it renews like a standard one, without a review. A new
   * subscriber on the friend offer without an unspent referral is still refused.
   */
  private friendRenewal(accountId: string, offer: BoostyOfferDef, subscriberId: string | undefined) {
    if (!subscriberId) return false
    return this.db.prepare(`SELECT 1 FROM boosty_grants g JOIN payments p ON p.id = g.payment_id
      WHERE g.boosty_user_id = ? AND g.account_id = ? AND g.offer_key = ? AND p.status = 'succeeded' LIMIT 1`).get(subscriberId, accountId, offer.key) !== undefined
  }

  /**
   * Issue a Boosty payment (the only path: the sync and «Подтвердить оплату Boosty»). Checked again inside the
   * transaction (two confirmations cannot both spend one friend discount). `paidUntil`: Boosty's paid-until — the account
   * is paid until it + BOOSTY_GRACE_MS, never shorter than now; `months`: added from the end of the current period.
   */
  grant(input: {
    source: 'auto' | 'manual'
    actor: string
    accountId: string
    offer: BoostyOfferDef
    paidUntil?: number
    months?: 1 | 3 | 6 | 12
    /** Kopecks. */
    amount: number
    reference?: string
    subscriber?: { userId: string; levelId: string; periodEnd: number }
    /** A level of the other region, issued for its share of the period (crossRegionShare). */
    crossRegion?: boolean
  }) {
    const { accountId, offer } = input
    const rules = { crossRegion: input.crossRegion === true, manual: input.source === 'manual' }
    if ((input.paidUntil === undefined) === (input.months === undefined)) throw new AccountError(400, 'Укажите срок: месяцы или дату «оплачено до»')
    if (offer.kind === 'friend' && input.months !== undefined && input.months !== 1) throw new AccountError(400, 'Скидка друга — только на 1 месяц')
    const reason = this.refusal(accountId, offer, input.subscriber?.userId, rules)
    if (reason) throw new BoostyGrantError(reason)
    // The discount itself (and the inviter's reward) belongs to the first friend payment only, not to its renewals.
    const firstFriend = offer.kind === 'friend' && this.friendAvailable(accountId)
    const plan: PlanId = input.months === undefined ? '1m' : (`${input.months}m` as PlanId)
    let paidUntilAfter = 0
    const payment = this.payments.confirmManual(this.accounts.billingInfo(accountId), {
      provider: 'boosty',
      plan,
      amount: input.amount,
      region: offer.region,
      actor: input.actor,
      ...(input.reference ? { reference: input.reference } : {}),
      ...(firstFriend ? { discountPercent: FRIEND_DISCOUNT_PERCENT } : {}),
      ...(input.paidUntil !== undefined ? { until: Math.max(this.now(), input.paidUntil + BOOSTY_GRACE_MS) } : {}),
    }, () => {
      const again = this.refusal(accountId, offer, input.subscriber?.userId, rules)
      if (again) throw new BoostyGrantError(again)
      if (input.subscriber) {
        const last = this.lastPeriodEnd(input.subscriber.userId)
        if (last !== undefined && input.subscriber.periodEnd <= last + SAME_PERIOD_MS) throw new PaymentError(409, 'Этот период Boosty уже выдан')
      }
    }, (view: PaymentView) => {
      paidUntilAfter = this.payments.paidUntil(accountId) ?? 0
      this.db.prepare('INSERT INTO boosty_grants (payment_id, source, account_id, offer_key, boosty_user_id, level_id, period_end, paid_until_after, actor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(view.id, input.source, accountId, offer.key, input.subscriber?.userId ?? null, input.subscriber?.levelId ?? null, input.subscriber?.periodEnd ?? input.paidUntil ?? null, paidUntilAfter, input.actor, this.now())
      if (input.subscriber) this.rememberPeriod(input.subscriber.userId, accountId, input.subscriber.levelId, input.subscriber.periodEnd)
    })
    return { payment, region: offer.region, paidUntil: paidUntilAfter }
  }

  /**
   * «Подтвердить оплату Boosty» (owner): the owner found the payment on Boosty by the account's e-mail. `region`: the
   * region of the offer that was bought (default: the account's). `reviewId`: the review item this settles (its Boosty
   * subscriber and period are then remembered, so the sync does not issue the same period again).
   */
  confirm(actor: string, input: { email: string; offer: BoostyOffer; region?: BoostyRegion; months?: 1 | 3 | 6 | 12; paidUntil?: number; amount: number; reference?: string; reviewId?: number }) {
    const account = this.accounts.accountByEmail(input.email)
    if (!account) throw new BoostyGrantError('unknown_email', 'Аккаунт с таким e-mail не найден')
    const accountRegion = this.region(account.id)
    if (!accountRegion) throw new BoostyGrantError('no_country')
    if (accountRegion === 'RU' && !input.region) throw new BoostyGrantError('region_mismatch', 'Аккаунт из России: Boosty для него недоступен (оплата через СБП). Дни можно выдать вручную')
    const region = input.region ?? (accountRegion as BoostyRegion)
    const review = input.reviewId === undefined ? undefined : this.db.prepare('SELECT * FROM boosty_review WHERE id = ?').get(input.reviewId) as Row | undefined
    if (input.reviewId !== undefined && !review) throw new AccountError(404, 'Запись проверки не найдена')
    const subscriber = review?.boosty_user_id != null && review.period_end != null
      ? { userId: String(review.boosty_user_id), levelId: String(review.level_id ?? ''), periodEnd: Number(review.period_end) }
      : undefined
    const result = this.grant({
      source: 'manual', actor, accountId: account.id, offer: offerOf(region, input.offer), amount: input.amount,
      ...(input.months !== undefined ? { months: input.months } : { paidUntil: input.paidUntil }),
      ...(input.reference ? { reference: input.reference } : {}),
      ...(subscriber ? { subscriber } : {}),
    })
    if (review) this.db.prepare("UPDATE boosty_review SET status = 'resolved', resolved_at = ?, resolved_by = ?, account_id = ? WHERE id = ?").run(this.now(), actor, account.id, Number(review.id))
    return { ...result, accountId: account.id }
  }

  // ---- the automatic sync (services/boostySync.ts) ----

  /** The offer of a Boosty level: the table by id, the owner's mapping, BOOSTY_LEVEL_MAP by id / name / price. */
  offerForLevel(levelId: string, name: string, price: number): BoostyOfferDef | undefined {
    const byTable = BOOSTY_OFFER_TABLE.find((offer) => offer.levelId === levelId)
    if (byTable) return byTable
    const mapped = (this.db.prepare('SELECT offer_key FROM boosty_levels WHERE level_id = ?').get(levelId) as Row | undefined)?.offer_key
    const key = (typeof mapped === 'string' ? mapped : undefined) ?? this.levelMap.ids.get(levelId) ?? this.levelMap.names.get(name.trim().toLowerCase()) ?? this.levelMap.prices.get(price)
    return key ? offerByKey(key) : undefined
  }

  /** One sync pass over the subscribers Boosty listed. Never throws for one subscriber: the rest still run. */
  applySubscribers(subscribers: readonly BoostySubscriber[]): BoostySyncResult {
    const result: BoostySyncResult = { subscribers: subscribers.length, active: 0, granted: 0, adopted: 0, review: 0, unchanged: 0 }
    const levels = new Map<string, { name: string; price: number; count: number }>()
    for (const subscriber of subscribers) {
      if (!subscriber.active) continue
      result.active += 1
      if (subscriber.levelId) {
        const level = levels.get(subscriber.levelId) ?? { name: subscriber.levelName, price: subscriber.price, count: 0 }
        level.count += 1
        levels.set(subscriber.levelId, level)
      }
      try {
        const outcome = this.applySubscriber(subscriber)
        result[outcome] += 1
      } catch (error) {
        // A refusal raced inside the transaction, or a period already issued: reviewed / counted as unchanged.
        if (error instanceof BoostyGrantError) { this.addReview(error.reason, subscriber); result.review += 1 } else if (error instanceof PaymentError && error.status === 409) result.unchanged += 1
        else console.warn('Boosty sync: one subscriber failed', error instanceof Error ? error.name : 'unknown error')
      }
    }
    const now = this.now()
    for (const [levelId, level] of levels) {
      this.db.prepare(`INSERT INTO boosty_levels (level_id, name, price, subscribers, last_seen_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(level_id) DO UPDATE SET name = excluded.name, price = excluded.price, subscribers = excluded.subscribers, last_seen_at = excluded.last_seen_at`).run(levelId, level.name, level.price, level.count, now)
    }
    return result
  }

  private applySubscriber(subscriber: BoostySubscriber): 'granted' | 'adopted' | 'review' | 'unchanged' {
    const offer = this.offerForLevel(subscriber.levelId, subscriber.levelName, subscriber.price)
    if (!offer) {
      console.warn(`Boosty sync: unmatched level ${subscriber.levelId || '(none)'} — map it in the owner panel`)
      return this.addReview('unknown_level', subscriber)
    }
    if (!subscriber.paidUntil) return this.addReview('no_period', subscriber, offer)
    const periodEnd = subscriber.paidUntil
    const last = this.lastPeriodEnd(subscriber.userId)
    if (last !== undefined && periodEnd <= last + SAME_PERIOD_MS) return 'unchanged'
    if (periodEnd <= this.now()) return 'unchanged'
    const account = subscriber.email ? this.accounts.accountByEmail(subscriber.email) : undefined
    if (!account) return this.addReview('unknown_email', subscriber, offer)
    const reason = this.refusal(account.id, offer, subscriber.userId)
    const share = reason === 'region_mismatch' ? this.crossRegionShare(account.id, offer, subscriber.price) : undefined
    if (reason && share === undefined) return this.addReview(reason, subscriber, offer, account.id)
    const meta = { userId: subscriber.userId, levelId: subscriber.levelId, periodEnd }
    if (share !== undefined) {
      // the other region's level: the period it is worth from now (the whole one when it costs as much or more)
      const now = this.now()
      this.grant({
        source: 'auto', actor: SYNC_ACTOR, accountId: account.id, offer, paidUntil: Math.round(now + (periodEnd - now) * share),
        amount: Math.max(0, Math.round(subscriber.price * 100)), reference: `sub:${subscriber.userId}:${Math.floor(periodEnd / 1000)}`, subscriber: meta, crossRegion: true,
      })
      this.resolveReviews(subscriber.userId, periodEnd)
      return 'granted'
    }
    if (last === undefined && this.adopt(account.id, offer, meta)) { this.resolveReviews(subscriber.userId, periodEnd); return 'adopted' }
    this.grant({
      source: 'auto', actor: SYNC_ACTOR, accountId: account.id, offer, paidUntil: periodEnd, amount: Math.max(0, Math.round(subscriber.price * 100)),
      reference: `sub:${subscriber.userId}:${Math.floor(periodEnd / 1000)}`, subscriber: meta,
    })
    this.resolveReviews(subscriber.userId, periodEnd)
    return 'granted'
  }

  /**
   * The subscriber's first period may already have been confirmed by hand (the owner was faster than the sync): a recent
   * manual Boosty payment of the same account and region, not tied to a subscriber yet, is tied to this one — no second
   * payment, the paid period only stretched to Boosty's date if that is longer.
   */
  private adopt(accountId: string, offer: BoostyOfferDef, subscriber: { userId: string; levelId: string; periodEnd: number }) {
    const row = this.db.prepare(`SELECT g.payment_id FROM boosty_grants g JOIN payments p ON p.id = g.payment_id
      WHERE g.account_id = ? AND g.source = 'manual' AND g.boosty_user_id IS NULL AND p.status = 'succeeded' AND p.region = ? AND g.created_at >= ?
      ORDER BY g.created_at DESC LIMIT 1`).get(accountId, offer.region, this.now() - ADOPT_WINDOW_MS) as Row | undefined
    if (!row) return false
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.prepare('UPDATE boosty_grants SET boosty_user_id = ?, level_id = ?, period_end = ? WHERE payment_id = ?').run(subscriber.userId, subscriber.levelId, subscriber.periodEnd, String(row.payment_id))
      this.payments.extendTo(accountId, Math.max(this.now(), subscriber.periodEnd + BOOSTY_GRACE_MS))
      this.rememberPeriod(subscriber.userId, accountId, subscriber.levelId, subscriber.periodEnd)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
    return true
  }

  private lastPeriodEnd(userId: string) {
    const row = this.db.prepare('SELECT last_period_end FROM boosty_subscribers WHERE boosty_user_id = ?').get(userId) as Row | undefined
    return row ? Number(row.last_period_end) : undefined
  }

  private rememberPeriod(userId: string, accountId: string, levelId: string, periodEnd: number) {
    this.db.prepare(`INSERT INTO boosty_subscribers (boosty_user_id, account_id, level_id, last_period_end, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(boosty_user_id) DO UPDATE SET account_id = excluded.account_id, level_id = excluded.level_id, last_period_end = MAX(last_period_end, excluded.last_period_end), updated_at = excluded.updated_at`)
      .run(userId, accountId, levelId, periodEnd, this.now())
  }

  /** One review item per subscriber, period and reason (a poll every few minutes does not repeat it). */
  private addReview(reason: BoostyReviewReason, subscriber: BoostySubscriber, offer?: BoostyOfferDef, accountId?: string): 'review' {
    const now = this.now()
    const key = `${subscriber.userId}:${subscriber.levelId}:${subscriber.paidUntil ?? 0}:${reason}`
    this.db.prepare(`INSERT INTO boosty_review (key, reason, email, account_id, boosty_user_id, level_id, level_name, offer_key, price, period_end, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?) ON CONFLICT(key) DO UPDATE SET updated_at = excluded.updated_at, account_id = COALESCE(excluded.account_id, account_id)`)
      .run(key, reason, subscriber.email.slice(0, 254), accountId ?? null, subscriber.userId, subscriber.levelId || null, subscriber.levelName || null, offer?.key ?? null, subscriber.price, subscriber.paidUntil ?? null, now, now)
    return 'review'
  }

  /** Open review items of a subscriber up to a period that has now been issued: settled by the sync. */
  private resolveReviews(userId: string, periodEnd: number) {
    this.db.prepare("UPDATE boosty_review SET status = 'resolved', resolved_at = ?, resolved_by = ? WHERE boosty_user_id = ? AND status = 'open' AND (period_end IS NULL OR period_end <= ?)")
      .run(this.now(), SYNC_ACTOR, userId, periodEnd + SAME_PERIOD_MS)
  }

  // ---- the owner's lists ----

  review(filter: { status?: 'open' | 'all'; limit: number; offset: number }) {
    const where = filter.status === 'all' ? '' : "WHERE status = 'open'"
    const total = Number((this.db.prepare(`SELECT COUNT(*) AS n FROM boosty_review ${where}`).get() as Row).n)
    const items = (this.db.prepare(`SELECT * FROM boosty_review ${where} ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?`).all(filter.limit, filter.offset) as Row[]).map((row): BoostyReviewItem => {
      const reason = String(row.reason) as BoostyReviewReason
      return {
        id: Number(row.id), reason, reasonText: REVIEW_REASON_TEXT[reason] ?? reason, email: String(row.email),
        ...optionalText('accountId', row.account_id), ...optionalText('boostyUserId', row.boosty_user_id), ...optionalText('levelId', row.level_id),
        ...optionalText('levelName', row.level_name), ...(row.offer_key ? { offerKey: String(row.offer_key) as BoostyOfferKey } : {}),
        ...(row.price == null ? {} : { price: Number(row.price) }), ...(row.period_end == null ? {} : { periodEnd: iso(row.period_end) }),
        status: row.status === 'resolved' || row.status === 'dismissed' ? row.status : 'open',
        createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
        ...(row.resolved_at == null ? {} : { resolvedAt: iso(row.resolved_at) }), ...optionalText('resolvedBy', row.resolved_by),
      }
    })
    return { items, total }
  }

  dismissReview(actor: string, id: number) {
    const changed = this.db.prepare("UPDATE boosty_review SET status = 'dismissed', resolved_at = ?, resolved_by = ? WHERE id = ? AND status = 'open'").run(this.now(), actor, id)
    if (!Number(changed.changes)) throw new AccountError(404, 'Открытая запись проверки не найдена')
  }

  /** Levels the sync has seen that are not one of the four offers: id, name, price and the owner's mapping. */
  levels(): BoostyLevelSeen[] {
    return (this.db.prepare('SELECT * FROM boosty_levels ORDER BY last_seen_at DESC LIMIT 50').all() as Row[])
      .filter((row) => !BOOSTY_OFFER_TABLE.some((offer) => offer.levelId === String(row.level_id)))
      .map((row) => ({ levelId: String(row.level_id), name: String(row.name), price: Number(row.price), ...(row.offer_key ? { offerKey: String(row.offer_key) as BoostyOfferKey } : {}), lastSeenAt: iso(row.last_seen_at), subscribers: Number(row.subscribers) }))
  }

  /** The owner maps a Boosty level to one of the four offers (null: unmapped again). */
  mapLevel(levelId: string, offerKey: BoostyOfferKey | null) {
    if (BOOSTY_OFFER_TABLE.some((offer) => offer.levelId === levelId)) throw new AccountError(409, 'Этот уровень уже сопоставлен в таблице предложений')
    const changed = this.db.prepare('UPDATE boosty_levels SET offer_key = ? WHERE level_id = ?').run(offerKey, levelId)
    if (!Number(changed.changes)) throw new AccountError(404, 'Уровень Boosty ещё не встречался')
  }

  /** Boosty payments, newest first; `accountId` narrows to one account. */
  list(filter: { accountId?: string; limit: number; offset: number }) {
    const where = filter.accountId ? "WHERE p.provider = 'boosty' AND p.account_id = ?" : "WHERE p.provider = 'boosty'"
    const args = filter.accountId ? [filter.accountId] : []
    const total = Number((this.db.prepare(`SELECT COUNT(*) AS n FROM payments p ${where}`).get(...args) as Row).n)
    const rows = this.db.prepare(`SELECT p.*, a.email AS email, a.deleted_at AS deleted_at, g.source AS source, g.offer_key AS offer_key, g.boosty_user_id AS boosty_user_id,
      g.period_end AS period_end, g.paid_until_after AS paid_until_after
      FROM payments p LEFT JOIN accounts a ON a.id = p.account_id LEFT JOIN boosty_grants g ON g.payment_id = p.id ${where}
      ORDER BY p.created_at DESC, p.rowid DESC LIMIT ? OFFSET ?`).all(...args, filter.limit, filter.offset) as Row[]
    const payments = rows.map((row): BoostyPaymentRecord => {
      const reference = typeof row.provider_id === 'string' && row.provider_id.startsWith('boosty:') ? row.provider_id.slice('boosty:'.length) : undefined
      return {
        id: String(row.id),
        accountId: String(row.account_id),
        ...(row.email == null || row.deleted_at != null ? {} : { email: String(row.email) }),
        region: String(row.region) as PaymentRegion,
        offer: row.offer_key ? (String(row.offer_key).endsWith('_FRIEND') ? 'friend' : 'standard') : row.discount_percent == null ? 'standard' : 'friend',
        ...(row.offer_key ? { offerKey: String(row.offer_key) as BoostyOfferKey } : {}),
        plan: String(row.plan) as PlanId,
        amount: Number(row.amount) / 100,
        status: row.status === 'refunded' ? 'refunded' : 'succeeded',
        source: row.source === 'auto' ? 'auto' : 'manual',
        confirmedAt: iso(row.paid_at ?? row.created_at),
        confirmedBy: String(row.confirmed_by ?? ''),
        ...(row.period_end == null ? {} : { periodEnd: iso(row.period_end) }),
        ...(row.paid_until_after == null ? {} : { paidUntilAfter: iso(row.paid_until_after) }),
        ...optionalText('boostyUserId', row.boosty_user_id),
        ...(reference ? { reference } : {}),
      }
    })
    return { payments, total }
  }

  // ---- the sync's persisted state (services/boostySync.ts) ----

  state(key: string) {
    const row = this.db.prepare('SELECT value FROM boosty_state WHERE key = ?').get(key) as Row | undefined
    return row ? String(row.value) : undefined
  }

  setState(key: string, value: string | undefined) {
    if (value === undefined) this.db.prepare('DELETE FROM boosty_state WHERE key = ?').run(key)
    else this.db.prepare('INSERT INTO boosty_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
  }
}
