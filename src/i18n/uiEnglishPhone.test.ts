import { describe, expect, it } from 'vitest'
import { PHONE_PHRASES } from './uiEnglishPhone'

describe('English for phone sign-in and SMS settings', () => {
  it('translates the phone screens and the server messages as whole phrases', async () => {
    const { setRenderLanguage, uiText } = await import('./renderText')
    setRenderLanguage('en')
    try {
      expect(uiText('Войти по коду из SMS')).toBe('Sign in with an SMS code')
      expect(uiText('Неверный или устаревший код. Проверьте код или запросите новый.')).toBe('Wrong or expired code. Check it or request a new one.')
      expect(uiText('SMS: одноразовые коды')).toBe('SMS: one-time codes')
      expect(uiText('Отправить тестовое SMS')).toBe('Send a test SMS')
    } finally {
      setRenderLanguage('ru')
    }
    expect(uiText('Войти по коду из SMS')).toBe('Войти по коду из SMS')
  })

  it('has no duplicate Russian keys with different translations', () => {
    const seen = new Map<string, string>()
    for (const [ru, en] of PHONE_PHRASES) {
      if (seen.has(ru)) expect(seen.get(ru)).toBe(en)
      seen.set(ru, en)
    }
  })
})
