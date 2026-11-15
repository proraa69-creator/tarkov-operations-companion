/**
 * «Статистика за период» of «Сводка» (owner, 15.11.2026), the same on the site, in the PC owner app and in the phone admin
 * app: two days picked on the calendar — a right click (site, PC) or a long press (phone) picks the first day, the next
 * one the second (months can be turned in between), a third one drops both, and so does the cross. The summary of those
 * owner's days comes from GET /me/admin/stats?from=&to= (server/src/services/adminStore.ts `stats`).
 */
export interface PickedDays { first?: string; second?: string }

/** The next pick on `date` (YYYY-MM-DD): the first day, then the second (the same day again: one day), then none. */
export function pickDay(picked: PickedDays, date: string): PickedDays {
  if (!picked.first) return { first: date }
  if (!picked.second) return { first: picked.first, second: date }
  return {}
}

/** The chosen owner's days in order, once both are picked. */
export function pickedRange(picked: PickedDays): { from: string; to: string } | null {
  if (!picked.first || !picked.second) return null
  return picked.first <= picked.second ? { from: picked.first, to: picked.second } : { from: picked.second, to: picked.first }
}

/** How a calendar day stands in the pick: its ends, the days between, or nothing. */
export function pickedDayState(picked: PickedDays, date: string): 'start' | 'end' | 'single' | 'inside' | undefined {
  const range = pickedRange(picked)
  if (!range) return picked.first === date ? 'single' : undefined
  if (range.from === range.to) return range.from === date ? 'single' : undefined
  if (date === range.from) return 'start'
  if (date === range.to) return 'end'
  return date > range.from && date < range.to ? 'inside' : undefined
}

/** «01.11 — 05.11.2026» (one day: «05.11.2026»). */
export function pickedRangeText(from: string, to: string) {
  const day = (date: string, year: boolean) => `${date.slice(8, 10)}.${date.slice(5, 7)}${year ? `.${date.slice(0, 4)}` : ''}`
  if (from === to) return day(to, true)
  return `${day(from, from.slice(0, 4) !== to.slice(0, 4))} — ${day(to, true)}`
}

/** A long press on the phone: this long. */
export const LONG_PRESS_MS = 500

/**
 * The part of GET /me/admin/stats the period summary reads (fields of 15.11.2026 optional: an older server omits them).
 * Money in roubles.
 */
export interface AdminPeriodStats {
  range: { from: string; to: string; timezone: string }
  users: { total: number; new: number }
  subscriptions: { activePaid: number; activePaidRepeat?: number; trials: number; trialsDead?: number; trialsAlive?: number }
  payers: { everPaid: number; paidInRange: number; newInRange: number; repeatPaid: number; repeatInRange: number }
  revenue: {
    total: number
    payments: number
    repeatPayments?: number
    byPlan: Record<string, { count: number; amount: number }>
    refunds: { count: number; amount: number }
  }
  trialConversion: { trialStarted: number; laterPaid: number; rate: number; dead?: number; alive?: number }
}
