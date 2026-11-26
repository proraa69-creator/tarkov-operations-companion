import { describe, expect, it } from 'vitest'
import { autoLocale, offeredLocale } from '.'

describe('the language of a first visit', () => {
  it('Russian for Russia and its neighbours, English elsewhere, by the country first', () => {
    expect(autoLocale({ country: 'RU', languages: ['en-US'] })).toBe('ru')
    expect(autoLocale({ country: 'kz' })).toBe('ru')
    expect(autoLocale({ country: 'DE', languages: ['de-DE'] })).toBe('de')
    expect(autoLocale({ country: 'US', timeZone: 'Europe/Moscow', languages: ['en-US'] })).toBe('en')
  })

  it('a Russian browser abroad still gets Russian', () => {
    expect(autoLocale({ country: 'DE', languages: ['ru-RU', 'de'] })).toBe('ru')
    // Ukraine reads Russian (owner, 25.11.2026: «украинский язык удали. Это тот же русский»)
    expect(autoLocale({ country: 'UA', languages: ['uk-UA'] })).toBe('ru')
    expect(autoLocale({ country: 'DE', languages: ['uk-UA', 'de'] })).toBe('ru')
  })

  it('without the country: the time zone, then the browser', () => {
    expect(autoLocale({ timeZone: 'Asia/Almaty', languages: ['en-US'] })).toBe('ru')
    expect(autoLocale({ timeZone: 'Europe/Berlin', languages: ['en-US'] })).toBe('en')
    expect(autoLocale({ timeZone: 'America/New_York', languages: ['ru'] })).toBe('ru')
    expect(autoLocale({})).toBe('en')
  })

  it("German, Japanese, Chinese: the browser's language first, else the country's (owner, 24.11.2026)", () => {
    expect(autoLocale({ country: 'CN', languages: ['zh-CN'] })).toBe('zh')
    expect(autoLocale({ country: 'CN' })).toBe('zh')
    expect(autoLocale({ country: 'TW', languages: ['zh-TW', 'en'] })).toBe('zh')
    expect(autoLocale({ country: 'JP', languages: [] })).toBe('ja')
    expect(autoLocale({ country: 'AT', languages: ['it-IT'] })).toBe('de')
    expect(autoLocale({ country: 'US', languages: ['ja-JP', 'en-US'] })).toBe('ja')
    expect(autoLocale({ country: 'CN', languages: ['en-US'] })).toBe('en')
    expect(autoLocale({ timeZone: 'Asia/Tokyo', languages: [] })).toBe('ja')
    expect(autoLocale({ timeZone: 'Asia/Shanghai' })).toBe('zh')
  })

  it("shown in English, the country's or another browser language is offered", () => {
    expect(offeredLocale({ country: 'CN', languages: ['en-US'] }, 'en')).toBe('zh')
    expect(offeredLocale({ country: 'DE', languages: ['en-US', 'de'] }, 'en')).toBe('de')
    expect(offeredLocale({ country: 'US', languages: ['en-US', 'ja'] }, 'en')).toBe('ja')
    expect(offeredLocale({ country: 'US', languages: ['en-US'] }, 'en')).toBeNull()
    expect(offeredLocale({ country: 'DE', languages: ['de-DE'] }, 'de')).toBeNull()
  })

  it("Polish, Spanish, Portuguese, French, Korean and Turkish by the browser or the country (owner, 24.11.2026)", () => {
    expect(autoLocale({ country: 'PL' })).toBe('pl')
    expect(autoLocale({ country: 'UA' })).toBe('ru')
    expect(autoLocale({ timeZone: 'Europe/Kyiv' })).toBe('ru')
    expect(autoLocale({ country: 'UA', languages: ['ru-RU'] })).toBe('ru')
    expect(autoLocale({ country: 'MX' })).toBe('es')
    expect(autoLocale({ country: 'BR' })).toBe('pt')
    expect(autoLocale({ country: 'FR' })).toBe('fr')
    expect(autoLocale({ country: 'KR' })).toBe('ko')
    expect(autoLocale({ country: 'TR' })).toBe('tr')
    expect(autoLocale({ country: 'US', languages: ['pt-BR'] })).toBe('pt')
    expect(autoLocale({ timeZone: 'Europe/Warsaw' })).toBe('pl')
    expect(autoLocale({ timeZone: 'America/Sao_Paulo' })).toBe('pt')
    expect(offeredLocale({ country: 'KR', languages: ['en-US'] }, 'en')).toBe('ko')
  })
})
