// Scene 15: the colour theme switched three times from the top bar, then the start-up update window of the desktop
// app (driven through the stand-in bridge: download progress, check, install) — the real UpdateOverlay component.
import { beginTake } from '../take.mjs'
import { squadBridge } from '../squad/bridge.mjs'
const lang = process.argv[2] ?? 'ru'
const VERSION = '0.6.0.27'
const { page, rec, at, v, scenes, tx, finish } = await beginTake('t09c-themes-update', {
  lang, hash: '#/', mouse: { x: 1200, y: 640 }, extraInit: [squadBridge({ squadName: lang === 'en' ? 'Night squad' : 'Ночной отряд' })],
})
const update = (next) => page.evaluate((n) => window.__update(n), next)
const themeButton = 'button.theme-cycle'

// «Оформление можно сменить под себя.»
await at(v(15, -0.3)); await rec.moveTo(themeButton, { duration: 400 })
await at(v(15, 0.1)); await rec.ring({ id: 'theme', target: themeButton, pad: 6, radius: 12 }); await rec.card({ target: themeButton, side: 'bottom', ...tx.themes })
for (const t of [0.3, 0.85, 1.4]) { await at(v(15, t)); await rec.click(null) }
await at(v(15, 1.95)); await rec.overlay('clearAll')
// «Автообновление приложения, у тебя всегда свежая версия.»
await at(v(15, 2.1)); await update({ state: 'downloading', version: VERSION, progress: 0 })
await at(v(15, 2.35)); await rec.card({ target: '.update-overlay-card', side: 'left', ...tx.update })
let progress = 0
for (const t of [2.4, 2.7, 3.0, 3.3, 3.6, 3.9, 4.2]) { await at(v(15, t)); progress = Math.min(100, progress + (t === 4.2 ? 100 : 15 + Math.round(t * 2))); await update({ state: 'downloading', version: VERSION, progress }) }
await at(v(15, 4.45)); await update({ state: 'downloading', phase: 'verifying', version: VERSION, progress: 100 })
await at(v(15, 5.05)); await update({ state: 'installing', version: VERSION, progress: 100 })
await at(scenes[15].end - 0.35); await rec.overlay('clearAll')
console.log('t09c length', await finish())
