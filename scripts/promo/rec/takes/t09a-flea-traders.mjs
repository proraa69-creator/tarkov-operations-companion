// Scenes 12–13: the flea market (fresh prices, a star puts an item into favorites) and the traders with 3D models.
import { beginTake } from '../take.mjs'
import { ready } from '../rec.mjs'
const lang = process.argv[2] ?? 'ru'
const L = lang === 'en'
  ? { favorites: 'Favorites', traders: 'Traders', mechanic: 'Mechanic', ragman: 'Ragman', star: 'Favorites' }
  : { favorites: 'Избранное', traders: 'Торговцы', mechanic: 'Механик', ragman: 'Барахольщик', star: 'Избранное' }
const { page, rec, at, v, scenes, tx, finish } = await beginTake('t09a-flea-traders', {
  lang, hash: '#/flea', mouse: { x: 1300, y: 760 },
  prepare: async (page) => {
    await page.evaluate(() => { location.hash = '#/traders' }); await ready(page, 1500)
    for (const name of [L.mechanic, L.ragman]) { await page.locator(`button.trader-card[aria-label="${name}"]`).click(); await page.waitForTimeout(6000) }
    await page.evaluate(() => { location.hash = '#/flea' }); await ready(page, 1200)
  },
})
// A click that loads a model: from the button's release the clock all but stops and no frame is written until the
// model is on screen (no loading pause, no «Загрузка модели…» label; at 0.03 it still flashed for a frame or two).
async function clickAndLoad() {
  await page.mouse.down(); await rec.vsleep(95)
  await rec.setRate(0.001); rec.hold(true)
  await page.mouse.up()
  await page.waitForTimeout(300)
  await page.waitForFunction(() => !document.querySelector('.trader-figure-status:not(.is-error)'), null, { timeout: 30000 }).catch(() => console.log('  model still loading'))
  // The picture without the label has to reach the recorder before the hold ends.
  await page.waitForTimeout(800)
  rec.hold(false); await rec.setRate(0.25)
}
const fresh = '.page-header .tag'
const row = '.price-table tbody tr:nth-child(6)'

// 12 · «Барахолка. Всегда актуальные цены,»
await at(v(12, 0.05)); await rec.ring({ id: 'fresh', target: fresh, pad: 6, radius: 10 }); await rec.card({ target: fresh, side: 'left', ...tx.flea })
// «а нужные предметы можно добавить в избранное.»
await at(v(12, 2.45)); await rec.overlay('clearRing', 'fresh'); await rec.click(`${row} button[aria-label="${L.star}"]`, { duration: 560 })
await at(v(12, 3.35)); await rec.overlay('hideCard', 'main'); await rec.click(`button:has-text("${L.favorites}") >> nth=0`, { duration: 520 })
await at(v(12, 4.05)); await rec.ring({ id: 'list', target: '.price-table', pad: 6 })
await at(scenes[12].end - 0.45); await rec.overlay('clearAll')
// 13 · «Торговцы, их задания и трёхмерные модели.»
await at(v(13, -0.4)); await rec.moveTo(`a.nav-link:has-text("${L.traders}")`, { duration: 480 }); await clickAndLoad()
await at(v(13, 0.2)); await rec.ring({ id: 'fig', target: '.trader-figure-stage', pad: 6 }); await rec.card({ target: '.trader-figure-stage', side: 'left', ...tx.traders })
await at(v(13, 0.75)); await rec.moveTo(`button.trader-card[aria-label="${L.mechanic}"]`, { duration: 480 }); await clickAndLoad()
await at(v(13, 1.9)); await rec.moveTo(`button.trader-card[aria-label="${L.ragman}"]`, { duration: 420 }); await clickAndLoad()
await at(v(13, 2.7)); await rec.overlay('hideCard', 'main'); await rec.ring({ id: 'fig', target: 'section.panel:has(.quest-map-row), .panel:has(> .panel-header .panel-title)', pad: 6 })
await at(scenes[13].end - 0.4); await rec.overlay('clearAll')
console.log('t09a length', await finish())
