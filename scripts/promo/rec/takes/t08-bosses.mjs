// Scene 11: «Боссы». The 3D viewer (Тагилла, then the next two bosses with the arrows) and the «Тактика боя» page.
// The 3D view renders slowly in software, so the take runs on a slower clock.
import { beginTake } from '../take.mjs'
import { ready } from '../rec.mjs'
const lang = process.argv[2] ?? 'ru'
const L = lang === 'en' ? { first: 'Tagilla' } : { first: 'Тагилла' }
const card = `button.gallery-card:has-text("${L.first}") >> nth=0`
const { page, rec, at, v, scenes, tx, finish } = await beginTake('t08-bosses', {
  lang, hash: '#/gallery', mouse: { x: 1240, y: 980 }, rate: 0.08,
  prepare: async (page) => {
    // The three models and the tactics page once, so they come from memory on camera.
    await page.locator(card).click(); await page.waitForTimeout(6000)
    for (let i = 0; i < 2; i += 1) { await page.locator('.gallery-viewer-step.is-next').click(); await page.waitForTimeout(6000) }
    await page.locator('a.boss-tactics-button').click(); await ready(page, 1500)
    await page.evaluate(() => { location.hash = '#/gallery' }); await ready(page, 1500)
    await page.keyboard.press('Escape'); await page.waitForTimeout(500)
  },
})
const stage = '.gallery-viewer-stage'
// A click that loads a model (seconds in software GL): from the button's release the clock all but stops and no frame
// is written until the model is on screen, so the video shows no loading pause and no «Загрузка модели…» label.
async function clickAndLoad() {
  await page.mouse.down(); await rec.vsleep(95)
  await rec.setRate(0.001); rec.hold(true)
  await page.mouse.up()
  await page.waitForTimeout(300)
  await page.waitForFunction(() => !document.querySelector('.gallery-viewer-status'), null, { timeout: 30000 }).catch(() => console.log('  model still loading'))
  // The picture without the label has to reach the recorder before the hold ends.
  await page.waitForTimeout(800)
  rec.hold(false); await rec.setRate(0.08)
}
// «Боссы.»
await at(v(11, -0.45)); await rec.moveTo(card, { duration: 520, dy: 0.4 }); await clickAndLoad()
// «3D модели и полная тактика боя:»
await at(v(11, 0.5)); await rec.card({ target: '.gallery-viewer-info', side: 'left', ...tx.bossModel, at: { x: 64, y: 760 }, arrow: false })
await at(v(11, 0.6)); await rec.moveTo(stage, { duration: 380, dx: 0.42, dy: 0.45 })
await page.mouse.down(); await rec.moveTo(stage, { duration: 700, dx: 0.62, dy: 0.47, arc: 0 }); await page.mouse.up()
await at(v(11, 1.9)); await rec.moveTo('.gallery-viewer-step.is-next', { duration: 420 }); await clickAndLoad()
await at(v(11, 2.65)); await clickAndLoad()
// «где появляется, чем опасен и как лучше действовать.»
await at(v(11, 3.2)); await rec.overlay('clearAll'); await rec.click('a.boss-tactics-button', { duration: 420 })
await at(v(11, 3.9)); await rec.ring({ id: 't', target: '.boss-tactics-facts', pad: 6 }); await rec.card({ target: '.boss-tactics-facts', side: 'right', ...tx.bossTactics })
await at(v(11, 4.8)); await rec.overlay('hideCard', 'main'); await rec.ring({ id: 't', target: '.boss-tactics-block.is-danger', pad: 6 }); await rec.moveTo('.boss-tactics-block.is-danger', { duration: 520, dx: 0.3, dy: 0.3 })
await at(v(11, 5.7)); await rec.ring({ id: 't', target: '.boss-tactics-block.is-plan', pad: 6 }); await rec.moveTo('.boss-tactics-block.is-plan', { duration: 520, dx: 0.4, dy: 0.35 })
await at(scenes[11].end - 0.35); await rec.overlay('clearAll')
console.log('t08 length', await finish())
