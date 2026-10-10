import { describe, expect, it } from 'vitest'
import type { Plan } from './api'
import { planSaving, SUBSCRIPTION_PREVIEW } from './plans'

const month: Plan = { id: '1m', months: 1, price: 300, currency: 'RUB', discountPercent: 0 }

describe('the saving of a longer plan', () => {
  it('is measured against paying month by month: «2 400 ₽ вместо 3 600 ₽, экономия 1 200 ₽»', () => {
    expect(SUBSCRIPTION_PREVIEW.map((plan) => planSaving(plan, SUBSCRIPTION_PREVIEW))).toEqual([
      null,
      { full: 900, saving: 90 },
      { full: 1800, saving: 300 },
      { full: 3600, saving: 1200 },
    ])
  })

  it('is not shown without both prices or without a discount', () => {
    expect(planSaving({ ...month, id: '3m', months: 3, price: null }, [month])).toBeNull()
    expect(planSaving({ ...month, id: '3m', months: 3, price: 810 }, [{ ...month, price: null }])).toBeNull()
    expect(planSaving({ ...month, id: '3m', months: 3, price: 900 }, [month])).toBeNull()
  })

  it('keeps kopecks of a server price', () => {
    expect(planSaving({ ...month, id: '3m', months: 3, price: 809.5 }, [{ ...month, price: 299.9 }])).toEqual({ full: 899.7, saving: 90.2 })
  })
})
