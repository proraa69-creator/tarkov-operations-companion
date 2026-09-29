// Regenerates the «Снаряжение» / "Gear" theme textures into src/assets/gear/.
//   node scripts/gear/generate.mjs            -> 2048² tiles (what the app ships)
//   node scripts/gear/generate.mjs --masters  -> also 4096² masters into ./work/gear-masters (not committed)
// Needs Playwright's Chromium (set PW_CHROMIUM to override the path).
import { chromium } from 'playwright'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const out = join(root, 'src', 'assets', 'gear')
const masters = process.argv.includes('--masters')

const jobs = [
  // [file, expression, webp quality]
  ['cordura-multicam.webp', 'gearTex.cordura(2048)', 0.74],
  ['molle-multicam.webp', 'gearTex.molle(2048)', 0.74],
  ['velcro-ranger.webp', "gearTex.velcro(1024, '#3c4130')", 0.78],
  ['webbing-coyote.webp', "gearTex.webbing(512, '#8c7552', 3)", 0.82],
  ['webbing-ranger.webp', "gearTex.webbing(512, '#48503c', 4)", 0.82],
  ['buckle.webp', 'gearTex.buckle()', 0.9],
  ['snap.webp', 'gearTex.snap()', 0.9],
]
if (masters) jobs.push(['../../../work/gear-masters/molle-4096.webp', 'gearTex.molle(4096)', 0.9], ['../../../work/gear-masters/cordura-4096.webp', 'gearTex.cordura(4096)', 0.9])

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined, args: ['--no-sandbox'] })
const page = await browser.newPage()
await page.addScriptTag({ content: await readFile(join(here, 'gear-texgen.js'), 'utf8') })
await mkdir(out, { recursive: true })
for (const [file, expr, q] of jobs) {
  const t = Date.now()
  const data = await page.evaluate(([e, quality]) => (0, eval)(e).toDataURL('image/webp', quality), [expr, q])
  const buf = Buffer.from(data.split(',')[1], 'base64')
  const target = join(out, file)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, buf)
  console.log(`${file.padEnd(28)} ${(buf.length / 1024).toFixed(0).padStart(5)} KB  ${Date.now() - t} ms`)
}
await browser.close()
