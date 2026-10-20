/**
 * The tariffs on BZB (Bezebee, pay.bezebee.com; owner, 20.10.2026: «добавь СНГ-тарифы для тех, у кого аккаунты СНГ на
 * сайте; каждую ссылку отдельно, каждой кнопкой, как у нас сделано с ЮKassa», then the Global ones). One product page per
 * plan and region, a one-time payment: roubles for the CIS, US dollars for every other country outside Russia. Like the
 * Boosty links (services/boosty.ts) a region's pages go only to an account whose saved country is in that region
 * (src/shared/paymentRegions.ts), never to Russia, and only with the offer / personal data consent (stored like a ЮKassa
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

interface BezebeeTariffs {
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
      { plan: '3m', months: 3, price: 810, url: 'https://pay.bezebee.com/EIV5foW0' },
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

/** What the cabinet may know before a click: the plans and prices of the account's region, never the links. */
export function bezebeeOffer(region: BezebeeRegion, friendOpen: boolean) {
  const tariffs = BEZEBEE_TARIFFS[region]
  return {
    currency: tariffs.currency,
    plans: tariffs.plans.map(({ plan, months, price }) => ({ plan, months, price })),
    friend: friendOpen ? { plan: tariffs.friend.plan, price: tariffs.friend.price } : null,
  }
}

/** The page of a plan of the region; `friend`: the referral page (the first month only). */
export function bezebeeLink(region: BezebeeRegion, plan: BezebeePlanId, friend = false) {
  const tariffs = BEZEBEE_TARIFFS[region]
  if (friend) return plan === tariffs.friend.plan ? tariffs.friend.url : undefined
  return tariffs.plans.find((entry) => entry.plan === plan)?.url
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
    const region = paymentRegionOf(this.accounts.countryOf(account.id))
    if (!region) throw new BezebeeConfirmError(409, 'no_country', 'У аккаунта не указана страна')
    if (region === 'RU') throw new BezebeeConfirmError(409, 'region_mismatch', 'Аккаунт из России: его оплата — через ЮKassa')
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
