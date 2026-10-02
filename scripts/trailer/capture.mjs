// Step 1 of the trailer: open the renderer (and the website) in Chromium and save crisp 1920x1080 @2x stills into
// scripts/trailer/shots/. No mouse walkthrough is recorded: every still is one clean frame that trailer.html then
// animates with a Ken Burns move. Needs the renderer on :5210 (`npx vite --port 5210`) and the website on :5672
// (`npx vite --config website/vite.config.ts --port 5672`).
//
//   node scripts/trailer/capture.mjs [name ...]     all shots, or only the named groups:
//   app tools route kappa story modes boss busts phone squad item minimap site qr
//
// External hosts (tarkov.dev, assets.tarkov.dev) are answered locally with neutral placeholders: item icons become a
// plain dark tile and the map image a dim survey grid. No game art is used. The squad shots use a made-up account
// served by a fake desktop bridge: names, ids and quests are invented for the picture.
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { chromium } from '../../node_modules/playwright/index.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const BASE = process.env.TRAILER_BASE ?? 'http://127.0.0.1:5210/'
const SITE = process.env.TRAILER_SITE ?? 'http://127.0.0.1:5672/'
const OUT = join(here, 'shots')
mkdirSync(OUT, { recursive: true })
const only = process.argv.slice(2)
const want = (name) => !only.length || only.includes(name)

const ITEM_TILE = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2a3a30"/><stop offset="1" stop-color="#141d18"/></linearGradient></defs>
<rect width="128" height="128" rx="10" fill="url(#g)"/>
<g fill="none" stroke="#c4a665" stroke-opacity=".55" stroke-width="5" stroke-linejoin="round">
<path d="M64 26 98 44v40L64 102 30 84V44z"/><path d="M30 44l34 18 34-18M64 62v40"/></g></svg>`

const MAP_GRID = (() => {
  const lines = []
  for (let i = 0; i <= 1000; i += 50) {
    const major = i % 250 === 0
    lines.push(`<path d="M${i} 0V1000M0 ${i}H1000" stroke="${major ? '#2f4236' : '#1c2921'}" stroke-width="${major ? 2 : 1}"/>`)
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000" viewBox="0 0 1000 1000">
<defs><radialGradient id="v" cx=".5" cy=".5" r=".7"><stop offset="0" stop-color="#16211b"/><stop offset="1" stop-color="#0b120e"/></radialGradient></defs>
<rect width="1000" height="1000" fill="url(#v)"/>${lines.join('')}</svg>`
})()

// Adds a «Коллекционер» quest with its collectible items to the demo dataset (the demo has none), and keys for the raid list.
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

/** Seeds a believable profile per mode (PvP, PvE and Season differ, so the three can be shown side by side). */
const SEED = `(() => {
  try {
    const now = new Date().toISOString()
    localStorage.setItem('tarkov-map-marker-style', 'modern')
    const raw = localStorage.getItem('tarkov-operations-profiles-v2')
    if (!raw) return
    const state = JSON.parse(raw)
    const p = state.profiles[0]
    if (p.__trailer2) return
    p.__trailer2 = true
    p.name = 'Оператор'
    const plan = {
      pvp: { level: 24, done: ['debut', 'shooting-cans', 'introduction'], active: ['checking', 'operation-aquarius', 'golden-swag', 'bp-depot', 'pharmacist', 'story-tour'], tracked: ['operation-aquarius', 'golden-swag', 'bp-depot'] },
      pve: { level: 41, done: ['debut', 'shooting-cans', 'introduction', 'checking', 'bp-depot', 'pharmacist'], active: ['operation-aquarius', 'golden-swag'], tracked: ['operation-aquarius'] },
      seasonal: { level: 9, done: ['debut'], active: ['shooting-cans', 'introduction'], tracked: ['shooting-cans'] },
    }
    for (const [mode, cfg] of Object.entries(plan)) {
      const m = p.modes[mode]
      if (!m) continue
      m.playerLevel = cfg.level
      const rec = (taskId, status) => ({ taskId, status, source: 'eft-log', updatedAt: now })
      m.taskProgress = {}
      for (const id of cfg.done) m.taskProgress[id] = rec(id, 'completed')
      for (const id of cfg.active) m.taskProgress[id] = rec(id, 'active')
      m.trackedTaskIds = cfg.tracked
      m.favoriteItemIds = ['graphics-card', 'ledx', 'salewa']
    }
    localStorage.setItem('tarkov-operations-profiles-v2', JSON.stringify(state))
    localStorage.setItem('tarkov-collector-items-v1:pvp', JSON.stringify(['kappa-book', 'kappa-axe', 'kappa-lion', 'kappa-egg']))
    location.reload()
  } catch (e) { console.warn(e) }
})()`

