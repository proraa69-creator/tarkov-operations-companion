import { describe, expect, it } from 'vitest'
import { translateUiText } from './uiEnglish'
import { OVERVIEW_PHRASES } from './uiEnglishOverview'

describe('Overview English', () => {
  it('translates the Kappa card, its list and the reused Overview texts', () => {
    expect(translateUiText('Задания для Капы')).toBe('Kappa-required tasks')
    expect(translateUiText('Выполнено 3 из 13')).toBe('Completed 3 of 13')
    expect(translateUiText('по логам')).toBe('from logs')
    expect(translateUiText('по экрану')).toBe('from screen')
    expect(translateUiText('вручную')).toBe('manual')
    expect(translateUiText('по цепочке')).toBe('by chain')
    expect(translateUiText('Засчитаны · ')).toBe('Counted · ')
    expect(translateUiText('Свернуть')).toBe('Collapse')
    expect(translateUiText('Требования рейда')).toBe('Raid requirements')
    expect(translateUiText('Взять и заложить')).toBe('Take and plant')
  })

  it('has an English text for every phrase, without leftover Cyrillic', () => {
    for (const [ru, en] of OVERVIEW_PHRASES) {
      expect(translateUiText(ru)).toBe(en)
      expect(en).not.toMatch(/[А-Яа-яЁё]/)
    }
  })
})
