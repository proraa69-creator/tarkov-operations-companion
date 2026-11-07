/**
 * Payment regions (owner's spec: docs/payments/payment-regions-and-announcements.md). Shared by the server (which alone
 * decides what an account may pay with: server/src/routes/payments.ts, services/bezebee.ts), the website's cabinet and
 * the apps (display only).
 *
 *   RU    — Russia: ЮKassa (BZB's CIS pages only for an account the owner opened them to: bezebeeRegionOf);
 *   CIS   — the CIS countries of src/shared/countries.ts except Russia, Asia, the low-income countries and Ukraine: BZB in
 *           roubles, or the CIS price in dollars by a foreign card;
 *   WORLD — every other country, the rest of Europe and a country typed by hand («XX») included: BZB in US dollars.
 *
 * The region is derived from the country saved in the account, never from a form value of a payment, the IP address or
 * a VPN. An account without a country has no region: paying waits for «Укажите страну».
 *
 * The BZB pages themselves are not here: the server hands out only the ones an account may see (services/bezebee.ts).
 */
import { CIS_COUNTRIES } from './countries'

export type PaymentRegion = 'RU' | 'CIS' | 'WORLD'
export const PAYMENT_REGIONS: readonly PaymentRegion[] = ['RU', 'CIS', 'WORLD']

/**
 * Countries that pay the CIS price though they are not in the CIS (owner, 01.11.2026: «поменяй все азиатские страны,
 * добавь их в снг, что бы цены соответсвовали их регионам… и все страны где низкий уровень жизни и зп, их добавь в снг»).
 * Only the price: the CIS of the admin panel's regions and of the notices' language stays src/shared/countries.ts.
 *   - Asia: every country of the UN geoscheme's Asia (Central, Eastern, South-Eastern, Southern and Western Asia), except
 *     Cyprus, which the app counts as Europe;
 *   - low and lower-middle income outside Asia: the World Bank's income groups (FY2026).
 */
export const ASIA_PRICE_COUNTRIES: readonly string[] = [
  // Eastern Asia
  'CN', 'HK', 'MO', 'MN', 'JP', 'KP', 'KR', 'TW',
  // South-Eastern Asia
  'BN', 'KH', 'ID', 'LA', 'MY', 'MM', 'PH', 'SG', 'TH', 'TL', 'VN',
  // Southern Asia
  'AF', 'BD', 'BT', 'IN', 'IR', 'MV', 'NP', 'PK', 'LK',
  // Western Asia (the CIS's Armenia and Azerbaijan are in the CIS list already)
  'BH', 'GE', 'IQ', 'IL', 'JO', 'KW', 'LB', 'OM', 'QA', 'SA', 'PS', 'SY', 'TR', 'AE', 'YE',
]
export const LOW_INCOME_PRICE_COUNTRIES: readonly string[] = [
  // Africa
  'AO', 'BJ', 'BF', 'BI', 'CV', 'CM', 'CF', 'TD', 'KM', 'CD', 'CG', 'CI', 'DJ', 'EG', 'ER', 'SZ', 'ET', 'GM', 'GH', 'GN',
  'GW', 'KE', 'LS', 'LR', 'MG', 'MW', 'ML', 'MR', 'MA', 'MZ', 'NE', 'NG', 'RW', 'ST', 'SN', 'SL', 'SO', 'SS', 'SD', 'TZ',
  'TG', 'TN', 'UG', 'ZM', 'ZW',
  // The Americas
  'BO', 'HT', 'HN', 'NI',
  // Oceania
  'KI', 'FM', 'PG', 'WS', 'SB', 'VU',
]

/**
 * Countries the owner gave the CIS price by name (owner, 08.11.2026: «Переведи Украину в СНГ-сегмент… У них оплата должна
 * быть и в рублях, и в долларах… Не $7, а сколько там, 3,5»): the CIS pages in roubles and the CIS price in dollars by card.
 * Only the price: Ukraine stays Europe in the admin panel's regions and the notices' language (src/shared/countries.ts).
 */
export const OWNER_CIS_PRICE_COUNTRIES: readonly string[] = ['UA']

/** The CIS price: the CIS list without Russia (Russia pays through SBP), Asia, the low-income countries and the owner's. */
export const CIS_PAYMENT_COUNTRIES: readonly string[] = [...new Set([...CIS_COUNTRIES.filter((code) => code !== 'RU'), ...ASIA_PRICE_COUNTRIES, ...LOW_INCOME_PRICE_COUNTRIES, ...OWNER_CIS_PRICE_COUNTRIES])]

/** The payment region of a saved country (ISO 3166-1 alpha-2 or «XX»); undefined when the account has no country. */
export function paymentRegionOf(country: string | null | undefined): PaymentRegion | undefined {
  if (typeof country !== 'string') return undefined
  const code = country.trim().toUpperCase()
  if (!/^[A-Z]{2}$/.test(code)) return undefined
  if (code === 'RU') return 'RU'
  return CIS_PAYMENT_COUNTRIES.includes(code) ? 'CIS' : 'WORLD'
}
