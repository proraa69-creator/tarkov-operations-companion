// The phone app for the phone-apps ad: the real renderer in the phone layout (iPhone 17 size, @2x), the demo profile,
// a signed-in demo account, and a stand-in for the raidos.app server. The stand-in answers the account and the live
// relay (GET /v1/live/:mode, server/src/routes/live.ts) itself, so the take can send the phone the PC's screenshot
// position and the recognised item at exact moments — what the PC app of the same account sends in a real raid. Public
// files of raidos.app (map tiles, quest data) come from the request cache like every other host (../../net.mjs).
import { readFileSync } from 'node:fs'
import { launch, S } from '../rec.mjs'
import { answerExternal } from '../../net.mjs'

export const BASE = process.env.PROMO_BASE ?? 'http://127.0.0.1:5211/'
/** iPhone 17: 402 × 874 points. */
export const PHONE = { width: 402, height: 874, scale: 2 }
const SEEDS = { ru: JSON.parse(readFileSync(`${S}/promo/rec/seed-ru.json`, 'utf8')), en: JSON.parse(readFileSync(`${S}/promo/rec/seed-en.json`, 'utf8')) }
const TIMEWARP = readFileSync(`${S}/promo/rec/timewarp.js`, 'utf8')
const OVERLAY = readFileSync(`${S}/promo/rec/overlay.js`, 'utf8')

/** One-time windows that must not open on camera (src/onboarding, src/events). */
const SEEN = ['raidos-scourge-event-v1', 'raidos-goons-rest-tip-v1', 'raidos.first-launch.game-restart.v2', 'raidos.first-launch.game-restart.v1',
  'raidos-quest-sync-tip-v1', 'raidos-raid-loadout-tip-v1', 'raidos-new-features-0-6-0-68-v1', 'toc.cookie-notice']

/** Touches instead of the desktop pointer: a soft dot while the finger is down, and the overlay's ripple. */
const TOUCH_CSS = `.pv-cursor svg{display:none}
.pv-cursor::after{content:'';position:absolute;left:-17px;top:-18px;width:44px;height:44px;border-radius:50%;background:rgb(255 255 255 / 34%);
  border:2px solid rgb(255 255 255 / 70%);box-shadow:0 2px 10px rgb(0 0 0 / 45%);opacity:0;transform:scale(.6);transition:opacity .12s ease-out,transform .18s cubic-bezier(.23,1,.32,1)}
.pv-cursor.is-down::after{opacity:1;transform:scale(1)}`

/**
 * The stand-in server. `send({ position })` / `send({ item })` publish a new live state: a waiting GET /v1/live/:mode
 * answers at once (as the relay does), the next one gets it right away.
 */
function standIn() {
  const live = { version: 1, position: null, item: null }
  const waiting = new Set()
  const json = (route, status, body) => route.fulfill({ status, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }, body: JSON.stringify(body) })
  const account = { email: 'demo@raidos.app', kind: 'user', nicknames: { pvp: 'RaidOS_Demo' }, subscription: { status: 'active', paidUntil: new Date(Date.now() + 30 * 864e5).toISOString() }, emailVerifiedAt: new Date(Date.now() - 40 * 864e5).toISOString(), createdAt: new Date(Date.now() - 40 * 864e5).toISOString() }
  // Public data of the real server, from the request cache.
  const PUBLIC = /^\/(?:v1\/map-tiles\/|v1\/map-updates|v1\/quest-requirements|v1\/map-bosses|media\/)/
  async function handle(route) {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } })
    if (url.pathname === '/health') return json(route, 200, { ok: true })
    if (url.pathname === '/v1/accounts/me') return json(route, 200, account)
    if (url.pathname === '/v1/announcement') return json(route, 200, { announcement: null })
    const mode = /^\/v1\/live\/(pvp|pve|seasonal)$/.exec(url.pathname)?.[1]
    if (mode) {
      const since = Number(url.searchParams.get('since'))
      if (mode === 'pvp' && Number.isFinite(since) && since >= live.version) {
        // Held like the relay holds it; answered with the same version after a while if nothing comes.
        await new Promise((resolve) => { const done = () => { waiting.delete(done); resolve() }; waiting.add(done); setTimeout(done, 12_000) })
      }
      return json(route, 200, mode === 'pvp' ? live : { version: 1, position: null, item: null })
    }
    if (/^\/v1\/me\/position\/pvp$/.test(url.pathname)) return json(route, 200, { position: live.position })
    if (request.method() === 'GET' && PUBLIC.test(url.pathname)) return route.fallback()
    return json(route, 404, { error: 'Не найдено' })
  }
  function send(next) {
    Object.assign(live, next, { version: live.version + 1 })
    for (const done of [...waiting]) done()
  }
  return { handle, send, live }
}

