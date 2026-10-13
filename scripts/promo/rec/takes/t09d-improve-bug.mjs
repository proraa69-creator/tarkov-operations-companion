// Scenes 16–17: «Мы постоянно улучшаем приложение…» — a quick run through the sections, the data refresh button; then
// «Нашёл ошибку?» — the bug report window with its «+1 день» banner, filled in and sent (the stand-in server accepts it).
import { beginTake } from '../take.mjs'
import { ready } from '../rec.mjs'
import { squadBridge } from '../squad/bridge.mjs'
const lang = process.argv[2] ?? 'ru'
const L = lang === 'en'
  ? { refresh: 'Refresh data', bug: 'Report a bug', topic: 'Minimap does not open', text: 'M shows nothing in raid.' }
  : { refresh: 'Обновить данные', bug: 'Сообщить об ошибке', topic: 'Не открывается мини-карта', text: 'M в рейде ничего не показывает.' }
const PAGES = ['#/gunsmith', '#/gallery', '#/squad?tab=squad', '#/']
const WINDOWS_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) raid-os/0.6.0.26 Chrome/138.0.0.0 Electron/37.2.0 Safari/537.36'
const { page, rec, at, v, scenes, tx, finish } = await beginTake('t09d-improve-bug', {
  lang, hash: '#/kappa-items', mouse: { x: 1180, y: 760 }, userAgent: WINDOWS_UA,
  extraInit: [squadBridge({ squadName: lang === 'en' ? 'Night squad' : 'Ночной отряд' })],
  prepare: async (page) => {
    for (const hash of [...PAGES, '#/kappa-items']) { await page.evaluate((h) => { location.hash = h }, hash); await ready(page, 900) }
  },
})
const go = (hash) => page.evaluate((h) => { location.hash = h }, hash)
const refresh = `button[aria-label="${L.refresh}"]`
async function type(text, perChar) { for (const ch of text) { await page.keyboard.type(ch); await rec.vsleep(perChar) } }

// 16 · «Мы постоянно улучшаем приложение и добавляем новое,»
await at(v(16, 0.05)); await rec.card({ at: { x: 1380, y: 96 }, ...tx.improve, arrow: false })
for (const [i, hash] of PAGES.entries()) { await at(v(16, 0.5 + i * 0.68)); await go(hash) }
// «а база всегда обновляется.»
await at(v(16, 3.05)); await rec.overlay('hideCard', 'main'); await rec.moveTo(refresh, { duration: 450 })
await at(v(16, 3.5)); await rec.ring({ id: 'sync', target: refresh, pad: 6, radius: 12 }); await rec.card({ target: refresh, side: 'bottom', ...tx.dataFresh })
await at(v(16, 3.7)); await rec.click(null)
await at(scenes[16].end - 0.35); await rec.overlay('clearAll')
// 17 · «Нашёл ошибку?»
await at(v(17, -0.45)); await rec.click(`.support-nav-link:has-text("${L.bug}")`, { duration: 480 })
await at(v(17, 0.45)); await rec.ring({ id: 'bonus', target: '.bug-report-reward', pad: 6, radius: 12 }); await rec.card({ target: '.bug-report-reward', side: 'right', ...tx.bug })
// «Сообщи о ней, и если она подтвердится, к подписке добавится день.»
await at(v(17, 1.2)); await rec.click('.bug-report-form input.input', { duration: 380, dx: 0.3 }); await type(L.topic, 16)
await rec.click('.bug-report-form textarea', { duration: 300, dx: 0.3, dy: 0.3 }); await type(L.text, 12)
await at(v(17, 3.75)); await rec.click('.bug-report-form button[type=submit]', { duration: 420 })
await at(v(17, 4.25)); await rec.overlay('hideCard', 'main'); await rec.ring({ id: 'bonus', target: '.bug-report-done', pad: 6, radius: 12 })
await at(scenes[17].end - 0.3); await rec.overlay('clearAll')
console.log('t09d length', await finish())
