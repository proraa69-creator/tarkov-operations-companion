import { describe, expect, it } from 'vitest'
import { translateUiText } from './uiEnglish'
import { GUNSMITH_PHRASES } from './uiEnglishGunsmith'

describe('Gunsmith English', () => {
  it('has an English text for every phrase, without leftover Cyrillic', () => {
    for (const [ru, en] of GUNSMITH_PHRASES) {
      expect(translateUiText(ru)).toBe(en)
      expect(en).not.toMatch(/[А-Яа-яЁё]/)
    }
  })

  it('translates the block\'s composed lines', () => {
    expect(translateUiText('Механик · ур. 25')).toBe('Mechanic · lvl. 25')
    expect(translateUiText('Как собрать · пример сборки')).toBe('How to build · example build')
    expect(translateUiText('Характеристики')).toBe('Stats')
  })
})
