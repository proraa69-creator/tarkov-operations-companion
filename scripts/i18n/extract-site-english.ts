/**
 * Every English text of the website (website/src/i18n/phrases*.ts), for its German, Japanese and Chinese files
 * (website/src/i18n/locales/<lang>.json, keyed by the English):
 *
 *   npx jiti scripts/i18n/extract-site-english.ts <out.json>
 */
import { writeFileSync } from 'node:fs'
import { AUTH_PHRASES } from '../../website/src/i18n/phrasesAuth'
import { CABINET_PHRASES } from '../../website/src/i18n/phrasesCabinet'
import { LAYOUT_PHRASES } from '../../website/src/i18n/phrasesLayout'
import { LEGAL_PHRASES } from '../../website/src/i18n/phrasesLegal'
import { PUBLIC_PHRASES } from '../../website/src/i18n/phrasesPublic'
import { PROMO_SITE_PHRASES } from '../../website/src/i18n/phrasesPromoSite'

const texts = new Set<string>()
for (const list of [LAYOUT_PHRASES, PUBLIC_PHRASES, AUTH_PHRASES, CABINET_PHRASES, LEGAL_PHRASES, PROMO_SITE_PHRASES]) {
  for (const [, english] of list) if (english.trim() && /[A-Za-z]{2,}/.test(english)) texts.add(english)
}
const list = [...texts].sort((a, b) => a.localeCompare(b))
writeFileSync(process.argv[2] ?? 'site-english.json', `${JSON.stringify(list, null, 1)}\n`)
console.log(`${list.length} texts, ${list.reduce((sum, text) => sum + text.length, 0)} characters`)
