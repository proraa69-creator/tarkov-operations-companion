import { legalDocument, type LegalDocument, type LegalSection } from './documents'

/**
 * The privacy policy as the iPhone app and the App Store card show it (/app/privacy): the site's policy without anything
 * about payments, plans, payment services, receipts, invitations, the partner programme or advertising — «сделай так, будто
 * это вообще бесплатное приложение. Надо только на этой странице» (owner, 13.11.2026). The site's /legal/privacy stays whole.
 *
 * Every edit names the text it changes: when the site's policy is reworded, the edit throws and appPrivacy.test.ts fails, so
 * this page is looked at again instead of quietly showing the new wording.
 */

/** Words this page must not hold (appPrivacy.test.ts). */
export const APP_PRIVACY_FORBIDDEN = /оплат|платеж|платёж|тариф|подписк|ЮKassa|ЮМани|НСПК|BZB|bezebee|Boosty|налог|чек|реклам|приглаш|Пригласи|партн[её]р|скидк|бесплатн|сумм|валют|оферт|банк|выплат|наград|пробн|Premium|автопродл|возврат/i

type Edit = { drop: string } | { from: string; to: string }

/** Section number prefix → edits of its items (or paragraphs). `drop`: the item starting with this text goes. */
const EDITS: Record<string, Edit[]> = {
  '2.': [
    { from: ' По стране определяется способ оплаты.', to: '' },
    { from: 'незавершённая регистрация (e-mail, хэш пароля, код приглашения, страна, хэши IP-адреса)', to: 'незавершённая регистрация (e-mail, хэш пароля, страна, хэши IP-адреса)' },
    { drop: 'Оплата:' },
    { drop: 'Оплаты через платформу Boosty' },
    { drop: 'Оплата через сервис BZB' },
    { drop: 'Приглашения:' },
    { drop: 'Реклама:' },
    { drop: 'Программа «Пригласи друга»' },
    { drop: 'Партнёрам программы приглашений' },
    { from: 'Это нужно, чтобы один аккаунт игры использовался только с одним аккаунтом Сервиса и бесплатный период выдавался один раз на аккаунт игры. Привязка и данные устройств удаляются вместе с аккаунтом; хэш аккаунта игры, получившего бесплатный период, хранится и после удаления аккаунта.',
      to: 'Это нужно, чтобы один аккаунт игры использовался только с одним аккаунтом Сервиса. Привязка и данные устройств удаляются вместе с аккаунтом.' },
    { from: 'при регистрации и переходе по ссылке приглашения или по рекламной ссылке сохраняется только его хэш — см. «Приглашения», «Реклама» и «Программа «Пригласи друга»»', to: 'при регистрации сохраняется только его хэш' },
  ],
  '3.': [
    { from: 'Статистика аудитории по регионам и выбор способов оплаты — по стране, указанной при регистрации.', to: 'Статистика аудитории по регионам — по стране, указанной при регистрации.' },
    { drop: 'Приём оплаты' },
    { drop: 'Партнёрская программа' },
    { drop: 'Статистика рекламы' },
    { drop: 'Программа «Пригласи друга»' },
    { from: 'Соблюдение правила «один аккаунт Escape from Tarkov — один аккаунт Сервиса» и выдача бесплатного периода один раз на аккаунт игры.', to: 'Соблюдение правила «один аккаунт Escape from Tarkov — один аккаунт Сервиса».' },
    { from: 'по региону страны и наличию подписки;', to: 'по региону страны;' },
  ],
  '4.': [
    { from: 'Исполнение договора (оферты), стороной', to: 'Исполнение договора, стороной' },
    { drop: 'Исполнение обязанностей, возложенных законом' },
  ],
  '5.': [
    { from: 'ООО НКО «ЮМани» (ЮKassa), НСПК и банк Пользователя — приём платежей и возвраты (e-mail, сумма и номер заказа); ФНС России через «Мой налог» — чеки; сервис BZB (bezebee.com) — приём оплаты пользователей из стран СНГ (кроме России) и других стран: Пользователь сам указывает свои данные на BZB, а Оператор получает от BZB сведения о платеже, перечисленные выше; Resend, Inc.', to: 'Resend, Inc.' },
    { from: 'Данные не продаются и не передаются для рекламы.', to: 'Данные не продаются и не передаются для других целей.' },
    { from: 'сведения о платежах — в течение сроков налогового и бухгалтерского учёта (5 лет); ', to: '' },
    { from: '; хэши IP-адресов переходов по ссылкам приглашений и по рекламным ссылкам — до 7 дней', to: '' },
  ],
  '7.': [
    { drop: 'Платёжные реквизиты обрабатываются' },
  ],
  '8.': [
    { from: 'Сайт не использует рекламные и аналитические cookie.', to: 'Сайт не использует cookie для отслеживания.' },
  ],
}

function applyEdits(lines: string[] | undefined, edits: Edit[], used: Set<Edit>) {
  if (!lines) return undefined
  const out: string[] = []
  for (const line of lines) {
    let text: string | null = line
    for (const edit of edits) {
      if (text === null) break
      if ('drop' in edit) {
        if (text.startsWith(edit.drop)) { text = null; used.add(edit) }
      } else if (text.includes(edit.from)) {
        text = text.replace(edit.from, edit.to)
        used.add(edit)
      }
    }
    if (text !== null) out.push(text)
  }
  return out
}

export function appPrivacyDocument(): LegalDocument {
  const doc = legalDocument('privacy')!
  const used = new Set<Edit>()
  const sections: LegalSection[] = doc.sections.map((section) => {
    const edits = Object.entries(EDITS).find(([prefix]) => section.title.startsWith(prefix))?.[1] ?? []
    return { ...section, paragraphs: applyEdits(section.paragraphs, edits, used), items: applyEdits(section.items, edits, used) }
  })
  const missed = Object.values(EDITS).flat().filter((edit) => !used.has(edit))
  if (missed.length) throw new Error(`/app/privacy: the site's policy changed, ${missed.length} edit(s) no longer apply: ${JSON.stringify(missed[0])}`)
  return { ...doc, sections }
}
