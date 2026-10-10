import type { Plan, PlanId, PlansResponse } from './api'

export const PLAN_LABELS: Record<PlanId, string> = { '1m': '1 месяц', '3m': '3 месяца', '6m': '6 месяцев', '12m': '12 месяцев' }

/** The tariff grid when the server has no price for a plan (or is not reachable): the cabinet and the «Покупателям» page. */
export const SUBSCRIPTION_PREVIEW: PlansResponse['plans'] = [
  { id: '1m', months: 1, price: 300, currency: 'RUB', discountPercent: 0 },
  { id: '3m', months: 3, price: 810, currency: 'RUB', discountPercent: 10 },
  { id: '6m', months: 6, price: 1500, currency: 'RUB', discountPercent: 17 },
  { id: '12m', months: 12, price: 2400, currency: 'RUB', discountPercent: 33 },
]

/** Server prices where they are set, the preview grid elsewhere. */
export function visiblePlans(plans: PlansResponse | null | undefined): PlansResponse['plans'] {
  return SUBSCRIPTION_PREVIEW.map((fallback) => {
    const configured = plans?.plans.find((plan) => plan.id === fallback.id)
    return configured?.price != null ? configured : fallback
  })
}

/**
 * What a longer plan saves against paying month by month at the 1-month price: «2 400 ₽ вместо 3 600 ₽, экономия
 * 1 200 ₽» (owner, 10.10.2026). Null for the 1-month plan, a plan without a price, or when nothing is saved.
 */
export function planSaving(plan: Plan, plans: readonly Plan[]): { full: number; saving: number } | null {
  const month = plans.find((entry) => entry.months === 1)?.price
  if (plan.months <= 1 || plan.price === null || month == null) return null
  const full = Math.round(month * plan.months * 100) / 100
  const saving = Math.round((full - plan.price) * 100) / 100
  return saving > 0 ? { full, saving } : null
}

export function formatMoney(amount: number, currency: string) {
  const digits = Number.isInteger(amount) ? 0 : 2
  try { return new Intl.NumberFormat('ru-RU', { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: 2 }).format(amount) } catch { return `${amount} ${currency}` }
}
