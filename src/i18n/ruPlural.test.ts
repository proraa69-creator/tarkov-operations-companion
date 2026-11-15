import { describe, expect, it } from 'vitest'
import { ruDays, ruDaysLeft } from './ruPlural'
import { translateUiText } from './uiEnglish'

/** Report 163 (owner, 15.11.2026): «Осталось 36 дня» — the word has to follow the number. */
describe('days in Russian', () => {
  it('follows the number', () => {
    expect([1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 36, 101, 111, 112, 698].map(ruDays)).toEqual([
      '1 день', '2 дня', '4 дня', '5 дней', '11 дней', '12 дней', '14 дней', '21 день', '22 дня', '25 дней', '36 дней', '101 день', '111 дней', '112 дней', '698 дней',
    ])
  })

  it('says how many are left', () => {
    expect([1, 2, 21, 36, 698].map(ruDaysLeft)).toEqual(['Остался 1 день', 'Осталось 2 дня', 'Остался 21 день', 'Осталось 36 дней', 'Осталось 698 дней'])
  })

  it('reads in English too', () => {
    expect([1, 2, 21, 36].map((days) => translateUiText(ruDaysLeft(days)))).toEqual(['1 day left', '2 days left', '21 days left', '36 days left'])
    expect(translateUiText('Будет начислено: 1 день')).toBe('Will grant: 1 day')
    expect(translateUiText(`Начислено: ${ruDays(3)}`)).toBe('Granted: 3 days')
  })
})
