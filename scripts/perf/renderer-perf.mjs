#!/usr/bin/env node
/**
 * What the app's main window costs the game while it sits behind it (owner, 14.10.2026: «проведи тесты еще раз по
 * оптимизации, что бы не было лагов фризов и зависаний в игре при использовании приложения»).
 *
 * The renderer runs from a Vite dev server (`npx vite --port 5311 --strictPort --host 127.0.0.1`) in Chromium, with a stub
 * of the desktop bridge shaped like the players' app (catalog through the server gateway, encrypted cache, «Мини Карта»
 * status, raid state). Each page is measured twice:
 *   - focused: the player uses the app;
 *   - blurred: the game is in front. The window stays visible and unthrottled, as Electron's main window with
 *     `backgroundThrottling: false`: only `document.hasFocus()` turns false and `blur` fires, which is all the page sees.
 * Per state: requestAnimationFrame callbacks/s, timer callbacks/s, long tasks, main-thread CPU (CDP Performance.getMetrics
 * TaskDuration / ScriptDuration), endless CSS animations, and the bridge calls (status polls, catalog requests, cache
 * writes). The «catalog» scenario counts catalog refreshes while blurred; «refresh» measures one refresh of the catalog.
 *
 *   node scripts/perf/renderer-perf.mjs --url http://127.0.0.1:5311 --catalog catalog-pvp.json [--seconds 30]
 *     [--pages overview,maps,quests,gallery,minimap] [--scenarios pages,catalog,refresh] [--catalog-seconds 150]
 *     [--chromium /path/to/chrome] [--json results.json] [--sites]
 *
 * `--catalog`: a catalog as the server sends it (GET /v1/catalog/pvp), e.g. written by
 * `JSON.stringify(await fetchLiveCatalog('pvp', 'ru'))` (src/data/catalogSource.ts). Without it the app runs on its demo data.
 * Nothing here runs Windows or the game: the numbers compare builds, they are not the game's frame times.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'

const args = parseArgs(process.argv.slice(2))
const BASE = String(args.url ?? 'http://127.0.0.1:5311').replace(/\/+$/, '')
const SECONDS = Number(args.seconds ?? 30)
const CATALOG_SECONDS = Number(args['catalog-seconds'] ?? 150)
const PAGES = String(args.pages ?? 'overview,maps,quests,gallery,minimap').split(',').filter(Boolean)
const SCENARIOS = String(args.scenarios ?? 'pages,catalog,refresh').split(',').filter(Boolean)
const CATALOG = args.catalog ? readFileSync(String(args.catalog)) : null
const TDEV = args.tdev ? String(args.tdev) : ''
const SITES = Boolean(args.sites)

const ROUTES = {
  overview: '/',
  maps: '/maps/customs',
  quests: '/quests',
  gallery: '/gallery',
  minimap: '/experimental',
}

function parseArgs(list) {
  const out = {}
  for (let i = 0; i < list.length; i += 1) {
    const key = list[i]
    if (!key.startsWith('--')) continue
    const next = list[i + 1]
    if (next === undefined || next.startsWith('--')) out[key.slice(2)] = true
    else { out[key.slice(2)] = next; i += 1 }
  }
  return out
}

function chromiumPath() {
  if (args.chromium) return String(args.chromium)
  if (process.env.PERF_CHROMIUM) return process.env.PERF_CHROMIUM
  // The sandbox has Playwright's Chromium under /opt/pw-browsers (a revision that may differ from the installed package).
  const root = '/opt/pw-browsers'
  if (existsSync(root)) {
    for (const dir of readdirSync(root).filter((name) => /^chromium-\d+$/.test(name)).sort().reverse()) {
      const candidate = join(root, dir, 'chrome-linux', 'chrome')
      if (existsSync(candidate)) return candidate
    }
  }
  return undefined
}

/**
 * Runs in the page before the app (addInitScript): counts timer and frame callbacks and long tasks, records the calls the
 * page makes to the desktop bridge, and provides that bridge.
 */
