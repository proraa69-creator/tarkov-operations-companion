import { describe, expect, it } from 'vitest'
import { AUTH_PHRASES } from './phrasesAuth'
import { CABINET_PHRASES } from './phrasesCabinet'
import { LAYOUT_PHRASES } from './phrasesLayout'
import { LEGAL_PHRASES } from './phrasesLegal'
import { PUBLIC_PHRASES } from './phrasesPublic'
import { setSiteLocale, tr } from '.'

const LISTS = { LAYOUT_PHRASES, PUBLIC_PHRASES, AUTH_PHRASES, CABINET_PHRASES, LEGAL_PHRASES }

describe('website English phrases', () => {
  it('give one English text per Russian phrase, with the same placeholders and no Cyrillic', () => {
    const seen = new Map<string, { en: string; list: string }>()
    const conflicts: string[] = []
    for (const [list, phrases] of Object.entries(LISTS)) {
      for (const [ru, en] of phrases) {
        expect(en, ru).not.toMatch(/[А-Яа-яЁё]/)
        const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort().join(',')
        expect(placeholders(en), ru).toBe(placeholders(ru))
        const before = seen.get(ru)
        if (before && before.en !== en) conflicts.push(`${ru}: ${before.list} «${before.en}» / ${list} «${en}»`)
        seen.set(ru, { en, list })
      }
    }
    expect(conflicts).toEqual([])
  })

  it('switches the language and fills placeholders', () => {
    expect(tr('Личный кабинет')).toBe('Личный кабинет')
    setSiteLocale('en')
    try {
      expect(tr('Личный кабинет')).toBe('My account')
      expect(tr('версия {version}', { version: '0.6.0' })).toBe('version 0.6.0')
      expect(document.documentElement.lang).toBe('en')
    } finally {
      setSiteLocale('ru')
    }
    expect(tr('версия {version}', { version: '0.6.0' })).toBe('версия 0.6.0')
  })
})
