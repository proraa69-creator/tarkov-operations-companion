/**
 * The tariffs on BZB (Bezebee, pay.bezebee.com; owner, 20.10.2026: «добавь СНГ-тарифы для тех, у кого аккаунты СНГ на
 * сайте; каждую ссылку отдельно, каждой кнопкой, как у нас сделано с ЮKassa», then the Global ones). One product page per
 * plan and region, a one-time payment: roubles for the CIS, US dollars for every other country outside Russia. A
 * region's pages go only to an account whose saved country is in that region
 * (src/shared/paymentRegions.ts), never to Russia but for an account the owner opened them to (bezebeeRegionOf: the CIS
 * pages), and only with the offer / personal data consent (stored like a ЮKassa
 * payment's). The referral page (first month at the friend's price) only while the account's friend discount is open
 * (services/invites.ts). Until BZB's confirmation reaches this server (its API, owner 20.10.2026), the owner opens the
 * subscription by hand.
 */
import { paymentRegionOf } from '../../../src/shared/paymentRegions.js'
import type { AccountStore } from './accountStore.js'
import { FRIEND_DISCOUNT_PERCENT, type InviteProgram } from './invites.js'
import { PaymentError, type PaymentStore } from './paymentStore.js'

export type BezebeePlanId = '1m' | '3m' | '6m' | '12m'
export type BezebeeRegion = 'CIS' | 'WORLD'

export interface BezebeePlan {
  plan: BezebeePlanId
  months: number
  /** In the region's currency, as on the BZB product page. */
  price: number
  url: string
}

export interface BezebeeTariffs {
  currency: 'RUB' | 'USD'
  plans: readonly BezebeePlan[]
  /** «Пригласи друга»: the first month of an invited account. */
  friend: { plan: '1m'; price: number; url: string }
}

export const BEZEBEE_TARIFFS: Readonly<Record<BezebeeRegion, BezebeeTariffs>> = {
  CIS: {
    currency: 'RUB',
    plans: [
      { plan: '1m', months: 1, price: 300, url: 'https://pay.bezebee.com/NMTIra0O' },
      // 800 ₽ (owner, 27.10.2026: «тариф для СНГ 3 месяца сделать 800 рублей»).
      { plan: '3m', months: 3, price: 800, url: 'https://pay.bezebee.com/EIV5foW0' },
      { plan: '6m', months: 6, price: 1500, url: 'https://pay.bezebee.com/iPnQLAib' },
      { plan: '12m', months: 12, price: 2400, url: 'https://pay.bezebee.com/x0ccDHp2' },
    ],
    friend: { plan: '1m', price: 240, url: 'https://pay.bezebee.com/DBmUzkAn' },
  },
  WORLD: {
    currency: 'USD',
    plans: [
      { plan: '1m', months: 1, price: 7, url: 'https://pay.bezebee.com/3bAgJUTh' },
      { plan: '3m', months: 3, price: 19, url: 'https://pay.bezebee.com/EpGyVETp' },
      { plan: '6m', months: 6, price: 35, url: 'https://pay.bezebee.com/ivaGNRWa' },
      { plan: '12m', months: 12, price: 60, url: 'https://pay.bezebee.com/sOGFWBn6' },
    ],
    friend: { plan: '1m', price: 5.5, url: 'https://pay.bezebee.com/Xw98gnXM' },
  },
}

/**
 * The CIS price paid by a foreign card in US dollars (owner, 02.11.2026: a player from Georgia could not pay — the CIS
 * pages take SBP and Russian cards only; «создай новые продукты по ценам СНГшным, но с глобал оплатой в долларах», named
 * Global). Offered to every account of the CIS price next to the rouble pages. Every price differs from the other tables,
 * so a sum still names one tariff (services/bezebeeWebhook.ts). A page BZB has not approved yet has no url: not offered.
 */
export const BEZEBEE_CARD_TARIFFS: BezebeeTariffs = {
  currency: 'USD',
  plans: [
    { plan: '1m', months: 1, price: 3.5, url: 'https://pay.bezebee.com/H7uHXCvY' },
    { plan: '3m', months: 3, price: 9.5, url: 'https://pay.bezebee.com/oHfDYpiR' },
    { plan: '6m', months: 6, price: 18, url: 'https://pay.bezebee.com/WQkT4kue' },
    { plan: '12m', months: 12, price: 29, url: 'https://pay.bezebee.com/esIOFGrz' },
  ],
  friend: { plan: '1m', price: 2.9, url: 'https://pay.bezebee.com/xdoWbQJ2' },
}

/**
 * Countries whose cards the dollar pages refuse (owner, 11.11.2026, after BZB's answer: Belarusian cards are blocked by the
 * card processor of the dollar pages, while the rouble pages' Russian acquiring takes them, Belkart included — «у людей из
 * Белоруссии убери в долларах, оставь в рублях»). Such an account gets no `card` offer and no dollar page; a sale that
 * still comes in is credited as usual (services/bezebeeWebhook.ts).
 */
export const NO_CARD_COUNTRIES: readonly string[] = ['BY']

/** Whether an account of this saved country may pay the CIS price by a foreign card in dollars. */
export const bezebeeCardAllowed = (country: string | null | undefined) => !NO_CARD_COUNTRIES.includes((country ?? '').toUpperCase())

/** Every table with the region its payments belong to: the CIS in roubles, the CIS by a foreign card, Global. */
export const BEZEBEE_TABLES: ReadonlyArray<{ region: BezebeeRegion; tariffs: BezebeeTariffs }> = [
  { region: 'CIS', tariffs: BEZEBEE_TARIFFS.CIS },
  { region: 'CIS', tariffs: BEZEBEE_CARD_TARIFFS },
  { region: 'WORLD', tariffs: BEZEBEE_TARIFFS.WORLD },
]

