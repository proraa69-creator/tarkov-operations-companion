// Ad images from the promo: frames of the finished takes in a few social formats (cover 16:9, three squares, a 4:5
// feed post and a 9:16 story).   node ads/build.mjs ru
import { chromium, stageAssets } from '../../env.mjs'
import { mkdirSync } from 'node:fs'
import { S } from '../rec.mjs'
const lang = process.argv[2] ?? 'ru'
const DIR = `${S}/promo/rec/ads`
await stageAssets(DIR)
const OUT = `${S}/promo/out/ads-${lang}`
mkdirSync(OUT, { recursive: true })
const TEXT = {
  ru: {
    download: 'Скачать для Windows', soonPhones: 'Скоро — на iPhone и Android', tag1: 'Меньше вкладок,', tag2: 'больше рейдов.',
    trust: 'Не внедряется в игру и не читает её память',
    cover: { eyebrow: 'Приложение для Escape from Tarkov', title: 'Всё для рейда —<br><span class="hot">в одном окне</span>',
      bullets: ['Квесты и сюжет — синхронизация с игрой', 'Каппа: скан схрона одной клавишей', 'Информация о предмете прямо в рейде', 'Мини-карта поверх игры'] },
    squares: {
      kappa: { eyebrow: 'Каппа', title: 'Нажал клавишу — предметы уже в приложении' },
      item: { eyebrow: 'В рейде', title: 'Нужен ли предмет — видно сразу' },
      minimap: { eyebrow: 'Мини-карта', title: 'Поверх игры: ты и квесты рядом' },
    },
    feed: { lead: 'Квесты, Каппа, карты и отряд — в одном приложении', labels: ['Каппа одной клавишей', 'Предмет в рейде', 'Мини-карта поверх игры', 'Оружейник'] },
    story: { labels: ['Каппа: скан схрона', 'Предмет в рейде', 'Мини-карта'] },
  },
  en: {
    download: 'Download for Windows', soonPhones: 'Soon on iPhone and Android', tag1: 'Fewer tabs,', tag2: 'more raids.',
    trust: 'Doesn’t inject into the game or read its memory',
    cover: { eyebrow: 'The companion app for Escape from Tarkov', title: 'Everything for the raid —<br><span class="hot">in one window</span>',
      bullets: ['Quests and story synced with the game', 'Kappa: scan your stash with one key', 'Item info right in the raid', 'A minimap on top of the game'] },
    squares: {
      kappa: { eyebrow: 'Kappa', title: 'Press a key — the items are in the app' },
      item: { eyebrow: 'In raid', title: 'Needed or not — see it at once' },
      minimap: { eyebrow: 'Minimap', title: 'On top of the game: you and nearby quests' },
    },
    feed: { lead: 'Quests, Kappa, maps and your squad in one app', labels: ['Kappa with one key', 'Item info in raid', 'Minimap over the game', 'Gunsmith'] },
    story: { labels: ['Kappa: stash scan', 'Item info in raid', 'Minimap'] },
  },
}
const f = (name) => `frames-${lang}/${name}.png`
const frames = { overview: f('overview') }
const crops = {
  kappa: { img: f('kappa'), x: 40, y: 0, w: 1080, h: 1080 },
  item: { img: f('item'), x: 820, y: 0, w: 1080, h: 1080 },
  minimap: { img: f('minimap-b'), x: 1210, y: 0, w: 680, h: 680 },
  kappa2: { img: f('kappa'), x: 40, y: 140, w: 1100, h: 800 },
  item2: { img: f('item'), x: 800, y: 330, w: 820, h: 596 },
  minimap2: { img: f('minimap-b'), x: 1214, y: 0, w: 700, h: 509 },
  gunsmith2: { img: f('gunsmith'), x: 930, y: 120, w: 980, h: 712 },
  kappa3: { img: f('kappa'), x: 40, y: 140, w: 1100, h: 520 },
  item3: { img: f('item'), x: 790, y: 300, w: 700, h: 752 },
  minimap3: { img: f('minimap-b'), x: 1214, y: 10, w: 690, h: 742 },
}
const ADS = [
  ['cover-1920x1080', { layout: 'cover', w: 1920, h: 1080 }],
  ['kappa-1080x1080', { layout: 'square', key: 'kappa', w: 1080, h: 1080 }],
  ['item-1080x1080', { layout: 'square', key: 'item', w: 1080, h: 1080 }],
  ['minimap-1080x1080', { layout: 'square', key: 'minimap', w: 1080, h: 1080 }],
  ['feed-1080x1350', { layout: 'feed', w: 1080, h: 1350 }],
  ['story-1080x1920', { layout: 'story', w: 1080, h: 1920 }],
]
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--force-color-profile=srgb'] })
for (const [name, spec] of ADS) {
  const page = await browser.newPage({ viewport: { width: spec.w, height: spec.h } })
  await page.goto(`file://${DIR}/stage.html?p=${encodeURIComponent(JSON.stringify({ ...spec, text: TEXT[lang], frames, crops }))}`)
  await page.evaluate(() => window.ready); await page.waitForTimeout(200)
  await page.screenshot({ path: `${OUT}/raidos-${name}-${lang}.png` })
  await page.close()
  console.log(name)
}
await browser.close()
