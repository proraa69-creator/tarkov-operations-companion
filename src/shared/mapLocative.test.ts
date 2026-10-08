import { describe, expect, it } from 'vitest'
import { mapLocativePhrase } from './mapLocative'
import { MAP_DISPLAY_NAMES } from '../data/mapIds'

describe('mapLocativePhrase', () => {
  it('puts the base maps into the locative instead of «на Таможня»', () => {
    expect(mapLocativePhrase({ id: 'customs', name: 'Таможня' })).toBe('на Таможне')
    expect(mapLocativePhrase({ id: 'streets-of-tarkov', name: 'Улицы Таркова' })).toBe('на Улицах Таркова')
    expect(mapLocativePhrase({ id: 'shoreline', name: 'Берег' })).toBe('на Береге')
    expect(mapLocativePhrase({ id: 'icebreaker', name: 'Ледокол' })).toBe('на Ледоколе')
    expect(mapLocativePhrase({ id: 'woods', name: 'Лес' })).toBe('в Лесу')
    expect(mapLocativePhrase({ id: 'the-lab', name: 'Лаборатория' })).toBe('в Лаборатории')
  })

  it('knows every base map of the catalog and its upstream aliases', () => {
    for (const [id, name] of Object.entries(MAP_DISPLAY_NAMES)) {
      const phrase = mapLocativePhrase({ id, name })
      expect(phrase).not.toBe(`на ${name}`)
      expect(phrase).not.toMatch(/на карте/)
    }
    expect(mapLocativePhrase({ id: 'bigmap', name: 'Таможня' })).toBe('на Таможне')
    expect(mapLocativePhrase({ id: 'factory-night', name: 'Завод' })).toBe('на Заводе')
    // an unknown id with a known Russian name (curated data) still gets the right case
    expect(mapLocativePhrase({ id: 'customs-v2', name: 'Таможня' })).toBe('на Таможне')
  })

  it('keeps an unknown map readable instead of guessing its case', () => {
    expect(mapLocativePhrase({ id: 'new-location', name: 'Порт' })).toBe('на карте «Порт»')
  })

  it('uses plain «on» in English', () => {
    expect(mapLocativePhrase({ id: 'customs', name: 'Customs' }, 'en')).toBe('on Customs')
    expect(mapLocativePhrase({ id: 'new-location', name: 'Harbor' }, 'en')).toBe('on Harbor')
  })
})
