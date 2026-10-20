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
