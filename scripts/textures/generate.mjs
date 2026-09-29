// Regenerates the procedural textures used by the textured themes (src/styles/themes.css).
//
//   node scripts/textures/generate.mjs                 # all textures
//   node scripts/textures/generate.mjs ocp rust        # only some
//   PW_CHROMIUM=/path/to/chrome node scripts/textures/generate.mjs
//
// Each texture is rendered once as a 4096² master (tile-able, lit height map — see texgen.js) inside headless
// Chromium, then written as WebP for 1× screens (2048²) and, where the size budget allows, for 2× screens
// (4096²). The themes show the tile at 2048 CSS px, so every file is displayed 1:1 or downscaled, never enlarged.
// Masters are not kept (add --masters <dir> to save a lossless copy outside the repo).
// Outputs land in src/assets/textures/<theme>/<texture>-<size>.webp; themes.css imports them via url().
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const outRoot = path.resolve(here, '../../src/assets/textures')

// texture -> theme folder, master size and the exported sizes (quality tuned so each theme stays inside budget)
export const TEXTURES = {
  blackmc: { theme: 'blackmc', master: 4096, out: [{ size: 2048, quality: 0.84 }, { size: 4096, quality: 0.6 }] },
  ocp: { theme: 'ocp', master: 4096, out: [{ size: 2048, quality: 0.82 }, { size: 4096, quality: 0.55 }] },
  woodland: { theme: 'woodland', master: 4096, out: [{ size: 2048, quality: 0.86 }, { size: 4096, quality: 0.66 }] },
  perforated: { theme: 'perforated', master: 4096, out: [{ size: 2048, quality: 0.86 }, { size: 4096, quality: 0.62 }] },
  rust: { theme: 'rust', master: 4096, out: [{ size: 2048, quality: 0.86 }, { size: 4096, quality: 0.66 }] },
  slate: { theme: 'slate', master: 4096, out: [{ size: 2048, quality: 0.84 }, { size: 4096, quality: 0.58 }] },
  tracksuit: { theme: 'telnyashka', master: 4096, out: [{ size: 2048, quality: 0.84 }, { size: 4096, quality: 0.6 }] },
  stripes: { theme: 'telnyashka', master: 2048, out: [{ size: 1024, quality: 0.86 }, { size: 2048, quality: 0.72 }] },
  grain: { theme: 'telnyashka', master: 512, out: [{ size: 512, quality: 0.8 }] },
}

const args = process.argv.slice(2)
const mastersAt = args.includes('--masters') ? args[args.indexOf('--masters') + 1] : null
const names = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--masters')
const selected = names.length ? names : Object.keys(TEXTURES)
for (const n of selected) if (!TEXTURES[n]) throw new Error(`unknown texture "${n}" (known: ${Object.keys(TEXTURES).join(', ')})`)

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined),
  args: ['--no-sandbox', '--js-flags=--max-old-space-size=8192'],
})
const write = (file, url) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64')) }
// four at a time keeps memory in check (each 4096² master needs ~1.5 GB of float buffers)
for (let i = 0; i < selected.length; i += 4) {
  await Promise.all(selected.slice(i, i + 4).map(async (name) => {
    const cfg = TEXTURES[name]
    const page = await browser.newPage()
    await page.addScriptTag({ path: path.join(here, 'texgen.js') })
    const outputs = mastersAt ? [...cfg.out, { size: cfg.master, quality: 1 }] : cfg.out
    const { urls, ms } = await page.evaluate(([n, s, o]) => window.renderTexture(n, s, o), [name, cfg.master, outputs])
    cfg.out.forEach(({ size }, k) => {
      const file = path.join(outRoot, cfg.theme, `${name}-${size}.webp`)
      write(file, urls[k])
      console.log(`${name} ${size}² ${(fs.statSync(file).size / 1e6).toFixed(2)} MB  (${ms} ms)`)
    })
    if (mastersAt) write(path.join(mastersAt, `${name}-master-${cfg.master}.webp`), urls.at(-1))
    await page.close()
  }))
}
await browser.close()
