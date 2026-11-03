import { describe, expect, it } from 'vitest'
import { monthsToDays, paymentDates } from './adminApi'

describe('admin mobile helpers', () => {
  it('builds inclusive date filters for the payment presets', () => {
    // 18:30 in Bangkok, the owner's time.
    const now = new Date('2026-10-17T11:30:00.000Z')
    expect(paymentDates('today', now)).toEqual({ from: '2026-10-17', to: '2026-10-17' })
    expect(paymentDates('yesterday', now)).toEqual({ from: '2026-10-16', to: '2026-10-16' })
    expect(paymentDates('7d', now)).toEqual({ from: '2026-10-11', to: '2026-10-17' })
    expect(paymentDates('30d', now)).toEqual({ from: '2026-09-18', to: '2026-10-17' })
    expect(paymentDates('month', now)).toEqual({ from: '2026-10-01', to: '2026-10-17' })
    expect(paymentDates('custom', now, { from: '2026-10-02', to: '' })).toEqual({ from: '2026-10-02' })
    expect(paymentDates('all', now)).toEqual({})
  })

  it('counts the days in Bangkok time, whatever the phone is set to (owner, 03.11.2026)', () => {
    // 01:30 on the 18th in Bangkok is still the 17th in Moscow and in UTC.
    expect(paymentDates('today', new Date('2026-10-17T18:30:00.000Z'))).toEqual({ from: '2026-10-18', to: '2026-10-18' })
    expect(paymentDates('month', new Date('2026-10-31T17:30:00.000Z'))).toEqual({ from: '2026-11-01', to: '2026-11-01' })
  })

  it('uses the same 30-day month as paid server plans', () => {
    expect(monthsToDays(1)).toBe(30)
    expect(monthsToDays(3)).toBe(90)
    expect(monthsToDays(12)).toBe(360)
  })
})
