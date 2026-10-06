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
export const PROVIDER_LABEL: Record<PaymentProvider, string> = { yookassa: 'ЮKassa', lava: 'Lava.top' }
export const PAYMENT_STATUS: Record<PaymentStatus, { label: string; tone: string }> = {
  pending: { label: 'Ожидает', tone: '' },
  succeeded: { label: 'Оплачен', tone: 'green' },
  canceled: { label: 'Отменён', tone: 'danger' },
  refunded: { label: 'Возвращён', tone: 'danger' },
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
