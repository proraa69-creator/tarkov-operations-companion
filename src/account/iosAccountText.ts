import type { ServerAccountStatus } from '../electron'
import { apiBaseUrl } from '../sync/webAccount'

/** Words of the iPhone app's account screens (src/account/IosAccount.tsx): no subscription, price or payment in them. */

/** «Политика конфиденциальности» on the site of the server the app uses (the owner's address serves both). */
export function privacyPolicyUrl() {
  try { return `${new URL(apiBaseUrl()).origin}/legal/privacy` } catch { return 'https://raidos.app/legal/privacy' }
}

const date = (value?: string) => (value ? new Date(value).toLocaleDateString('ru-RU') : '')

/** «Доступ открыт до 30.10.2026» / «Нет доступа»: the account's access in words without a subscription or a price. */
export function accessText(subscription?: ServerAccountStatus['subscription']) {
  if (!subscription) return 'Нет данных: сервер недоступен'
  if (subscription.status === 'lifetime') return 'Доступ открыт'
  const until = subscription.status === 'active' ? subscription.paidUntil : subscription.status === 'trial' ? subscription.trialEndsAt : undefined
  if (subscription.status === 'active' || subscription.status === 'trial') return until ? `Доступ открыт до ${date(until)}` : 'Доступ открыт'
  return 'Нет доступа'
}

/** The server's «cancel the autopayment in the cabinet» names the website's payments: on the iPhone it is support. */
export function deleteErrorText(message: string) {
  return /автопродлени|автоплат/i.test(message) ? 'Этот аккаунт нельзя удалить из приложения. Напишите в поддержку — удалим вручную.' : message
}
