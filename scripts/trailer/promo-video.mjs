// Home page trailer: node scripts/trailer/promo-video.mjs (needs the renderer on :5661 —
// `npx vite --port 5661` — and the website on :5672 — `npx vite --config website/vite.config.ts --port 5672`).
// Writes website/public/media/trailer.webm and trailer-poster.jpg.
//
// Promo video (1280x720 WebM) recorded with Playwright recordVideo: a host page with title cards and captions that
// cross-fades between iframes — the website home page (dev server :5672) and live app screens (renderer :5661, demo
// data, no game art). The blank lead-in is trimmed and the result re-encoded with Playwright's bundled ffmpeg (VP8).
import { fileURLToPath } from 'node:url'
import { chromium } from '../../node_modules/playwright/index.mjs'
import { readFileSync, mkdirSync, rmSync, copyFileSync, statSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
const HERE = fileURLToPath(new URL('.', import.meta.url))
// Working folder for the raw recording; a copy of the final webm is left there too.
const SCRATCH = process.env.PROMO_OUT ?? HERE + '.promo/'
const WT = fileURLToPath(new URL('../../', import.meta.url))
const MEDIA = WT + 'website/public/media/'
const APP = process.env.PROMO_APP ?? 'http://127.0.0.1:5661/'
const SITE = process.env.PROMO_SITE ?? 'http://127.0.0.1:5672/'
const HOST = 'http://127.0.0.1:5699/'
const FFMPEG = process.env.TRAILER_FFMPEG ?? '/opt/pw-browsers/ffmpeg-1011/ffmpeg-linux'
const FONTS = WT + 'scripts/trailer/assets/fonts/'

const ITEM_TILE = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2a3a30"/><stop offset="1" stop-color="#141d18"/></linearGradient></defs><rect width="128" height="128" rx="10" fill="url(#g)"/><g fill="none" stroke="#c4a665" stroke-opacity=".55" stroke-width="5" stroke-linejoin="round"><path d="M64 26 98 44v40L64 102 30 84V44z"/><path d="M30 44l34 18 34-18M64 62v40"/></g></svg>`
const MAP_GRID = (() => {
  const lines = []
  for (let i = 0; i <= 1000; i += 50) { const major = i % 250 === 0; lines.push(`<path d="M${i} 0V1000M0 ${i}H1000" stroke="${major ? '#2f4236' : '#1c2921'}" stroke-width="${major ? 2 : 1}"/>`) }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000" viewBox="0 0 1000 1000"><defs><radialGradient id="v" cx=".5" cy=".5" r=".7"><stop offset="0" stop-color="#16211b"/><stop offset="1" stop-color="#0b120e"/></radialGradient></defs><rect width="1000" height="1000" fill="url(#v)"/>${lines.join('')}</svg>`
})()
const COLLECTOR_PATCH = `
;(() => {
  const icon = 'https://assets.tarkov.dev/collector-icon.webp'
  const extra = [['kappa-book', 'Потрёпанная старинная книга', 'Книга'], ['kappa-axe', 'Старинный топор', 'Топор'], ['kappa-lion', 'Бронзовая фигурка льва', 'Лев'], ['kappa-rooster', 'Золотой петух', 'Петух'], ['kappa-egg', 'Золотое яйцо', 'Яйцо'], ['kappa-raven', 'Фигурка ворона', 'Ворон'], ['kappa-firesteel', 'Старое огниво', 'Огниво'], ['kappa-teapot', 'Старинный чайник', 'Чайник'], ['kappa-vase', 'Старинная ваза', 'Ваза'], ['kappa-cat', 'Фигурка кота', 'Кот']]
  for (const [id, name, shortName] of extra) items.push({ id, name, shortName, category: 'Бартер', description: name, iconUrl: icon, questIds: ['collector'], prices: [] })
  const need = { checking: [['machinery-key', 1, 'key']], 'operation-aquarius': [['dorm-206-key', 1, 'key']], 'golden-swag': [['dorm-303-key', 1, 'key'], ['trailer-key', 1, 'key']], 'bp-depot': [['ms2000', 4, 'mark']] }
  for (const quest of demoDataset.quests) if (need[quest.id]) quest.raidRequirements = need[quest.id].map(([itemId, count, purpose]) => ({ itemId, count, purpose, mapIds: ['customs'] }))
  demoDataset.quests.push({ id: 'collector', name: 'Коллекционер', trader: 'Скупщик', anyMap: true, level: 1, kappa: false, description: 'Собрать коллекцию для Скупщика.', objectives: ['Передать предметы, найденные в рейде'], rewards: ['Контейнер «Каппа»'], requiredItems: extra.map(([id]) => id) })
})();
`
const SEED = `(() => {
  try {
    const now = new Date().toISOString()
    localStorage.setItem('tarkov-map-marker-style', 'modern')
    const raw = localStorage.getItem('tarkov-operations-profiles-v2')
    if (!raw) return 'no-profile'
    const state = JSON.parse(raw)
    const p = state.profiles[0]
    if (p.__promo) return 'seeded'
    p.__promo = true
    const m = p.modes[p.selectedMode || 'pvp']
    m.playerLevel = 24
    const rec = (taskId, status) => ({ taskId, status, source: 'eft-log', updatedAt: now })
    for (const id of ['debut', 'shooting-cans', 'introduction']) m.taskProgress[id] = rec(id, 'completed')
    for (const id of ['checking', 'operation-aquarius', 'golden-swag', 'bp-depot', 'pharmacist', 'story-tour']) m.taskProgress[id] = rec(id, 'active')
    m.trackedTaskIds = ['operation-aquarius', 'golden-swag', 'bp-depot']
    m.favoriteItemIds = ['graphics-card', 'ledx', 'salewa']
    localStorage.setItem('tarkov-operations-profiles-v2', JSON.stringify(state))
    localStorage.setItem('tarkov-collector-items-v1:pvp', JSON.stringify(['kappa-book', 'kappa-axe', 'kappa-lion', 'kappa-egg']))
    location.reload()
    return 'reloading'
  } catch (e) { return String(e) }
})()`

const HOST_HTML = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>
@font-face { font-family: 'Inter'; font-weight: 100 900; src: url(/fonts/inter-cyrillic.woff2) format('woff2'); unicode-range: U+0400-045F, U+2116; }
@font-face { font-family: 'Inter'; font-weight: 100 900; src: url(/fonts/inter-latin.woff2) format('woff2'); unicode-range: U+0000-00FF, U+2000-206F; }
@font-face { font-family: 'Oswald'; font-weight: 200 700; src: url(/fonts/oswald-cyrillic.woff2) format('woff2'); unicode-range: U+0400-045F, U+2116; }
@font-face { font-family: 'Oswald'; font-weight: 200 700; src: url(/fonts/oswald-latin.woff2) format('woff2'); unicode-range: U+0000-00FF, U+2000-206F; }
* { box-sizing: border-box; }
html, body { margin: 0; width: 1280px; height: 720px; overflow: hidden; background: #070a08; color: #edf2ed; font-family: Inter, sans-serif; }
.layer { position: absolute; inset: 0; opacity: 0; transition: opacity .55s cubic-bezier(.22,.61,.36,1); pointer-events: none; overflow: hidden; }
.layer.on { opacity: 1; pointer-events: auto; }
iframe { border: 0; display: block; background: #0a0f0c; }
#site { width: 1280px; height: 720px; }
#app { width: 1280px; height: 720px; }
.slide { display: grid; place-items: center; align-content: center; gap: 14px; text-align: center;
  background: radial-gradient(circle at 50% 30%, rgb(169 185 115 / 16%), transparent 55%), radial-gradient(circle at 80% 100%, rgb(196 166 101 / 10%), transparent 50%), linear-gradient(180deg, #0d130f, #070a08); }
.slide .kicker { color: #c4a665; font: 800 15px Inter; letter-spacing: .3em; text-transform: uppercase; }
.slide h1 { margin: 0; font: 700 74px/1 Oswald; letter-spacing: .02em; text-transform: uppercase; }
.slide h1 em { font-style: normal; color: #a9b973; }
.slide p { margin: 0; color: #a7b2a9; font-size: 22px; }
.slide .wm { width: 620px; height: auto; }
.slide .rule { width: 120px; height: 3px; background: linear-gradient(90deg, transparent, #c4a665, transparent); }
.slide.on .anim { animation: rise .8s cubic-bezier(.16,1,.3,1) both; }
.slide.on .anim:nth-child(2) { animation-delay: .08s } .slide.on .anim:nth-child(3) { animation-delay: .16s } .slide.on .anim:nth-child(4) { animation-delay: .24s }
@keyframes rise { from { opacity: 0; transform: translateY(18px); } }
.cta { display: flex; gap: 14px; margin-top: 18px; }
.cta span { padding: 14px 24px; border-radius: 11px; font-weight: 800; font-size: 19px; border: 1px solid #3b4d40; background: #19241e; }
.cta span.primary { border-color: #786840; background: linear-gradient(180deg, #6d603f, #52492f); color: #fff8e7; }
.trust { color: #8a968c !important; font-size: 16px !important; }
#caption { pointer-events: none; position: absolute; left: 40px; bottom: 36px; z-index: 50; display: flex; align-items: center; gap: 14px; padding: 14px 20px 14px 16px; border: 1px solid #4e5a3c; border-radius: 14px;
  background: rgb(8 12 10 / 88%); box-shadow: 0 18px 40px rgb(0 0 0 / 55%); opacity: 0; transform: translateY(14px); transition: opacity .4s, transform .5s cubic-bezier(.16,1,.3,1); max-width: 900px; }
#caption.on { opacity: 1; transform: none; }
#caption b { display: grid; place-items: center; min-width: 38px; height: 38px; padding: 0 8px; border-radius: 10px; background: #2a2a1e; border: 1px solid #5f553a; color: #dfbd70; font: 800 15px Inter; }
#caption div { display: grid; gap: 2px; }
#caption strong { font-size: 21px; letter-spacing: -.01em; }
#caption small { color: #9aa69c; font-size: 14px; }
#cursor { pointer-events: none; position: absolute; z-index: 60; left: 0; top: 0; width: 22px; height: 22px; transition: transform .45s cubic-bezier(.22,.61,.36,1); opacity: 0; filter: drop-shadow(0 2px 3px rgb(0 0 0 / 70%)); }
#cursor.on { opacity: 1; }
#cursor.click::after { content: ""; position: absolute; left: -12px; top: -12px; width: 24px; height: 24px; border-radius: 50%; border: 2px solid #dfbd70; animation: ping .5s ease-out forwards; }
@keyframes ping { from { transform: scale(.3); opacity: 1; } to { transform: scale(1.6); opacity: 0; } }
/* in-game style backdrops for the overlay windows (CSS only, no game art) */
.scene { background: radial-gradient(circle at 70% 25%, rgb(150 160 120 / 14%), transparent 55%), radial-gradient(circle at 15% 85%, rgb(0 0 0 / 70%), transparent 60%), linear-gradient(160deg, #20251e, #0b0e0b); }
.scene .haze { position: absolute; inset: 0; background: repeating-linear-gradient(0deg, rgb(255 255 255 / 1.5%) 0 2px, transparent 2px 4px); }
.scene .hud { position: absolute; left: 40px; top: 30px; color: #6f7a70; font: 700 13px Inter; letter-spacing: .2em; text-transform: uppercase; }
.stash { position: absolute; left: 90px; top: 110px; width: 560px; display: grid; grid-template-columns: repeat(8, 1fr); gap: 4px; padding: 10px; border: 1px solid rgb(255 255 255 / 10%); background: rgb(0 0 0 / 35%); }
.stash span { aspect-ratio: 1; border: 1px solid rgb(255 255 255 / 8%); background: rgb(30 34 28 / 80%); }
.stash span.item { background: linear-gradient(145deg, #3a3426, #1d1a13); border-color: rgb(223 189 112 / 25%); }
.stash span.hot { border-color: #dfbd70; box-shadow: 0 0 22px rgb(223 189 112 / 45%); }
.keycap { position: absolute; right: 70px; top: 70px; display: flex; align-items: center; gap: 12px; padding: 10px 14px; border: 1px solid #3b4d40; border-radius: 12px; background: rgb(10 15 12 / 88%); color: #a7b2a9; font-size: 16px; font-weight: 700; transition: transform .2s; }
.keycap kbd { min-width: 38px; height: 38px; display: grid; place-items: center; border: 1px solid #786840; border-bottom-width: 4px; border-radius: 8px; background: #2a2416; color: #fff3d2; font: 800 20px monospace; }
.keycap.press kbd { transform: translateY(3px); border-bottom-width: 1px; background: #5a4d2c; }
#item-frame { position: absolute; left: 640px; top: 260px; width: 420px; height: 260px; background: transparent; }
#mm-frame { position: absolute; right: 70px; top: 10px; width: 470px; height: 700px; background: transparent; }
.shot-toast { position: absolute; left: 50px; top: 90px; padding: 10px 14px; border: 1px solid #5f553a; border-radius: 10px; background: rgb(20 18 12 / 90%); color: #f0d48c; font: 700 15px Inter; opacity: 0; transition: opacity .2s; }
.shot-toast.on { opacity: 1; }
.shot-toast small { display: block; color: #8a8f80; font: 500 12px monospace; margin-top: 3px; }
.flash { position: absolute; inset: 0; background: #fff; opacity: 0; pointer-events: none; }
.flash.on { animation: flash .35s ease-out; }
@keyframes flash { from { opacity: .18; } to { opacity: 0; } }
.phone { position: absolute; left: 50%; top: 50%; width: 334px; height: 692px; transform: translate(-50%, -50%); padding: 12px; border-radius: 46px; border: 1px solid #3d4a3f; background: linear-gradient(160deg, #1b211c, #070908); box-shadow: 0 30px 80px rgb(0 0 0 / 60%); }
.phone .screen { width: 310px; height: 668px; overflow: hidden; border-radius: 34px; }
#phone-frame { width: 390px; height: 840px; transform: scale(.795); transform-origin: 0 0; }
.phone-badge { position: absolute; top: 34px; right: -26px; padding: 5px 12px; border: 1px solid #8a7747; border-radius: 999px; background: #2a2215; color: #f0d48c; font: 800 14px Inter; letter-spacing: .1em; text-transform: uppercase; transform: rotate(6deg); }
.phone-side { position: absolute; left: 80px; top: 50%; transform: translateY(-50%); width: 300px; display: grid; gap: 10px; }
.phone-side strong { font: 700 40px/1.05 Oswald; text-transform: uppercase; }
.phone-side span { color: #a7b2a9; font-size: 17px; line-height: 1.5; }
</style></head><body>
<div id="l-black" class="layer on" style="background:#070a08"></div>
<div id="l-title" class="layer slide"><div class="kicker anim">Компаньон для Escape from Tarkov</div><img class="anim wm" src="${SITE}brand/wordmark.svg" alt=""><div class="rule anim"></div><p class="anim">Квесты · карты · цены · отряд — в одном окне рядом с игрой</p></div>
<div id="l-chapter" class="layer slide"><div class="kicker anim" id="ch-k"></div><h1 class="anim" id="ch-t"></h1><div class="rule anim"></div><p class="anim" id="ch-p"></p></div>
<div id="l-site" class="layer"><iframe id="site"></iframe></div>
<div id="l-app" class="layer"><iframe id="app"></iframe></div>
<div id="l-item" class="layer scene"><div class="haze"></div><div class="hud">Схрон · пример</div>
  <div class="stash">${Array.from({ length: 48 }, (_, i) => `<span class="${[3, 4, 9, 13, 20, 21, 30, 38, 44].includes(i) ? 'item' : ''}${i === 21 ? ' hot' : ''}"></span>`).join('')}</div>
  <div class="keycap" id="keycap"><span>Наведите курсор и нажмите</span><kbd>;</kbd></div>
  <iframe id="item-frame" allowtransparency="true"></iframe></div>
<div id="l-mm" class="layer scene"><div class="haze"></div><div class="hud">Окно поверх игры · пример</div><div class="flash" id="flash"></div>
  <div class="shot-toast" id="toast">Скриншот в игре → позиция<small id="toast-name"></small></div>
  <iframe id="mm-frame" allowtransparency="true"></iframe></div>
<div id="l-phone" class="layer slide" style="place-items:initial">
  <div class="phone-side"><strong>Телефон — скоро</strong><span>iOS и Android: те же задания и карты в мобильной раскладке. В магазинах приложений пока нет.</span></div>
  <div class="phone"><span class="phone-badge">скоро</span><div class="screen"><iframe id="phone-frame"></iframe></div></div></div>
<div id="l-end" class="layer slide"><div class="kicker anim">Готовы к рейду?</div><img class="anim wm" style="width:440px" src="${SITE}brand/wordmark.svg" alt=""><div class="cta anim"><span class="primary">Скачать для Windows</span><span>Личный кабинет</span></div><p class="anim">raidos.app</p><p class="anim trust">Не вмешивается в игру · данные из открытых источников · Windows 10 и 11</p></div>
<div id="caption"><b id="cap-n"></b><div><strong id="cap-t"></strong><small id="cap-s"></small></div></div>
<svg id="cursor" viewBox="0 0 24 24"><path d="M3 2l7 19 2.6-7.4L20 11z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>
<script>
window.show = (id) => { for (const el of document.querySelectorAll('.layer')) el.classList.toggle('on', el.id === id) }
window.chapter = (k, t, p) => { document.getElementById('ch-k').textContent = k; document.getElementById('ch-t').innerHTML = t; document.getElementById('ch-p').textContent = p }
window.caption = (n, t, s) => { const c = document.getElementById('caption'); if (!t) { c.classList.remove('on'); return } document.getElementById('cap-n').textContent = n; document.getElementById('cap-t').textContent = t; document.getElementById('cap-s').textContent = s || ''; c.classList.add('on') }
window.cursor = (x, y, on = true) => { const c = document.getElementById('cursor'); c.classList.toggle('on', on); c.style.transform = 'translate(' + x + 'px,' + y + 'px)' }
window.clickFx = () => { const c = document.getElementById('cursor'); c.classList.remove('click'); void c.offsetWidth; c.classList.add('click') }
</script></body></html>`

const BRIDGE = `(() => {
  if (!location.hash.startsWith('#/overlay')) return
  const l = {}
  window.tarkovDesktop = { overlaySetInteractive() {}, overlayResize() {}, setOverlaySize() {}, resizeOverlay() {}, overlayDrag() {}, experimental: { updateSettings: async () => ({}) }, onOverlay(c, cb) { l[c] = cb; return () => {} } }
  window.__emit = (c, x) => l[c] && l[c](x)
  document.documentElement.style.background = 'transparent'
  addEventListener('DOMContentLoaded', () => { document.body.style.background = 'transparent' })
})()`

// The host page needs a real server: Chromium aborts iframe navigations from a route-fulfilled document.
const hostServer = createServer((req, res) => {
  const path = new URL(req.url, HOST).pathname
  if (path.startsWith('/fonts/')) { res.writeHead(200, { 'content-type': 'font/woff2' }); res.end(readFileSync(FONTS + path.slice(7))); return }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(HOST_HTML)
})
await new Promise((r) => hostServer.listen(5699, '127.0.0.1', r))
const browser = await chromium.launch({ executablePath: process.env.TRAILER_CHROMIUM ?? '/opt/pw-browsers/chromium', args: ['--force-color-profile=srgb', '--hide-scrollbars'] })

async function setupContext(options) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, locale: 'ru-RU', ...options })
  await context.route('**/*', async (route) => {
    const url = route.request().url()
    if (url.startsWith(HOST)) return route.continue()
    if (url.startsWith(APP) && /\/src\/data\/demo\.ts/.test(url)) {
      const response = await route.fetch()
      return route.fulfill({ response, body: (await response.text()) + COLLECTOR_PATCH })
    }
    if (url.startsWith(APP) || url.startsWith(SITE)) return route.continue()
    if (/^https?:\/\/([^/]+\.)?tarkov\.dev\//.test(url)) {
      if (/\/maps\//.test(url) || /\.svg(\?|$)/.test(url)) return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: MAP_GRID })
      if (/\.(webp|png|jpe?g|gif)(\?|$)/.test(url)) return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: ITEM_TILE })
    }
    return route.abort()
  })
  await context.addInitScript(() => {
    if (location.port === '5661') {
      sessionStorage.setItem('tarkov-account-gate-skipped', '1')
      if (!localStorage.getItem('promo-theme')) {
        localStorage.setItem('promo-theme', '1')
        localStorage.setItem('tarkov-app-theme', 'blackmc')
        localStorage.setItem('tarkov-operations-locale-v1', 'ru')
        localStorage.setItem('tarkov-operations-ui-v2', JSON.stringify({ selectedMapId: 'customs', hiddenMarkerTypes: [], hiddenMarkerLayers: ['spawn'] }))
      }
    }
    if (location.port === '5672') {
      localStorage.setItem('toc.cookie-notice', '1')
      const style = document.createElement('style')
      // headless Chromium paints <video> black: show the poster instead of the old trailer in the hero
      style.textContent = '.trailer video{visibility:hidden}.trailer{background:#070b09 url(/media/trailer-poster.jpg) center/cover}.trailer-overlay,.trailer-controls{display:none!important}html{scroll-behavior:auto!important}'
      document.addEventListener('DOMContentLoaded', () => document.head.appendChild(style))
    }
  })
  await context.addInitScript(BRIDGE)
  return context
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

// ---- 1. poster: the title card (also shown in the site hero while recording) --------------------------------
{
  const context = await setupContext()
  const page = await context.newPage()
  await page.goto(HOST)
  await page.evaluate(() => document.fonts.ready)
  await page.evaluate(() => window.show('l-title'))
  await wait(1500)
  await page.screenshot({ path: MEDIA + 'trailer-poster.jpg', type: 'jpeg', quality: 88 })
  await context.close()
}

// ---- 2. recording --------------------------------------------------------------------------------------------
const REC = SCRATCH + 'rec/'
rmSync(REC, { recursive: true, force: true })
mkdirSync(REC, { recursive: true })
const context = await setupContext({ recordVideo: { dir: REC, size: { width: 1280, height: 720 } } })
context.setDefaultTimeout(4000)
const page = await context.newPage()
const tVideo = Date.now()
page.on('pageerror', (e) => console.log('host pageerror', e.message))
await page.goto(HOST)
await page.evaluate(() => document.fonts.ready)

const frameOf = (selector) => page.frameLocator(selector)
const frameByUrlPart = (iframeId) => page.frames().find((f) => f.parentFrame() === page.mainFrame() && f.name() === iframeId) ?? null
async function setSrc(id, url) {
  await page.evaluate(([i, u]) => { const el = document.getElementById(i); el.name = i; el.src = u }, [id, url])
  for (let i = 0; i < 100; i++) { const f = await (await page.$('#' + id)).contentFrame(); if (f && f.url().startsWith(url.split('#')[0])) return f; await wait(100) }
  const ff = await (await page.$('#' + id)).contentFrame(); console.log('frame url', ff && ff.url(), page.frames().map((f) => f.url())); throw new Error('frame ' + id)
}
async function settleApp(frame, ms = 1200) {
  await frame.waitForLoadState('networkidle').catch(() => {})
  await frame.waitForFunction(() => !document.body.innerText.includes('Загружаем актуальную базу'), null, { timeout: 30000 }).catch(() => {})
  await wait(ms)
}
const show = (id) => page.evaluate((i) => window.show(i), id)
const caption = (n, t, s) => page.evaluate(([a, b, c]) => window.caption(a, b, c), [n, t, s])
const chapter = (k, t, p) => page.evaluate(([a, b, c]) => window.chapter(a, b, c), [k, t, p])
let cur = { x: 640, y: 400 }
async function moveTo(x, y, ms = 450) {
  await page.evaluate(([a, b]) => window.cursor(a, b, true), [x, y])
  const steps = Math.max(4, Math.round(ms / 40))
  await page.mouse.move(x, y, { steps })
  cur = { x, y }
  await wait(Math.max(0, ms - steps * 8))
}
async function click(x, y, ms = 450) {
  await moveTo(x, y, ms)
  await page.evaluate(() => window.clickFx())
  await page.mouse.click(x, y)
}
const hideCursor = () => page.evaluate(() => window.cursor(0, 0, false))
// Playwright boxes of elements inside iframes are already in host-page coordinates (transforms included).
async function appBox(frame, selector, index = 0) {
  const b = await frame.locator(selector).nth(index).boundingBox()
  if (!b) throw new Error('no box ' + selector)
  return { x: b.x, y: b.y, w: b.width, h: b.height }
}
const A = (x, y) => [Math.round(x), Math.round(y)]
async function siteScrollTo(frame, target, ms = 1300) {
  await frame.evaluate(async ([t, d]) => {
    const el = typeof t === 'string' ? document.querySelector(t) : null
    const to = el ? el.getBoundingClientRect().top + scrollY - 76 : t
    const from = scrollY
    const start = performance.now()
    await new Promise((resolve) => {
      const step = (now) => {
        const k = Math.min(1, (now - start) / d)
        const e = k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2
        scrollTo(0, from + (to - from) * e)
        if (k < 1) requestAnimationFrame(step); else resolve()
      }
      requestAnimationFrame(step)
    })
  }, [target, ms])
}

// Preload everything behind the black layer.
const site = await setSrc('site', SITE)
await site.waitForLoadState('networkidle').catch(() => {})
let app = await setSrc('app', APP + '#/')
await settleApp(app, 500)
console.log('seed', await app.evaluate(SEED))
await wait(1500)
await settleApp(app, 800)
const item = await setSrc('item-frame', APP + '#/overlay/item')
const mm = await setSrc('mm-frame', APP + '#/overlay/minimap')
const phone = await setSrc('phone-frame', APP + '#/')
await settleApp(item, 300); await settleApp(mm, 300); await settleApp(phone, 800)
// minimap overlay: data, a first position, the selected quest and a zoom-out (layer shown only during preload)
await page.evaluate(() => window.show('l-mm'))
await mm.evaluate(async () => {
  const demo = await import('/src/data/demo.ts')
  const mapData = demo.maps.find((m) => m.id === 'customs')
  const layer = { extract: 'extract.pmc', quest: 'quest.zone', boss: 'boss', cache: 'loot.container', danger: 'hazard', key: 'key' }
  const markers = demo.markers.filter((m) => m.mapId === 'customs').map((m) => ({ id: m.id, position: m.position, layerId: layer[m.type] ?? 'landmark', title: m.title, questId: m.questId }))
  window.__emit('overlay:minimap', { state: 'ready', map: mapData, markers, questCount: 3, opacity: 0.94, playerMarker: 'arrow', quests: [
    { questId: 'operation-aquarius', name: 'Операция «Водолей»', trader: 'Терапевт', markerIds: ['customs-aquarius'], objectives: ['Найти спрятанную воду в общежитии', 'Выжить и выйти'] },
    { questId: 'golden-swag', name: 'Золотая добыча', trader: 'Лыжник', markerIds: ['customs-golden-swag'], objectives: ['Найти зажигалку Зиббо', 'Спрятать зажигалку в бытовке'] },
    { questId: 'checking', name: 'Проверка', trader: 'Прапор', markerIds: ['customs-checking'], objectives: ['Найти ключ от бензовоза', 'Забрать бронзовые часы'] },
  ] })
  window.__emit('overlay:position', { x: 520, y: 0, z: 470, yaw: 0, at: Date.now() - 60000 })
})
await wait(700)
const qb = await mm.locator('.ov-quest-list button').first().boundingBox().catch(() => null)
if (qb) await page.mouse.click(qb.x + qb.width / 2, qb.y + qb.height / 2)
await wait(1000)
const mapEl = await mm.locator('.ov-minimap-map').boundingBox()
await page.mouse.move(mapEl.x + mapEl.width / 2, mapEl.y + mapEl.height / 2)
for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, 120); await wait(150) }
await page.mouse.move(5, 5)
await wait(800)
await page.evaluate(() => window.show('l-black'))
// let the reveal animations of the site play only when we scroll there
await wait(1500)

const tStart = Date.now()
const marks = []
const mark = (name) => marks.push(`${((Date.now() - tStart) / 1000).toFixed(1)}s ${name}`)

// ---- timeline ----------------------------------------------------------------------------------------------
async function routeSteps() {
  const n = await app.locator('.raid-route-step').count()
  const boxes = []
  for (let i = 0; i < n; i++) { const b = await app.locator('.raid-route-step').nth(i).boundingBox().catch(() => null); if (b) boxes.push(b) }
  return boxes
}
mark('title')
await show('l-title'); await wait(2600)

mark('site hero')
await show('l-site'); await wait(1700)
await siteScrollTo(site, '.promo-intro', 1300); await wait(900)

// Chapter 1
await chapter('Глава 1', 'Перед <em>рейдом</em>', 'Квесты, карта и план на локацию'); await show('l-chapter'); mark('ch1'); await wait(1200)
await siteScrollTo(site, '#overview', 10); await show('l-site'); await wait(2200)
mark('app overview')
await show('l-app'); await caption('01', 'Квесты подтягиваются сами', 'Raid OS читает журналы EFT: принятые задания уже на «Обзоре»'); await wait(700)
for (const i of [0, 2]) { const b = await appBox(app, '.quest-row', i).catch(() => null); if (b) await moveTo(b.x + b.w * 0.5, b.y + b.h * 0.5, 450) }
await wait(800); await hideCursor(); await caption()
// map tools (prepared while the overview fades out)
await app.evaluate(() => { location.hash = '#/maps/customs' }); await wait(1100)
mark('app tools')
await caption('02', 'Рулетка и «Снайпер»', 'Дистанции в метрах игры, кольца дальности до 500 м')
const map = await appBox(app, '.leaflet-container')
const P = (fx, fy) => [map.x + map.w * fx, map.y + map.h * fy]
const rb0 = await app.getByRole('button', { name: /Рулетка/ }).first().boundingBox(); const ruler = { x: rb0.x, y: rb0.y, w: rb0.width, h: rb0.height }
await click(ruler.x + ruler.w / 2, ruler.y + ruler.h / 2, 300)
for (const [fx, fy] of [[0.16, 0.66], [0.36, 0.48], [0.50, 0.56]]) { await click(...P(fx, fy), 300); await wait(80) }
const sb0 = await app.getByRole('button', { name: /Снайпер/ }).first().boundingBox(); const sniper = { x: sb0.x, y: sb0.y, w: sb0.width, h: sb0.height }
await click(sniper.x + sniper.w / 2, sniper.y + sniper.h / 2, 300)
await click(...P(0.73, 0.30), 450)
await moveTo(...P(0.97, 0.95), 450)
await wait(700); await hideCursor(); await caption()

// Chapter 2
await chapter('Глава 2', 'В <em>рейде</em>', 'Мини-карта, маршрут и цена предмета'); await show('l-chapter'); mark('ch2')
// clean map with the raid route, while the chapter card is up
await app.evaluate(() => { location.hash = '#/maps/customs?route=1'; location.reload() }).catch(() => {})
await wait(1400)
mark('minimap')
await show('l-mm'); await caption('03', 'Мини-карта поверх игры', 'Позиция обновляется по скриншоту: координаты — в имени файла EFT'); await wait(600)
for (const [z, x, yaw] of [[476, 516, 10], [486, 510, 20], [494, 505, 30], [500, 500, 35]]) {
  await page.evaluate(([zz, xx]) => {
    document.getElementById('toast-name').textContent = `…_${xx}.42, 3.27, ${zz}.07_0.02, -0.84, 0.03, 0.54_….png`
    const t = document.getElementById('toast'); t.classList.add('on'); const f = document.getElementById('flash'); f.classList.remove('on'); void f.offsetWidth; f.classList.add('on')
  }, [z, x])
  await mm.evaluate(([zz, xx, yy]) => window.__emit('overlay:position', { x: xx, y: 0, z: zz, yaw: yy, at: Date.now() }), [z, x, yaw])
  await wait(1000)
}
await page.evaluate(() => document.getElementById('toast').classList.remove('on'))
await caption()

// route
await settleApp(app, 0)
const steps = await routeSteps()
console.log('route steps', steps.length)
if (steps.length) {
  const cx = steps.reduce((a, b) => a + b.x, 0) / steps.length, cy = steps.reduce((a, b) => a + b.y, 0) / steps.length
  await page.mouse.move(cx, cy); await page.mouse.wheel(0, -100); await wait(700)
}
mark('route')
await show('l-app'); await caption('04', 'Маршрут ①→②→③→④→⑤', 'Порядок обхода точек текущих заданий на карте')
await wait(500)
for (const b of await routeSteps()) await moveTo(b.x + b.width / 2 + 16, b.y + b.height / 2 + 16, 300)
await wait(500); await hideCursor(); await caption()

// item price overlay
mark('item')
await show('l-item'); await caption('05', 'Цена предмета прямо в рейде', 'Наведите курсор, дождитесь подсказки игры и нажмите клавишу')
// gallery for chapter 4 is prepared now, out of sight
const hot = await page.locator('.stash span.hot').boundingBox()
await moveTo(hot.x + hot.width / 2, hot.y + hot.height / 2, 600)
await page.evaluate(() => document.getElementById('keycap').classList.add('press'))
await item.evaluate(() => window.__emit('overlay:item', { state: 'loading' }))
await wait(220)
await page.evaluate(() => document.getElementById('keycap').classList.remove('press'))
await wait(380)
await item.evaluate(() => window.__emit('overlay:item', { state: 'found', itemId: 'kappa-book', name: 'Потрёпанная старинная книга', shortName: 'Книга', fleaPrice: 145200, bestTrader: { name: 'Терапевт', price: 61000 }, quests: [], kappa: true, collector: true, keep: { need: 1, remaining: 1, foundInRaid: true, kind: 'kappa', reason: '«Коллекционер»', more: 0 } }))
await caption('05', '«Каппа» и «НЕ ПРОДАВАТЬ»', 'Предмет нужен для «Коллекционера» · цены — пример')
await wait(2000)
const other = await (await page.locator('.stash span.item').all())[1].boundingBox()
await moveTo(other.x + other.width / 2, other.y + other.height / 2, 500)
await page.evaluate(() => document.getElementById('keycap').classList.add('press'))
await item.evaluate(() => window.__emit('overlay:item', { state: 'found', itemId: 'salewa', name: 'Аптечка Salewa', shortName: 'Salewa', fleaPrice: 29600, bestTrader: { name: 'Терапевт', price: 22500 }, quests: [], kappa: false, collector: false, mate: true }))
await wait(200)
await page.evaluate(() => document.getElementById('keycap').classList.remove('press'))
await caption('05', 'Метка MATE', 'Предмет нужен другу или товарищу по отряду')
await wait(1400); await hideCursor(); await caption()

// Chapter 3
await chapter('Глава 3', 'Путь к <em>Каппе</em>', 'Сюжет по этапам · PvP, PvE и Сезон отдельно'); await show('l-chapter'); mark('ch3'); await wait(1200)
await siteScrollTo(site, '#story-kappa', 10); await show('l-site'); await wait(2200)
await siteScrollTo(site, '#modes', 1200); await wait(1700)

// Chapter 4
await chapter('Глава 4', '<em>Боссы</em>', 'Где появляются и сколько держат'); await show('l-chapter'); mark('ch4'); await wait(1200)
mark('boss')
await siteScrollTo(site, '#bosses .feature-visual', 10); await show('l-site')
await caption('07', 'Здоровье по частям тела', 'Локации боссов, вооружение и 3D-модель в галерее')
await wait(2600)
await siteScrollTo(site, 'section#bosses .boss-grid', 1000); await wait(1600); await caption()

// Chapter 5
await chapter('Глава 5', 'Везде и <em>вместе</em>', 'Телефон, один аккаунт и отряд'); await show('l-chapter'); mark('ch5'); await wait(1200)
mark('phone')
await show('l-phone'); await wait(800)
const tab = await phone.locator('.mobile-tab').nth(1).boundingBox().catch(() => null)
if (tab) await click(tab.x + tab.width / 2, tab.y + tab.height / 2, 500)
await wait(900); await hideCursor()
await siteScrollTo(site, '#sync', 10); await show('l-site'); await wait(2200)
await siteScrollTo(site, '#squad', 1100); await wait(1800)

// Final
mark('final')
await siteScrollTo(site, '.promo-final', 1200); await wait(1900)
await show('l-end'); await wait(3000)
mark('end')
const duration = (Date.now() - tStart) / 1000
const lead = (tStart - tVideo) / 1000
console.log(marks.join('\n'))
console.log('lead', lead.toFixed(2), 'duration', duration.toFixed(2))
const raw = await page.video().path()
await context.close()
await browser.close()
hostServer.close()

const out = MEDIA + 'trailer.webm'
const BITRATE = process.env.BITRATE ?? '1600k'
const r = spawnSync(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', '-ss', lead.toFixed(2), '-i', raw, '-t', duration.toFixed(2),
  '-c:v', 'libvpx', '-pix_fmt', 'yuv420p', '-b:v', BITRATE, '-maxrate', '2500k', '-bufsize', '4000k', '-crf', '10', '-qmin', '4', '-qmax', '42', '-quality', 'good', '-cpu-used', '2', '-g', '75', '-an', out], { stdio: 'inherit' })
if (r.status !== 0) throw new Error('ffmpeg failed')
copyFileSync(out, SCRATCH + 'raidos-trailer.webm')
rmSync(REC, { recursive: true, force: true })
console.log('webm', (statSync(out).size / 1048576).toFixed(2), 'MB', readdirSync(REC))