const offerOf = (tariffs: BezebeeTariffs, friendOpen: boolean) => ({
  currency: tariffs.currency,
  plans: tariffs.plans.filter((entry) => entry.url).map(({ plan, months, price }) => ({ plan, months, price })),
  friend: friendOpen && tariffs.friend.url ? { plan: tariffs.friend.plan, price: tariffs.friend.price } : null,
})

/**
 * What the cabinet may know before a click: the plans and prices of the account's region, never the links. A CIS account
 * also gets `card`: the plans in dollars for a foreign card — unless its country's cards cannot pay them (`card` false:
 * NO_CARD_COUNTRIES).
 */
export function bezebeeOffer(region: BezebeeRegion, friendOpen: boolean, card = true) {
  return { ...offerOf(BEZEBEE_TARIFFS[region], friendOpen), ...(region === 'CIS' && card ? { card: offerOf(BEZEBEE_CARD_TARIFFS, friendOpen) } : {}) }
}

/**
 * The BZB region of an account: its saved country's (the CIS, Global), or the CIS for an account from Russia the owner
 * opened BZB to (owner, 02.11.2026: «добавь именно ему в личный кабинет оплату через bzb в снг, там же тоже в рублях и те
 * же цены» — a player whose connection never reached ЮMoney); undefined for the rest of Russia and without a country.
 */
export function bezebeeRegionOf(accounts: Pick<AccountStore, 'countryOf' | 'bezebeeAllowed'>, accountId: string): BezebeeRegion | undefined {
  const region = paymentRegionOf(accounts.countryOf(accountId))
  if (region === 'CIS' || region === 'WORLD') return region
  return region === 'RU' && accounts.bezebeeAllowed(accountId) ? 'CIS' : undefined
}

/** The page of a plan of the region; `friend`: the referral page (the first month only); `card`: the CIS in dollars. */
export function bezebeeLink(region: BezebeeRegion, plan: BezebeePlanId, friend = false, card = false) {
  const tariffs = card && region === 'CIS' ? BEZEBEE_CARD_TARIFFS : BEZEBEE_TARIFFS[region]
  if (friend) return plan === tariffs.friend.plan ? tariffs.friend.url || undefined : undefined
  return tariffs.plans.find((entry) => entry.plan === plan)?.url || undefined
}

/**
 * «Подтвердить оплату BZB» (owner): until BZB's API tells this server, the owner finds the payment on BZB and confirms it
 * here. It is stored as a succeeded payment (services/paymentStore.ts confirmManual): the plan's months are added, the
 * referral price spends the friend discount (the cabinet then shows the full prices) and earns the inviter's reward,
 * like a ЮKassa payment with the discount. `amount`: roubles received (default: the CIS price; required for WORLD, whose
 * page is in dollars).
 */
export class BezebeePayments {
  constructor(private readonly accounts: AccountStore, private readonly payments: PaymentStore, private readonly invites?: InviteProgram) {}

  confirm(actor: string, input: { email: string; plan: BezebeePlanId; friend?: boolean; amount?: number; reference?: string }) {
    const account = this.accounts.accountByEmail(input.email)
    if (!account) throw new BezebeeConfirmError(404, 'unknown_email', 'Аккаунт с таким email не найден')
    if (!paymentRegionOf(this.accounts.countryOf(account.id))) throw new BezebeeConfirmError(409, 'no_country', 'У аккаунта не указана страна')
    // Russia: only an account the owner opened BZB to, at the CIS prices (bezebeeRegionOf).
    const region = bezebeeRegionOf(this.accounts, account.id)
    if (!region) throw new BezebeeConfirmError(409, 'region_mismatch', 'Аккаунт из России: его оплата — через ЮKassa')
    const friend = input.friend === true
    if (friend && input.plan !== '1m') throw new BezebeeConfirmError(400, 'friend_plan', 'Цена по приглашению — только на 1 месяц')
    const friendOpen = (this.invites?.discountPercent(account.id) ?? 0) > 0
    if (friend && !friendOpen) throw new BezebeeConfirmError(409, 'friend_without_referral', 'У аккаунта нет неиспользованной скидки по приглашению')
    const tariffs = BEZEBEE_TARIFFS[region]
    const listed = friend ? tariffs.friend.price : tariffs.plans.find((entry) => entry.plan === input.plan)?.price ?? 0
    const roubles = input.amount ?? (tariffs.currency === 'RUB' ? listed : undefined)
    if (roubles === undefined || !Number.isFinite(roubles) || roubles < 0) throw new BezebeeConfirmError(400, 'amount_required', 'Укажите сумму, которую вы получили, в рублях')
    const payment = this.payments.confirmManual(this.accounts.billingInfo(account.id), {
      provider: 'bezebee',
      plan: input.plan,
      amount: Math.round(roubles * 100),
      region,
      actor,
      ...(input.reference ? { reference: input.reference } : {}),
      ...(friend ? { discountPercent: FRIEND_DISCOUNT_PERCENT } : {}),
    }, () => {
      if (friend && !((this.invites?.discountPercent(account.id) ?? 0) > 0)) throw new BezebeeConfirmError(409, 'friend_without_referral', 'У аккаунта нет неиспользованной скидки по приглашению')
    })
    return { accountId: account.id, region, payment, paidUntil: this.payments.paidUntil(account.id) ?? 0 }
  }
}

export class BezebeeConfirmError extends PaymentError {
  constructor(status: number, readonly code: string, message: string) { super(status, message) }
}
