// Load the app once and save the catalog it built (IndexedDB idb-keyval) for planning the demo profile.
import { chromium } from '../env.mjs'
import { writeFileSync } from 'node:fs'
import { answerExternal } from '../net.mjs'
import { S } from '../env.mjs'
const BASE = 'http://127.0.0.1:5211/'
const mode = process.argv[2] ?? 'pvp'
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } })
await answerExternal(context, (url) => url.startsWith(BASE))
await context.addInitScript((mode) => { try { sessionStorage.setItem('tarkov-account-gate-skipped', '1'); localStorage.setItem('toc.cookie-notice', '1'); localStorage.setItem('tarkov-operations-state-v1', JSON.stringify({ raidMode: mode })) } catch {} }, mode)
const page = await context.newPage()
await page.goto(BASE + '#/')
const key = `tarkov-operations-catalog-v11-${mode}-ru`
let data = null
for (let i = 0; i < 90 && !data; i++) {
  await page.waitForTimeout(1000)
  data = await page.evaluate((key) => new Promise((resolve) => {
    const open = indexedDB.open('keyval-store')
    open.onsuccess = () => { try { const tx = open.result.transaction('keyval', 'readonly'); const req = tx.objectStore('keyval').get(key); req.onsuccess = () => resolve(req.result ?? null); req.onerror = () => resolve(null) } catch { resolve(null) } }
    open.onerror = () => resolve(null)
  }), key)
}
if (!data) { console.log('no catalog'); process.exit(1) }
writeFileSync(`${S}/promo/rec/catalog-${mode}.json`, JSON.stringify(data))
console.log('quests', data.quests.length, 'items', data.items.length, 'maps', data.maps.length, 'markers', data.markers.length)
await browser.close()
