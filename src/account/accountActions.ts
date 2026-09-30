import type { ServerAccountStatus } from '../electron'
import { ACCOUNT_URL, REGISTER_URL } from '../shared/links'
import { usesWebAccount } from '../sync/serverSync'
import { apiBaseUrl } from '../sync/webAccount'

/** Opens a website page in the system browser (desktop: the site of the server the app uses) or a new tab. */
export function openWebsite(page: 'register' | 'cabinet') {
  const desktop = window.tarkovDesktop?.account
  if (desktop) { void desktop.openWebsite(page).catch(() => false); return }
  // The phone: the site of the server it uses (the owner's address serves the site and the API).
  let site = ''
  if (usesWebAccount()) { try { site = new URL(apiBaseUrl()).origin } catch { /* fall back to the configured links */ } }
  window.open(site ? `${site}/${page}` : page === 'register' ? REGISTER_URL : ACCOUNT_URL, '_blank', 'noopener,noreferrer')
}

export type SubscriptionView = NonNullable<ServerAccountStatus['subscription']>

const date = (value?: string) => (value ? new Date(value).toLocaleDateString('ru-RU') : '')

/** «Активна до 30.10.2026», «Пробный период до …», «Бесплатно навсегда», «Не активна». */
export function subscriptionText(subscription?: SubscriptionView) {
  if (!subscription) return 'Нет данных: сервер недоступен'
  if (subscription.status === 'lifetime') return 'Бесплатно навсегда'
  if (subscription.status === 'active') return subscription.paidUntil ? `Активна до ${date(subscription.paidUntil)}` : 'Активна'
  if (subscription.status === 'trial') return subscription.trialEndsAt ? `Пробный период до ${date(subscription.trialEndsAt)}` : 'Пробный период'
  return 'Не активна'
}
