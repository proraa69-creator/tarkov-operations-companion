import { describe, expect, it } from 'vitest'
import { LEGAL_VERSION, SELLER_DETAILS, legalDocument } from './documents'

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
    expect(LEGAL_VERSION).toBe('2026-10-09.2')
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
})
