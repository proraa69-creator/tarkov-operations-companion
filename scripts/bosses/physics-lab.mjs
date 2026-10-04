// Renders the physics lab page (physics-lab.html) for boss models into PNGs.
//   node scripts/bosses/physics-lab.mjs <out dir> [classes|sim|walk] [key ...]   (sim: turns; walk: walking, see physics-lab.ts)
import { chromium } from 'playwright'
import { createServer } from 'vite'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')
const outDir = path.resolve(process.argv[2] || 'physics-lab-out')
const mode = process.argv[3] || 'classes'
const only = process.argv.slice(4)
const srcDir = path.join(root, 'src/assets/boss-models')
const vite = await createServer({ root, configFile: false, logLevel: 'warn', appType: 'mpa', server: { host: '127.0.0.1', port: 0, fs: { allow: [root] } } })
await vite.listen()
const port = vite.httpServer.address().port
const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined),
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})
fs.mkdirSync(outDir, { recursive: true })
const files = fs.readdirSync(srcDir).filter((f) => f.endsWith('.glb') && (!only.length || only.includes(f.replace(/\.glb$/, ''))))
for (const file of files) {
  const key = file.replace(/\.glb$/, '')
  const page = await browser.newPage()
  page.on('console', (msg) => { if (msg.type() === 'error') console.error(key, msg.text()) })
  const model = '/@fs/' + path.join(srcDir, file).split(path.sep).join('/').replace(/^\//, '')
  const query = mode === 'walk' ? 'mode=sim&motion=walk' : `mode=${mode}`
  await page.goto(`http://127.0.0.1:${port}/scripts/bosses/physics-lab.html?m=${encodeURIComponent(model)}&key=${key}&${query}`)
  await page.waitForFunction(() => document.title !== '', null, { timeout: 300000 })
  const title = await page.title()
  console.log(title)
  if (title.startsWith('done')) {
    const png = Buffer.from((await page.evaluate(() => document.getElementById('c').toDataURL('image/png'))).split(',')[1], 'base64')
    fs.writeFileSync(path.join(outDir, `${key}-${mode}.png`), png)
  }
  await page.close()
}
await browser.close()
await vite.close()
