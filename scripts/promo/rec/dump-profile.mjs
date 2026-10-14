import { chromium } from '../env.mjs'
import { writeFileSync } from 'node:fs'
import { answerExternal } from '../net.mjs'
import { S } from '../env.mjs'
const BASE = 'http://127.0.0.1:5211/'
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } })
await answerExternal(context, (url) => url.startsWith(BASE))
await context.addInitScript(() => { try { sessionStorage.setItem('tarkov-account-gate-skipped', '1'); localStorage.setItem('toc.cookie-notice', '1') } catch {} })
const page = await context.newPage()
await page.goto(BASE + '#/')
await page.waitForTimeout(6000)
const dump = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map((key) => [key, localStorage.getItem(key)])))
writeFileSync(`${S}/promo/rec/default-storage.json`, JSON.stringify(dump, null, 1))
console.log(Object.keys(dump).join('\n'))
await browser.close()
