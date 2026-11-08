/** Formatting the admin app's sections share. Times are the owner's: Bangkok (src/shared/ownerTime.ts), as on the site. */
import { uiText } from '../i18n/renderText'
import { OWNER_TIME_ZONE } from '../shared/ownerTime'
import type { PaymentStatus, PlanId } from './adminApi'

export const PLAN_LABEL: Record<PlanId, string> = { '1m': '1 месяц', '3m': '3 месяца', '6m': '6 месяцев', '12m': '12 месяцев' }
export const PLAN_SHORT: Record<PlanId, string> = { '1m': '1 мес', '3m': '3 мес', '6m': '6 мес', '12m': '12 мес' }
export const PLAN_IDS: PlanId[] = ['1m', '3m', '6m', '12m']
export const PROVIDER_TEXT: Record<string, string> = { yookassa: 'ЮKassa', bezebee: 'BZB', apple: 'Apple', archive: 'Архив', lava: 'Архив' }

const rubles = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 })
const dateTimeFormat = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short', timeZone: OWNER_TIME_ZONE })
const dateFormat = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeZone: OWNER_TIME_ZONE })
const timeFormat = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: OWNER_TIME_ZONE })
export const count = new Intl.NumberFormat('ru-RU')
export const money = (value: number) => rubles.format(value) + ' ₽'
export const dateTime = (value?: string) => value ? dateTimeFormat.format(new Date(value)) : '—'
export const dateOnly = (value?: string) => value ? dateFormat.format(new Date(value)) : '—'
export const timeOnly = (value: string) => timeFormat.format(new Date(value))

export function errorText(error: unknown) {
  return error instanceof Error ? error.message : 'Не удалось загрузить данные'
}

export const accountText = (email?: string, nickname?: string) => (email ? `${email}${nickname ? ` · ${nickname}` : ''}` : 'аккаунт удалён')

export function statusText(status: PaymentStatus) {
  return uiText({ succeeded: 'оплачено', pending: 'ожидает', canceled: 'отменено', refunded: 'возврат' }[status])
}
