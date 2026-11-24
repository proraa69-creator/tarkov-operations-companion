import { afterEach, describe, expect, it } from 'vitest'
import { setRenderLanguage, uiText } from '../i18n/renderText'
import { distanceText } from './conditionText'

describe('the distance of a raid condition in English', () => {
  afterEach(() => setRenderLanguage('ru'))

  // Seen on the English Overview, «Сбор на рейд»: «×3 · PMC · до 25 m».
  it('has no Russian word left', () => {
    setRenderLanguage('en')
    expect(uiText(distanceText({ compare: '<=', value: 25 }))).toBe('up to 25 m')
    expect(uiText(distanceText({ compare: '>=', value: 40 }))).toBe('40+ m')
  })

  it('stays as it was in Russian', () => {
    setRenderLanguage('ru')
    expect(uiText(distanceText({ compare: '<=', value: 25 }))).toBe('до 25 м')
  })
})
