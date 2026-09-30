// Theme picker thumbnails (Settings → «Цветовая схема»): a tiny, language-free piece of the real interface — a sidebar
// strip with the active tab, a stat card with a number, a primary button and a switch — rendered by the app's own CSS in
// every theme, saved as src/assets/theme-previews/<theme>.webp (2× for sharp screens).
//   1. start the renderer: npm run dev   (or any Vite server of this repo)
//   2. node scripts/theme-previews.mjs [http://127.0.0.1:5173/]
// Needs Playwright's Chromium (PLAYWRIGHT_CHROMIUM=/path/to/chromium to use a specific build).
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const url = process.argv[2] || 'http://127.0.0.1:5173/'
const out = join(root, 'src', 'assets', 'theme-previews')
const THEMES = ['tarkov', 'steel', 'crimson', 'blackmc', 'perforated', 'rust', 'slate', 'telnyashka', 'gear']
const W = 200, H = 120

// lucide-style outline icons (home, target, map) so the strip reads as the app's navigation
const icon = (d) => `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`
const HOME = icon('<path d="M3 10.5 12 3l9 7.5V21H3z"/><path d="M9 21v-7h6v7"/>')
const TARGET = icon('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>')
const MAP = icon('<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15M15 6v15"/>')
const MARKUP = `
<div id="tp-shot" style="position:fixed;left:0;top:0;width:${W}px;height:${H}px;z-index:2147483647;overflow:hidden">
  <aside class="sidebar" style="position:absolute;inset:0 auto 0 0;width:58px;padding:8px 7px;display:flex;flex-direction:column;gap:0">
    <div class="brand" style="padding:0 0 7px;justify-content:center"><div class="brand-mark" style="width:26px;height:26px;font-size:11px">TO</div></div>
    <nav class="nav-list" style="display:grid;gap:4px">
      <a class="nav-link active" style="height:22px;min-height:0;padding:0;justify-content:center">${HOME}</a>
      <a class="nav-link" style="height:22px;min-height:0;padding:0;justify-content:center">${TARGET}</a>
      <a class="nav-link" style="height:22px;min-height:0;padding:0;justify-content:center">${MAP}</a>
    </nav>
  </aside>
  <section class="stat-card" style="position:absolute;left:68px;top:10px;right:9px;bottom:10px;min-height:0;margin:0;padding:10px 11px;display:grid;grid-template-rows:auto 1fr;gap:8px">
    <div class="stat-value" style="font-size:26px;line-height:1;margin:0;justify-self:start">42</div>
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;align-self:end">
      <button class="button primary small" type="button" style="min-width:0;padding:0 12px">OK</button>
      <span class="toggle on" style="display:block"><span></span></span>
    </div>
  </section>
</div>`

const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {})
mkdirSync(out, { recursive: true })
for (const theme of THEMES) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, reducedMotion: 'reduce' })
  await page.addInitScript((id) => { try { localStorage.setItem('tarkov-app-theme', id) } catch { /* ignore */ } }, theme)
  await page.goto(url)
  await page.waitForSelector('.sidebar', { timeout: 60_000 })
  await page.evaluate((markup) => {
    const style = document.createElement('style')
    // only the picture: hide the app and the theme decorations (portals), keep the page background
    style.textContent = `body > :not(#tp-shot) { visibility: hidden !important; }
      #tp-shot .sidebar::before, #tp-shot .sidebar::after, #tp-shot .nav-list::after { display: none !important; }
      #tp-shot * { transition: none !important; animation: none !important; }`
    document.head.append(style)
    document.body.insertAdjacentHTML('beforeend', markup)
  }, MARKUP)
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(1500) // textures
  const png = await page.screenshot({ clip: { x: 0, y: 0, width: W, height: H } })
  // encode WebP in the browser (no image library needed)
  const webp = await page.evaluate(async (b64) => {
    const image = new Image()
    image.src = `data:image/png;base64,${b64}`
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
    canvas.getContext('2d').drawImage(image, 0, 0)
    return canvas.toDataURL('image/webp', 0.86).split(',')[1]
  }, png.toString('base64'))
  writeFileSync(join(out, `${theme}.webp`), Buffer.from(webp, 'base64'))
  console.log(`${theme}.webp`)
  await page.close()
}
await browser.close()
