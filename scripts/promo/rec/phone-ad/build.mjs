// Builds the phone-apps ad in one language from its phone take (take.mjs): 1080 × 1920, 30 fps — the app inside an
// iPhone, the PC monitor with the phone popping up over it on the screenshot, numbered pointers to what the voice talks
// about; the voice lines placed by timeline.mjs, the repo's synthesised interface sounds (sound.mjs), −14 LUFS.
//   node phone-ad/build.mjs ru|en [--reuse]   → promo/out/raidos-phone-ad-<lang>.mp4 (calm pad + sounds) and -voice.mp4
// --reuse keeps the rendered picture and redoes only the sound.
import { chromium, stageAssets } from '../../env.mjs'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { FF, S } from '../rec.mjs'
import { DURATION, FPS, takeSpan, timeline } from './timeline.mjs'

const lang = process.argv[2] === 'en' ? 'en' : 'ru'
const { voice: VOICE, voiceDir, scenes: SCENES, moments: MOMENTS } = timeline(lang)
const TAKE = takeSpan(lang)
const DIR = `${S}/promo/rec/phone-ad`
const OUT = `${S}/promo/out/phone-ad`
const VOICE_DIR = `${S}/promo/voice/${voiceDir}`
const PHONE_TAKE = `${OUT}/phone-${lang}.mp4`
await stageAssets(DIR)
const frames = Math.round(DURATION * FPS)
const video = `${OUT}/picture-${lang}.mp4`
const countFrames = (file) => Number([...spawnSync(FF, ['-hide_banner', '-i', file, '-map', '0:v:0', '-f', 'null', '-'], { encoding: 'utf8' }).stderr.matchAll(/frame=\s*(\d+)/g)].pop()?.[1])
const reuse = process.argv.includes('--reuse') && existsSync(video) && countFrames(video) === frames

const TEXT = {
  ru: {
    hello: 'Дорогие друзья!', introTitle: 'Приложения<br><em>для телефона</em>',
    chips: ['Квесты', 'Карты', 'Боссы', 'Барахолка'], chipTimes: [0.1, 0.55, 1.05, 1.45],
    tourEyebrow: 'Всё с ПК — в кармане', tourTitle: 'Raid OS <em>в телефоне</em>',
    mapEyebrow: 'Клавиша скриншота на ПК', mapTitle: 'Карта открывается <em>сама</em>',
    itemEyebrow: 'Клавиша предмета на ПК', itemTitle: 'Что это и <em>сколько стоит</em>',
    testEyebrow: 'Тестируем каждый день', testTitle: 'Пишите нам, <em>что улучшить</em>', testSub: 'Прямо из приложения: «Ещё» → чат с поддержкой',
    illustration: 'Иллюстрация', compass: ['ЮЗ', 'З', 'СЗ'], stash: 'СХРОН', itemName: 'Потрепанная антикварная книга', itemKey: 'клавиша предмета', screenshotKey: 'скриншот',
    tagline: 'Меньше вкладок —<br><em>больше рейдов</em>', download: 'Скачать бесплатно:',
    disclaimer: 'Неофициальный фанатский проект. Escape from Tarkov — товарный знак Battlestate Games Limited. Проект не связан с Battlestate Games и не спонсируется ею.',
    pointers: { nav: 'Все разделы — внизу', map: 'Карта открылась сама', me: 'Вы здесь', hover: 'Наведите на предмет', price: 'Цены: барахолка и торговец', kappa: 'Нужен для Каппы', chat: 'Пишите нам здесь' },
  },
  en: {
    hello: 'Hey everyone!', introTitle: 'Raid OS<br><em>for your phone</em>',
    chips: ['Quests', 'Maps', 'Bosses', 'Flea market'], chipTimes: [0.05, 0.42, 0.8, 1.3],
    tourEyebrow: 'Your PC app, in your pocket', tourTitle: 'Raid OS <em>on the phone</em>',
    mapEyebrow: 'Screenshot key on the PC', mapTitle: 'The map opens <em>by itself</em>',
    itemEyebrow: 'Item key on the PC', itemTitle: 'What it is, <em>what it’s worth</em>',
    testEyebrow: 'Improving every day', testTitle: 'Tell us <em>what to improve</em>', testSub: 'Right in the app: More → Support chat',
    illustration: 'Illustration', compass: ['SW', 'W', 'NW'], stash: 'STASH', itemName: 'Battered antique book', itemKey: 'item key', screenshotKey: 'screenshot',
    tagline: 'Fewer tabs,<br><em>more raids</em>', download: 'Free download:',
    disclaimer: 'Unofficial fan project. Escape from Tarkov is a trademark of Battlestate Games Limited. This project is not affiliated with or sponsored by Battlestate Games.',
    pointers: { nav: 'Every section is down here', map: 'The map opened by itself', me: 'You are here', hover: 'Hover over an item', price: 'Prices: flea and trader', kappa: 'Needed for Kappa', chat: 'Message us here' },
  },
}

