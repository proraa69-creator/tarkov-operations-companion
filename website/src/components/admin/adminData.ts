/** Formatting, labels and the data hook of the «Админ-панель» tabs (components/admin/*). */
import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, errorMessage, type PaymentProvider, type PaymentStatus, type PlanId } from '../../api'
import { useAuth } from '../../auth'
import { formatPeriodKey, formatRub } from '../ReferralStatsTable'

export { formatPeriodKey, formatRub }

export const numberFormat = new Intl.NumberFormat('ru-RU')
export const dateTime = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' })
export const dateOnly = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Moscow' })
export const PLAN_IDS: PlanId[] = ['1m', '3m', '6m', '12m']
export const PLAN_LABEL: Record<PlanId, string> = { '1m': '1 мес', '3m': '3 мес', '6m': '6 мес', '12m': '12 мес' }
/** «Архив»: a payment service that is no longer connected (owner, 13.10.2026); its payments stay as history. */
export const PROVIDER_LABEL: Record<PaymentProvider, string> = { yookassa: 'ЮKassa', boosty: 'Boosty', bezebee: 'BZB', archive: 'Архив' }
export const PAYMENT_STATUS: Record<PaymentStatus, { label: string; tone: string }> = {
  pending: { label: 'Ожидает', tone: '' },
  succeeded: { label: 'Оплачен', tone: 'green' },
  canceled: { label: 'Отменён', tone: 'danger' },
  refunded: { label: 'Возвращён', tone: 'danger' },
}

/**
 * «Пригласи друга» (owner, 14.10.2026: «нужно что бы было видно от кого пришел человек по скидке»): the inviter's e-mail,
 * or «друг (аккаунт удалён)» when that account was deleted since.
 */
export function inviterText(inviter: { email?: string; deleted?: true }) {
  return inviter.email && !inviter.deleted ? inviter.email : 'друг (аккаунт удалён)'
}
/** «Пользователи» opened on one account: e-mails in payments and rewards lead there (AdminUsers reads `q`). */
export const usersLink = (email: string) => `/admin?tab=users&q=${encodeURIComponent(email)}`

/** Why a «Пригласи друга» reward waits for the owner (server/src/services/invites.ts fraudFlags), in plain Russian. */
export const INVITE_FLAG: Record<string, string> = {
  'same-device': 'тот же компьютер, что у пригласившего',
  'same-address': 'тот же IP-адрес при регистрации',
  'address-cluster': 'много друзей с одного IP-адреса',
  'same-card': 'оплачено картой пригласившего',
  'card-reused': 'эта карта уже оплачивала другого друга',
  burst: 'слишком много друзей за сутки',
  'same-email': 'почта друга совпадает с почтой пригласившего',
  'eft-counted': 'аккаунт Таркова друга уже засчитан',
  'payment-or-account': 'платёж отменён или аккаунт друга удалён',
  milestone: 'крупный ранг: подтверждается вручную',
}
export const inviteFlagText = (flags: readonly string[]) => flags.map((flag) => INVITE_FLAG[flag] ?? flag).join('; ')
/** What a reward is for. */
export const REWARD_KIND: Record<string, string> = { friend: 'за друга', scout: 'ранг Scout', operator: 'ранг Operator', 'squad-leader': 'ранг Squad Leader', 'raid-commander': 'ранг Raid Commander', legend: 'ранг Legend' }
/**
 * The state of a reward in words (owner, 17.10.2026: «более понятнее»): на проверке до DATE, начислено DATE,
 * у администрации: why, не засчитано: why.
 */
export function rewardStatusText(reward: { status: string; releaseAt?: string; decidedAt?: string; waitingEft?: true; flags?: readonly string[]; comment?: string }) {
  const flags = reward.flags?.length ? inviteFlagText(reward.flags) : ''
  if (reward.status === 'pending') {
    if (reward.waitingEft) return 'на проверке: друг ещё не вошёл в приложение'
    return reward.releaseAt ? `на проверке до ${dateOnly.format(new Date(reward.releaseAt))}` : 'на проверке'
  }
  if (reward.status === 'review') return flags ? `у администрации: ${flags}` : 'у администрации'
  if (reward.status === 'granted') return reward.decidedAt ? `начислено ${dateOnly.format(new Date(reward.decidedAt))}` : 'начислено'
  if (reward.status === 'canceled') return reward.comment ? `не засчитано: ${reward.comment}` : flags ? `не засчитано: ${flags}` : 'не засчитано'
  return reward.status
}
export const REWARD_TONE: Record<string, string> = { pending: '', review: 'brass', granted: 'green', canceled: 'danger' }

/** The friend's first-month discount of a friend-invited account (services/invites.ts on the server). */
export const FRIEND_DISCOUNT: Record<'used' | 'unused' | 'lost', { label: string; tone: string; hint: string }> = {
  used: { label: 'скидка использована', tone: 'green', hint: 'Первая оплата прошла со скидкой друга' },
  unused: { label: 'скидка ещё не использована', tone: '', hint: 'Оплат ещё не было: скидка на первый месяц доступна' },
  lost: { label: 'оплатил без скидки', tone: '', hint: 'Первая оплата прошла без скидки (например, тариф дольше месяца): скидка больше не предлагается' },
}

export type Failure = { message: string; offline: boolean }
export const failure = (reason: unknown): Failure => ({ message: errorMessage(reason), offline: reason instanceof ApiError && reason.network })

/**
 * Loads `fetcher(token)` when the inputs change; keeps the previous data while reloading, drops answers that arrive
 * after a newer request.
 */
export function useAdminData<T>(fetcher: (token: string) => Promise<T>) {
  const { token } = useAuth()
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<Failure | null>(null)
  const [loading, setLoading] = useState(false)
  const generation = useRef(0)
  const reload = useCallback(() => {
    if (!token) return Promise.resolve()
    const current = ++generation.current
    return fetcher(token).then(
      (next) => { if (current === generation.current) { setData(next); setError(null) } },
      (reason: unknown) => { if (current === generation.current) setError(failure(reason)) },
    ).finally(() => { if (current === generation.current) setLoading(false) })
  }, [token, fetcher])
  useEffect(() => { void reload() }, [reload])
  /** «Обновить» button: the same request with a spinner. */
  const refresh = useCallback(() => { setLoading(true); return reload() }, [reload])
  return { data, setData, error, loading, reload, refresh, token }
}

/** Moscow date (YYYY-MM-DD) `daysAgo` days before today. */
export function mskDay(daysAgo = 0) {
  return new Date(Date.now() + 3 * 3600_000 - daysAgo * 86_400_000).toISOString().slice(0, 10)
}
