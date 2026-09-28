import { describe, expect, it } from 'vitest'
import { translateUiText } from './uiEnglish'

describe('English UI translation', () => {
  it('translates complete interface phrases and dynamic counters', () => {
    expect(translateUiText('Следующий рейд начинается здесь')).toBe('Your next raid starts here')
    expect(translateUiText('3 задания')).toBe('3 tasks')
    expect(translateUiText('Прапор · ур. 12 · Любая карта')).toBe('Прапор · lvl. 12 · Any map')
  })
})