function pageSetup(options) {
  const perf = {
    raf: 0, timeout: 0, interval: 0, longTasks: 0, longTaskMs: 0,
    calls: {}, cacheWrites: 0, cacheBytes: 0,
    sites: options.sites ? {} : null,
    catalogVersion: 'a'.repeat(40),
  }
  window.__perf = perf
  const count = (key) => { perf.calls[key] = (perf.calls[key] ?? 0) + 1 }
  const site = (kind) => {
    if (!perf.sites) return ''
    const line = (new Error().stack ?? '').split('\n').slice(3).find((entry) => !entry.includes('__perf')) ?? ''
    return `${kind} ${line.trim().replace(/^at /, '').replace(/https?:\/\/[^/]+\//, '').replace(/\?[^:)]*/, '')}`
  }
  const tick = (key) => { if (perf.sites && key) perf.sites[key] = (perf.sites[key] ?? 0) + 1 }

  const nativeRaf = window.requestAnimationFrame.bind(window)
  window.requestAnimationFrame = (callback) => {
    const key = site('raf')
    return nativeRaf((time) => { perf.raf += 1; tick(key); callback(time) })
  }
  const nativeTimeout = window.setTimeout.bind(window)
  window.setTimeout = (callback, ms, ...rest) => {
    if (typeof callback !== 'function') return nativeTimeout(callback, ms, ...rest)
    const key = site('timeout')
    return nativeTimeout((...values) => { perf.timeout += 1; tick(key); callback(...values) }, ms, ...rest)
  }
  const nativeInterval = window.setInterval.bind(window)
  window.setInterval = (callback, ms, ...rest) => {
    if (typeof callback !== 'function') return nativeInterval(callback, ms, ...rest)
    const key = site(`interval ${ms}ms`)
    return nativeInterval((...values) => { perf.interval += 1; tick(key); callback(...values) }, ms, ...rest)
  }
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) { perf.longTasks += 1; perf.longTaskMs += entry.duration }
    }).observe({ type: 'longtask', buffered: false })
  } catch { /* no long task timing */ }

  perf.reset = () => {
    perf.raf = 0; perf.timeout = 0; perf.interval = 0; perf.longTasks = 0; perf.longTaskMs = 0
    perf.calls = {}; perf.cacheWrites = 0; perf.cacheBytes = 0
    if (perf.sites) perf.sites = {}
  }
  perf.read = () => ({
    raf: perf.raf, timeout: perf.timeout, interval: perf.interval, longTasks: perf.longTasks, longTaskMs: perf.longTaskMs,
    calls: { ...perf.calls }, cacheWrites: perf.cacheWrites, cacheBytes: perf.cacheBytes,
    sites: perf.sites ? Object.entries(perf.sites).sort((a, b) => b[1] - a[1]).slice(0, 25) : null,
    animations: document.getAnimations().filter((animation) => animation.playState === 'running' && animation.effect?.getTiming().iterations === Infinity)
      .map((animation) => animation.animationName ?? animation.constructor.name),
  })
  // The game takes the front: the window loses focus but stays visible (Electron, backgroundThrottling: false).
  perf.blur = () => {
    Object.defineProperty(document, 'hasFocus', { value: () => false, configurable: true })
    window.dispatchEvent(new Event('blur'))
  }
  perf.focus = () => {
    Object.defineProperty(document, 'hasFocus', { value: () => true, configurable: true })
    window.dispatchEvent(new Event('focus'))
  }
  // Raid start / end from the game's logs (electron/main.ts `game:raid-state`).
  const raidListeners = new Set()
  let raid = { inRaid: false }
  perf.raid = (inRaid) => {
    raid = inRaid ? { inRaid: true, since: Date.now(), location: 'bigmap' } : { inRaid: false }
    for (const listener of raidListeners) listener(raid)
  }
  // A new catalog on the server (prices moved): the next request answers in full.
  perf.bumpCatalog = () => { perf.catalogVersion = perf.catalogVersion === 'a'.repeat(40) ? 'b'.repeat(40) : 'a'.repeat(40) }

  const settings = {
    version: 4, itemLookup: true, minimap: true, tracking: true, autoScreenshot: false, screenshotIntervalMs: 1500,
    itemKey: 'Semicolon', minimapKey: 'KeyM', collectorKey: '', minimapOpacity: 0.9, minimapWidth: 420, playerMarker: 'arrow',
    screenshotsDir: '', minimapPosition: null, runAsAdmin: false, showOnScreenshot: false, minimapOff: false, screenshotKey: 'Print',
  }
  const status = () => ({
    hookReady: true, hookError: '', tracking: true, screenshotsFolder: 'C:\\Users\\Player\\Documents\\Escape from Tarkov\\Screenshots',
    screenshotCandidates: [], lastScreenshot: null, screenshotPresses: 0, filesAfterPress: 0,
    screenshotKey: { keys: ['Print'], label: 'PrtSc', source: 'standard', unbound: false, sendable: true },
    elevated: true, snipping: 'off', nativeError: '', gameSeenAt: null, gameKeys: 'visible', lastPosition: null, raid, displayMode: 'fullscreen',
  })
  const account = {
    signedIn: true, email: 'player@example.com', kind: 'user', online: true, serverUrl: 'https://raidos.app', persistent: true,
    subscription: { status: 'active', paidUntil: '2099-01-01T00:00:00.000Z' }, createdAt: '2025-01-01T00:00:00.000Z', emailVerified: true,
    entitlement: { valid: true, plan: 'paid', expiresAt: '2099-01-01T00:00:00.000Z' },
  }
  const later = (value, ms = 0) => new Promise((resolve) => nativeTimeout(() => resolve(value), ms))
  const off = () => () => {}

  window.tarkovDesktop = {
    isDesktop: true,
    edition: 'client',
    serverMode: false,
    dataGateway: true,
    dataCache: {
      get: async (key) => { count(`cache:get ${key.split('-').slice(0, 3).join('-')}`); return null },
      set: async (key, value) => { count('cache:set'); perf.cacheWrites += 1; perf.cacheBytes += String(value).length; return true },
    },
    async serviceRequest(method, path) {
      const catalog = /^\/v1\/catalog\/(pvp|pve|seasonal)(?:\?(.*))?$/.exec(path)
      if (catalog) {
        const query = new URLSearchParams(catalog[2] ?? '')
        // electron/serviceGateway.ts: the version the app has goes to the server as If-None-Match; 304 → { notModified }.
        if (query.get('v') && query.get('v') === perf.catalogVersion) { count('catalog 304'); return later({ notModified: true }, 40) }
        count('catalog 200')
        const response = await fetch(`/__perf/catalog/${catalog[1]}`)
        if (!response.ok) throw new Error('Сервис недоступен: 503')
        const data = await response.json()
        // electron/serviceGateway.ts takes the server's ETag into the catalog's metadata.
        if (data.metadata) data.metadata.contentVersion = perf.catalogVersion
        return data
      }
      count(`service ${method} ${path.replace(/\?.*$/, '').replace(/\/[a-f0-9]{24}(?=\/|$)/g, '/:id')}`)
      const json = /^\/v1\/data\/json\/([a-z-]+\/[a-z_]+)$/.exec(path)
      if (json) {
        const response = await fetch(`/__perf/tdev/${json[1]}`)
        return response.ok ? await response.json() : { data: {} }
      }
      if (path === '/v1/data/graphql') return { data: {} }
      // Long polls answer after the server's wait (~25 s), so they do not spin.
      if (/^\/v1\/(?:map-updates|announcement|me\/social-events)/.test(path)) return later({ version: 1 }, path.includes('since=') ? 25_000 : 50)
      if (path.startsWith('/v1/me/') || path.startsWith('/v1/friends') || path.startsWith('/v1/squads')) return null
      return later(null, 20)
    },
    account: {
      status: async () => { count('account:status'); return account },
      login: async () => account, logout: async () => account, openWebsite: async () => true,
    },
    update: {
      status: async () => ({ state: 'idle' }),
      install: async () => ({ state: 'idle' }),
      check: async () => ({ outcome: 'latest', status: { state: 'idle' }, current: '0.6.0-35', checkedAt: new Date().toISOString() }),
      settings: async () => ({ autoCheck: true, autoInstall: true }),
      setSettings: async (patch) => ({ autoCheck: true, autoInstall: true, ...patch }),
      onStatus: off,
    },
    autoFindAndScanLogs: async () => null,
    scanLogs: async () => null,
    logSearchReport: async () => ({ folders: [], checked: [] }),
    startWatchingLogs: async () => false,
    clearApplicationData: async () => true,
    onLogsUpdated: off,
    getRaidState: async () => { count('raid:get'); return raid },
    onRaidStateChanged: (listener) => { raidListeners.add(listener); return () => raidListeners.delete(listener) },
    saveProfileBackup: async () => true,
    openProfileBackup: async () => null,
    getVersion: async () => '0.6.0-35',
    notify: async () => true,
    resolvePlayerProfile: async () => null,
    refreshPlayerProfile: async () => null,
    // The game is not in front: the main process answers at once (electron/screenOcr.ts).
    captureQuestFrame: async () => { count('quests:capture-frame'); return { text: '', sourceName: '', gameWindow: false } },
    captureQuestScreenshot: async () => null,
    recognizeQuestPng: async () => ({ text: '', sourceName: '' }),
    scanScreenText: async () => ({ text: '', gameWindow: false }),
    experimental: {
      getSettings: async () => { count('experimental:get-settings'); return { ...settings } },
      updateSettings: async (patch) => Object.assign(settings, patch),
      getStatus: async () => { count('experimental:status'); return status() },
      toggleMinimap: async () => true,
      pickScreenshotsFolder: async () => ({ ...settings }),
      testItemLookup: async () => null,
      checkScreenshots: async () => null,
      openLookupLog: async () => true,
      onCheckProgress: off,
      relaunchAsAdmin: async () => false,
      openKeyboardSettings: async () => true,
      fixSnipping: async () => ({ ok: true, snipping: 'off' }),
      answer: async () => {},
      onQuery: off,
      onPosition: off,
      onCollectorScan: off,
    },
  }
  try {
    localStorage.setItem('tarkov-operations-locale-v1', options.locale)
    if (options.spin) localStorage.setItem('tarkov-gallery-spin-v1', '1')
    sessionStorage.setItem('tarkov-account-gate-skipped', '1')
    // A returning player: the one-off notices and the first-run tips were seen before (src/onboarding/).
    localStorage.setItem('raidos.first-launch.game-restart.v1', '1')
    localStorage.setItem('raidos-quest-sync-tip-v1', '2026-10-01T00:00:00.000Z')
    localStorage.setItem(`raidos-first-run-guide-v1:${account.email}`, JSON.stringify({ started: '2025-01-01T00:00:00.000Z', accepted: ['quests', 'minimap', 'maps', 'kappa'] }))
  } catch { /* storage unavailable */ }
}

