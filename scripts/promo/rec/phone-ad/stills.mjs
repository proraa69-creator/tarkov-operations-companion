// Pictures for an Instagram post from the phone-apps ad (owner, 21.10.2026: «сделай мне скриншоты из видео картинки для
// соцсетей… на русском и английском»): six slides per language, drawn by stage.html as stills from the phone take —
// a 4:5 carousel for the feed (1080 × 1350, the phone placed to fit) and the full 9:16 frames for stories.
//   node phone-ad/stills.mjs ru|en   → promo/out/posts/<lang>/post-0N-<slide>.jpg and story-0N-<slide>.jpg
import { chromium, stageAssets } from '../../env.mjs'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { FF, S } from '../rec.mjs'
import { stashParams, STASH, TEXT } from './content.mjs'
import { takeSpan, timeline } from './timeline.mjs'

const lang = process.argv[2] === 'en' ? 'en' : 'ru'
const { voice: VOICE, scenes: SCENES, moments: M } = timeline(lang)
const DIR = `${S}/promo/rec/phone-ad`
const OUT = `${S}/promo/out/posts/${lang}`
await stageAssets(DIR)

/** Second of the video, the post's phone place and crop, pointers on, the camera in the phone, the key held up. */
const SLIDES = [
  { name: 'intro', t: 5.2, post: { place: [540, 1500, 0.8], top: 60 } },
  { name: 'inside', t: SCENES.tour[0] + 2.1, pointers: ['nav'], post: { place: [540, 900, 0.72], top: 60 } },
  { name: 'map', t: M.positionSent + 2.0, pointers: ['map', 'me'], zoom: 'none', key: true,
    post: { place: [780, 978, 0.54], top: 20, pos: { map: [36, 1090], me: [36, 1230] } } },
  { name: 'item', t: M.itemSent + 2.2, pointers: ['price', 'kappa'], zoom: 'item', key: true,
    post: { place: [780, 978, 0.54], top: 20, pos: { price: [36, 1090], kappa: [36, 1230] } } },
  { name: 'chat', t: M.chat + 1.0, pointers: ['chat'], post: { place: [640, 905, 0.7], top: 60, pos: { chat: [30, 1060] } } },
  { name: 'outro', t: 33.6, post: { top: 300, discTop: 1560 } },
]

const take = `${S}/promo/out/phone-ad/phone-${lang}.mp4`
const boxes = JSON.parse(readFileSync(`${S}/promo/out/phone-ad/boxes-${lang}.json`, 'utf8'))
const frames = `${DIR}/frames-still`
rmSync(frames, { recursive: true, force: true }); mkdirSync(frames, { recursive: true })
const icons = `${DIR}/frames-icons`
mkdirSync(icons, { recursive: true })
for (const id of new Set(Object.values(STASH))) {
  if (!existsSync(`${icons}/${id}.webp`)) execFileSync('curl', ['-sS', '-m', '60', '-o', `${icons}/${id}.webp`, `https://assets.tarkov.dev/${id}-icon.webp`])
}
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--force-color-profile=srgb'] })
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } })
page.on('pageerror', (error) => console.log('  pageerror:', error.message))
const base = { lang, text: TEXT[lang], ...stashParams(), scenes: SCENES, moments: M, voice: VOICE.map((line) => ({ at: line.at, dur: line.dur })), boxes }

for (const [index, slide] of SLIDES.entries()) {
  // The phone as it was at that second of the take (the take ends with «testing»; the outro has no phone).
  const phone = `frames-still/${slide.name}.png`
  execFileSync(FF, ['-v', 'error', '-y', '-ss', String(Math.min(slide.t, takeSpan(lang).to - 0.15)), '-i', take, '-frames:v', '1', '-update', '1', `${DIR}/${phone}`])
  const shared = { pointers: slide.pointers ?? [], zoom: slide.zoom, key: slide.key }
  const n = String(index + 1).padStart(2, '0')
  for (const kind of ['story', 'post']) {
    const still = kind === 'post' ? { ...shared, ...slide.post } : shared
    await page.goto(`file://${DIR}/stage.html?p=${encodeURIComponent(JSON.stringify({ ...base, still }))}`)
    await page.evaluate(() => window.ready)
    await page.evaluate(async ([src, t]) => { await window.setPhone(src); window.render(t); await new Promise(requestAnimationFrame) }, [phone, slide.t])
    const file = `${OUT}/${kind}-${n}-${slide.name}.jpg`
    await page.screenshot({ path: file, type: 'jpeg', quality: 93, clip: kind === 'post' ? { x: 0, y: slide.post.top, width: 1080, height: 1350 } : undefined })
    console.log(file)
  }
}
await browser.close()
