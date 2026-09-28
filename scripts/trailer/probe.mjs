// Quick probe: screenshot every route once so we can see what renders offline.
import { chromium } from '../../node_modules/playwright/index.mjs'

const BASE = process.env.TRAILER_BASE ?? 'http://localhost:5210/'
const OUT = process.argv[2] ?? '/tmp/trailer-probe'
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
for (const [name, hash] of [['dash', '#/'], ['quests', '#/quests'], ['maps', '#/maps/customs'], ['flea', '#/flea'], ['kappa', '#/kappa-items'], ['settings', '#/settings']]) {
  await page.goto(BASE + hash)
  await page.waitForTimeout(2500)
  await page.screenshot({ path: `${OUT}/${name}.png` })
}
await browser.close()