// The stash of the item scene: a few real item pictures (tarkov.dev assets) and the book the cursor goes to.
const BOOK_ID = '5bc9c049d4351e44f824d360'
const STASH = { 2: '544fb45d4bdc2dee738b4568', 5: '57347c5b245977448d35f6e1', 9: '59faff1d86f7746c51718c9c', 14: '590c5a7286f7747884343aea',
  19: '57347ca924597744596b4e71', 26: '57347c77245977448d35f6e2', 33: '5d0375ff86f774186372f685', 44: BOOK_ID, 50: '5c0530ee86f774697952d952', 61: '59e3577886f774176a362503' }
const BOOK_CELL = 44
const COLS = 13 // stage.html #cells

if (!reuse) {
  const phoneFrames = `${DIR}/frames-phone`
  rmSync(phoneFrames, { recursive: true, force: true }); mkdirSync(phoneFrames, { recursive: true })
  execFileSync(FF, ['-v', 'error', '-y', '-i', PHONE_TAKE, '-vf', `fps=${FPS}`, '-q:v', '2', `${phoneFrames}/%04d.jpg`])
  const taken = countFrames(PHONE_TAKE)
  console.log('phone frames', taken, 'for', Math.round((TAKE.to - TAKE.from) * FPS))

  // Item pictures, fetched once (curl trusts the agent proxy's CA).
  const icons = `${DIR}/frames-icons`
  mkdirSync(icons, { recursive: true })
  for (const id of new Set(Object.values(STASH))) {
    if (!existsSync(`${icons}/${id}.webp`)) execFileSync('curl', ['-sS', '-m', '60', '-o', `${icons}/${id}.webp`, `https://assets.tarkov.dev/${id}-icon.webp`])
  }

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--force-color-profile=srgb'] })
  const stash = Array.from({ length: COLS * 6 }, (_, i) => (STASH[i] ? `frames-icons/${STASH[i]}.webp` : ''))
  const bookCell = [(BOOK_CELL % COLS) * 66, Math.floor(BOOK_CELL / COLS) * 66].map((v, i) => v + [34, 80][i])
  const boxes = JSON.parse(readFileSync(`${OUT}/boxes-${lang}.json`, 'utf8'))
  const params = { lang, text: TEXT[lang], stash, bookCell, scenes: SCENES, moments: MOMENTS, voice: VOICE.map((line) => ({ at: line.at, dur: line.dur })), boxes }
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } })
  page.on('pageerror', (error) => console.log('  pageerror:', error.message))
  await page.goto(`file://${DIR}/stage.html?p=${encodeURIComponent(JSON.stringify(params))}`)
  await page.evaluate(() => window.ready)
  mkdirSync(OUT, { recursive: true })
  const enc = spawn(FF, ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-movflags', '+faststart', video], { stdio: ['pipe', 'inherit', 'inherit'] })
  const done = once(enc, 'close')
  // PROMO_FRAMES=12.5,20.8 renders only those seconds to PNGs for a look, not the video.
  const only = process.env.PROMO_FRAMES?.split(',').map(Number)
  for (let i = 0; i < frames; i += 1) {
    const t = i / FPS
    if (only && !only.some((x) => Math.round(x * FPS) === i)) continue
    const n = Math.min(taken, Math.max(1, Math.round((t - TAKE.from) * FPS) + 1))
    await page.evaluate(async ([src, t]) => { await window.setPhone(src); window.render(t) }, [`frames-phone/${String(n).padStart(4, '0')}.jpg`, t])
    const png = await page.screenshot({ type: 'png' })
    if (only) { writeFileSync(`${OUT}/look-${lang}-${t.toFixed(2)}.png`, png); continue }
    if (!enc.stdin.write(png)) await once(enc.stdin, 'drain')
    if (i % 150 === 0) console.log('frame', i, '/', frames)
  }
  enc.stdin.end()
  const [code] = await done
  await browser.close()
  if (only) process.exit(0)
  if (code !== 0) throw new Error(`encoder exited with ${code}`)
}
const got = countFrames(video)
if (got !== frames) throw new Error(`picture has ${got} frames, expected ${frames}`)

