// App Store screenshots of the iPhone app (docs/app-store/README.md): the real renderer in Chromium, made to run as the
// iPhone app (Capacitor's platform is 'ios', so isIosApp() is true: no prices, payments or subscription words, the phone
// layout in both orientations), at the exact pixel sizes App Store Connect takes:
//
//   6.3"  iPhone with Dynamic Island (medium) — required   402 × 874 pt @3 → 1206 × 2622 (landscape 2622 × 1206)
//   6.9"  iPhone with Dynamic Island (large)               440 × 956 pt @3 → 1320 × 2868 (landscape 2868 × 1320)
//   6.5"  iPhone with Face ID (large)                      414 × 896 pt @3 → 1242 × 2688 (landscape 2688 × 1242)
//
//   VITE_APP_STORE=1 npx vite --port 5231 --strictPort --host 127.0.0.1     # 1. the renderer as the App Store build
//   node scripts/app-store/capture.mjs [--locale=ru,en] [--device=6.3,6.9,6.5] [--orient=portrait,landscape] [--only=maps,quests]
//
// → docs/app-store/screenshots/raw/<locale>/<device>-<orient>/NN-<screen>.png (clean screens; frame.mjs adds captions).
//
// The profile is made up (PvP level 28, «Оператор», real task ids of the live catalog); no account is signed in, so no
// e-mail or player nickname is on any picture. The catalog, items and their pictures are the live data the app shows,
// fetched once and cached in scripts/app-store/.cache/ (git-ignored), so a re-run is offline. Requests to raidos.app are
// GET only (public data); the owner's server notice is dropped from its answer so no notice covers a screen. Map
// drawings: Customs is the owner's own render (scripts/trailer/ownMap.mjs, as in the site's trailers); any other map
// drawing is a neutral grid (tarkov.dev's maps are CC BY-NC-SA, not for an advert).
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '../../node_modules/playwright/index.mjs'
import * as ownMap from '../trailer/ownMap.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const BASE = process.env.APPSTORE_BASE ?? 'http://127.0.0.1:5231/'
const OUT = process.env.APPSTORE_OUT ?? join(here, '..', '..', 'docs', 'app-store', 'screenshots', 'raw')
const CACHE = join(here, '.cache')
const DEBUG = process.env.APPSTORE_DEBUG === '1'

const arg = (name, fallback) => (process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback).split(',').filter(Boolean)
const LOCALES = arg('locale', 'ru,en')
const DEVICE_IDS = arg('device', '6.3,6.9,6.5')
const ORIENTS = arg('orient', 'portrait,landscape')
const ONLY = arg('only', '')

