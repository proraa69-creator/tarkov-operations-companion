// Recorder for the promo: the real renderer (live tarkov.dev catalog and images) in Chromium, page time slowed
// (timewarp.js + CDP Animation.setPlaybackRate), screencast frames stamped on the page's clock and written as a
// constant 30 fps video. Actions (cursor, clicks, scrolls, tips) are scheduled on the same slowed clock, so the video
// plays at normal speed however slow the machine renders.
import { chromium } from '../env.mjs'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { answerExternal } from '../net.mjs'

import { S } from '../env.mjs'
export { S }
export const BASE = process.env.PROMO_BASE ?? 'http://127.0.0.1:5211/'
export const FF = process.env.FFMPEG ?? (existsSync(`${S}/bin/ffmpeg`) ? `${S}/bin/ffmpeg` : 'ffmpeg')
const REC = `${S}/promo/rec`
const TIMEWARP = readFileSync(`${REC}/timewarp.js`, 'utf8')
const OVERLAY = readFileSync(`${REC}/overlay.js`, 'utf8')
const SEEDS = { ru: JSON.parse(readFileSync(`${REC}/seed-ru.json`, 'utf8')), en: JSON.parse(readFileSync(`${REC}/seed-en.json`, 'utf8')) }
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

let browser = null
export async function launch() {
  browser ??= await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--no-sandbox', '--force-color-profile=srgb', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-compositing', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'],
  })
  return browser
}
export async function close() { await browser?.close(); browser = null }

/**
 * The app in a fresh context: seeded profile (seed.json), language, mode and theme; external hosts answered from the
 * curl cache; slowed clock and the overlay installed before the app starts.
 */
export async function openApp({ hash = '#/', locale = 'ru', mode = 'pvp', theme = null, collected = 21, extraInit = [], viewport = { width: 1920, height: 1080 }, userAgent } = {}) {
  await launch()
  const context = await browser.newContext({ viewport, deviceScaleFactor: viewport.width < 600 ? 2 : 1, locale: locale === 'en' ? 'en-US' : 'ru-RU', colorScheme: 'dark', ...(userAgent ? { userAgent } : {}) })
  await answerExternal(context, (url) => url.startsWith(BASE))
  await context.addInitScript(TIMEWARP)
  await context.addInitScript(([seed, locale, mode, theme, collected]) => {
    try {
      sessionStorage.setItem('tarkov-account-gate-skipped', '1')
      if (localStorage.getItem('promo-seeded')) return
      localStorage.setItem('promo-seeded', '1')
      localStorage.setItem('toc.cookie-notice', '1')
      localStorage.setItem('tarkov-operations-locale-v1', locale)
      localStorage.setItem('tarkov-operations-state-v1', JSON.stringify({ raidMode: mode }))
      const profiles = JSON.parse(seed['tarkov-operations-profiles-v2'])
      profiles.profiles[0].selectedMode = mode
      localStorage.setItem('tarkov-operations-profiles-v2', JSON.stringify(profiles))
      localStorage.setItem('tarkov-operations-ui-v2', seed['tarkov-operations-ui-v2'])
      if (theme) localStorage.setItem('tarkov-app-theme', theme)
      localStorage.setItem('tarkov-collector-items-v1:pvp', JSON.stringify(seed.collector.slice(0, collected)))
      localStorage.setItem('tarkov-collector-items-v1:pve', JSON.stringify(seed.collector.slice(0, 30)))
      localStorage.setItem('tarkov-collector-items-v1:seasonal', JSON.stringify(seed.collector.slice(0, 6)))
      const ago = (minutes) => new Date(Date.now() - minutes * 60000).toISOString()
      localStorage.setItem('goon-sightings-v2-pvp', JSON.stringify([{ mapId: 'shoreline', reportedAt: ago(34), sent: true }]))
      localStorage.setItem('goon-sightings-v2-pve', JSON.stringify([{ mapId: 'woods', reportedAt: ago(71), sent: true }]))
      localStorage.setItem('goon-sightings-v2-seasonal', JSON.stringify([{ mapId: 'customs', reportedAt: ago(128), sent: true }]))
    } catch { /* storage blocked */ }
  }, [SEEDS[locale] ?? SEEDS.ru, locale, mode, theme, collected])
  for (const script of extraInit) await context.addInitScript(script)
  await context.addInitScript(OVERLAY)
  const page = await context.newPage()
  page.on('pageerror', (error) => console.log('  pageerror:', error.message.slice(0, 200)))
  await page.goto(BASE + hash)
  await ready(page)
  return { context, page }
}