// ---- sound: the voice lines, interface sounds on the story's events, and the calm pad for the main version -------------
const taps = [7.9 + 0.42, 9.8 + 0.42, 10.9 + 0.42, MOMENTS.more + 0.45]
const cues = [
  { t: 0.15, kind: 'logo' },
  ...Object.values(SCENES).slice(1).map(([from]) => ({ t: from - 0.25, kind: 'whoosh' })),
  ...taps.map((t) => ({ t, kind: 'pop' })),
  { t: MOMENTS.screenshotKey, kind: 'key' }, { t: MOMENTS.positionSent + 0.35, kind: 'ping' },
  { t: MOMENTS.itemKey, kind: 'key' }, { t: MOMENTS.itemSent + 0.3, kind: 'ding' },
  { t: SCENES.outro[0] + 0.2, kind: 'end' },
]
writeFileSync(`${OUT}/cues-${lang}.json`, JSON.stringify({ duration: DURATION, cues }))
for (const style of ['ambient', 'sfx']) execFileSync('node', [`${S}/promo/rec/sound.mjs`, `--cues=${OUT}/cues-${lang}.json`, `--style=${style}`, `--out=${OUT}/bed-${lang}-${style}.wav`], { stdio: 'inherit' })

const ms = (x) => Math.round(x * 1000)
function mux(style, file) {
  const inputs = VOICE.flatMap((line) => ['-i', `${VOICE_DIR}/s0${line.id}.mp3`])
  const voices = VOICE.map((line, i) => `[${i}:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${ms(line.at)}|${ms(line.at)}[v${i}]`).join(';')
  const bed = VOICE.length
  const graph = `${voices};${VOICE.map((_, i) => `[v${i}]`).join('')}amix=inputs=${VOICE.length}:normalize=0:duration=longest,apad,atrim=0:${DURATION.toFixed(3)},asplit=2[vo][sc];` +
    `[${bed}:a]volume=${style === 'ambient' ? 0.55 : 0.8}[b];[b][sc]sidechaincompress=threshold=0.02:ratio=5:attack=15:release=400[duck];` +
    `[vo][duck]amix=inputs=2:normalize=0:duration=first,loudnorm=I=-14:TP=-1.5:LRA=11[a]`
  execFileSync(FF, ['-v', 'error', '-y', ...inputs, '-i', `${OUT}/bed-${lang}-${style}.wav`, '-i', video, '-filter_complex', graph,
    '-map', `${bed + 1}:v`, '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-shortest', '-movflags', '+faststart', file], { stdio: 'inherit' })
}
mux('ambient', `${S}/promo/out/raidos-phone-ad-${lang}.mp4`)
mux('sfx', `${S}/promo/out/raidos-phone-ad-${lang}-voice.mp4`)
console.log('phone ad', lang, DURATION, 's,', frames, 'frames →', `${S}/promo/out/raidos-phone-ad-${lang}.mp4`, '(+ -voice)')