/** Points and safe areas of each class (iPhone 17 Pro, 17 Pro Max, 11 Pro Max); every screenshot is @3x. */
const DEVICES = {
  '6.3': { w: 402, h: 874, top: 62, side: 62 },
  '6.9': { w: 440, h: 956, top: 62, side: 62 },
  '6.5': { w: 414, h: 896, top: 44, side: 44 },
}

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS' }
const MAP_GRID = (() => {
  const lines = []
  for (let i = 0; i <= 1000; i += 10) {
    const major = i % 50 === 0
    lines.push(`<path d="M${i} 0V1000M0 ${i}H1000" stroke="${major ? '#33473a' : '#1d2b22'}" stroke-width="${major ? 1.4 : 1}" vector-effect="non-scaling-stroke"/>`)
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000" viewBox="0 0 1000 1000"><rect width="1000" height="1000" fill="#111a15"/>${lines.join('')}</svg>`
})()
/** Map drawings that are not the owner's Customs render: tarkov.dev's tiles and SVG schemes (direct or mirrored). */
const MAP_DRAWING = /(assets\.tarkov\.dev\/maps\/|raidos\.app\/v1\/map-tiles\/(?!maps\.json))/

// ---- network: read-only, cached ----------------------------------------------------------------------------------
mkdirSync(CACHE, { recursive: true })
const cacheFile = (method, url, body) => join(CACHE, createHash('sha1').update(`${method} ${url}\n${body ?? ''}`).digest('hex'))
function readCache(file) {
  if (!existsSync(file)) return null
  const meta = JSON.parse(readFileSync(`${file}.json`, 'utf8'))
  return { ...meta, body: readFileSync(file) }
}
function writeCache(file, entry) {
  writeFileSync(file, entry.body)
  writeFileSync(`${file}.json`, JSON.stringify({ status: entry.status, contentType: entry.contentType }))
}
async function cachedGet(url) {
  const file = cacheFile('GET', url)
  const hit = readCache(file)
  if (hit) return hit.body
  const response = await fetch(url, { signal: AbortSignal.timeout(90_000) })
  const body = Buffer.from(await response.arrayBuffer())
  if (response.ok) writeCache(file, { status: response.status, contentType: response.headers.get('content-type') ?? 'application/octet-stream', body })
  return body
}

/** What the server answers that should not reach a screenshot: the owner's notice (its switches and blocks stay). */
function cleanAnswer(url, entry) {
  if (/raidos\.app\/v1\/announcement/.test(url) && /json/.test(entry.contentType)) {
    try {
      const json = JSON.parse(entry.body.toString('utf8'))
      if (json && typeof json === 'object') json.announcement = null
      return { ...entry, body: Buffer.from(JSON.stringify(json)) }
    } catch { return entry }
  }
  return entry
}

async function answer(route) {
  const request = route.request()
  const url = request.url()
  const method = request.method()
  if (url.startsWith(BASE) || url.startsWith('data:') || url.startsWith('blob:')) return route.continue()
  if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
  if (DEBUG && /map|tile|customs/i.test(url)) console.log('map?', url.slice(0, 140))
  const tile = ownMap.customsTileOf(url)
  if (tile) return route.fulfill({ status: 200, contentType: 'image/png', body: await ownMap.ownCustomsTile(...tile), headers: CORS })
  if (MAP_DRAWING.test(url)) return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: MAP_GRID, headers: CORS })
  // «Обновление»: the owner's release text would open its window over the first screen.
  if (/raidos\.app\/v1\/player-news/.test(url)) return route.fulfill({ status: 404, contentType: 'application/json', body: '{}', headers: CORS })
  const readOnlyPost = method === 'POST' && /^https:\/\/api\.tarkov\.dev\/graphql/.test(url)
  if (method !== 'GET' && !readOnlyPost) {
    if (DEBUG) console.log('refused', method, url.slice(0, 120))
    return route.fulfill({ status: 503, contentType: 'application/json', body: '{}', headers: CORS })
  }
  // A long poll (`?since=`) waits on the server; answering it from the cache at once would spin the app's loop.
  if (/[?&]since=/.test(url)) {
    await new Promise((resolve) => setTimeout(resolve, 20_000))
    return route.fulfill({ status: 204, headers: CORS }).catch(() => {})
  }
  const body = readOnlyPost ? request.postData() ?? '' : undefined
  const file = cacheFile(method, url, body)
  let entry = readCache(file)
  if (!entry) {
    try {
      const response = await route.fetch({ timeout: 90_000 })
      entry = { status: response.status(), contentType: response.headers()['content-type'] ?? 'application/octet-stream', body: await response.body() }
      if (entry.status < 400) writeCache(file, entry)
    } catch (error) {
      if (DEBUG) console.log('failed', url.slice(0, 120), String(error).slice(0, 80))
      return route.fulfill({ status: 504, contentType: 'text/plain', body: '', headers: CORS }).catch(() => {})
    }
  }
  entry = cleanAnswer(url, entry)
  return route.fulfill({ status: entry.status, contentType: entry.contentType, body: entry.body, headers: CORS }).catch(() => {})
}