/** The phone app in `lang` (ru | en), ready on «Обзор». */
export async function openPhone({ hash = '#/', lang = 'ru', prepare } = {}) {
  const browser = await launch()
  const context = await browser.newContext({
    viewport: { width: PHONE.width, height: PHONE.height }, deviceScaleFactor: PHONE.scale, isMobile: true, hasTouch: true, locale: lang === 'en' ? 'en-US' : 'ru-RU', colorScheme: 'dark',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  })
  const server = standIn()
  await answerExternal(context, (url) => url.startsWith(BASE))
  // Registered after the cache: it answers raidos.app first and hands the public files back to the cache.
  await context.route(/^https:\/\/raidos\.app\//, server.handle)
  await context.addInitScript(TIMEWARP)
  await context.addInitScript(([seed, seen, lang]) => {
    try {
      sessionStorage.setItem('tarkov-account-gate-skipped', '1')
      if (localStorage.getItem('phone-ad-seeded')) return
      localStorage.setItem('phone-ad-seeded', '1')
      for (const key of seen) localStorage.setItem(key, '1')
      localStorage.setItem('tarkov-operations-locale-v1', lang)
      localStorage.setItem('tarkov-operations-state-v1', JSON.stringify({ raidMode: 'pvp' }))
      localStorage.setItem('tarkov-operations-profiles-v2', seed['tarkov-operations-profiles-v2'])
      localStorage.setItem('tarkov-operations-ui-v2', seed['tarkov-operations-ui-v2'])
      localStorage.setItem('tarkov-collector-items-v1:pvp', JSON.stringify(seed.collector.slice(0, 21)))
      localStorage.setItem('tarkov-mobile-session-v1', JSON.stringify({ token: 'promoDemoSessionToken_0123456789', email: 'demo@raidos.app', kind: 'user' }))
    } catch { /* storage blocked */ }
  }, [SEEDS[lang] ?? SEEDS.ru, SEEN, lang])
  await context.addInitScript(OVERLAY)
  await context.addInitScript((css) => {
    addEventListener('DOMContentLoaded', () => { const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style) })
  }, TOUCH_CSS)
  const page = await context.newPage()
  page.on('pageerror', (error) => console.log('  pageerror:', error.message.slice(0, 200)))
  await page.goto(BASE + hash)
  await ready(page)
  if (prepare) await prepare(page, server)
  return { context, page, server }
}

export async function ready(page, extra = 1500) {
  await page.waitForFunction(() => document.querySelector('.page') && !/Загружаем актуальную базу|Loading current database|Loading the latest data/i.test(document.body?.innerText ?? ''), null, { timeout: 180_000 }).catch(() => console.log('  still loading'))
  await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {})
  await page.waitForFunction(() => [...document.images].filter((img) => img.getBoundingClientRect().width > 0).every((img) => img.complete), null, { timeout: 30_000 }).catch(() => {})
  await new Promise((resolve) => setTimeout(resolve, extra))
}

/** The PC's screenshot position on Customs (the place of the landscape promo's minimap scene). */
export const CUSTOMS_POSITION = { x: 150, y: 2, z: 135, yaw: 40, map: 'customs' }

/**
 * The item the PC recognised (tarkov.dev PvP on 20.10.2026: lowest flea offer 31 499 ₽, Therapist 32 144 ₽; needed by the
 * Collector — «Каппа»), as the PC sends it to the relay (items/recognisedItem.ts liveItemBody).
 */
export const book = (lang = 'ru') => ({
  itemId: '5bc9c049d4351e44f824d360', name: lang === 'en' ? 'Battered antique book' : 'Потрепанная антикварная книга', shortName: lang === 'en' ? 'Book' : 'Книга',
  iconUrl: 'https://assets.tarkov.dev/5bc9c049d4351e44f824d360-icon.webp',
  fleaPrice: 31499, bestTrader: { name: lang === 'en' ? 'Therapist' : 'Терапевт', price: 32144 }, quests: [], kappa: true, collector: true,
})

/** The page's own clock (slowed while recording): a position or item time the app sees as «now». */
export const pageNow = (page) => page.evaluate(() => Date.now())
