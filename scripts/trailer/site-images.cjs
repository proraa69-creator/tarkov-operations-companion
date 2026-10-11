// The website presentation's pictures from the trailer shots (README.md «The website's presentation»):
//   node scripts/trailer/site-images.cjs        scripts/trailer/shots    → website/src/assets/promo/*.webp
//   node scripts/trailer/site-images.cjs en     scripts/trailer/shots-en → website/src/assets/promo/*-en.webp
const sharp = require('sharp')
const { join } = require('node:path')
const ROOT = join(__dirname, '..', '..')
const EN = process.argv[2] === 'en'
const SH = join(__dirname, EN ? 'shots-en' : 'shots')
const SHRU = join(__dirname, 'shots')
const OUT = join(ROOT, 'website', 'src', 'assets', 'promo')
const webp = (img) => img.webp({ quality: 80, effort: 6 })
const save = async (img, name) => { const info = await webp(img).toFile(join(OUT, `${name}${EN ? '-en' : ''}.webp`)); console.log(name, info.width, info.height, Math.round(info.size / 1024) + ' KB') }
;(async () => {
  await save(sharp(join(SH, 'dashboard.png')).resize({ width: 1200 }), 'overview')
  await save(sharp(join(SH, 'overlay-sneaker.png')).resize({ width: 560 }), 'item-sneaker')
  await save(sharp(join(SH, 'overlay-gpu.png')).resize({ width: 560 }), 'item-gpu')
  for (const mode of ['pvp', 'pve', 'season']) await save(sharp(join(SH, `mode-${mode}.png`)).resize({ width: 900 }), `mode-${mode}`)
  // the first three maps of «Квесты по картам», large enough to read
  const q = await sharp(join(SH, 'squad-board-panel.png')).metadata()
  await save(sharp(join(SH, 'squad-board-panel.png')).extract({ left: 0, top: 0, width: Math.round(q.width * 0.6), height: q.height }).resize({ width: 1200 }), 'squad-board')
  // ballistics: without the sidebar (its version line) — the page content only
  const b = await sharp(join(SH, 'ballistics.png')).metadata()
  await save(sharp(join(SH, 'ballistics.png')).extract({ left: 444, top: 0, width: b.width - 444, height: b.height }).resize({ width: 1200 }), 'ballistics')
  await save(sharp(join(SH, 'overlay-minimap.png')).resize({ width: 560 }), 'minimap')
  await save(sharp(join(SH, 'update-card.png')).resize({ width: 720 }), 'update')
  for (const id of ['tarkov', 'blackmc', 'slate', 'telnyashka', 'gear']) await save(sharp(join(SH, `theme-${id}.png`)).resize({ width: 640 }), `theme-${id}`)
  await save(sharp(join(SH, 'phone.png')).resize({ width: 520 }), 'phone-overview')
  await save(sharp(join(SH, 'phone-live.png')).resize({ width: 520 }), 'phone-live')
  // Bosses: Tagilla's 3D model next to the health card, on the gallery's dark backdrop (the trailer's scene 06)
  const W = 1200, H = 675
  const backdrop = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs><radialGradient id="g" cx="32%" cy="55%" r="70%"><stop offset="0" stop-color="#26301f"/><stop offset="1" stop-color="#070a08"/></radialGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`)
  const model = await sharp(join(SHRU, 'boss3d-0-00.png')).trim({ threshold: 4 }).resize({ height: 620 }).png().toBuffer()
  const modelMeta = await sharp(model).metadata()
  const card = await sharp(join(SH, 'bosshp-0-idle.png')).resize({ height: 600 }).png().toBuffer()
  const cardMeta = await sharp(card).metadata()
  const img = sharp(backdrop).composite([
    { input: model, left: Math.round(W * 0.27 - modelMeta.width / 2), top: Math.round((H - modelMeta.height) / 2) + 10 },
    { input: card, left: W - cardMeta.width - 70, top: Math.round((H - cardMeta.height) / 2) },
  ])
  await save(img, 'boss-tagilla')
})()