/** Loads the PvE and Season catalogs once, so switching modes on camera is instant; back to `mode`. */
export async function warmModes(page, mode = 'pvp') {
  for (const label of ['PvE', 'Сезон', 'Season', 'PvP']) {
    const button = page.locator('.mode-switch button', { hasText: new RegExp(`^${label}$`) })
    if (!(await button.count())) continue
    await button.first().click()
    await ready(page, 600)
  }
  if (mode !== 'pvp') await page.locator('.mode-switch button').nth(mode === 'pve' ? 1 : 2).click()
  await ready(page, 800)
}

/** The catalog is loaded and the images on screen have arrived. */
export async function ready(page, extra = 1500) {
  await page.waitForFunction(() => !/Загружаем актуальную базу|Loading the latest data/i.test(document.body?.innerText ?? ''), null, { timeout: 180_000 }).catch(() => console.log('  still loading'))
  await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {})
  await settleImages(page)
  await sleep(extra)
}
export async function settleImages(page, timeout = 30_000) {
  await page.waitForFunction(() => [...document.images].filter((img) => img.getBoundingClientRect().width > 0).every((img) => img.complete), null, { timeout }).catch(() => {})
}

/** Point of an element: its centre, or `dx/dy` as fractions of its box. */
export async function pointOf(page, target, { dx = 0.5, dy = 0.5 } = {}) {
  if (typeof target === 'object' && 'x' in target) return target
  const locator = typeof target === 'string' ? page.locator(target).first() : target
  const box = await locator.boundingBox()
  if (!box) throw new Error(`no box for ${target}`)
  return { x: box.x + box.width * dx, y: box.y + box.height * dy }
}

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

