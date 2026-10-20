/**
 * The CIS tariffs on BZB (Bezebee, pay.bezebee.com; owner, 20.10.2026: «добавь СНГ-тарифы для тех, у кого аккаунты СНГ
 * на сайте; каждую ссылку отдельно, каждой кнопкой, как у нас сделано с ЮKassa»). One product page per plan, priced in
 * roubles on BZB. Like the Boosty links (services/boosty.ts) they are handed out only to an account whose saved country
 * is in the CIS region (src/shared/paymentRegions.ts), never to Russia or WORLD, and only after the payer acknowledged
 * the e-mail warning. BZB tells this server nothing: the owner finds the payment by the e-mail the payer gave on BZB and
 * opens the subscription by hand.
 */
export type BezebeePlanId = '1m' | '3m' | '6m' | '12m'

export interface BezebeePlan {
  plan: BezebeePlanId
  months: number
  /** Roubles, as on the BZB product page. */
  price: number
  url: string
}

export const BEZEBEE_CIS_PLANS: readonly BezebeePlan[] = [
  { plan: '1m', months: 1, price: 300, url: 'https://pay.bezebee.com/NMTIra0O' },
  { plan: '3m', months: 3, price: 810, url: 'https://pay.bezebee.com/EIV5foW0' },
  { plan: '6m', months: 6, price: 1500, url: 'https://pay.bezebee.com/iPnQLAib' },
  { plan: '12m', months: 12, price: 2400, url: 'https://pay.bezebee.com/x0ccDHp2' },
]

/** What the cabinet may know before a click: the plans and prices, never the links. */
export function bezebeeOffer() {
  return { currency: 'RUB' as const, plans: BEZEBEE_CIS_PLANS.map(({ plan, months, price }) => ({ plan, months, price })) }
}

export function bezebeeLink(plan: BezebeePlanId) {
  return BEZEBEE_CIS_PLANS.find((entry) => entry.plan === plan)?.url
}