// ---- the made-up profile -----------------------------------------------------------------------------------------
const liveTasks = async () => new Map(Object.values(JSON.parse((await cachedGet('https://json.tarkov.dev/regular/tasks')).toString()).data.tasks).map((task) => [task.normalizedName, task]))
/** PvP level 28: the early chains done, Customs quests and Gunsmith (M4A1) taken. Real task ids, so every page shows real data. */
async function profilePlan() {
  const tasks = await liveTasks()
  const id = (name) => (tasks.get(name) ?? tasks.get(`${name}-usec`) ?? tasks.get(`${name}-bear`))?.id
  const active = ['operation-aquarius-part-1', 'operation-aquarius', 'golden-swag', 'the-extortionist', 'chemical-part-1', 'gunsmith-m4a1', 'shootout-picnic', 'the-survivalist-path-unprotected-but-dangerous'].map(id).filter(Boolean)
  const done = ['debut', 'delivery-from-the-past', 'bad-rep-evidence', 'background-check', 'shaking-up-the-teller', 'pharmacist', 'checking', 'search-mission', 'introduction', 'supplier', 'acquaintance', 'shortage', 'sanitary-standards-part-1', 'painkiller',
    'gunsmith-part-1', 'gunsmith-mp-133', 'gunsmith-aks-74u', 'gunsmith-hk-mp5', 'gunsmith-model-870', 'gunsmith-aks-74n', 'gunsmith-ak-105', 'gunsmith-mpx',
    'gunsmith-op-sks', 'gunsmith-p226r', 'gunsmith-vector-9x19'].map(id).filter(Boolean)
  // «Коллекционер»: 17 of its 44 items found
  const collector = tasks.get('collector')?.objectives?.flatMap((objective) => objective.items ?? []) ?? []
  return { level: 28, active: [...new Set(active)], done: [...new Set(done)], tracked: active.slice(0, 3), collected: [...new Set(collector)].filter((_, i) => i % 5 !== 1 && i % 5 !== 3).slice(0, 17) }
}
const SEED = (plan, locale) => `(() => {
  try {
    const raw = localStorage.getItem('tarkov-operations-profiles-v2')
    if (!raw) return false
    const state = JSON.parse(raw)
    const p = state.profiles[0]
    if (p.__appStore) return false
    p.__appStore = true
    p.name = ${JSON.stringify(locale === 'en' ? 'Operator' : 'Оператор')}
    const plan = ${JSON.stringify(plan)}
    const now = new Date().toISOString()
    const m = p.modes.pvp
    m.playerLevel = plan.level
    const rec = (taskId, status) => ({ taskId, status, source: 'eft-log', updatedAt: now })
    m.taskProgress = {}
    for (const id of plan.done) m.taskProgress[id] = rec(id, 'completed')
    for (const id of plan.active) m.taskProgress[id] = rec(id, 'active')
    m.trackedTaskIds = plan.tracked
    localStorage.setItem('tarkov-operations-profiles-v2', JSON.stringify(state))
    localStorage.setItem('tarkov-collector-items-v1:pvp', JSON.stringify(plan.collected))
    return true
  } catch (e) { console.warn(e); return false }
})()`

// ---- the iPhone around the page ----------------------------------------------------------------------------------
/** iOS status bar (portrait only: iOS hides it in landscape on Face ID iPhones), drawn in the top safe area. */
const STATUS_BAR = (top) => `(() => {
  const old = document.getElementById('appstore-status'); if (old) old.remove()
  const bar = document.createElement('div')
  bar.id = 'appstore-status'
  bar.setAttribute('aria-hidden', 'true')
  bar.style.cssText = 'position:fixed;left:0;right:0;top:0;height:${top}px;z-index:2147483647;pointer-events:none;display:flex;align-items:center;justify-content:space-between;padding:${top > 50 ? 4 : 2}px 30px 0 46px;box-sizing:border-box;color:#fff;font:600 17px/1 -apple-system,"SF Pro Text","Segoe UI",system-ui,sans-serif;letter-spacing:-.2px'
  bar.innerHTML = '<span>9:41</span><span style="display:flex;gap:7px;align-items:center">'
    + '<svg width="19" height="12" viewBox="0 0 19 12"><rect x="0" y="8" width="3.2" height="4" rx=".7" fill="#fff"/><rect x="5" y="5.5" width="3.2" height="6.5" rx=".7" fill="#fff"/><rect x="10" y="3" width="3.2" height="9" rx=".7" fill="#fff"/><rect x="15" y="0" width="3.2" height="12" rx=".7" fill="#fff"/></svg>'
    + '<svg width="17" height="12" viewBox="0 0 17 12"><path d="M8.5 2.3c2.4 0 4.6.9 6.3 2.5l1.2-1.2C14 1.6 11.4.5 8.5.5S3 1.6 1 3.6l1.2 1.2c1.7-1.6 3.9-2.5 6.3-2.5zm0 3.4c1.5 0 2.9.6 3.9 1.5l1.2-1.2C12.3 4.8 10.5 4 8.5 4S4.7 4.8 3.4 6l1.2 1.2c1-.9 2.4-1.5 3.9-1.5zm0 3.4c.6 0 1.2.2 1.6.6L8.5 11.3 6.9 9.7c.4-.4 1-.6 1.6-.6z" fill="#fff"/></svg>'
    + '<svg width="27" height="13" viewBox="0 0 27 13"><rect x=".5" y=".5" width="23" height="12" rx="3.5" fill="none" stroke="#fff" stroke-opacity=".4"/><rect x="2" y="2" width="20" height="9" rx="2" fill="#fff"/><path d="M25 4.5v4c.8-.3 1.3-1.1 1.3-2s-.5-1.7-1.3-2z" fill="#fff" fill-opacity=".45"/></svg>'
    + '</span>'
  document.documentElement.appendChild(bar)
})()`