const BRIDGE = `(() => {
  const l = {}
  window.tarkovDesktop = {
    overlaySetInteractive() {}, overlayResize() {}, setOverlaySize() {}, resizeOverlay() {}, overlayDrag() {},
    experimental: { updateSettings: async () => ({}) },
    onOverlay(c, cb) { l[c] = cb; return () => {} },
  }
  window.__emit = (c, x) => l[c] && l[c](x)
})()`

// Squad page: a signed-in desktop shell with a made-up server. Everything not listed answers with null / no-ops.
const H = (n) => n.toString(16).padStart(24, '0')
const SQUAD_DATA = {
  squadId: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
  members: [
    { memberId: H(1), nickname: 'Operator', isYou: true, isOwner: true, activeQuestIds: ['checking', 'operation-aquarius', 'golden-swag', 'bp-depot', 'pharmacist'], completedCount: 3 },
    { memberId: H(2), nickname: 'Wolfhound', isYou: false, isOwner: false, activeQuestIds: ['checking', 'golden-swag', 'bp-depot'], completedCount: 7 },
    { memberId: H(3), nickname: 'Nightowl_7', isYou: false, isOwner: false, activeQuestIds: ['operation-aquarius', 'golden-swag', 'pharmacist'], completedCount: 5 },
  ],
}
const SQUAD_BRIDGE = `(() => {
  const squad = ${JSON.stringify(SQUAD_DATA)}
  const info = { id: squad.squadId, name: 'Ночной отряд', maxMembers: 5, isOwner: true, createdAt: new Date().toISOString(), members: squad.members.map((m) => ({ ...m, joinedAt: new Date().toISOString(), lastSyncAt: new Date().toISOString() })) }
  const deep = () => new Proxy(function () {}, {
    get: (_t, prop) => prop === 'then' ? undefined : (typeof prop === 'string' && prop.startsWith('on') ? () => () => {} : deep()),
    apply: () => Promise.resolve(null),
  })
  const target = {
    account: {
      status: async () => ({ signedIn: true, email: 'operator@example.com', kind: 'user', online: true, serverUrl: 'https://raidos.app', persistent: true,
        nicknames: { pvp: 'Operator' }, subscription: { status: 'active' }, entitlement: { valid: true, plan: 'paid' } }),
      websiteUrl: async () => 'https://raidos.app',
    },
    update: { status: async () => ({ state: 'idle' }), onStatus: () => () => {} },
    getVersion: async () => '0.5.4',
    getRaidState: async () => ({ inRaid: false }),
    serviceRequest: async (method, path) => {
      if (/\\/v1\\/squads\\/mine\\//.test(path)) return { squad: info, access: true, invitations: [] }
      if (/\\/v1\\/squads\\/[a-f0-9]{32}\\/overview\\//.test(path)) return { squad: info, mode: 'pvp', generatedAt: new Date().toISOString(), sharedQuests: [] }
      if (path === '/v1/friends') return { code: 'K7QM-2XWD', access: true, friends: [], incoming: [], outgoing: [], blocked: [] }
      return null
    },
  }
  window.tarkovDesktop = new Proxy(target, { get: (t, p) => (p in t ? t[p] : (p === 'then' ? undefined : typeof p === 'string' && p.startsWith('on') ? () => () => {} : deep())) })
})()`

const browser = await chromium.launch({ executablePath: process.env.TRAILER_CHROMIUM ?? '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--force-color-profile=srgb'] })

