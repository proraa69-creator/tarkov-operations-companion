import { describe, expect, it } from 'vitest'
import { APP_PRIVACY_FORBIDDEN, appPrivacyDocument } from './appPrivacy'
import { legalDocument } from './documents'

const text = (doc: ReturnType<typeof appPrivacyDocument>) => [doc.title, ...doc.sections.flatMap((section) => [section.title, ...(section.paragraphs ?? []), ...(section.items ?? [])])]

// Owner, 13.11.2026: the iPhone app's policy page «будто это вообще бесплатное приложение», only on that page.
describe('/app/privacy', () => {
  it('names no payment, plan, payment service, receipt, invitation, partner or advertising', () => {
    const found = text(appPrivacyDocument()).filter((line) => APP_PRIVACY_FORBIDDEN.test(line))
    expect(found).toEqual([])
  })

  it('keeps the rest of the policy: the operator, the account, game data, rights, protection', () => {
    const all = text(appPrivacyDocument()).join('\n')
    for (const kept of ['152-ФЗ', 'e-mail', 'Игровые данные', 'Аккаунт Escape from Tarkov', 'Resend, Inc.', 'Роскомнадзоре', 'scrypt']) expect(all).toContain(kept)
    expect(appPrivacyDocument().sections).toHaveLength(legalDocument('privacy')!.sections.length)
  })

  it('the site\'s own policy is untouched', () => {
    expect(text(legalDocument('privacy') as ReturnType<typeof appPrivacyDocument>).some((line) => /ЮKassa/.test(line))).toBe(true)
  })
})