/** One take: frames from the start call until stop(), as a 30 fps H.264 file (no audio). */
export async function record(page, out, { rate = 0.25, fps = 30, quality = 88 } = {}) {
  mkdirSync(dirname(out), { recursive: true })
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Animation.enable')
  let currentRate = rate
  // Node wall clock ↔ page virtual clock.
  let syncWall = 0, syncVirtual = 0
  async function setRate(next) {
    await cdp.send('Animation.setPlaybackRate', { playbackRate: next })
    const before = Date.now()
    const [, virtual] = await page.evaluate((r) => window.__vt.setRate(r), next)
    const after = Date.now()
    syncWall = (before + after) / 2
    syncVirtual = virtual
    currentRate = next
  }
  const vAt = (wallMs) => syncVirtual + (wallMs - syncWall) * currentRate
  await setRate(rate)
  const ff = spawn(FF, ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-', '-c:v', 'libx264', '-preset', 'medium', '-crf', '15', '-pix_fmt', 'yuv420p', '-r', String(fps), '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] })
  const start = vAt(Date.now())
  const step = 1000 / fps
  let next = start, last = null, frames = 0, written = 0
  // hold(true): the slowed clock still creeps, but no frame is written. The screencast may send nothing for a change
  // made during the hold (a loading label removed), so the first picture captured after the hold fills the slots the
  // hold crossed: a label shown during the hold never reaches the video.
  let holding = false, releasedAt = 0, fresh = false
  const write = (buffer) => { ff.stdin.write(buffer); written += 1 }
  const onFrame = async ({ data, metadata, sessionId }) => {
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {})
    const buffer = Buffer.from(data, 'base64')
    const wall = (metadata.timestamp ?? Date.now() / 1000) * 1000
    const v = vAt(wall)
    frames += 1
    if (holding || wall < releasedAt) { last = buffer; return }
    if (fresh) { last = buffer; fresh = false }
    if (!last && v > next) { while (next <= v) { write(buffer); next += step } }
    while (next <= v) { write(last ?? buffer); next += step }
    last = buffer
  }
  cdp.on('Page.screencastFrame', onFrame)
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 })

  const vnow = () => vAt(Date.now())
  const vsleep = (ms) => sleep(ms / currentRate)
  async function until(virtualMs) { const wait = virtualMs - (vnow() - start); if (wait > 0) await vsleep(wait) }

  // The mouse travels on a gentle arc with ease-in-out, stepped on the slowed clock.
  let mouse = { x: 960, y: 1180 }
  async function moveTo(target, { duration = 650, dx, dy, arc = 0.12 } = {}) {
    const to = await pointOf(page, target, { dx, dy })
    const from = { ...mouse }
    const t0 = vnow()
    const nx = -(to.y - from.y), ny = to.x - from.x
    for (;;) {
      const t = Math.min(1, (vnow() - t0) / duration)
      const e = ease(t)
      const bend = Math.sin(Math.PI * e) * arc
      const x = from.x + (to.x - from.x) * e + nx * bend
      const y = from.y + (to.y - from.y) * e + ny * bend
      await page.mouse.move(x, y)
      mouse = { x, y }
      if (t >= 1) break
      await sleep(6)
    }
  }
  async function click(target, options = {}) {
    if (target) await moveTo(target, options)
    await page.mouse.down()
    await vsleep(95)
    await page.mouse.up()
  }
  async function wheel(deltaY, { steps = 6, duration = 600 } = {}) {
    for (let i = 0; i < steps; i += 1) { await page.mouse.wheel(0, deltaY / steps); await vsleep(duration / steps) }
  }
  /** Smooth scroll of a scrollable element (or the page) by `dy` pixels over `duration` virtual ms. */
  async function scroll(selector, dy, duration = 900) {
    await page.evaluate(([selector, dy, duration]) => {
      const node = selector ? document.querySelector(selector) : (document.scrollingElement ?? document.documentElement)
      if (!node) return
      const from = node.scrollTop, t0 = performance.now()
      const easeIO = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
      const tick = () => { const t = Math.min(1, (performance.now() - t0) / duration); node.scrollTop = from + dy * easeIO(t); if (t < 1) requestAnimationFrame(tick) }
      requestAnimationFrame(tick)
    }, [selector, dy, duration])
    await vsleep(duration + 60)
  }
  /** Smoothly scrolls the element's nearest scrollable box so the element sits at `block` (0 top … 1 bottom). */
  async function reveal(selector, { block = 0.5, duration = 850 } = {}) {
    await page.evaluate(([selector, block, duration]) => {
      const el = document.querySelector(selector)
      if (!el) return
      const scrollable = (n) => { const s = getComputedStyle(n); return /(auto|scroll)/.test(s.overflowY) && n.scrollHeight > n.clientHeight + 1 }
      let box = el.parentElement
      while (box && box !== document.body && box !== document.documentElement && !scrollable(box)) box = box.parentElement
      const root = document.scrollingElement || document.documentElement
      const container = box && box !== document.body && box !== document.documentElement ? box : root
      const er = el.getBoundingClientRect()
      const cr = container === root ? { top: 0, height: innerHeight } : container.getBoundingClientRect()
      const from = container.scrollTop, max = container.scrollHeight - container.clientHeight
      const dy = Math.max(-from, Math.min(max - from, er.top + er.height / 2 - (cr.top + cr.height * block)))
      const t0 = performance.now()
      const easeIO = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
      const tick = () => { const t = Math.min(1, (performance.now() - t0) / duration); container.scrollTop = from + dy * easeIO(t); if (t < 1) requestAnimationFrame(tick) }
      requestAnimationFrame(tick)
    }, [selector, block, duration])
    await vsleep(duration + 60)
  }
  const overlay = (method, ...args) => page.evaluate(([method, args]) => window.__promo[method](...args), [method, args])
  // Playwright selectors (`:has-text`, `>>`) are resolved here to a box; plain CSS selectors are passed on, so rings
  // follow their element while it moves.
  async function target(value) {
    if (typeof value !== 'string') return value
    const state = await page.evaluate((selector) => { try { return document.querySelector(selector) ? 'found' : 'none' } catch { return 'invalid' } }, value)
    if (state === 'found') return value
    if (state === 'none') { console.log('  overlay target not found:', value); return null }
    const box = await page.locator(value).first().boundingBox({ timeout: 3000 }).catch(() => null)
    return box ? { left: box.x, top: box.y, width: box.width, height: box.height } : null
  }
  const card = async (options) => overlay('card', { ...options, target: await target(options.target) })
  const ring = async (options) => overlay('ring', { ...options, target: await target(options.target) })

  async function stop(holdMs = 0) {
    if (holdMs) await vsleep(holdMs)
    const end = vnow()
    await cdp.send('Page.stopScreencast').catch(() => {})
    cdp.off('Page.screencastFrame', onFrame)
    if (last) while (next <= end) { write(last); next += step }
    ff.stdin.end()
    await new Promise((resolve) => ff.on('close', resolve))
    await cdp.send('Animation.setPlaybackRate', { playbackRate: 1 }).catch(() => {})
    await page.evaluate(() => window.__vt.setRate(1)).catch(() => {})
    await cdp.detach().catch(() => {})
    console.log(`  ${out.split('/').pop()}: ${(written / fps).toFixed(2)} s, ${written} frames from ${frames} captures`)
    return written / fps
  }
  return { page, cdp, setRate, hold: (on) => { if (on) holding = true; else if (holding) { holding = false; releasedAt = Date.now(); fresh = true } }, vnow: () => vnow() - start, vsleep, until, moveTo, click, wheel, scroll, reveal, overlay, card, ring, target, stop, mouse: () => mouse, setMouse: (point) => { mouse = point } }
}