async function newPage(opts = {}) {
  const context = await browser.newContext({ viewport: opts.viewport ?? { width: 1920, height: 1080 }, deviceScaleFactor: opts.scale ?? 2, locale: 'ru-RU', reducedMotion: 'reduce' })
  await context.route('**/*', async (route) => {
    const url = route.request().url()
    if (url.startsWith(BASE)) {
      if (/\/src\/data\/demo\.ts/.test(url)) {
        const response = await route.fetch()
        return route.fulfill({ response, body: (await response.text()) + COLLECTOR_PATCH })
      }
      return route.continue()
    }
    if (url.startsWith(SITE)) return route.continue()
    if (/^https?:\/\/([^/]+\.)?tarkov\.dev\//.test(url)) {
      if (/\/maps\//.test(url) || /\.svg(\?|$)/.test(url)) return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: MAP_GRID })
      if (/\.(webp|png|jpe?g|gif)(\?|$)/.test(url)) return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: ITEM_TILE })
    }
    return route.abort()
  })
  await context.addInitScript(([theme, mode]) => {
    try {
      sessionStorage.setItem('tarkov-account-gate-skipped', '1')
      if (!localStorage.getItem('trailer-seeded')) {
        localStorage.setItem('trailer-seeded', '1')
        localStorage.setItem('tarkov-app-theme', theme)
        localStorage.setItem('tarkov-operations-locale-v1', 'ru')
        localStorage.setItem('tarkov-operations-state-v1', JSON.stringify({ raidMode: mode }))
        localStorage.setItem('tarkov-operations-ui-v2', JSON.stringify({ selectedMapId: 'customs', hiddenMarkerTypes: [], hiddenMarkerLayers: ['spawn'] }))
        localStorage.setItem('toc.cookie-notice', '1')
      }
    } catch { /* storage blocked */ }
  }, [opts.theme ?? 'blackmc', opts.mode ?? 'pvp'])
  if (opts.bridge) await context.addInitScript(BRIDGE)
  if (opts.squad) await context.addInitScript(SQUAD_BRIDGE)
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log('pageerror', e.message, (e.stack || '').split('\n').slice(1, 3).join(' | ')))
  return { context, page }
}

