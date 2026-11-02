import { describe, expect, it } from 'vitest'
import { newUsersRange, ownerDay, ownerDayRange, ownerRangeText, ownerText } from './ownerTime'

describe("the owner's time: Bangkok, UTC+7 (owner, 03.11.2026)", () => {
  it('days start at midnight in Bangkok', () => {
    expect(ownerDay(Date.parse('2026-11-02T16:59:59.000Z'))).toBe('2026-11-02')
    expect(ownerDay(Date.parse('2026-11-02T17:00:00.000Z'))).toBe('2026-11-03')
    expect(ownerDayRange('2026-11-03')).toEqual({ start: Date.parse('2026-11-02T17:00:00.000Z'), end: Date.parse('2026-11-03T17:00:00.000Z') })
    expect(ownerText(Date.parse('2026-11-03T07:05:00.000Z'))).toBe('2026-11-03 14:05')
  })

  it('«Новые за …»: the periods the site and the app offer, weeks from Monday', () => {
    // Tuesday 03.11.2026, 10:00 in Bangkok.
    const now = Date.parse('2026-11-03T03:00:00.000Z')
    expect(newUsersRange('today', now)).toEqual({ from: '2026-11-03', to: '2026-11-03' })
    expect(newUsersRange('yesterday', now)).toEqual({ from: '2026-11-02', to: '2026-11-02' })
    expect(newUsersRange('7d', now)).toEqual({ from: '2026-10-28', to: '2026-11-03' })
    expect(newUsersRange('week', now)).toEqual({ from: '2026-11-02', to: '2026-11-03' })
    expect(newUsersRange('lastWeek', now)).toEqual({ from: '2026-10-26', to: '2026-11-01' })
    expect(newUsersRange('30d', now)).toEqual({ from: '2026-10-05', to: '2026-11-03' })
    expect(newUsersRange('month', now)).toEqual({ from: '2026-11-01', to: '2026-11-03' })
    expect(newUsersRange('lastMonth', now)).toEqual({ from: '2026-10-01', to: '2026-10-31' })
    // A Monday is the first day of its own week; January's last month is December.
    expect(newUsersRange('week', Date.parse('2026-11-02T03:00:00.000Z'))).toEqual({ from: '2026-11-02', to: '2026-11-02' })
    expect(newUsersRange('lastMonth', Date.parse('2027-01-10T03:00:00.000Z'))).toEqual({ from: '2026-12-01', to: '2026-12-31' })
    expect(ownerRangeText('2026-10-05', '2026-11-03')).toBe('5 окт. – 3 нояб.')
    expect(ownerRangeText('2026-11-03', '2026-11-03')).toBe('3 нояб.')
  })
})
