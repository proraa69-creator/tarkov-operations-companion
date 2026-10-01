import { describe, expect, it } from 'vitest'
import { EMAIL_PHRASES } from './uiEnglishEmail'

describe('English for e-mail codes and the e-mail settings', () => {
  it('translates the e-mail screens, the owner panel and the server messages as whole phrases', async () => {
    const { setRenderLanguage, uiText } = await import('./renderText')
    setRenderLanguage('en')
    try {
      expect(uiText('Войти по коду из письма')).toBe('Sign in with an e-mail code')
      expect(uiText('Подтвердите e-mail')).toBe('Confirm your e-mail')
      expect(uiText('Почта: коды подтверждения')).toBe('E-mail: confirmation codes')
      expect(uiText('Отправить тестовое письмо')).toBe('Send a test e-mail')
      expect(uiText('Коды на e-mail сейчас недоступны. Войдите по e-mail и паролю.')).toBe('E-mail codes are not available right now. Sign in with your e-mail and password.')
      // Shared with the SMS forms.
      expect(uiText('Забыли пароль?')).toBe('Forgot your password?')
    } finally {
      setRenderLanguage('ru')
    }
    expect(uiText('Войти по коду из письма')).toBe('Войти по коду из письма')
  })

  it('has no duplicate Russian keys with different translations', () => {
    const seen = new Map<string, string>()
    for (const [ru, en] of EMAIL_PHRASES) {
      if (seen.has(ru)) expect(seen.get(ru)).toBe(en)
      seen.set(ru, en)
    }
  })
})
