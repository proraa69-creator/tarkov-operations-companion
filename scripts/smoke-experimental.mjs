// Manual smoke test for the in-game overlays: node scripts/smoke-experimental.mjs
import { _electron as electron } from '@playwright/test'
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const out = join(tmpdir(), 'tarkov-smoke')
await mkdir(out, { recursive: true })
const screenshotFolder = join(out, 'screenshots')
await mkdir(screenshotFolder, { recursive: true })
process.env.TARKOV_SCREENSHOTS_DIR = screenshotFolder
const isolatedUserData = join(out, 'user-data')
const app = process.env.SMOKE_EXE
  ? await electron.launch({ executablePath: process.env.SMOKE_EXE, args: [`--user-data-dir=${isolatedUserData}`] })
  : await electron.launch({ args: ['.', `--user-data-dir=${isolatedUserData}`] })
const main = await app.firstWindow()
await main.waitForLoadState('domcontentloaded')

// Wait until the catalog is available (cached catalog loads in seconds).
for (let i = 0; i < 150; i += 1) {
  const ready = await main.evaluate(() => document.querySelectorAll('.nav-link').length > 0 && !document.body.innerText.includes('Загружаем актуальную базу'))
  if (ready) break
  await new Promise((resolve) => setTimeout(resolve, 2000))
}
await new Promise((resolve) => setTimeout(resolve, 8000))

const status = await main.evaluate(() => window.tarkovDesktop.experimental.getStatus())
console.log('status', JSON.stringify(status))

const item = await main.evaluate(() => window.tarkovDesktop.experimental.testItemLookup())
console.log('item answer', JSON.stringify(item)?.slice(0, 400))
await new Promise((resolve) => setTimeout(resolve, 800))
for (const window of app.windows()) {
  const url = window.url()
  if (url.includes('overlay/item')) await window.screenshot({ path: join(out, 'item.png') })
}

await main.evaluate(() => { location.hash = '#/maps/customs' })
await new Promise((resolve) => setTimeout(resolve, 1500))
const shown = await main.evaluate(() => window.tarkovDesktop.experimental.toggleMinimap())
console.log('minimap shown', shown)

// Fake EFT screenshots in an isolated temporary folder: player files are never modified.
const folder = screenshotFolder
const created = []
for (let i = 0; i < 5; i += 1) {
  const name = `2099-01-01[00-0${i}]_${(-200 + i * 30).toFixed(2)}, 1.00, ${(-100 + i * 20).toFixed(2)}_0.00000, 0.38268, 0.00000, 0.92388_1.0${i} (0).png`
  await writeFile(join(folder, name), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  created.push(name)
  await new Promise((resolve) => setTimeout(resolve, 1300))
}
await new Promise((resolve) => setTimeout(resolve, 2500))
const left = (await readdir(folder)).filter((name) => name.startsWith('2099-'))
console.log('screenshots preserved', left.length, left)
const after = await main.evaluate(() => window.tarkovDesktop.experimental.getStatus())
console.log('last position', JSON.stringify(after.lastPosition))
for (const window of app.windows()) {
  if (window.url().includes('overlay/minimap')) {
    await new Promise((resolve) => setTimeout(resolve, 2500))
    await window.screenshot({ path: join(out, 'minimap.png') })
  }
}
await main.screenshot({ path: join(out, 'main.png'), timeout: 10_000 }).catch(() => console.log('main screenshot skipped'))
console.log('screens in', out)
await app.close()