// The far-out tiles of the owner's render are cut from one big picture: build it before any tile is asked for.
await ownMap.fullAt3()
const browser = await chromium.launch({ args: ['--force-color-profile=srgb', '--enable-unsafe-swiftshader'] })

async function newPage({ device, orient, locale }) {
  const d = DEVICES[device]
  const portrait = orient === 'portrait'
  const viewport = portrait ? { width: d.w, height: d.h } : { width: d.h, height: d.w }
  const insets = portrait ? { top: d.top, bottom: 34, left: 0, right: 0 } : { top: 0, bottom: 21, left: d.side, right: d.side }
  const context = await browser.newContext({
    viewport, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: locale === 'en' ? 'en-US' : 'ru-RU', reducedMotion: 'reduce',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  })
  await context.route('**/*', answer)
  await context.addInitScript(([locale, insets]) => {
    // The iPhone app: Capacitor reports 'ios' and uses the plugins' web code (src/platform.ts isIosApp()).
    window.CapacitorCustomPlatform = { name: 'ios', plugins: {} }
    const style = () => {
      const root = document.documentElement
      for (const [side, px] of Object.entries(insets)) root.style.setProperty(`--safe-area-inset-${side}`, `${px}px`)
    }
    if (document.documentElement) style(); else document.addEventListener('DOMContentLoaded', style)
    try {
      sessionStorage.setItem('tarkov-account-gate-skipped', '1')
      if (!localStorage.getItem('appstore-seeded')) {
        localStorage.setItem('appstore-seeded', '1')
        localStorage.setItem('tarkov-app-theme', 'tarkov')
        localStorage.setItem('tarkov-operations-locale-v1', locale)
        localStorage.setItem('tarkov-operations-state-v1', JSON.stringify({ raidMode: 'pvp' }))
        localStorage.setItem('tarkov-map-view', 'satellite')
        localStorage.setItem('tarkov-map-marker-style', 'modern')
        localStorage.setItem('tarkov-operations-ui-v2', JSON.stringify({ selectedMapId: 'customs', hiddenMarkerTypes: [], hiddenMarkerLayers: ['key', 'spawn', 'loot.valuable', 'loot.weapon', 'loot.medical', 'loot.provision', 'loot.technical', 'loot.container', 'loot.documents'] }))
        localStorage.setItem('toc.cookie-notice', '1')
        localStorage.setItem('raidos-scourge-event-v1', 'seen')
        for (const key of ['raidos-raid-loadout-tip-v1', 'raidos-quest-sync-tip-v1']) localStorage.setItem(key, new Date().toISOString())
      }
    } catch { /* storage blocked */ }
  }, [locale, insets])
  const page = await context.newPage()
  // A day after the Halloween look ends (src/theme/halloween.ts, curatedQuests HALLOWEEN_2026_END): the store shows the
  // app's everyday look. The clock runs on from there.
  await page.clock.install({ time: new Date(process.env.APPSTORE_TIME ?? '2026-11-13T06:41:00Z') })
  await page.clock.resume()
  page.on('pageerror', (e) => console.log('pageerror', e.message))
  if (DEBUG) page.on('console', (m) => { if (/error|warn/.test(m.type()) && !/CORS|Failed to load|GL Driver/.test(m.text())) console.log('console', m.type(), m.text().slice(0, 400)) })
  return { context, page, insets, portrait }
}