async function settle(page, ms = 1500) {
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.waitForFunction(() => !document.body.innerText.includes('Загружаем актуальную базу'), null, { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(ms)
}
async function open(page, hash, extra = 1800) {
  await page.goto(BASE + hash)
  await settle(page, 800)
  await page.evaluate(SEED)
  await settle(page, extra)
}
const shot = (page, name, clip) => page.screenshot({ path: join(OUT, `${name}.png`), ...(clip ? { clip } : {}) })
const transparent = (page) => page.evaluate(() => { document.documentElement.style.background = 'transparent'; document.body.style.background = 'transparent' })
const cardShot = async (page, name, selector) => {
  const b = await page.locator(selector).first().boundingBox()
  await page.screenshot({ path: join(OUT, `${name}.png`), omitBackground: true, clip: { x: Math.max(0, b.x - 12), y: Math.max(0, b.y - 12), width: b.width + 24, height: b.height + 24 } })
}

// 1. Overview (auto-synced quests, requirements for the raid)
if (want('app')) {
  const { context, page } = await newPage()
  await open(page, '#/')
  await page.waitForTimeout(2500)
  await shot(page, 'dashboard')
  await context.close()
}

// 2. Map tools: ruler + sniper
if (want('tools')) {
  const { context, page } = await newPage()
  await open(page, '#/maps/customs', 2200)
  const box = await page.locator('.leaflet-container').first().boundingBox()
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5)
  await page.getByRole('button', { name: /Рулетка/ }).first().click()
  for (const [x, y] of [[0.16, 0.66], [0.36, 0.48], [0.50, 0.56]]) { await page.mouse.click(box.x + box.width * x, box.y + box.height * y); await page.waitForTimeout(250) }
  await page.getByRole('button', { name: /Снайпер/ }).first().click()
  await page.waitForTimeout(300)
  await page.mouse.click(box.x + box.width * 0.73, box.y + box.height * 0.30)
  await page.waitForTimeout(400)
  await page.mouse.move(box.x + box.width * 0.99, box.y + box.height * 0.99)
  await page.waitForTimeout(700)
  await shot(page, 'maps-tools')
  await context.close()
}

// 3. Raid route ①→②→③→④→⑤
if (want('route')) {
  const { context, page } = await newPage()
  await open(page, '#/maps/customs?route=1', 2500)
  const box = await page.locator('.leaflet-container').first().boundingBox()
  const n = await page.locator('.raid-route-step').count()
  const boxes = []
  for (let i = 0; i < n; i++) boxes.push(await page.locator('.raid-route-step').nth(i).boundingBox())
  console.log('route steps', n)
  if (n) {
    const cx = boxes.reduce((a, b) => a + b.x, 0) / n, cy = boxes.reduce((a, b) => a + b.y, 0) / n
    await page.mouse.move(cx, cy)
    await page.mouse.wheel(0, -100); await page.waitForTimeout(1200)
  }
  await page.mouse.move(box.x + box.width * 0.99, box.y + box.height * 0.99)
  await page.waitForTimeout(600)
  await shot(page, 'route')
  await context.close()
}

// 5a. Items for the Collector (Kappa)
if (want('kappa')) {
  const { context, page } = await newPage({ squad: true })
  await open(page, '#/', 1500)
  await page.evaluate(() => { location.hash = '#/kappa-items' })
  await page.waitForTimeout(2500)
  await shot(page, 'kappa')
  await context.close()
}

// 5b. Story quests by stage
if (want('story')) {
  const { context, page } = await newPage()
  await open(page, '#/quests?filter=story', 2500)
  await shot(page, 'story')
  await context.close()
}

// 6. PvP / PvE / Season — the overview in each mode (progress differs per mode)
if (want('modes')) {
  for (const [mode, name] of [['pvp', 'pvp'], ['pve', 'pve'], ['seasonal', 'season']]) {
    const { context, page } = await newPage({ mode })
    await open(page, '#/', 1800)
    await page.waitForTimeout(2200)
    await shot(page, `mode-${name}`, { x: 250, y: 70, width: 1670, height: 270 })
    await context.close()
  }
}

// 7. Boss card: 3D viewer with HP by body part
if (want('boss')) {
  const { context, page } = await newPage()
  await open(page, '#/gallery', 2500)
  await page.locator('.gallery-card', { hasText: process.env.BOSS ?? 'Килла' }).first().click()
  await page.waitForTimeout(5000)
  await page.locator('.gallery-viewer, [role=dialog]').first().screenshot({ path: join(OUT, 'boss.png') })
  await context.close()
}

// 8. Phone layout at 390 px
if (want('phone')) {
  const { context, page } = await newPage({ viewport: { width: 390, height: 844 }, scale: 3 })
  await open(page, '#/', 2000)
  await page.waitForTimeout(1500)
  await shot(page, 'phone')
  await page.evaluate(() => { location.hash = '#/quests' })
  await page.waitForTimeout(2000)
  await shot(page, 'phone-quests')
  await context.close()
}

// 10. Squad (signed-in desktop shell, invented members)
if (want('squad')) {
  const { context, page } = await newPage({ squad: true })
  await page.goto(BASE + '#/')
  await settle(page, 800)
  await page.evaluate(SEED)
  await settle(page, 1500)
  await page.evaluate(() => { location.hash = '#/squad' })
  await page.waitForTimeout(3500)
  await shot(page, 'squad')
  await page.evaluate(() => { location.hash = '#/squad?tab=plan' })
  await page.waitForTimeout(3000)
  await shot(page, 'squad-plan')
  await context.close()
}

// 4. Overlay cards: item price + «нужен на Каппу / НЕ ПРОДАВАТЬ», and the MATE tag
if (want('item')) {
  for (const [name, payload] of [
    ['overlay-item-kappa', {
      state: 'found', itemId: 'kappa-book', name: 'Потрёпанная старинная книга', shortName: 'Книга', fleaPrice: 145200,
      bestTrader: { name: 'Терапевт', price: 61000 }, quests: [], kappa: true, collector: true,
      keep: { need: 1, remaining: 1, foundInRaid: true, kind: 'kappa', reason: '«Коллекционер»', more: 0 },
    }],
    ['overlay-item-mate', {
      state: 'found', itemId: 'salewa', name: 'Аптечка Salewa', shortName: 'Salewa', fleaPrice: 29600,
      bestTrader: { name: 'Терапевт', price: 22500 }, quests: [], kappa: false, collector: false, mate: true,
    }],
  ]) {
    const { context, page } = await newPage({ bridge: true, viewport: { width: 420, height: 260 }, scale: 4 })
    await page.goto(BASE + '#/overlay/item'); await settle(page, 800)
    await transparent(page)
    await page.evaluate((p) => window.__emit('overlay:item', p), payload)
    await page.waitForTimeout(800)
    await cardShot(page, name, '.eft-card')
    await context.close()
  }
}

// 3b. Minimap overlay with the current position and the active quests
if (want('minimap')) {
  const { context, page } = await newPage({ bridge: true, viewport: { width: 560, height: 540 }, scale: 4 })
  await page.goto(BASE + '#/overlay/minimap'); await settle(page, 800)
  await transparent(page)
  await page.evaluate(async () => {
    const demo = await import('/src/data/demo.ts')
    const map = demo.maps.find((m) => m.id === 'customs')
    const layer = { extract: 'extract.pmc', quest: 'quest.zone', boss: 'boss', cache: 'loot.container', danger: 'hazard', key: 'key' }
    const markers = demo.markers.filter((m) => m.mapId === 'customs').map((m) => ({ id: m.id, position: m.position, layerId: layer[m.type] ?? 'landmark', title: m.title, questId: m.questId }))
    window.__emit('overlay:minimap', {
      state: 'ready', map, markers, questCount: 3, opacity: 0.94, playerMarker: 'arrow',
      quests: [
        { questId: 'operation-aquarius', name: 'Операция «Водолей»', trader: 'Терапевт', markerIds: ['customs-aquarius'], objectives: ['Найти спрятанную воду в общежитии', 'Выжить и выйти'] },
        { questId: 'golden-swag', name: 'Золотая добыча', trader: 'Лыжник', markerIds: ['customs-golden-swag'], objectives: ['Найти зажигалку Зиббо', 'Спрятать зажигалку в бытовке'] },
        { questId: 'checking', name: 'Проверка', trader: 'Прапор', markerIds: ['customs-checking'], objectives: ['Найти ключ от бензовоза', 'Забрать бронзовые часы'] },
      ],
    })
  })
  await page.waitForTimeout(800)
  await page.evaluate(() => window.__emit('overlay:position', { x: 600, y: 0, z: 470, yaw: -60, at: Date.now() - 2000 }))
  await page.waitForTimeout(400)
  await page.locator('.ov-quest-list button').first().click().catch(() => {})
  await page.waitForTimeout(1500)
  const mb = await page.locator('.ov-minimap-map').boundingBox()
  await page.mouse.move(mb.x + mb.width / 2, mb.y + mb.height / 2)
  for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, 120); await page.waitForTimeout(450) }
  await page.mouse.move(0, 0)
  await page.evaluate(() => window.__emit('overlay:position', { x: 503, y: 0, z: 498, yaw: 35, at: Date.now() }))
  await page.waitForTimeout(1000)
  await cardShot(page, 'overlay-minimap', '.ov-minimap, .ov-card')
  await context.close()
}

