import { describe, expect, it } from 'vitest'
import { monthsToDays, paymentDates } from './adminApi'

describe('admin mobile helpers', () => {
  it('builds inclusive date filters for the payment presets', () => {
    const now = new Date(2026, 9, 17, 18, 30)
    expect(paymentDates('today', now)).toEqual({ from: '2026-10-17', to: '2026-10-17' })
    expect(paymentDates('yesterday', now)).toEqual({ from: '2026-10-16', to: '2026-10-16' })
    expect(paymentDates('7d', now)).toEqual({ from: '2026-10-11', to: '2026-10-17' })
    expect(paymentDates('30d', now)).toEqual({ from: '2026-09-18', to: '2026-10-17' })
    expect(paymentDates('all', now)).toEqual({})
  })

  it('uses the same 30-day month as paid server plans', () => {
    expect(monthsToDays(1)).toBe(30)
    expect(monthsToDays(3)).toBe(90)
    expect(monthsToDays(12)).toBe(360)
  })
})
