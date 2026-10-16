/**
 * Payment regions (owner's spec: docs/payments/payment-regions-and-announcements.md). Shared by the server (which alone
 * decides what an account may pay with: server/src/routes/payments.ts, services/boosty.ts), the website's cabinet and the
 * apps (display only).
 *
 *   RU    — Russia: the existing ЮKassa SBP payment only, never a Boosty link;
 *   CIS   — the CIS countries of src/shared/countries.ts except Russia: the Boosty CIS offer;
 *   WORLD — every other country, Europe and a country typed by hand («XX») included: the Boosty international offer.
 *
 * The region is derived from the country saved in the account, never from a form value of a payment, the IP address or
 * a VPN. An account without a country has no region: paying waits for «Укажите страну».
 *
 * The Boosty links themselves are not here: the server hands out only the ones an account may see (services/boosty.ts).
 */
import { CIS_COUNTRIES } from './countries'

export type PaymentRegion = 'RU' | 'CIS' | 'WORLD'
export const PAYMENT_REGIONS: readonly PaymentRegion[] = ['RU', 'CIS', 'WORLD']

/** «СНГ» for Boosty: the CIS list without Russia (Russia pays through SBP). */
export const CIS_PAYMENT_COUNTRIES: readonly string[] = CIS_COUNTRIES.filter((code) => code !== 'RU')

/** The payment region of a saved country (ISO 3166-1 alpha-2 or «XX»); undefined when the account has no country. */
export function paymentRegionOf(country: string | null | undefined): PaymentRegion | undefined {
  if (typeof country !== 'string') return undefined
  const code = country.trim().toUpperCase()
  if (!/^[A-Z]{2}$/.test(code)) return undefined
  if (code === 'RU') return 'RU'
  return CIS_PAYMENT_COUNTRIES.includes(code) ? 'CIS' : 'WORLD'
}

/** The Boosty offers of a region: the standard one, and the one-time friend discount («Пригласи друга»). */
export type BoostyOffer = 'standard' | 'friend'
export const BOOSTY_OFFERS: readonly BoostyOffer[] = ['standard', 'friend']

/** The warning shown before every Boosty redirect; the payer acknowledges it before the link opens (exact spec text). */
export const BOOSTY_EMAIL_WARNING = {
  ru: 'Укажите на Boosty тот же email, который используется в вашем аккаунте Raid OS. Иначе мы не сможем найти платёж и активировать подписку.',
  en: 'Use the same email on Boosty as in your Raid OS account. Otherwise, we won’t be able to find your payment and activate your subscription.',
} as const

/** The suggested announcement for the Boosty audiences of «Создать объявление» (a template; nothing is sent by itself). */
export const BOOSTY_ANNOUNCEMENT = {
  title: { ru: 'Оплата через Boosty', en: 'Payments via Boosty' },
  text: {
    ru: 'Оплата Raid OS через Boosty доступна для пользователей из СНГ и других стран. Перед оплатой укажите на Boosty тот же email, который используется в Raid OS. Пользователям из России доступна оплата через СБП.',
    en: 'Raid OS payments via Boosty are now available for users in the CIS and other countries. Use the same email on Boosty as in your Raid OS account before paying. Users in Russia can pay via SBP.',
  },
} as const
