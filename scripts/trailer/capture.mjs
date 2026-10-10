// Step 1 of the trailer: open the renderer (and the website) in Chromium and save crisp 1920x1080 @2x stills into
// scripts/trailer/shots/. No mouse walkthrough is recorded: every still is one clean frame that trailer.html then
// animates with a Ken Burns move. Needs the renderer on :5210 (`npx vite --port 5210`) and the website on :5672
// (`npx vite --config website/vite.config.ts --port 5672`).
//
//   node scripts/trailer/capture.mjs [name ...]     all shots, or only the named groups:
//   app stash item modes themes squad bossstill boss3d bosshp ballistics flea minimap update phone live site qr
//
// The owner's own screenshots (overview, the stash, the Collector page; chat 10.10.2026) live in scripts/trailer/owner/
// and are used as they are; `stash` cuts the item icons for the «Цена в рейде» scene out of owner/stash.webp (the same
// items the owner marked).
//
// External hosts (tarkov.dev, assets.tarkov.dev) are answered locally: item icons become a plain dark tile (the GPU and
// LEDX get the pictures cut out of the owner's stash) and the map image a dim survey grid (tarkov.dev's maps are
// CC BY-NC-SA, non-commercial: not for an advert). The ammo for «Баллистика» comes from the
// repository's tarkov.dev fixture (src/arsenal/fixtures/ammoResponse.json, 16 real rounds). The squad shots use a
// made-up account served by a fake desktop bridge: names, ids and quests are invented for the picture.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { chromium } from '../../node_modules/playwright/index.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const BASE = process.env.TRAILER_BASE ?? 'http://127.0.0.1:5210/'
const SITE = process.env.TRAILER_SITE ?? 'http://127.0.0.1:5672/'
const OUT = join(here, 'shots')
const AMMO_FIXTURE = readFileSync(join(here, '..', '..', 'src', 'arsenal', 'fixtures', 'ammoResponse.json'), 'utf8')
mkdirSync(OUT, { recursive: true })
const only = process.argv.slice(2)
const want = (name) => !only.length || only.includes(name)

const ITEM_TILE = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2a3a30"/><stop offset="1" stop-color="#141d18"/></linearGradient></defs>
<rect width="128" height="128" rx="10" fill="url(#g)"/>
<g fill="none" stroke="#c4a665" stroke-opacity=".55" stroke-width="5" stroke-linejoin="round">
<path d="M64 26 98 44v40L64 102 30 84V44z"/><path d="M30 44l34 18 34-18M64 62v40"/></g></svg>`

const MAP_GRID = (() => {
  // thin lines that stay one pixel at any zoom (non-scaling strokes): a 10 m survey grid, a brighter line every 50 m
  const lines = []
  for (let i = 0; i <= 1000; i += 10) {
    const major = i % 50 === 0
    lines.push(`<path d="M${i} 0V1000M0 ${i}H1000" stroke="${major ? '#33473a' : '#1d2b22'}" stroke-width="${major ? 1.4 : 1}" vector-effect="non-scaling-stroke"/>`)
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000" viewBox="0 0 1000 1000">
<defs><radialGradient id="v" cx=".5" cy=".5" r=".7"><stop offset="0" stop-color="#17231c"/><stop offset="1" stop-color="#0b120e"/></radialGradient></defs>
<rect width="1000" height="1000" fill="url(#v)"/>${lines.join('')}</svg>`
})()

// Item pictures the app would load from assets.tarkov.dev, taken from the owner's stash screenshot instead (see `stash`)
const ICON_FILES = { '57347ca924597744596b4e71': 'card-icon-gpu.png', '5c0530ee86f774697952d952': 'card-icon-ledx.png' }