async function settle(page, ms = 1200) {
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {})
  await page.waitForFunction(() => !/Загружаем актуальную базу|Loading current database/.test(document.body.innerText), null, { timeout: 120_000 }).catch(() => console.log('  catalog still loading'))
  await page.waitForTimeout(ms)
}
async function go(page, hash, ms = 2500) {
  await page.evaluate((h) => { location.hash = h }, hash)
  await settle(page, ms)
  await page.evaluate(() => window.scrollTo(0, 0))
}

/**
 * Scrolls the page so the first visible text matching `pattern` stands right under the top bar; `inside`: the scrolling
 * box it is in (a sheet) instead of the page.
 */
async function scrollToText(page, pattern, gap = 10, inside = false) {
  const found = await page.evaluate(([source, gap, inside]) => {
    const re = new RegExp(source, 'i')
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    let el = null
    while (walker.nextNode()) {
      const parent = walker.currentNode.parentElement
      if (parent && re.test(walker.currentNode.textContent ?? '') && parent.getClientRects().length && !parent.closest('nav, #appstore-status')) { el = parent; break }
    }
    if (!el) return false
    if (inside) {
      let box = el.parentElement
      while (box && !(box.scrollHeight > box.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(box).overflowY))) box = box.parentElement
      if (box) { box.scrollTop += el.getBoundingClientRect().top - box.getBoundingClientRect().top - gap; return true }
    }
    const bars =[...document.querySelectorAll('body *')].filter((node) => {
      if (node.id === 'appstore-status') return false
      const style = getComputedStyle(node)
      if (style.position !== 'fixed' && style.position !== 'sticky') return false
      const box = node.getBoundingClientRect()
      return box.top <= 5 && box.height > 0 && box.height < innerHeight / 3
    })
    const top = Math.max(0, ...bars.map((node) => node.getBoundingClientRect().bottom))
    window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - top - gap)
    return true
  }, [pattern.source, gap, inside])
  if (!found) console.log(`  no text ${pattern}`)
  await page.waitForTimeout(900)
  return found
}
async function tapText(page, pattern) {
  const target = page.getByText(pattern).first()
  if (!(await target.count())) { console.log(`  nothing to tap: ${pattern}`); return false }
  await target.scrollIntoViewIfNeeded().catch(() => {})
  await target.click().catch((error) => console.log(`  tap failed ${pattern}: ${String(error).slice(0, 80)}`))
  await page.waitForTimeout(2500)
  return true
}

async function tilesLoaded(page) {
  await page.waitForFunction(() => [...document.querySelectorAll('img.leaflet-tile')].every((img) => img.complete && img.naturalWidth > 0), null, { timeout: 60_000 }).catch(() => console.log('  map tiles still loading'))
  await page.waitForTimeout(1200)
}

