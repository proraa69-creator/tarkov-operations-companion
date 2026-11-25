import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { countryLanguage } from './countryLanguage'
import { LocaleProvider, languageSettled, useLocale } from './LocaleProvider'
import { syncGameLanguage } from '../import/gameLanguageSync'

describe('the app\'s language by the account\'s country (owner, 25.11.2026)', () => {
  it('maps the countries to the app\'s languages, English for the rest', () => {
    for (const code of ['RU', 'BY', 'KZ', 'KG', 'UA', 'AM', 'AZ', 'UZ', 'TJ', 'TM', 'MD', 'GE']) expect(countryLanguage(code)).toBe('ru')
    expect(countryLanguage('DE')).toBe('de')
    expect(countryLanguage('AT')).toBe('de')
    expect(countryLanguage('CH')).toBe('de')
    expect(countryLanguage('JP')).toBe('ja')
    for (const code of ['CN', 'TW', 'HK', 'SG']) expect(countryLanguage(code)).toBe('zh')
    expect(countryLanguage('PL')).toBe('pl')
    for (const code of ['ES', 'MX', 'AR', 'CO']) expect(countryLanguage(code)).toBe('es')
    for (const code of ['BR', 'PT']) expect(countryLanguage(code)).toBe('pt')
    for (const code of ['FR', 'BE']) expect(countryLanguage(code)).toBe('fr')
    expect(countryLanguage('KR')).toBe('ko')
    expect(countryLanguage('TR')).toBe('tr')
    for (const code of ['US', 'GB', 'TH', 'kz']) expect(countryLanguage(code)).toBe(code === 'kz' ? 'ru' : 'en')
    for (const none of [undefined, '', 'XX', 'Russia', 7]) expect(countryLanguage(none)).toBeNull()
  })
})

let seen: ReturnType<typeof useLocale>
function Probe() { seen = useLocale(); return null }

describe('LocaleProvider: the account\'s country decides a new install\'s language, once', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => { cleanup(); localStorage.clear() })

  it('takes the country\'s language at the first sign-in of a new install, and only then', () => {
    render(<LocaleProvider><Probe /></LocaleProvider>)
    expect(seen.language).toBe('ru')
    expect(languageSettled()).toBe(false)
    act(() => seen.applyAccountCountry(undefined)) // an account with no country yet decides nothing
    expect(languageSettled()).toBe(false)
    act(() => seen.applyAccountCountry('DE'))
    expect(seen.language).toBe('de')
    expect(languageSettled()).toBe(true)
    act(() => seen.applyAccountCountry('KZ'))
    expect(seen.language).toBe('de')
  })

  it('gives a Russian account on a new install the Russian app (report 232)', () => {
    render(<LocaleProvider><Probe /></LocaleProvider>)
    act(() => seen.applyAccountCountry('RU'))
    expect(seen.language).toBe('ru')
  })

  it('keeps the player\'s own choice over any country, English included', () => {
    render(<LocaleProvider><Probe /></LocaleProvider>)
    act(() => seen.setLocale('en'))
    act(() => seen.applyAccountCountry('RU'))
    expect(seen.language).toBe('en')
    expect(localStorage.getItem('tarkov-operations-locale-v1')).toBe('en')
  })

  it('never changes a language an older version saved, the old default Russian included', () => {
    for (const saved of ['ja', 'ru'] as const) {
      localStorage.clear()
      localStorage.setItem('tarkov-operations-locale-v1', saved)
      render(<LocaleProvider><Probe /></LocaleProvider>)
      act(() => seen.applyAccountCountry('FR'))
      expect(seen.language).toBe(saved)
      cleanup()
    }
  })
})

describe('the game\'s language is the app\'s (owner, 25.11.2026)', () => {
  it('tells the main process the app\'s language, only when it differs', async () => {
    const api = { getSettings: vi.fn(async () => ({ gameLanguage: 'en' })), updateSettings: vi.fn(async () => ({})) }
    await syncGameLanguage('ru', api as never)
    expect(api.updateSettings).toHaveBeenCalledWith({ gameLanguage: 'ru' })
    api.updateSettings.mockClear()
    api.getSettings.mockResolvedValue({ gameLanguage: 'ru' })
    await syncGameLanguage('ru', api as never)
    expect(api.updateSettings).not.toHaveBeenCalled()
  })
})
