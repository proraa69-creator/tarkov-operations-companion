import { tr } from './i18n'
import { LEGAL_DOCUMENTS } from './legal/documents'

/**
 * Search engines (owner, 11.10.2026: «чтобы люди могли находить нас в поиске»): each page's description, whether it is
 * indexed, its canonical address and its Russian / English addresses (`?lang=`, src/i18n). The words live in the page
 * head (and index.html), never hidden in the page: Google and Yandex penalise hidden text.
 */
const SITE = 'https://raidos.app'

/** What search engines show under the public pages. */
const DESCRIPTIONS: Record<string, string> = {
  '/': 'Raid OS — независимый компаньон для Escape from Tarkov (Тарков, EFT) на Windows: квесты из логов игры, карты с маршрутом, мини-карта по скриншоту, цены предметов в рейде, путь к Каппе, «Оружейник», боссы и отряд. PvP, PvE и Сезон — отдельно.',
  '/download': 'Скачайте Raid OS для Windows — компаньон для Escape from Tarkov: квесты, карты, мини-карта, цены предметов в рейде и путь к Каппе. Установка не нужна, обновляется сам при запуске.',
  '/about': 'Raid OS сделан игроками Escape from Tarkov для игроков: наша миссия, честная игра и как с нами связаться.',
}

/** Open to search engines; accounts, admin, invitations and unknown addresses are not (also public/robots.txt). */
const INDEXED = new Set(['/', '/download', '/about', '/legal', ...LEGAL_DOCUMENTS.map((document) => `/legal/${document.slug}`)])
/** Pages with an English version, each language at its own address (the documents are in Russian only). */
const BILINGUAL = new Set(Object.keys(DESCRIPTIONS))

/** Sets (or, with null, removes) a tag in the page head. */
function headTag(selector: string, create: () => HTMLElement, attributes: Record<string, string> | null) {
  let element = document.head.querySelector<HTMLElement>(selector)
  if (!attributes) { element?.remove(); return }
  if (!element) { element = create(); document.head.append(element) }
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value)
}

export function updateSearchTags(pathname: string, search = window.location.search) {
  const indexed = INDEXED.has(pathname)
  const bilingual = indexed && BILINGUAL.has(pathname)
  const lang = new URLSearchParams(search).get('lang')
  const meta = () => document.createElement('meta')
  const link = () => document.createElement('link')
  headTag('meta[name="description"]', meta, { name: 'description', content: tr(DESCRIPTIONS[pathname] ?? DESCRIPTIONS['/']) })
  headTag('meta[name="robots"]', meta, { name: 'robots', content: indexed ? 'index, follow' : 'noindex, follow' })
  headTag('link[rel="canonical"]', link, indexed ? { rel: 'canonical', href: `${SITE}${pathname}${bilingual && (lang === 'ru' || lang === 'en') ? `?lang=${lang}` : ''}` } : null)
  for (const hreflang of ['ru', 'en', 'x-default']) {
    headTag(`link[rel="alternate"][hreflang="${hreflang}"]`, link, bilingual
      ? { rel: 'alternate', hreflang, href: `${SITE}${pathname}${hreflang === 'x-default' ? '' : `?lang=${hreflang}`}` } : null)
  }
}
