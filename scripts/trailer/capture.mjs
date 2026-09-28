// Step 1 of the trailer: open the renderer in Chromium, click through it and save 1920x1080 shots
// into scripts/trailer/shots/. Needs the renderer running: `npx vite --port 5210`.
//
// External hosts (tarkov.dev, assets.tarkov.dev) are answered locally with neutral placeholders so
// the shots never show broken-image glyphs: item icons become a plain dark tile and the map image a
// dim survey grid. No game art is used.
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '../../node_modules/playwright/index.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const BASE = process.env.TRAILER_BASE ?? 'http://localhost:5210/'
const OUT = join(here, 'shots')
mkdirSync(OUT, { recursive: true })

const ITEM_TILE = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2a3a30"/><stop offset="1" stop-color="#141d18"/></linearGradient></defs>
<rect width="128" height="128" rx="10" fill="url(#g)"/>
<g fill="none" stroke="#c4a665" stroke-opacity=".55" stroke-width="5" stroke-linejoin="round">
<path d="M64 26 98 44v40L64 102 30 84V44z"/><path d="M30 44l34 18 34-18M64 62v40"/></g></svg>`

// A dim, non-geographic survey grid used in place of the (blocked) map image.
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

async function stubNetwork(context) {
  await context.route(/^https?:\/\/([^/]+\.)?tarkov\.dev\//, (route) => {
    const url = route.request().url()
    if (/\/maps\//.test(url) || /\.svg(\?|$)/.test(url)) return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: MAP_GRID })
    if (/\.(webp|png|jpe?g|gif)(\?|$)/.test(url)) return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: ITEM_TILE })
    return route.abort()
  })
}

/** Seeds a believable profile: a few finished quests, a few in progress, favourites on the market. */
const SEED = `(() => {
  try {
    const now = new Date().toISOString()
    localStorage.setItem('tarkov-map-marker-style', 'modern')
    if (!localStorage.getItem('trailer-seeded')) {
      localStorage.setItem('trailer-seeded', '1')
      localStorage.setItem('tarkov-app-theme', window.__trailerTheme || 'tarkov')
    }
    const raw = localStorage.getItem('tarkov-operations-profiles-v2')
    if (!raw) return
    const state = JSON.parse(raw)
    const p = state.profiles[0]
    if (p.__trailer) return
    p.__trailer = true
    p.name = 'Оператор'
    const m = p.modes[p.selectedMode || 'pvp']
    const rec = (taskId, status) => ({ taskId, status, source: 'manual', updatedAt: now })
    for (const id of ['debut', 'shooting-cans', 'introduction']) m.taskProgress[id] = rec(id, 'completed')
    for (const id of ['checking', 'operation-aquarius', 'golden-swag', 'bp-depot', 'pharmacist']) m.taskProgress[id] = rec(id, 'active')
    m.trackedTaskIds = ['operation-aquarius', 'golden-swag', 'bp-depot']
    m.favoriteItemIds = ['graphics-card', 'ledx', 'salewa']
    localStorage.setItem('tarkov-operations-profiles-v2', JSON.stringify(state))
    location.reload()
  } catch (e) { console.warn(e) }
})()`

const BRIDGE = `(() => {
  const l = {}
  window.tarkovDesktop = {
    overlaySetInteractive() {}, overlayResize() {},
    experimental: { updateSettings: async () => ({}) },
    onOverlay(c, cb) { l[c] = cb; return () => {} },
  }
  window.__emit = (c, x) => l[c] && l[c](x)
})()`

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })

async function newPage(opts = {}) {
  const context = await browser.newContext({ viewport: opts.viewport ?? { width: 1920, height: 1080 }, deviceScaleFactor: opts.scale ?? 1, locale: 'ru-RU' })
  await stubNetwork(context)
  if (opts.theme) await context.addInitScript(`window.__trailerTheme = ${JSON.stringify(opts.theme)}`)
  if (opts.bridge) await context.addInitScript(BRIDGE)
  const page = await context.newPage()
  return { context, page }
}

async function settle(page, ms = 1500) {
  await page.waitForLoadState('networkidle').catch(() => {})
  // The first load shows a "loading database" placeholder until the demo fallback kicks in.
  await page.waitForFunction(() => !document.body.innerText.includes('Загружаем актуальную базу'), null, { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(ms)
}

async function open(page, hash) {
  await page.goto(BASE + hash)
  await settle(page, 800)
  await page.evaluate(SEED)
  await settle(page, 1500)
}

const shot = (page, name, clip) => page.screenshot({ path: join(OUT, `${name}.png`), ...(clip ? { clip } : {}) })

// ---- main app pages (default theme) -------------------------------------------------------------
{
  const { context, page } = await newPage({ scale: 2 })
  await open(page, '#/')
  await page.waitForTimeout(2500) // let the dashboard's entrance fade finish
  await shot(page, 'dashboard')

  await page.goto(BASE + '#/quests'); await settle(page, 2500)
  await shot(page, 'quests')

  await page.goto(BASE + '#/flea'); await settle(page, 2500)
  await shot(page, 'flea')

  await page.goto(BASE + '#/kappa-items'); await settle(page)
  await shot(page, 'kappa')

  await page.goto(BASE + '#/settings'); await settle(page)
  await shot(page, 'settings')

  // Maps with modern icons, then ruler and sniper tools.
  await page.goto(BASE + '#/maps/customs'); await settle(page, 2000)
  await shot(page, 'maps')
  const map = page.locator('.leaflet-container').first()
  const box = await map.boundingBox()
  if (box) {
    await page.getByRole('button', { name: /Рулетка/ }).first().click()
    const pts = [[0.22, 0.30], [0.45, 0.42], [0.62, 0.62], [0.78, 0.55]]
    for (const [x, y] of pts) { await page.mouse.click(box.x + box.width * x, box.y + box.height * y); await page.waitForTimeout(250) }
    await page.mouse.move(box.x + box.width * 0.78, box.y + box.height * 0.55)
    await page.waitForTimeout(400)
    await shot(page, 'maps-ruler')

    await page.getByRole('button', { name: /Снайпер/ }).first().click()
    await page.waitForTimeout(300)
    // An empty spot, so the click places the scope instead of opening a marker popup.
    await page.mouse.click(box.x + box.width * 0.70, box.y + box.height * 0.25)
    await page.waitForTimeout(400)
    await page.mouse.move(box.x + box.width * 0.97, box.y + box.height * 0.03)
    await page.waitForTimeout(600)
    await shot(page, 'maps-sniper')
  }
  await context.close()
}

// ---- colour themes -----------------------------------------------------------------------------
for (const theme of ['steel', 'crimson']) {
  const { context, page } = await newPage({ theme, scale: 2 })
  await open(page, '#/')
  await page.evaluate((t) => { localStorage.setItem('tarkov-app-theme', t) }, theme)
  await page.reload(); await settle(page, 4000)
  await shot(page, `theme-${theme}`)
  await context.close()
}

// ---- overlays (fake desktop bridge, transparent page, captured without background) ------------
{
  const { context, page } = await newPage({ bridge: true, viewport: { width: 360, height: 240 }, scale: 2 })
  await page.goto(BASE + '#/overlay/item'); await settle(page, 800)
  await page.evaluate(() => {
    document.documentElement.style.background = 'transparent'
    document.body.style.background = 'transparent'
  })
  await page.evaluate(() => window.__emit('overlay:item', {
    state: 'found', itemId: 'x', name: 'Потрёпанная старинная книга', shortName: 'Книга', fleaPrice: 145200,
    bestTrader: { name: 'Терапевт', price: 61000 },
    quests: [{ questId: 'q1', name: 'Коллекционер', trader: 'Скупщик', count: 1, kappa: true, purpose: 'сдать' }],
    kappa: true, collector: true,
  }))
  await page.waitForTimeout(700)
  const card = page.locator('.eft-card').first()
  const cb = await card.boundingBox()
  await page.screenshot({ path: join(OUT, 'overlay-item.png'), omitBackground: true, clip: cb ? { x: Math.max(0, cb.x - 12), y: Math.max(0, cb.y - 12), width: cb.width + 24, height: cb.height + 24 } : undefined })
  await context.close()
}
{
  const { context, page } = await newPage({ bridge: true, viewport: { width: 520, height: 640 }, scale: 2 })
  await page.goto(BASE + '#/overlay/minimap'); await settle(page, 800)
  await page.evaluate(() => {
    document.documentElement.style.background = 'transparent'
    document.body.style.background = 'transparent'
  })
  await page.evaluate(async () => {
    const demo = await import('/src/data/demo.ts')
    const map = demo.maps.find((m) => m.id === 'customs')
    const layer = { extract: 'extract.pmc', quest: 'quest.zone', boss: 'boss', cache: 'loot.container', danger: 'hazard', key: 'key' }
    const markers = demo.markers.filter((m) => m.mapId === 'customs').map((m) => ({
      id: m.id, position: m.position, layerId: layer[m.type] ?? 'landmark', title: m.title, questId: m.questId,
    }))
    window.__emit('overlay:minimap', {
      state: 'ready', map, markers, questCount: 3, opacity: 0.92, playerMarker: 'arrow',
      quests: [
        { questId: 'operation-aquarius', name: 'Операция «Водолей»', trader: 'Терапевт', markerIds: ['customs-aquarius'] },
        { questId: 'golden-swag', name: 'Золотая добыча', trader: 'Лыжник', markerIds: ['customs-golden-swag'] },
        { questId: 'checking', name: 'Проверка', trader: 'Прапор', markerIds: ['customs-checking'] },
      ],
    })
    window.__emit('overlay:position', { x: 480, y: 0, z: 560, yaw: 40, at: Date.now() })
  })
  await page.waitForTimeout(1500)
  const root = page.locator('.ov-minimap, .ov-card').first()
  const rb = await root.boundingBox()
  await page.screenshot({ path: join(OUT, 'overlay-minimap.png'), omitBackground: true, clip: rb ? { x: Math.max(0, rb.x - 12), y: Math.max(0, rb.y - 12), width: rb.width + 24, height: rb.height + 24 } : undefined })
  await context.close()
}

await browser.close()
console.log('shots saved to', OUT)
