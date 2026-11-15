import { describe, expect, it } from 'vitest'
import { pickDay, pickedDayState, pickedRange, pickedRangeText } from './adminPeriod'

/** «Статистика за период» (owner, 15.11.2026): first day, second day, the third pick drops both. */
describe('admin period pick', () => {
  it('picks the first day, the second, then nothing', () => {
    let picked = pickDay({}, '2026-11-10')
    expect(picked).toEqual({ first: '2026-11-10' })
    expect(pickedRange(picked)).toBeNull()
    picked = pickDay(picked, '2026-10-28')
    expect(pickedRange(picked)).toEqual({ from: '2026-10-28', to: '2026-11-10' })
    expect(pickDay(picked, '2026-11-12')).toEqual({})
  })

  it('marks the ends and the days between; the same day twice is one day', () => {
    const picked = { first: '2026-11-03', second: '2026-11-01' }
    expect(['2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04'].map((date) => pickedDayState(picked, date))).toEqual([undefined, 'start', 'inside', 'end', undefined])
    expect(pickedDayState({ first: '2026-11-03' }, '2026-11-03')).toBe('single')
    expect(pickedDayState({ first: '2026-11-03', second: '2026-11-03' }, '2026-11-03')).toBe('single')
    expect(pickedRange({ first: '2026-11-03', second: '2026-11-03' })).toEqual({ from: '2026-11-03', to: '2026-11-03' })
  })

  it('writes the period shortly', () => {
    expect(pickedRangeText('2026-11-01', '2026-11-05')).toBe('01.11 — 05.11.2026')
    expect(pickedRangeText('2025-12-28', '2026-01-03')).toBe('28.12.2025 — 03.01.2026')
    expect(pickedRangeText('2026-11-05', '2026-11-05')).toBe('05.11.2026')
  })
})
