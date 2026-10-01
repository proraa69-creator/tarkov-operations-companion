import { describe, expect, it } from 'vitest'
import { SERVER_UPDATE_PHRASES } from './uiEnglishServerUpdate'
import { SERVER_PHRASES } from './uiEnglishServer'
import { SERVER_STATUS_PHRASES } from './uiEnglishServerStatus'
import { PHONE_PHRASES } from './uiEnglishPhone'
import { EMAIL_PHRASES } from './uiEnglishEmail'
import { QUEST_PHRASES } from './uiEnglishQuests'

describe('English for «Автообновление сервера» and «Отчёты об ошибках (GitHub)»', () => {
  it('translates the owner panels as whole phrases and back', async () => {
    const { setRenderLanguage, uiText } = await import('./renderText')
    setRenderLanguage('en')
    try {
      expect(uiText('Автообновление сервера')).toBe('Server auto-update')
      expect(uiText('Отчёты об ошибках (GitHub)')).toBe('Error reports (GitHub)')
      expect(uiText('Только ночью, 03:00–06:00')).toBe('Only at night, 03:00–06:00')
      expect(uiText('Откатить на предыдущую')).toBe('Roll back to the previous one')
      expect(uiText('Проверить доступ')).toBe('Test access')
      expect(uiText('сервер (API) новой версии не ответил за 2 минуты')).toBe('the new version\'s server (API) did not answer within 2 minutes')
      // Shared words keep their existing translations.
      expect(uiText('Проверить')).toBe('Check')
      expect(uiText('Проверить сейчас')).toBe('Check now')
    } finally {
      setRenderLanguage('ru')
    }
    expect(uiText('Автообновление сервера')).toBe('Автообновление сервера')
  })

  it('never gives an existing Russian key another translation', () => {
    const known = new Map<string, string>()
    for (const [ru, en] of [...SERVER_PHRASES, ...SERVER_STATUS_PHRASES, ...PHONE_PHRASES, ...EMAIL_PHRASES, ...QUEST_PHRASES]) known.set(ru, en)
    const seen = new Map<string, string>()
    for (const [ru, en] of SERVER_UPDATE_PHRASES) {
      if (known.has(ru)) expect(en, ru).toBe(known.get(ru))
      if (seen.has(ru)) expect(seen.get(ru), ru).toBe(en)
      seen.set(ru, en)
    }
  })
})
