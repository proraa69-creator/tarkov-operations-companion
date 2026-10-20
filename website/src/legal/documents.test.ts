import { describe, expect, it } from 'vitest'
import { LEGAL_VERSION, LEGAL_VERSION_LABEL, SELLER_DETAILS, legalDocument } from './documents'

describe('published seller details', () => {
  it('uses the confirmed self-employed identity without inventing missing details', () => {
    const details = Object.fromEntries(SELLER_DETAILS)
    expect(details['Исполнитель']).toBe('Протопопов Андрей Александрович')
    expect(details['ИНН']).toBe('272401531806')
    expect(details['Статус']).toContain('самозанятый')
    expect(details['E-mail для обращений и претензий']).toBe('raidosapp@gmail.com')
    expect(details['Сайт']).toBe('https://raidos.app')
    expect(details).not.toHaveProperty('ОГРНИП')
    expect(details['Telegram']).toBe('@raidosapp')
    expect(LEGAL_VERSION).toBe('2026-10-20.3')
    expect(LEGAL_VERSION_LABEL).toBe('20 октября 2026 г., ред. 20')
  })

  it.each(['offer', 'privacy', 'consent'])('fills identity in %s while retaining its existing terms', (slug) => {
    const document = JSON.stringify(legalDocument(slug))
    expect(document).toContain('Протопопов Андрей Александрович')
    expect(document).toContain('272401531806')
    expect(document).not.toContain('[ФИО полностью]')
    expect(document).not.toContain('[ИНН]')
  })

  it.each(['offer', 'privacy', 'consent', 'cookies'])('publishes %s without drafts, placeholders or old payment services', (slug) => {
    const document = JSON.stringify(legalDocument(slug))
    expect(document).not.toMatch(/\[[А-ЯЁа-яё]/)
    expect(document).not.toMatch(/Robokassa|Робокасса|Lava|юрист/i)
  })

  it('refunds through YooKassa without keeping any commission, step by step', () => {
    const offer = JSON.stringify(legalDocument('offer'))
    expect(offer).toContain('ЮKassa')
    expect(offer).toContain('СБП')
    expect(offer).toContain('Комиссии платёжного сервиса и банка из суммы возврата не удерживаются.')
    expect(offer).not.toContain('за вычетом')
    expect(offer).toContain('Как вернуть деньги: 1)')
    expect(offer).toContain('Оказание услуги и срок доступа')
  })

  it('gives the first-month discount for a friend\'s invitation only and does not mention streamers', () => {
    const offer = JSON.stringify(legalDocument('offer'))
    expect(offer).toContain('по ссылке друга')
    expect(offer).toContain('скидку 20 %')
    for (const kind of ['offer', 'privacy'] as const) expect(JSON.stringify(legalDocument(kind))).not.toMatch(/стример/i)
  })

  it('does not claim that a notification has already been filed', () => {
    expect(JSON.stringify(legalDocument('privacy'))).not.toContain('Оператор направил уведомление')
  })

  it('names the country among the personal data, with its purpose (owner, 13.10.2026: «при регистрации нужно указать страну»)', () => {
    for (const slug of ['privacy', 'consent'] as const) {
      const document = JSON.stringify(legalDocument(slug))
      expect(document, slug).toContain('страна (указывается при регистрации')
      expect(document, slug).toMatch(/[Сс]татистика аудитории по регионам и выбор способов оплаты/)
    }
  })

  it('names BZB for the CIS (except Russia, roubles) and other countries (dollars), the consent, refunds; Boosty only for earlier subscriptions; no in-game overlay (ред. 19)', () => {
    const offer = JSON.stringify(legalDocument('offer'))
    expect(offer).toContain('BZB (bezebee.com)')
    expect(offer).toContain('для стран СНГ — в рублях, для других стран — в долларах США')
    expect(offer).toContain('Оплата через BZB разовая')
    expect(offer).toContain('Возврат платежа через BZB')
    expect(offer).toContain('Новые подписки через Boosty не оформляются')
    expect(offer).not.toContain('тот же e-mail, что и в аккаунте Сервиса: по нему Исполнитель находит платёж')
    expect(offer).toContain('Пользователи из России оплачивают только через ЮKassa')
    expect(offer).toContain('изменить страну после регистрации нельзя')
    expect(offer).not.toContain('мини-карта поверх игры')
    expect(JSON.stringify(legalDocument('privacy'))).toContain('BZB')
    expect(JSON.stringify(legalDocument('consent'))).toContain('BZB')
  })
  it('names the 10 days before a requested account deletion and that it can be cancelled (ред. 20)', () => {
    expect(JSON.stringify(legalDocument('privacy'))).toContain('выполняется через 10 дней после запроса; до этого срока запрос можно отменить')
  })
})