/** The screens, in the order of the store listing. `run` gets the page on its route and leaves it as it is shot. */
const SCREENS = [
  // «План рейда»: the map, what to take (keys, items to plant) and the quests on it.
  { name: 'overview', hash: '#/', run: (page) => scrollToText(page, /^(План рейда|Raid plan)/) },
  // A quest's card: objectives, where on the map, what to take, rewards.
  { name: 'quests', hash: '#/quests', run: async (page) => {
    await tapText(page, /^(Золотые понты|Golden Swag)$/)
    // past the trader's story (the game's own text) to the objectives and the photos of the places
    await scrollToText(page, /^(Цели|Objectives)$/, 16, true)
  } },
  // Customs with the quest points, exits, bosses and danger zones; in landscape the map takes the whole screen.
  { name: 'maps', hash: '#/maps/customs', ms: 6000, landscape: true, run: async (page, { portrait }) => {
    if (!portrait) { await page.locator('.phone-map-fullscreen').first().click().catch(() => console.log('  no fullscreen button')); await page.waitForTimeout(1500) }
    const zoomIn = page.locator('.leaflet-control-zoom-in').first()
    for (let i = 0; i < Number(process.env.APPSTORE_MAP_ZOOM ?? 1); i += 1) { await zoomIn.click().catch(() => {}); await page.waitForTimeout(700) }
    await tilesLoaded(page)
  } },
  // The current part (M4A1): the build, its stats and every part with its picture.
  { name: 'gunsmith', hash: '#/gunsmith', ms: 6000, landscape: true, run: (page) => scrollToText(page, /Colt M4A1 5\.56x45/) },
  // An item's card: prices, traders, the quests and hideout modules that need it.
  { name: 'flea', hash: '#/flea', ms: 4000, run: async (page, { locale }) => {
    const search = page.getByPlaceholder(/Найти предмет|Find an item|Search/i).first()
    if (await search.count()) { await search.fill(locale === 'en' ? 'Graphics card' : 'Видеокарта'); await page.waitForTimeout(2500) }
    await tapText(page, locale === 'en' ? /^Graphics card$/ : /^Видеокарта$/)
  } },
  // Bosses as 3D models with their health.
  { name: 'bosses', hash: '#/gallery', ms: 4000, landscape: true },
  // Penetration and damage of every round (the page's subtitle is not translated into English yet: scrolled past it).
  { name: 'ballistics', hash: '#/ballistics', ms: 4000, landscape: true, run: (page) => scrollToText(page, /^(Пробитие и урон|Penetration and damage)$/) },
  // «Коллекционер»: 17 of 44 found (the subtitle and the photo button are not fully in English yet: scrolled past them).
  { name: 'kappa', hash: '#/kappa-items', ms: 3000, run: (page) => scrollToText(page, /^(предметов собрано|items collected)$/, 70) },
  // «Что собрать для квестов»: Russian only — the English page opens empty in this build (reported in docs/app-store).
  { name: 'hideout', hash: '#/hideout/quests', ms: 6000, locales: ['ru'] },
]
// The overview's raid plan reads well across too.
SCREENS[0].landscape = true

const plan = await profilePlan()
console.log(`profile: level ${plan.level}, ${plan.active.length} active, ${plan.done.length} done`)
for (const locale of LOCALES) {
  for (const device of DEVICE_IDS) {
    for (const orient of ORIENTS) {
      const dir = join(OUT, locale, `${device}-${orient}`)
      mkdirSync(dir, { recursive: true })
      const { context, page, insets, portrait } = await newPage({ device, orient, locale })
      await page.goto(BASE + '#/')
      await settle(page, 800)
      if (await page.evaluate(SEED(plan, locale))) { await page.reload(); await settle(page, 2000) }
      let n = 0
      for (const screen of SCREENS) {
        if (screen.locales && !screen.locales.includes(locale)) continue
        // Landscape leaves little room under the top bar: only the screens that read well across.
        if (!portrait && !screen.landscape) continue
        n += 1
        if (ONLY.length && !ONLY.includes(screen.name)) continue
        await go(page, screen.hash, screen.ms)
        if (screen.run) await screen.run(page, { locale, portrait })
        // no finger left on a card (a hover tooltip)
        await page.mouse.move(2, 2)
        await page.waitForTimeout(400)
        if (portrait) await page.evaluate(STATUS_BAR(insets.top))
        else await page.evaluate(() => document.getElementById('appstore-status')?.remove())
        const file = join(dir, `${String(n).padStart(2, '0')}-${screen.name}.png`)
        await page.screenshot({ path: file })
        if (DEBUG) writeFileSync(file.replace(/\.png$/, '.txt'), await page.evaluate(() => `${location.hash}\n${(document.querySelector('main')?.innerHTML ?? '').slice(0, 1500)}\n${document.body.innerText}`))
        console.log(`${locale} ${device} ${orient} ${screen.name}`)
      }
      await context.close()
    }
  }
}
await browser.close()
