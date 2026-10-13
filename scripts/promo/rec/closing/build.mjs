// Takes t01 (intro) and t10 (scenes 18–20): drawn scenes, rendered frame by frame from stage.html (exact timing, no
// recorder), the phones showing the app's own phone layout (phones.mjs) and the intro ending on the first frame of t02.
//   node closing/build.mjs ru [intro|closing]
import { chromium, stageAssets } from '../../env.mjs'
import { spawn, execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { schedule, takes } from '../schedule.mjs'
import { S, FF } from '../rec.mjs'
const lang = process.argv[2] ?? 'ru'
const only = process.argv[3]
const DIR = `${S}/promo/rec/closing`
await stageAssets(DIR)
const OUT = `${S}/promo/out/${lang}`
const { scenes } = schedule(lang)
const list = takes(lang).list
const TEXT = {
  ru: {
    introSub: 'Приложение для <em>Escape from Tarkov</em>',
    soon: 'Скоро', phonesTitle: 'iOS <b>и</b> Android', phonesLead: '<strong>Полноценное приложение</strong>, а не урезанная версия.',
    fairEyebrow: 'И главное', fairTitle: 'Raid OS не нарушает правила игры',
    fairRows: ['Не внедряется в игру', 'Не читает её память', 'Не меняет её файлы', 'Ничего не делает за тебя'],
    tag1: 'Меньше вкладок,', tag2: 'больше рейдов.', download: 'Скачать для Windows', soonPhones: 'Скоро — на iPhone и Android',
  },
  en: {
    introSub: 'The companion app for <em>Escape from Tarkov</em>',
    soon: 'Coming soon', phonesTitle: 'iOS <b>and</b> Android', phonesLead: '<strong>The full app</strong>, not a cut-down version.',
    fairEyebrow: 'Most importantly', fairTitle: 'Raid OS doesn’t break the game’s rules',
    fairRows: ['Doesn’t inject into the game', 'Doesn’t read its memory', 'Doesn’t change its files', 'Doesn’t play for you'],
    tag1: 'Fewer tabs,', tag2: 'more raids.', download: 'Download for Windows', soonPhones: 'Soon on iPhone and Android',
  },
}
// Phrase starts inside the voice clips (seconds from the clip start), from silencedetect at -34 dB / 70 ms.
const PHRASES = {
  ru: { s1: 1.17, s18: 3.17, s19: [0.98, 3.56, 4.75, 5.99, 7.17], s20: [1.08, 2.18, 3.41] },
}
const ph = PHRASES[lang] ?? PHRASES.ru

async function render(id, params) {
  const take = list.find((entry) => entry.id === id)
  const frames = Math.round(take.to * 30) - Math.round(take.from * 30)
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--force-color-profile=srgb'] })
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
  const p = { ...params, text: TEXT[lang], duration: frames / 30 }
  await page.goto(`file://${DIR}/stage.html?p=${encodeURIComponent(JSON.stringify(p))}`)
  await page.evaluate(() => window.ready)
  await page.waitForTimeout(300)
  const out = `${OUT}/${id}.mp4`
  const ff = spawn(FF, ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', '30', '-c:v', 'mjpeg', '-i', '-', '-c:v', 'libx264', '-preset', 'medium', '-crf', '15', '-pix_fmt', 'yuv420p', '-r', '30', '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] })
  for (let i = 0; i < frames; i += 1) {
    await page.evaluate((t) => window.render(t), i / 30)
    const shot = await page.screenshot({ type: 'jpeg', quality: 95 })
    if (!ff.stdin.write(shot)) await new Promise((resolve) => ff.stdin.once('drain', resolve))
  }
  ff.stdin.end()
  await new Promise((resolve) => ff.on('close', resolve))
  await browser.close()
  console.log(`${id}: ${frames} frames (${(frames / 30).toFixed(2)} s)`)
}

if (!only || only === 'intro') {
  const t02 = `${OUT}/t02-overview.mp4`
  if (!existsSync(t02)) throw new Error('t02 first: the intro ends on its first frame')
  execFileSync(FF, ['-v', 'error', '-y', '-i', t02, '-frames:v', '1', `${DIR}/intro-bg-${lang}.png`])
  await render('t01-intro', { scene: 'intro', introBg: `intro-bg-${lang}.png`, voice: scenes[1].voice, phrase2: scenes[1].voice + ph.s1 })
}
if (!only || only === 'closing') {
  const from = list.find((entry) => entry.id === 't10-closing').from
  const phones = Object.fromEntries(['overview', 'maps', 'kappa'].map((n) => [n, { content: `phone-${lang}-${n}.png`, top: `phone-${lang}-${n}-top.png`, tabs: `phone-${lang}-${n}-tabs.png` }]))
  const at = {
    v18: scenes[18].voice - from, p18b: ph.s18,
    s19: scenes[19].start - from, v19: scenes[19].voice - from, p19: ph.s19,
    s20: scenes[20].start - from, v20: scenes[20].voice - from, p20: ph.s20,
  }
  await render('t10-closing', { scene: 'closing', phones, at })
}
