import { describe, expect, it } from 'vitest'
import { CIS_COUNTRIES, COUNTRY_CODES, countryGroups, countryName, EUROPE_COUNTRIES, isCountryCode, normalizeCountry, regionOf } from './countries'

/** The country at registration and the СНГ / Европа split of «Пользователи» (owner, 13.10.2026). */
describe('countries', () => {
  it('lists the 249 officially assigned ISO 3166-1 alpha-2 codes once, A→Z, without reserved or user-assigned ones', () => {
    expect(COUNTRY_CODES).toHaveLength(249)
    expect([...COUNTRY_CODES].sort()).toEqual([...COUNTRY_CODES])
    expect(new Set(COUNTRY_CODES).size).toBe(249)
    for (const code of ['XK', 'SU', 'UK', 'EU', 'AC', 'IC', 'ZZ']) expect(isCountryCode(code), code).toBe(false)
  })

  it('СНГ: the CIS members with the associate Turkmenistan; Европа: the UN scheme\'s Europe and Cyprus without them', () => {
    expect([...CIS_COUNTRIES].sort()).toEqual(['AM', 'AZ', 'BY', 'KG', 'KZ', 'MD', 'RU', 'TJ', 'TM', 'UZ'])
    const unEurope = ['BY', 'BG', 'CZ', 'HU', 'MD', 'PL', 'RO', 'RU', 'SK', 'UA', 'AX', 'DK', 'EE', 'FO', 'FI', 'GG', 'IS', 'IE', 'IM', 'JE', 'LV', 'LT', 'NO', 'SJ', 'SE', 'GB',
      'AL', 'AD', 'BA', 'HR', 'GI', 'GR', 'VA', 'IT', 'MT', 'ME', 'MK', 'PT', 'SM', 'RS', 'SI', 'ES', 'AT', 'BE', 'FR', 'DE', 'LI', 'LU', 'MC', 'NL', 'CH']
    expect([...EUROPE_COUNTRIES].sort()).toEqual([...unEurope.filter((code) => !CIS_COUNTRIES.includes(code as never)), 'CY'].sort())
    for (const code of [...CIS_COUNTRIES, ...EUROPE_COUNTRIES]) expect(isCountryCode(code), code).toBe(true)
    expect(regionOf('RU')).toBe('cis')
    expect(regionOf('md')).toBe('cis')
    expect(regionOf('UA')).toBe('europe')
    expect(regionOf('CY')).toBe('europe')
    for (const code of ['GE', 'TR', 'US', 'CN', 'IL']) expect(regionOf(code), code).toBe('other')
  })

  it('normalizes what forms and requests send; anything else is no country', () => {
    expect(normalizeCountry(' kz ')).toBe('KZ')
    for (const value of ['', 'XK', 'Kazakhstan', 'K', 7, null, undefined]) expect(normalizeCountry(value), String(value)).toBeUndefined()
  })

  it('names the countries in Russian and English and groups them for the select, sorted by name', () => {
    expect(countryName('KZ', 'ru')).toBe('Казахстан')
    expect(countryName('KZ', 'en')).toBe('Kazakhstan')
    for (const locale of ['ru', 'en'] as const) {
      const groups = countryGroups(locale)
      expect(groups.map((group) => group.region)).toEqual(['cis', 'europe', 'other'])
      expect(groups.map((group) => group.countries.length)).toEqual([10, 49, 190])
      for (const group of groups) {
        const names = group.countries.map((country) => country.name)
        expect(names).toEqual([...names].sort(new Intl.Collator(locale).compare))
      }
    }
    expect(countryGroups('ru').map((group) => group.label)).toEqual(['СНГ', 'Европа', 'Другие страны'])
    expect(countryGroups('en').map((group) => group.label)).toEqual(['CIS', 'Europe', 'Other countries'])
  })
})

// owner, 13.10.2026: «при нажатии выбора страны окно с ручным вводом», «не разделяй … просто общий список»
describe('the country list with a search', () => {
  it('is one list of all 249 countries sorted by name, in Russian and in English', async () => {
    const { countryOptions } = await import('./countries')
    for (const locale of ['ru', 'en'] as const) {
      const names = countryOptions(locale).map((option) => option.name)
      expect(names).toHaveLength(249)
      expect(names).toEqual([...names].sort(new Intl.Collator(locale).compare))
    }
    expect(countryOptions('ru')[0]).toEqual({ code: 'AU', name: 'Австралия' })
  })

  it('finds a country by its name in either language, its code or a common other name, best matches first', async () => {
    const { searchCountries } = await import('./countries')
    const codes = (query: string, locale: 'ru' | 'en' = 'ru') => searchCountries(query, locale).map((option) => option.code)
    expect(codes('каз')).toEqual(['KZ'])
    expect(codes('Kaz')[0]).toBe('KZ')
    expect(codes('kz')[0]).toBe('KZ')
    expect(codes('германия')).toEqual(['DE'])
    expect(codes('germ')).toEqual(['DE'])
    expect(codes('сша')[0]).toBe('US')
    expect(codes('USA')[0]).toBe('US')
    expect(codes('америка')).toContain('US')
    expect(codes('оаэ')).toEqual(['AE'])
    expect(codes('Англия')).toEqual(['GB'])
    expect(codes('белоруссия')).toEqual(['BY'])
    expect(codes('Кыргызстан')).toEqual(['KG'])
    expect(codes('рф')[0]).toBe('RU')
    // ё and е, accents, hyphens and spaces do not matter.
    expect(codes('соединенное королевство')).toEqual(['GB'])
    expect(codes('кот дивуар')).toEqual(['CI'])
    expect(codes('Cote d Ivoire', 'en')).toEqual(['CI'])
    expect(codes('turkiye', 'en')).toEqual(['TR'])
    expect(codes('острова')).toEqual(expect.arrayContaining(['AX', 'FO', 'VG']))
    // Names that start with the text come before names that only contain it.
    const ro = codes('ро')
    expect(ro[0]).toBe('RU')
    expect(ro).toContain('MA')
    expect(ro.indexOf('RU')).toBeLessThan(ro.indexOf('MA'))
    // A whole word inside a name: «Корея» finds both Koreas.
    expect(codes('корея')).toEqual(expect.arrayContaining(['KR', 'KP']))
    expect(codes('')).toHaveLength(249)
    expect(codes('zzzz')).toEqual([])
  })
})
