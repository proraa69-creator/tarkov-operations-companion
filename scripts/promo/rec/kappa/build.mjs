// Scene 4b: the owner's stash clip and app clip side by side, a key press, the items in the app a second later.
import { chromium } from '../../env.mjs'
import { mkdirSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { schedule, takes } from '../schedule.mjs'
import { T } from '../texts.mjs'
import { S, FF } from '../rec.mjs'
const lang = process.argv[2] ?? 'ru'
const { scenes } = schedule(lang)
const take = takes(lang).list.find((entry) => entry.id === 't03-kappa')
const frames = Math.round((take.to - take.from) * 30)
const keyAt = scenes[4].voice + 2.4 - take.from
const appOffset = 9.2 - (keyAt + 1.0)
const G = { x: 80, y: 200, w: 590, h: 800 }
const A = { x: 710, y: 290, w: 1130, h: 624, s: 1130 / 1920, counter: { x: 330, y: 230 }, counterBox: { x: 284, y: 210, w: 214, h: 40 } }
const tx = T[lang]
const text = { game: tx.kappaGame, app: tx.kappaApp, keyCaption: lang === 'en' ? 'Scan key' : 'Клавиша скана', card: lang === 'en' ? { eyebrow: 'Kappa', title: 'A second later — in the app', text: 'The items found are checked off by themselves.' } : { eyebrow: 'Каппа', title: 'Через секунду — в приложении', text: 'Найденные предметы отмечены сами.' } }
const out = `${S}/promo/out/${lang}`
const dir = `${S}/promo/rec/kappa/${lang}`
rmSync(dir, { recursive: true, force: true }); mkdirSync(`${dir}/ov`, { recursive: true }); mkdirSync(out, { recursive: true })
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--force-color-profile=srgb'] })
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
const url = (layer) => `file://${S}/promo/rec/kappa/layers.html?p=${encodeURIComponent(JSON.stringify({ layer, game: G, app: A, key: 'K', keyAt, text }))}`
await page.goto(url('bg')); await page.screenshot({ path: `${dir}/bg.png` })
await page.goto(url('ov')); await page.waitForTimeout(300)
for (let i = 0; i < frames; i += 1) {
  await page.evaluate((t) => window.render(t), i / 30)
  await page.screenshot({ path: `${dir}/ov/${String(i).padStart(4, '0')}.png`, omitBackground: true })
}
await browser.close()
const dur = (frames / 30).toFixed(4)
execFileSync(FF, ['-v', 'error', '-y',
  '-loop', '1', '-framerate', '30', '-i', `${dir}/bg.png`,
  '-i', `${S}/promo/src/game-stash.mp4`,
  '-ss', appOffset.toFixed(3), '-i', `${S}/promo/src/app-kappa.mp4`,
  '-framerate', '30', '-i', `${dir}/ov/%04d.png`,
  '-filter_complex',
  `[1:v]fps=30,crop=520:705:1150:160,scale=${G.w}:${G.h}:flags=lanczos,tpad=stop_mode=clone:stop_duration=10[g];` +
  `[2:v]fps=30,scale=${A.w}:${A.h}:flags=lanczos,tpad=stop_mode=clone:stop_duration=10[a];` +
  `[0:v][g]overlay=${G.x}:${G.y}:shortest=0[x];[x][a]overlay=${A.x}:${A.y}[y];[y][3:v]overlay=0:0,format=yuv420p[v]`,
  '-map', '[v]', '-t', dur, '-r', '30', '-c:v', 'libx264', '-preset', 'medium', '-crf', '15', '-movflags', '+faststart', `${out}/t03-kappa.mp4`], { stdio: 'inherit' })
console.log('t03-kappa', dur, 's, key at', keyAt.toFixed(2), 'app offset', appOffset.toFixed(2))
