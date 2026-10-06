/**
 * Links that leave the app for the system browser (pure functions, no Electron: unit-tested in externalLinks.test.ts).
 *
 * - 'open': a known site (the app's own site, tarkov.dev, the wiki, the guides the app links to, the owner's channels,
 *   payment pages, this PC's own website) — opened at once.
 * - 'confirm': any other HTTPS page (or another local address) — main.ts first shows a native dialog with the full
 *   address, so a page that got compromised cannot silently send the player anywhere.
 * - 'refuse': everything else (file:, javascript:, custom protocols, plain HTTP on the internet, broken URLs).
 */
export type ExternalLinkPolicy = 'open' | 'confirm' | 'refuse'

/** Known hosts: the host itself and its subdomains. */
const TRUSTED_DOMAINS = [
  'raidos.app',
  'tarkov.dev',
  't.me',
  'youtube.com',
  'youtu.be',
  // Payment pages (ЮKassa / ЮMoney).
  'yookassa.ru',
  'yoomoney.ru',
  // Boss guides linked from the boss cards (src/data/bossInfo.ts).
  'timesaver.gg',
  'v-tarkov.ru',
  'tarkovhead.com',
  'tarkovkit.com',
  'mrsouer.com',
  'eft.su',
  'tarkovguide.net',
]

/** Known hosts where only this exact host is trusted (other subdomains belong to other people). */
const TRUSTED_HOSTS = ['escapefromtarkov.fandom.com']

/** Hosts where only some paths are known: the owner's GitHub and VK pages. */
const TRUSTED_PATHS: Array<{ host: string; path: string }> = [
  { host: 'github.com', path: '/proraa69-creator' },
  { host: 'vk.com', path: '/metadvij' },
]

/** This PC's own website (electron/localServer.ts, LOCAL_SITE_URL) and its development server. */
const LOCAL_SITE_ORIGINS = ['http://127.0.0.1:5202', 'http://localhost:5202']

const LOCAL_HOSTS = ['127.0.0.1', 'localhost']

function underPath(pathname: string, prefix: string) {
  const path = pathname.toLowerCase()
  return path === prefix || path.startsWith(`${prefix}/`)
}

export function externalLinkPolicy(raw: string): ExternalLinkPolicy {
  let url: URL
  try { url = new URL(raw) } catch { return 'refuse' }
  const host = url.hostname.toLowerCase()
  if (url.protocol === 'http:') {
    if (!LOCAL_HOSTS.includes(host)) return 'refuse'
    return LOCAL_SITE_ORIGINS.includes(url.origin) && !url.username && !url.password ? 'open' : 'confirm'
  }
  if (url.protocol !== 'https:') return 'refuse'
  // user:password@ in a link, or an unusual port: always shown to the player first.
  if (url.username || url.password || url.port) return 'confirm'
  if (TRUSTED_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`))) return 'open'
  if (TRUSTED_HOSTS.includes(host)) return 'open'
  if (TRUSTED_PATHS.some((entry) => (host === entry.host || host === `www.${entry.host}`) && underPath(url.pathname, entry.path))) return 'open'
  return 'confirm'
}

/** The text of the confirmation dialog: the full address, and the host on its own line so it cannot hide at the end. */
export function externalLinkPrompt(raw: string) {
  let host = ''
  try { host = new URL(raw).host } catch { /* refused before this point */ }
  const shown = raw.length > 2000 ? `${raw.slice(0, 2000)}…` : raw
  return {
    message: 'Открыть ссылку в браузере?',
    detail: `Сайта нет в списке известных Raid OS.\n\nСайт: ${host}\nПолный адрес:\n${shown}\n\nОткрывайте, только если вы ожидали эту ссылку.`,
  }
}