async function openApp(browser, route, { spin = false, locale = 'ru' } = {}) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, locale: locale === 'en' ? 'en-US' : 'ru-RU' })
  await context.addInitScript({ content: `(${pageSetup})(${JSON.stringify({ sites: SITES, spin, locale })})` })
  await context.route((url) => !['127.0.0.1', 'localhost'].includes(url.hostname), (request) => request.abort())
  await context.route('**/__perf/catalog/*', (request) => CATALOG
    ? request.fulfill({ contentType: 'application/json', body: CATALOG })
    : request.fulfill({ status: 503, body: '' }))
  await context.route('**/__perf/tdev/**', (request) => {
    const name = new URL(request.request().url()).pathname.replace(/^\/__perf\/tdev\//, '')
    const file = TDEV ? join(TDEV, `${name}.json`) : ''
    return file && existsSync(file) ? request.fulfill({ contentType: 'application/json', body: readFileSync(file) }) : request.fulfill({ status: 404, body: '' })
  })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error.message ?? error)))
  await page.goto(`${BASE}/#${route}`, { waitUntil: 'load', timeout: 120_000 })
  const cdp = await context.newCDPSession(page)
  await cdp.send('Performance.enable')
  return { context, page, cdp, errors }
}

async function metrics(cdp) {
  const { metrics: list } = await cdp.send('Performance.getMetrics')
  return Object.fromEntries(list.map((entry) => [entry.name, entry.value]))
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** One state of one page: everything counted over `seconds`. */
async function measure(page, cdp, seconds) {
  await page.evaluate(() => window.__perf.reset())
  const before = await metrics(cdp)
  await wait(seconds * 1000)
  const after = await metrics(cdp)
  const counted = await page.evaluate(() => window.__perf.read())
  const delta = (name) => (after[name] ?? 0) - (before[name] ?? 0)
  return {
    seconds,
    rafPerSec: round(counted.raf / seconds),
    timeoutsPerSec: round(counted.timeout / seconds),
    intervalsPerSec: round(counted.interval / seconds),
    longTasks: counted.longTasks,
    longTaskMs: Math.round(counted.longTaskMs),
    taskMsPerSec: round((delta('TaskDuration') * 1000) / seconds),
    scriptMsPerSec: round((delta('ScriptDuration') * 1000) / seconds),
    styleLayoutMsPerSec: round(((delta('RecalcStyleDuration') + delta('LayoutDuration')) * 1000) / seconds),
    endlessAnimations: counted.animations.length,
    calls: counted.calls,
    cacheWrites: counted.cacheWrites,
    cacheMB: round(counted.cacheBytes / 1e6),
    ...(counted.sites ? { sites: counted.sites } : {}),
  }
}

const round = (value) => Math.round(value * 100) / 100

async function settle(page, ms) {
  await page.waitForSelector('.page', { timeout: 120_000 }).catch(() => {})
  await wait(ms)
}

async function pageScenario(browser, name) {
  const route = ROUTES[name]
  const gallery = name === 'gallery'
  const { context, page, cdp, errors } = await openApp(browser, route, { spin: gallery })
  try {
    await settle(page, 8000)
    if (gallery) {
      // «Автоповорот» on (saved), the first boss opened: the 3D viewer spins.
      await page.click('.gallery-card', { timeout: 30_000 })
      await page.waitForSelector('.gallery-viewer canvas:not(.is-hidden)', { timeout: 90_000 }).catch(() => {})
      await wait(3000)
    }
    const startup = await page.evaluate(() => window.__perf.read())
    const focused = await measure(page, cdp, SECONDS)
    await page.evaluate(() => window.__perf.blur())
    await wait(3000)
    const blurred = await measure(page, cdp, SECONDS)
    await page.evaluate(() => window.__perf.focus())
    return { page: name, route, startup: { calls: startup.calls, cacheWrites: startup.cacheWrites, cacheMB: round(startup.cacheBytes / 1e6) }, focused, blurred, errors: errors.slice(0, 5) }
  } finally {
    await context.close()
  }
}

/** The catalog while the game is in front: how many refreshes, cache writes and long tasks in `CATALOG_SECONDS`. */
async function catalogScenario(browser) {
  const { context, page, cdp, errors } = await openApp(browser, ROUTES.overview)
  try {
    await settle(page, 10_000)
    await page.evaluate(() => window.__perf.blur())
    await wait(2000)
    const blurred = await measure(page, cdp, CATALOG_SECONDS)
    // A raid while the app is in use: no refresh either.
    await page.evaluate(() => { window.__perf.focus(); window.__perf.raid(true) })
    const inRaid = await measure(page, cdp, Math.min(CATALOG_SECONDS, 90))
    await page.evaluate(() => window.__perf.raid(false))
    return { scenario: 'catalog', blurred, focusedInRaid: inRaid, errors: errors.slice(0, 5) }
  } finally {
    await context.close()
  }
}

/** One refresh of the catalog (the top-bar button): unchanged on the server, then changed. */
async function refreshScenario(browser) {
  const { context, page, cdp, errors } = await openApp(browser, ROUTES.overview)
  const once = async () => {
    await page.evaluate(() => window.__perf.reset())
    const before = await metrics(cdp)
    await page.click('button[aria-label="Обновить данные"]', { timeout: 10_000 }).catch(() => {})
    await wait(12_000)
    const after = await metrics(cdp)
    const counted = await page.evaluate(() => window.__perf.read())
    return {
      longTasks: counted.longTasks, longTaskMs: Math.round(counted.longTaskMs),
      taskMs: Math.round(((after.TaskDuration ?? 0) - (before.TaskDuration ?? 0)) * 1000),
      scriptMs: Math.round(((after.ScriptDuration ?? 0) - (before.ScriptDuration ?? 0)) * 1000),
      calls: counted.calls, cacheWrites: counted.cacheWrites, cacheMB: round(counted.cacheBytes / 1e6),
    }
  }
  try {
    await settle(page, 12_000)
    const idle = await measure(page, cdp, 12)
    const unchanged = await once()
    await page.evaluate(() => window.__perf.bumpCatalog())
    const changed = await once()
    return { scenario: 'refresh', idleBaseline12s: { taskMs: Math.round(idle.taskMsPerSec * 12), longTaskMs: idle.longTaskMs }, unchanged, changed, errors: errors.slice(0, 5) }
  } finally {
    await context.close()
  }
}

function table(results) {
  const lines = []
  const pages = results.filter((entry) => entry.page)
  if (pages.length) {
    lines.push('page      state    rAF/s  timeouts/s intervals/s longTasks(ms)  task ms/s script ms/s style+layout ms/s anims status-polls catalog')
    for (const entry of pages) {
      for (const state of ['focused', 'blurred']) {
        const row = entry[state]
        const polls = row.calls['experimental:status'] ?? 0
        const catalog = (row.calls['catalog 200'] ?? 0) + (row.calls['catalog 304'] ?? 0)
        lines.push(`${entry.page.padEnd(9)} ${state.padEnd(8)} ${String(row.rafPerSec).padStart(6)} ${String(row.timeoutsPerSec).padStart(10)} ${String(row.intervalsPerSec).padStart(11)} ${`${row.longTasks}(${row.longTaskMs})`.padStart(13)} ${String(row.taskMsPerSec).padStart(10)} ${String(row.scriptMsPerSec).padStart(11)} ${String(row.styleLayoutMsPerSec).padStart(17)} ${String(row.endlessAnimations).padStart(5)} ${String(polls).padStart(12)} ${String(catalog).padStart(7)}`)
      }
    }
  }
  for (const entry of results.filter((item) => item.scenario)) lines.push(`${entry.scenario}: ${JSON.stringify(entry)}`)
  return lines.join('\n')
}

const browser = await chromium.launch({
  executablePath: chromiumPath(),
  headless: true,
  // WebGL for the boss viewer without a GPU.
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--enable-precise-memory-info'],
})
const results = []
try {
  if (SCENARIOS.includes('pages')) {
    for (const name of PAGES) {
      if (!ROUTES[name]) continue
      process.stderr.write(`page ${name}…\n`)
      results.push(await pageScenario(browser, name))
    }
  }
  if (SCENARIOS.includes('catalog')) { process.stderr.write('catalog…\n'); results.push(await catalogScenario(browser)) }
  if (SCENARIOS.includes('refresh')) { process.stderr.write('refresh…\n'); results.push(await refreshScenario(browser)) }
} finally {
  await browser.close()
}
console.log(table(results))
if (args.json) writeFileSync(String(args.json), JSON.stringify(results, null, 2))
