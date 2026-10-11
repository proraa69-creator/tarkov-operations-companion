import { describe, expect, it } from 'vitest'
import { autoLocale } from '.'

describe('the language of a first visit', () => {
  it('Russian for Russia and its neighbours, English elsewhere, by the country first', () => {
    expect(autoLocale({ country: 'RU', languages: ['en-US'] })).toBe('ru')
    expect(autoLocale({ country: 'kz' })).toBe('ru')
    expect(autoLocale({ country: 'DE', languages: ['de-DE'] })).toBe('en')
    expect(autoLocale({ country: 'US', timeZone: 'Europe/Moscow', languages: ['en-US'] })).toBe('en')
  })

  it('a Russian browser abroad still gets Russian', () => {
    expect(autoLocale({ country: 'DE', languages: ['ru-RU', 'de'] })).toBe('ru')
    expect(autoLocale({ country: 'UA', languages: ['uk-UA'] })).toBe('en')
  })

  it('without the country: the time zone, then the browser', () => {
    expect(autoLocale({ timeZone: 'Asia/Almaty', languages: ['en-US'] })).toBe('ru')
    expect(autoLocale({ timeZone: 'Europe/Berlin', languages: ['en-US'] })).toBe('en')
    expect(autoLocale({ timeZone: 'America/New_York', languages: ['ru'] })).toBe('ru')
    expect(autoLocale({})).toBe('en')
  })
})