// 9. Website (the same account on the site)
if (want('site')) {
  const { context, page } = await newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto(SITE); await settle(page, 2500)
  await page.addStyleTag({ content: '.trailer-overlay,.trailer-controls,.cookie-notice{display:none!important}html{scroll-behavior:auto!important}' })
  await page.waitForTimeout(500)
  await shot(page, 'site')
  await context.close()
}

// 9b. A QR code (made-up link, not a real sign-in code) as SVG
if (want('qr')) {
  const qrcode = createRequire(import.meta.url)('../../node_modules/qrcode-generator')
  const qr = qrcode(0, 'M'); qr.addData('https://raidos.app/m', 'Byte'); qr.make()
  const n = qr.getModuleCount()
  let d = ''
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + 2} ${r + 2}h1v1h-1z`
  writeFileSync(join(OUT, 'qr.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n + 4} ${n + 4}" shape-rendering="crispEdges"><rect width="${n + 4}" height="${n + 4}" fill="#fff"/><path d="${d}" fill="#0a0f0c"/></svg>`)
}

// 7b. Boss busts (the app's own gallery renders, already on the website) for the boss row
if (want('busts')) {
  for (const id of ['reshala', 'killa', 'tagilla', 'glukhar', 'shturman', 'sanitar', 'kaban', 'zryachiy']) {
    try { copyFileSync(join(here, '..', '..', 'website', 'src', 'assets', 'promo', `bust-${id}.webp`), join(OUT, `bust-${id}.webp`)) } catch { console.log('no bust', id) }
  }
}

await browser.close()
console.log('shots saved to', OUT)
