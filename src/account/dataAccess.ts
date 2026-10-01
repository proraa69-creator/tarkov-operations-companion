/**
 * Whether the app may show game data (docs/subscription-protection.md):
 * - 'open': the owner's app and development (no paywall at all);
 * - 'granted': the players' app with a valid signed entitlement (subscription, trial, streamer or owner account);
 * - 'locked': the players' app without one — only the account and subscription screens (src/account/Paywall.tsx);
 * - 'checking': the first account status has not arrived yet.
 */
import { useEffect, useSyncExternalStore } from 'react'
import type { EntitlementReason, ServerAccountStatus } from '../electron.d'
import { DATA_ACCESS_EVENT, dataRoute, type DataRoute } from '../data/tarkovApi'
import { refreshServerStatus, useServerAccount } from '../sync/serverSync'

export type DataAccess =
  | { state: 'open' }
  | { state: 'checking' }
  | { state: 'granted'; plan?: string; expiresAt?: string }
  | { state: 'locked'; reason: EntitlementReason; message?: string }

export function computeDataAccess(route: DataRoute, status: ServerAccountStatus | null): DataAccess {
  if (route === 'direct') return { state: 'open' }
  if (!status) return { state: 'checking' }
  if (!status.signedIn) return { state: 'locked', reason: 'signed-out' }
  const entitlement = status.entitlement
  if (entitlement?.valid) return { state: 'granted', plan: entitlement.plan, expiresAt: entitlement.expiresAt }
  return { state: 'locked', reason: entitlement?.reason ?? 'unavailable', ...(entitlement?.message ? { message: entitlement.message } : {}) }
}

const noop = () => () => {}

export function useDataAccess(): DataAccess {
  const { status } = useServerAccount()
  // The route never changes while the app runs; read through the store hook so tests can switch it.
  const route = useSyncExternalStore(noop, dataRoute, dataRoute)
  // A data request refused by the server (402 / device switched off): ask for the status at once.
  useEffect(() => {
    if (route === 'direct') return
    const refresh = () => { void refreshServerStatus() }
    window.addEventListener(DATA_ACCESS_EVENT, refresh)
    return () => window.removeEventListener(DATA_ACCESS_EVENT, refresh)
  }, [route])
  return computeDataAccess(route, status)
}

export const canLoadGameData = (access: DataAccess) => access.state === 'open' || access.state === 'granted'

/** Why the app is locked, in words (the server's own text for a switched-off device). */
export function lockedReasonText(reason: EntitlementReason, message?: string) {
  switch (reason) {
    case 'device-revoked': return message ?? 'Это устройство отключено: в аккаунт вошли на другом устройстве (не больше трёх).'
    case 'device-inactive': return 'Устройство не активировано. Нажмите «Проверить оплату» или войдите заново.'
    case 'expired': return 'Нет связи с сервером дольше 72 часов. Подключитесь к интернету, чтобы продолжить.'
    case 'clock': return 'Часы компьютера переведены назад. Исправьте дату и время и нажмите «Проверить оплату».'
    case 'key-mismatch': return 'Ключ сервера изменился. Выйдите из аккаунта и войдите снова; если это повторяется — напишите в поддержку.'
    case 'no-key': case 'unavailable': return 'Сервер недоступен. Проверьте интернет и нажмите «Проверить оплату».'
    default: return 'Подписка не активна. Карты, задания, барахолка и остальные разделы откроются после оплаты.'
  }
}
