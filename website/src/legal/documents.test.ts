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
    expect(details['Номер в реестре операторов персональных данных']).toContain('не указан')
    expect(details['Адрес для корреспонденции']).toMatch(/^\[/)
    expect(LEGAL_VERSION).toBe('2026-10-08.2')
  })

  it.each(['offer', 'privacy', 'consent'])('fills identity in %s while retaining its existing terms', (slug) => {
    const document = JSON.stringify(legalDocument(slug))
    expect(document).toContain('Протопопов Андрей Александрович')
    expect(document).toContain('272401531806')
    expect(document).not.toContain('[ФИО полностью]')
    expect(document).not.toContain('[ИНН]')
  })

  it('does not claim that a notification has already been filed', () => {
    expect(JSON.stringify(legalDocument('privacy'))).not.toContain('Оператор направил уведомление')
  })
})
