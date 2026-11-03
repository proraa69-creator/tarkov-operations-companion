/**
 * The owner's time (owner, 03.11.2026: Bangkok time instead of Moscow): the site's «Админ-панель», the phone admin app
 * and the server's admin days (the calendar, «сегодня», «за этот месяц», «Новые за …», the payment filters, the CSV).
 * Asia/Bangkok is UTC+7 all year, without daylight saving, so the owner's day is a fixed shift of UTC. The players'
 * pages, receipts and the streamers' cabinet keep their own time.
 */
export const OWNER_TIME_ZONE = 'Asia/Bangkok'
export const OWNER_OFFSET_MS = 7 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

/** The owner's date (YYYY-MM-DD) of `time`. */
export const ownerDay = (time: number) => new Date(time + OWNER_OFFSET_MS).toISOString().slice(0, 10)
/** The owner's date `daysAgo` days before today. */
export const ownerDayAgo = (daysAgo = 0, now = Date.now()) => ownerDay(now - daysAgo * DAY_MS)
/** The owner's day (YYYY-MM-DD) as [start, end) in ms. */
export function ownerDayRange(day: string) {
  const start = Date.parse(`${day}T00:00:00.000Z`) - OWNER_OFFSET_MS
  return { start, end: start + DAY_MS }
}
/** «2026-11-03 14:05» in the owner's time (the admin CSV files). */
export const ownerText = (time: number) => new Date(time + OWNER_OFFSET_MS).toISOString().slice(0, 16).replace('T', ' ')

/**
 * The periods of «Новые за …» (owner, 03.11.2026: a tap on the tile chooses the period), the same on the site and in the
 * app: owner's days, today included.
 */
export type NewUsersPeriod = 'today' | 'yesterday' | '7d' | 'week' | 'lastWeek' | '30d' | 'month' | 'lastMonth'
export const NEW_USERS_PERIODS: ReadonlyArray<{ id: NewUsersPeriod; label: string; title: string }> = [
  { id: 'today', label: 'Сегодня', title: 'Новые сегодня' },
  { id: 'yesterday', label: 'Вчера', title: 'Новые вчера' },
  { id: '7d', label: '7 дней', title: 'Новые за 7 дней' },
  { id: 'week', label: 'Эта неделя', title: 'Новые за эту неделю' },
  { id: 'lastWeek', label: 'Прошлая неделя', title: 'Новые за прошлую неделю' },
  { id: '30d', label: '30 дней', title: 'Новые за 30 дней' },
  { id: 'month', label: 'Этот месяц', title: 'Новые за этот месяц' },
  { id: 'lastMonth', label: 'Прошлый месяц', title: 'Новые за прошлый месяц' },
]

/** The owner's days `from`..`to` (inclusive) of a «Новые за …» period; weeks start on Monday. */
export function newUsersRange(period: NewUsersPeriod, now = Date.now()): { from: string; to: string } {
  const today = ownerDay(now)
  const shift = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10)
  const monday = shift(today, -((new Date(`${today}T00:00:00.000Z`).getUTCDay() + 6) % 7))
  const monthStart = `${today.slice(0, 7)}-01`
  if (period === 'today') return { from: today, to: today }
  if (period === 'yesterday') return { from: shift(today, -1), to: shift(today, -1) }
  if (period === '7d') return { from: shift(today, -6), to: today }
  if (period === 'week') return { from: monday, to: today }
  if (period === 'lastWeek') return { from: shift(monday, -7), to: shift(monday, -1) }
  if (period === '30d') return { from: shift(today, -29), to: today }
  if (period === 'month') return { from: monthStart, to: today }
  const lastMonthEnd = shift(monthStart, -1)
  return { from: `${lastMonthEnd.slice(0, 7)}-01`, to: lastMonthEnd }
}

const dayMonth = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', timeZone: 'UTC' })
/** «3 нояб.» or «4 окт. – 2 нояб.»: the owner's days of a period. */
export function ownerRangeText(from: string, to: string) {
  const text = (day: string) => dayMonth.format(new Date(`${day}T12:00:00.000Z`))
  return from === to ? text(from) : `${text(from)} – ${text(to)}`
}
