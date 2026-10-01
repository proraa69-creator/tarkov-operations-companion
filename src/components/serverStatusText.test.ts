import { describe, expect, it } from 'vitest'
import { setRenderLanguage } from '../i18n/renderText'
import { agoText, watchdogText } from './serverStatusText'

describe('server status texts', () => {
  it('«последняя проверка N с назад» in both languages', () => {
    expect(agoText(1_000, 13_000, 'ru')).toBe('последняя проверка 12 с назад')
    expect(agoText(1_000, 13_000, 'en')).toBe('last check 12 s ago')
    expect(agoText(0, 13_000, 'ru')).toBe('ещё не проверялось')
    expect(agoText(1_000, 1_000 + 5 * 60_000, 'en')).toBe('last check 5 min ago')
  })

  it('translates the watchdog journal and alerts to English, leaves Russian as is', () => {
    setRenderLanguage('en')
    try {
      expect(watchdogText('Публичный адрес: автоматический перезапуск (попытка 3)', 'en')).toBe('Public address: automatic restart (attempt 3)')
      expect(watchdogText('Сервер (API): не удалось починить после 3 попыток', 'en')).toBe('Server (API): could not repair after 3 attempts')
      expect(watchdogText('Порт 8787 занят старым сервером (сборка 0.5.3 #40 (fff0000)).', 'en')).toBe('Port 8787 is held by an old server (build 0.5.3 #40 (fff0000)).')
      expect(watchdogText('Сервер перезапущен автоматически', 'en')).toBe('The server was restarted automatically')
      expect(watchdogText('raidos.app отвечает HTTP 530.', 'en')).toBe('raidos.app answers HTTP 530.')
    } finally {
      setRenderLanguage('ru')
    }
    expect(watchdogText('Сайт: не работает', 'ru')).toBe('Сайт: не работает')
  })
})
