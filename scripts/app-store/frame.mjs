// App Store pictures with a caption (docs/app-store/README.md): every clean screen of capture.mjs under a short line of
// text, at the same exact pixel size, as JPEG (App Store Connect takes .jpg/.png without transparency).
//
//   node scripts/app-store/frame.mjs            raw/<locale>/<device>-<orient>/NN-<screen>.png
//                                               → docs/app-store/screenshots/<locale>/<device>-<orient>/NN-<screen>.jpg
//
// The captions are below (CAPTIONS), short as every text of the app; the clean screens are also written as JPEG
// next to them (clean/), for a listing without captions.
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { chromium } from '../../node_modules/playwright/index.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = process.env.APPSTORE_FRAMED ?? join(here, '..', '..', 'docs', 'app-store', 'screenshots')
const RAW = process.env.APPSTORE_RAW ?? join(ROOT, 'raw')
const sharp = createRequire(import.meta.url)('sharp')
const FONTS = pathToFileURL(join(here, '..', 'trailer', 'assets', 'fonts')).href

/** One line per screen, two at most where the words need it (`\n`). */
export const CAPTIONS = {
  ru: {
    overview: 'План рейда:\nчто взять с собой',
    quests: 'Цели квестов\nи фото мест',
    maps: 'Карты с квестами\nи выходами',
    gunsmith: 'Оружейник:\nсборка по частям',
    flea: 'Цены барахолки\nи торговцев',
    bosses: 'Боссы в 3D',
    ballistics: 'Баллистика\nвсех патронов',
    kappa: 'Путь к Каппе',
    hideout: 'Что собрать\nдля квестов',
  },
  en: {
    overview: 'Raid plan:\nwhat to bring',
    quests: 'Quest objectives\nwith photos',
    maps: 'Maps with quests\nand extracts',
    gunsmith: 'Gunsmith builds,\npart by part',
    flea: 'Flea market and\ntrader prices',
    bosses: 'Bosses in 3D',
    ballistics: 'Ballistics of\nevery round',
    kappa: 'Track your Kappa',
    hideout: 'Items for quests',
  },
}
/** Landscape: one line. */
const ACROSS = { ru: { maps: 'Карта на весь экран' }, en: { maps: 'Full-screen maps' } }

const escape = (text) => text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])
function html({ width, height, portrait, caption, shot }) {
  const unit = Math.min(width, height) / 100
  const lines = portrait ? caption.split('\n') : [caption.replace('\n', ' ')]
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: 'Inter'; font-weight: 100 900; src: url(${FONTS}/inter-cyrillic.woff2) format('woff2'); unicode-range: U+0400-045F; }
@font-face { font-family: 'Inter'; font-weight: 100 900; src: url(${FONTS}/inter-latin.woff2) format('woff2'); unicode-range: U+0000-00FF, U+2000-206F; }
* { margin: 0; box-sizing: border-box; }
html, body { width: ${width}px; height: ${height}px; overflow: hidden; }
body { background: radial-gradient(120% 70% at 50% 0%, #22301f 0%, #121a14 46%, #0b100d 100%); color: #ece6d3;
  font-family: Inter, sans-serif; display: flex; flex-direction: column; align-items: center; }
/* The same caption block on every picture (two lines' room), so the phone is the same size on all of them. */
.cap { flex: 0 0 auto; width: 100%; height: ${portrait ? unit * 46 : unit * 22}px; padding: ${portrait ? unit * 10 : unit * 4}px ${unit * 6}px ${portrait ? unit * 5 : unit * 3}px;
  display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
.cap .bar { flex: 0 0 auto; width: ${unit * 12}px; height: ${unit * 1.1}px; margin: 0 auto ${unit * 4}px; border-radius: 99px; background: #c4a665; }
.cap h1 { max-width: 100%; white-space: nowrap; font-weight: 800; font-size: ${portrait ? unit * 9.4 : unit * 8}px; line-height: 1.08; letter-spacing: -.02em; }
.shot { flex: 1 1 auto; min-height: 0; display: flex; align-items: flex-start; justify-content: center; width: 100%; padding: 0 ${unit * 6}px ${unit * 6}px; }
.shot img { display: block; max-width: 100%; max-height: 100%; border-radius: ${unit * (portrait ? 7 : 5)}px;
  border: ${unit * 0.7}px solid #2d3a2f; box-shadow: 0 ${unit * 3}px ${unit * 9}px rgb(0 0 0 / 55%); }
</style></head><body>
<div class="cap"><div class="bar"></div><h1>${lines.map(escape).join('<br>')}</h1></div>
<div class="shot"><img src="${shot}"></div>
</body></html>`
}

const browser = await chromium.launch()
let count = 0
for (const locale of readdirSync(RAW)) {
  for (const set of readdirSync(join(RAW, locale))) {
    const portrait = set.endsWith('portrait')
    const files = readdirSync(join(RAW, locale, set)).filter((f) => f.endsWith('.png')).sort()
    if (!files.length) continue
    const outDir = join(ROOT, locale, set)
    const cleanDir = join(ROOT, 'clean', locale, set)
    mkdirSync(outDir, { recursive: true })
    mkdirSync(cleanDir, { recursive: true })
    const { width, height } = await sharp(join(RAW, locale, set, files[0])).metadata()
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
    for (const file of files) {
      const raw = join(RAW, locale, set, file)
      const name = file.replace(/^\d+-|\.png$/g, '')
      const caption = (portrait ? CAPTIONS[locale]?.[name] : ACROSS[locale]?.[name] ?? CAPTIONS[locale]?.[name]) ?? ''
      const shot = `data:image/png;base64,${readFileSync(raw).toString('base64')}`
      await page.setContent(html({ width, height, portrait, caption, shot }), { waitUntil: 'load' })
      // a line wider than the picture: smaller type, not a third line
      await page.evaluate(async () => {
        await document.fonts.ready
        const h1 = document.querySelector('h1')
        let size = parseFloat(getComputedStyle(h1).fontSize)
        while (h1.scrollWidth > h1.clientWidth + 1 && size > 20) { size -= 2; h1.style.fontSize = `${size}px` }
      })
      const png = await page.screenshot({ type: 'png' })
      const jpg = file.replace(/\.png$/, '.jpg')
      await sharp(png).flatten({ background: '#0b100d' }).jpeg({ quality: 88, chromaSubsampling: '4:4:4', mozjpeg: true }).toFile(join(outDir, jpg))
      await sharp(raw).flatten({ background: '#0b100d' }).jpeg({ quality: 88, chromaSubsampling: '4:4:4', mozjpeg: true }).toFile(join(cleanDir, jpg))
      count += 1
    }
    await page.close()
    console.log(`${locale} ${set}: ${files.length}`)
  }
}
await browser.close()
console.log(`${count} pictures`)
if (!existsSync(RAW)) console.log('no raw screens: run capture.mjs first')