// Adds a «Коллекционер» quest with its collectible items to the demo dataset (the demo has none), and keys for the raid list.
const COLLECTOR_PATCH = `
;(() => {
  const icon = 'https://assets.tarkov.dev/collector-icon.webp'
  const extra = [['kappa-book', 'Потрёпанная старинная книга', 'Книга'], ['kappa-axe', 'Старинный топор', 'Топор'], ['kappa-lion', 'Бронзовая фигурка льва', 'Лев'], ['kappa-rooster', 'Золотой петух', 'Петух'], ['kappa-egg', 'Золотое яйцо', 'Яйцо'], ['kappa-raven', 'Фигурка ворона', 'Ворон'], ['kappa-firesteel', 'Старое огниво', 'Огниво'], ['kappa-teapot', 'Старинный чайник', 'Чайник'], ['kappa-vase', 'Старинная ваза', 'Ваза'], ['kappa-cat', 'Фигурка кота', 'Кот']]
  for (const [id, name, shortName] of extra) items.push({ id, name, shortName, category: 'Бартер', description: name, iconUrl: icon, questIds: ['collector'], prices: [] })
  const need = { checking: [['machinery-key', 1, 'key']], 'operation-aquarius': [['dorm-206-key', 1, 'key']], 'golden-swag': [['dorm-303-key', 1, 'key'], ['trailer-key', 1, 'key']], 'bp-depot': [['ms2000', 4, 'mark']] }
  for (const quest of demoDataset.quests) if (need[quest.id]) quest.raidRequirements = need[quest.id].map(([itemId, count, purpose]) => ({ itemId, count, purpose, mapIds: ['customs'] }))
  // Quests on other maps, so the squad's «Квесты по картам» spreads over several maps.
  for (const [id, name, trader, mapId, level] of [['tarkov-shooter-1', 'Тарковский стрелок. Часть 1', 'Егерь', 'woods', 2], ['spa-tour-1', 'Спа-тур. Часть 1', 'Миротворец', 'shoreline', 15], ['hot-delivery', 'Горячая доставка', 'Прапор', 'interchange', 11], ['delivery-from-the-past', 'Доставка из прошлого', 'Прапор', 'factory', 7]]) {
    demoDataset.quests.push({ id, name, trader, mapId, level, kappa: true, description: name, objectives: ['Выполнить задание'], rewards: [] })
  }
  // Real GPU prices on «Рынок · Избранное» (Tarkov Forge: flea 7-day average to 30.09.2026, PvP 344 000 / PvE 739 000;
  // Therapist 124 740), so each mode shows its own flea price
  const gpu = items.find((item) => item.id === 'graphics-card')
  if (gpu) gpu.prices = gpu.prices.map((price) => price.source === 'Барахолка' ? { ...price, price: price.mode === 'pve' ? 739000 : 344000 } : { ...price, source: 'Терапевт', price: 124740 })
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
      m.favoriteItemIds = ['graphics-card']
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
    { memberId: H(1), nickname: 'Operator', isYou: true, isOwner: true, activeQuestIds: ['checking', 'golden-swag', 'introduction', 'tarkov-shooter-1', 'hot-delivery'], completedCount: 3 },
    { memberId: H(2), nickname: 'Wolfhound', isYou: false, isOwner: false, activeQuestIds: ['checking', 'golden-swag', 'tarkov-shooter-1', 'spa-tour-1'], completedCount: 7 },
    { memberId: H(3), nickname: 'Nightowl_7', isYou: false, isOwner: false, activeQuestIds: ['golden-swag', 'introduction', 'delivery-from-the-past', 'spa-tour-1'], completedCount: 5 },
  ],
}
const SQUAD_BRIDGE = `(() => {
  const squad = ${JSON.stringify(SQUAD_DATA)}
  const updateState = window.__trailerUpdate ?? { state: 'idle' }
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
    update: { status: async () => updateState, onStatus: () => () => {}, install: async () => updateState },
    getVersion: async () => '0.5.4',
    getRaidState: async () => ({ inRaid: false }),
    serviceRequest: async (method, path) => {
      if (/\\/v1\\/squads\\/mine\\//.test(path)) return { squad: info, access: true, invitations: [] }
      if (/\\/v1\\/squads\\/[a-f0-9]{32}\\/overview\\//.test(path)) return { squad: info, mode: 'pvp', generatedAt: new Date().toISOString(), sharedQuests: [] }
      if (path === '/v1/friends') return { code: 'K7QM-2XWD', access: true, friends: [], incoming: [], outgoing: [], blocked: [] }
      if (/\\/v1\\/me\\/position\\//.test(path)) return { position: { x: 512, y: 0, z: 488, yaw: 40, at: Date.now() - 1500, receivedAt: new Date().toISOString(), map: 'customs' } }
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
    if (url.startsWith('https://api.tarkov.dev/graphql')) return route.fulfill({ status: 200, contentType: 'application/json', body: AMMO_FIXTURE })
    if (/^https?:\/\/([^/]+\.)?tarkov\.dev\//.test(url)) {
      if (/\/maps\//.test(url) || /\.svg(\?|$)/.test(url)) return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: MAP_GRID })
      const own = Object.entries(ICON_FILES).find(([id]) => url.includes(`/${id}-`))
      if (own) { try { return route.fulfill({ status: 200, contentType: 'image/png', body: readFileSync(join(OUT, own[1])) }) } catch { /* not cut yet */ } }
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
  }, [opts.theme ?? 'tarkov', opts.mode ?? 'pvp'])
  if (opts.bridge) await context.addInitScript(BRIDGE)
  if (opts.update) await context.addInitScript((state) => { window.__trailerUpdate = state }, opts.update)
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

// 1. Overview of the app (only a blurred title background now: the overview scene uses the owner's screenshot)
if (want('app')) {
  const { context, page } = await newPage()
  await open(page, '#/')
  await page.waitForTimeout(2500)
  await shot(page, 'dashboard')
  await context.close()
}

// 2. «Цена в рейде»: the item icons the owner marked, cut out of his stash screenshot (63 px cells, grid from 519,110)
const STASH_CELL = 63
const STASH_ICONS = {
  sneaker: [7, 6, 2, 1], gpu: [4, 2, 2, 1], ledx: [6, 2, 1, 1], cpu: [9, 3, 1, 1], chain: [0, 4, 1, 1],
  fleece: [9, 2, 2, 1], lega: [8, 0, 1, 1], greenbat: [9, 0, 1, 1], strike: [3, 2, 1, 1],
}
if (want('stash')) {
  const sharp = createRequire(import.meta.url)('sharp')
  const source = join(here, 'owner', 'stash.webp')
  for (const [name, cell] of Object.entries(STASH_ICONS)) {
    if (!cell) continue
    const [col, row, w, h] = cell
    const { data, info } = await sharp(source).extract({ left: 519 + col * STASH_CELL, top: 110 + row * STASH_CELL, width: w * STASH_CELL, height: h * STASH_CELL })
      .removeAlpha().raw().toBuffer({ resolveWithObject: true })
    // the owner's red marker line runs along the left edge of some cells: paint its pixels with the cell background
    for (let i = 0; i < data.length; i += 3) if (data[i] > 140 && data[i + 1] < 75 && data[i + 2] < 75) { data[i] = 17; data[i + 1] = 21; data[i + 2] = 21 }
    await sharp(data, { raw: info }).resize(w * STASH_CELL * 2, h * STASH_CELL * 2, { kernel: 'lanczos3' }).png().toFile(join(OUT, `icon-${name}.png`))
    // the same picture without the cell's name strip, for the item cards
    await sharp(source).extract({ left: 519 + col * STASH_CELL + 2, top: 110 + row * STASH_CELL + 15, width: w * STASH_CELL - 4, height: h * STASH_CELL - 17 })
      .resize((w * STASH_CELL - 4) * 2, (h * STASH_CELL - 17) * 2, { kernel: 'lanczos3' }).png().toFile(join(OUT, `card-icon-${name}.png`))
  }
}

// 2b. Overlay cards: the sneaker with its «Каппа» tag (also shown in the Collector scene), the GPU with the MATE tag
if (want('item')) {
  const icon = (name) => `data:image/png;base64,${readFileSync(join(OUT, `card-icon-${name}.png`)).toString('base64')}`
  for (const [name, payload] of [
    // real prices (Tarkov Forge, 10.10.2026: the sneaker live, the GPU the PvP 7-day average to 30.09.2026)
    ['overlay-sneaker', { state: 'found', itemId: 'viibiin', name: 'Кроссовки Viibiin', shortName: 'Viibiin', fleaPrice: 55908, bestTrader: { name: 'Терапевт', price: 28939 }, quests: [], kappa: true, collector: true, icon: 'sneaker' }],
    ['overlay-gpu', { state: 'found', itemId: 'graphics-card', name: 'Видеокарта', shortName: 'GPU', fleaPrice: 344000, bestTrader: { name: 'Терапевт', price: 124740 }, quests: [], kappa: false, collector: false, mate: true, icon: 'gpu' }],
  ]) {
    const { context, page } = await newPage({ bridge: true, viewport: { width: 520, height: 300 }, scale: 4 })
    await page.goto(BASE + '#/overlay/item'); await settle(page, 800)
    await transparent(page)
    const { icon: iconName, ...rest } = payload
    await page.evaluate((p) => window.__emit('overlay:item', p), { ...rest, iconUrl: icon(iconName) })
    await page.waitForTimeout(900)
    await cardShot(page, name, '.eft-card')
    await context.close()
  }
}

// 3. PvP / PvE / Season — the whole overview in each mode (each mode has its own progress)
if (want('modes')) {
  for (const [mode, name] of [['pvp', 'pvp'], ['pve', 'pve'], ['seasonal', 'season']]) {
    const { context, page } = await newPage({ mode })
    await open(page, '#/', 1800)
    await page.waitForTimeout(2200)
    await shot(page, `mode-${name}`)
    await context.close()
  }
}

// 3b. Colour schemes — the overview in every scheme, in the order the top-bar palette button cycles through them
//     (src/theme/theme.ts THEMES); the button's place is printed for the pointer in trailer.html
if (want('themes')) {
  for (const id of ['tarkov', 'blackmc', 'slate', 'telnyashka', 'gear']) {
    const { context, page } = await newPage({ theme: id })
    await open(page, '#/', 1800)
    await page.waitForTimeout(2200)
    await shot(page, `theme-${id}`)
    if (id === 'tarkov') {
      const b = await page.locator('.theme-cycle').first().boundingBox()
      console.log('theme button (1x):', b && [Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2), Math.round(b.width), Math.round(b.height)])
    }
    await context.close()
  }
}

// 4. Squad: members, «Квесты по картам», shared quests (signed-in desktop shell, invented members)
if (want('squad')) {
  const { context, page } = await newPage({ squad: true })
  await page.goto(BASE + '#/')
  await settle(page, 800)
  await page.evaluate(SEED)
  await settle(page, 1500)
  await page.evaluate(() => { location.hash = '#/squad' })
  await page.waitForTimeout(3500)
  await shot(page, 'squad')
  const board = page.locator('.squad-board').first()
  if (await board.count()) {
    await board.scrollIntoViewIfNeeded()
    await page.evaluate(() => { const el = document.querySelector('.squad-board')?.closest('.panel'); el?.scrollIntoView({ block: 'center' }) })
    await page.waitForTimeout(600)
    await shot(page, 'squad-board')
    await page.locator('.panel', { has: page.locator('.squad-board') }).first().screenshot({ path: join(OUT, 'squad-board-panel.png') })
  } else console.log('squad board not found')
  await context.close()
}

// 5. Bosses: quick stills of several bosses, then one 3D model turned a full 360° in 120 steps (no cloth physics: the
//    capture runs with reduced motion, so nothing sways or clips), and the health card with each body part lit
const BOSS_ORDER = (process.env.BOSSES ?? 'Тагилла').split(',')
const BOSS_STILLS = (process.env.BOSS_STILLS ?? 'Решала,Килла,Глухарь,Кабан').split(',')
async function bossFrames(boss, frames, file) {
  // device scale 1: software WebGL is slow, and the stage in the trailer is about 760 px tall
  const { context, page } = await newPage({ viewport: { width: 1600, height: 1000 }, scale: 1 })
  await open(page, '#/gallery', 2500)
  await page.locator('.gallery-card', { hasText: boss }).first().click()
  await page.waitForFunction(() => !document.querySelector('.gallery-viewer-status'), null, { timeout: 60000 }).catch(() => {})
  await page.waitForTimeout(2500)
  // only the model: the page behind the (portal) viewer is hidden, every background transparent
  await page.addStyleTag({ content: '#root{visibility:hidden!important}html,body,.gallery-viewer,.gallery-viewer-body,.gallery-viewer-stage,.gallery-overlay{background:transparent!important;box-shadow:none!important;border-color:transparent!important;backdrop-filter:none!important}.gallery-viewer-head,.gallery-viewer-info,.gallery-viewer-step,.gallery-viewer-actions,.gallery-viewer-hint{visibility:hidden!important}' })
  const canvas = page.locator('.gallery-viewer-stage canvas').first()
  const box = await canvas.boundingBox()
  if (!box) { console.log('no canvas for', boss); await context.close(); return }
  // the viewer turns 0.0105 rad per dragged px: 120 frames of 4.9867 px make one full turn (3° a frame)
  const stepPx = Number(process.env.BOSS_STEP_PX ?? (2 * Math.PI / 0.0105 / frames))
  const x0 = box.x + box.width / 2 - (frames * stepPx) / 2, y = box.y + box.height * 0.6
  if (frames > 1) { await page.mouse.move(x0, y); await page.mouse.down() }
  for (let f = 0; f < frames; f++) {
    if (frames > 1) { await page.mouse.move(x0 + (f + 1) * stepPx, y, { steps: 1 }); await page.waitForTimeout(60) }
    await canvas.screenshot({ path: join(OUT, file(f)), omitBackground: true })
  }
  if (frames > 1) await page.mouse.up()
  await context.close()
}
if (want('boss3d')) {
  for (const [bi, boss] of BOSS_ORDER.entries()) await bossFrames(boss, Number(process.env.BOSS_FRAMES ?? 120), (f) => `boss3d-${bi}-${String(f).padStart(2, '0')}.png`)
}
if (want('bossstill')) {
  for (const [si, boss] of BOSS_STILLS.entries()) await bossFrames(boss, 1, () => `bossstill-${si}.png`)
}
if (want('bosshp')) {
  for (const [bi, boss] of BOSS_ORDER.entries()) {
    const { context, page } = await newPage({ viewport: { width: 1600, height: 1000 }, scale: 3 })
    await open(page, '#/gallery', 2500)
    await page.locator('.gallery-card', { hasText: boss }).first().click()
    await page.waitForTimeout(2500)
    const figure = page.locator('.body-figure').first()
    await figure.scrollIntoViewIfNeeded()
    await page.mouse.move(2, 2)
    await page.waitForTimeout(400)
    await figure.screenshot({ path: join(OUT, `bosshp-${bi}-idle.png`) })
    const windows = page.locator('.body-figure-window')
    for (let part = 0; part < 7; part++) {
      await windows.nth(part).hover()
      await page.waitForTimeout(450)
      await figure.screenshot({ path: join(OUT, `bosshp-${bi}-${part}.png`) })
    }
    await context.close()
  }
}

// 6. Ballistics: penetration/damage chart and the armor table for 7.62×39 BP (fixture ammo, see the header)
if (want('ballistics')) {
  const { context, page } = await newPage()
  await open(page, '#/ballistics', 2500)
  await page.locator('.ammo-table tbody tr', { hasText: '7.62x39mm BP' }).first().click().catch(() => {})
  await page.waitForTimeout(900)
  await page.evaluate(() => { document.querySelector('.page')?.scrollIntoView(); window.scrollTo(0, 0) })
  await page.waitForTimeout(400)
  await shot(page, 'ballistics')
  await context.close()
  // the «Против брони · BP» panel at a narrower window, so its table stays compact and readable in the video
  const narrow = await newPage({ viewport: { width: 1280, height: 1000 } })
  await open(narrow.page, '#/ballistics', 2500)
  await narrow.page.locator('.ammo-table tbody tr', { hasText: '7.62x39mm BP' }).first().click().catch(() => {})
  await narrow.page.waitForTimeout(900)
  const armor = narrow.page.locator('.panel', { has: narrow.page.locator('.armor-table') }).first()
  if (await armor.count()) {
    // below the sticky top bar, with its «Против брони · BP» heading
    await armor.evaluate((el) => window.scrollBy(0, el.getBoundingClientRect().top - 110))
    await narrow.page.waitForTimeout(400)
    await armor.screenshot({ path: join(OUT, 'ballistics-armor.png') })
  }
  else console.log('armor panel not found')
  await narrow.context.close()
}

// 6b. Flea market: prices of the selected mode, the best trader
if (want('flea')) {
  const { context, page } = await newPage()
  await open(page, '#/flea', 2500)
  // no live price source in the sandbox: hide its «демо-данные» notes and the (empty) price history
  await page.addStyleTag({ content: '.import-warning,.page-header>.tag.danger,.flea-detail .price-history{display:none!important}' })
  await page.locator('.flea-item-link', { hasText: 'Видеокарта' }).first().click().catch(() => {})
  await page.waitForTimeout(1200)
  await shot(page, 'flea')
  const card = page.locator('.flea-detail').first()
  if (await card.count()) await card.screenshot({ path: join(OUT, 'flea-card.png') })
  await context.close()
}

// 7. Minimap overlay with the player's point and the active quests (neutral map grid, see the header)
if (want('minimap')) {
  const { context, page } = await newPage({ bridge: true, viewport: { width: 560, height: 900 }, scale: 3 })
  // a view the player left by hand: about 110 m across around the dorms, so the quest points near the player show
  await context.addInitScript(() => { try { localStorage.setItem('raidos.minimap.views.v1', JSON.stringify({ customs: { center: [516, 500], zoom: 2.2 } })) } catch { /* storage blocked */ } })
  await page.goto(BASE + '#/overlay/minimap'); await settle(page, 800)
  await transparent(page)
  await page.evaluate(async () => {
    const demo = await import('/src/data/demo.ts')
    const map = demo.maps.find((m) => m.id === 'customs')
    const layer = { extract: 'extract.pmc', quest: 'quest.zone', boss: 'boss', cache: 'loot.container', danger: 'hazard', key: 'key' }
    const markers = demo.markers.filter((m) => m.mapId === 'customs').map((m) => ({ id: m.id, position: m.position, layerId: layer[m.type] ?? 'landmark', title: m.title, questId: m.questId }))
    window.__emit('overlay:minimap', {
      state: 'ready', map, markers, questCount: 3, opacity: 0.94, playerMarker: 'arrow', minimapWidth: 520,
      quests: [
        { questId: 'operation-aquarius', name: 'Операция «Водолей»', trader: 'Терапевт', markerIds: ['customs-aquarius'], objectives: ['Найти спрятанную воду в общежитии', 'Выжить и выйти'] },
        { questId: 'golden-swag', name: 'Золотая добыча', trader: 'Лыжник', markerIds: ['customs-golden-swag'], objectives: ['Найти зажигалку Зиббо', 'Спрятать зажигалку в бытовке'] },
        { questId: 'checking', name: 'Проверка', trader: 'Прапор', markerIds: ['customs-checking'], objectives: ['Найти ключ от бензовоза', 'Забрать бронзовые часы'] },
      ],
    })
  })
  await page.waitForTimeout(1000)
  await page.evaluate(() => window.__emit('overlay:position', { x: 503, y: 0, z: 498, yaw: 35, at: Date.now() }))
  await page.waitForTimeout(1500)
  await cardShot(page, 'overlay-minimap', '.ov-minimap, .ov-card')
  // where the player's arrow is on the card picture (cardShot pads 12 px), for the ping ring in trailer.html
  console.log('minimap player at (card px, 1x):', await page.evaluate(() => { const c = document.querySelector('.ov-minimap').getBoundingClientRect(); const p = document.querySelector('.ov-player')?.getBoundingClientRect(); const x0 = Math.max(0, c.left - 12), y0 = Math.max(0, c.top - 12); return p && [Math.round(p.left + p.width / 2 - x0), Math.round(p.top + p.height / 2 - y0), Math.round(c.right + 12 - x0), Math.round(c.bottom + 12 - y0)] }))
  console.log('minimap markers in view:', await page.evaluate(() => [...document.querySelectorAll('.ov-marker')].filter((m) => { const r = m.getBoundingClientRect(); const c = document.querySelector('.ov-minimap-map').getBoundingClientRect(); return r.right > c.left && r.left < c.right && r.bottom > c.top && r.top < c.bottom }).length))
  await context.close()
}

// 8. Auto-update: the «Обновление до актуальной версии» window while a new build downloads
if (want('update')) {
  const { context, page } = await newPage({ squad: true, update: { state: 'downloading', progress: 64, version: '0.5.5' } })
  await open(page, '#/', 1800)
  await page.waitForTimeout(1500)
  await shot(page, 'update')
  const card = page.locator('.update-overlay-card, .update-overlay > div').first()
  if (await card.count()) await card.screenshot({ path: join(OUT, 'update-card.png') }).catch(() => {})
  await context.close()
}

// 9. Phone layout at 390 px: overview, quests and the live map with the position the PC app sent
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
if (want('live')) {
  const { context, page } = await newPage({ viewport: { width: 390, height: 844 }, scale: 3, squad: true })
  await open(page, '#/live', 2500)
  await page.waitForTimeout(4000)
  await shot(page, 'phone-live')
  await context.close()
}

// 10. Website (the same account on the site)
if (want('site')) {
  const { context, page } = await newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto(SITE); await settle(page, 2500)
  await page.addStyleTag({ content: '.trailer-overlay,.trailer-controls,.cookie-notice{display:none!important}html{scroll-behavior:auto!important}' })
  await page.waitForTimeout(500)
  await shot(page, 'site')
  await context.close()
}

// 10b. A QR code (made-up link, not a real sign-in code) as SVG
if (want('qr')) {
  const qrcode = createRequire(import.meta.url)('../../node_modules/qrcode-generator')
  const qr = qrcode(0, 'M'); qr.addData('https://raidos.app/m', 'Byte'); qr.make()
  const n = qr.getModuleCount()
  let d = ''
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + 2} ${r + 2}h1v1h-1z`
  writeFileSync(join(OUT, 'qr.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n + 4} ${n + 4}" shape-rendering="crispEdges"><rect width="${n + 4}" height="${n + 4}" fill="#fff"/><path d="${d}" fill="#0a0f0c"/></svg>`)
}

await browser.close()
console.log('shots saved to', OUT)
