// Scene 9: the minimap over the game. The app's real minimap overlay (#/overlay/minimap) with the payload the app
// builds for Customs (minimap-payload.mjs) and a player position, over a drawn game backdrop (no game footage of a
// raid: the corner note says it is an example). Key M opens it; zoom, a quest button, opacity and size.
import { readFileSync } from 'node:fs'
import { beginTake } from '../take.mjs'
import { S } from '../rec.mjs'
import { MINIMAP_BRIDGE, installStaticStage } from '../minimap/stage.mjs'
const lang = process.argv[2] ?? 'ru'
const BG = `data:image/jpeg;base64,${readFileSync(`${S}/promo/rec/minimap/backdrop-${lang}.jpg`).toString('base64')}`
const payload = JSON.parse(readFileSync(`${S}/promo/rec/minimap-${lang}.json`, 'utf8'))
const WIDTH = 440
const PLAYER = { x: 150, z: 135, y: 2, yaw: 40 }
const { page, rec, at, v, tx, finish } = await beginTake('t06-minimap', {
  lang, hash: '#/overlay/minimap', mouse: { x: 760, y: 700 }, extraInit: [MINIMAP_BRIDGE], rate: 0.15,
  prepare: async (page) => {
    await page.evaluate(installStaticStage, { bg: BG, scale: 1.45 })
    await page.evaluate(([p, width, player]) => {
      window.__emit('overlay:minimap', { ...p, opacity: 0.9, minimapWidth: width, playerMarker: 'arrow' })
      window.__emit('overlay:position', { ...player, at: Date.now() })
    }, [payload, WIDTH, PLAYER])
    // Tiles of the opening view are in before the camera rolls.
    await page.waitForTimeout(2500)
    await page.waitForFunction(() => [...document.querySelectorAll('.leaflet-tile')].every((t) => t.complete), null, { timeout: 20000 }).catch(() => {})
  },
})
const position = () => page.evaluate((player) => window.__emit('overlay:position', { ...player, at: Date.now() }), PLAYER)
const open = () => page.evaluate(() => document.getElementById('root').classList.add('is-open'))
/** A point of a range input at value `value`. */
const rangePoint = async (index, value) => page.evaluate(([index, value]) => {
  const input = document.querySelectorAll('.ov-minimap-controls input')[index]
  const r = input.getBoundingClientRect()
  const t = (value - Number(input.min)) / (Number(input.max) - Number(input.min))
  return { x: r.left + 8 + (r.width - 16) * t, y: r.top + r.height / 2 }
}, [index, value])
async function drag(index, from, to, duration) {
  await rec.moveTo(await rangePoint(index, from), { duration: 380 })
  await page.mouse.down()
  const end = await rangePoint(index, to)
  await rec.moveTo(end, { duration, arc: 0 })
  await page.mouse.up()
}

// «Мини-карта поверх игры.» — the key, then the window.
await at(v(9, -0.3)); await rec.overlay('key', { label: 'M', caption: tx.itemKey, x: 150, y: 880 })
await at(v(9, -0.12)); await rec.overlay('keyDown'); await position(); await open()
await rec.vsleep(110); await rec.overlay('keyUp')
await at(v(9, 0.25)); await rec.card({ target: '.ov-minimap', side: 'left', ...tx.minimap })
// «Показывает, где ты находишься.»
await at(v(9, 1.8)); await rec.ring({ id: 'me', target: '.leaflet-marker-icon.ov-player', pad: 12, radius: 32 })
await at(v(9, 3.0)); await position()
// «Её можно приближать, нажимать на квесты, менять прозрачность и размер.»
await at(v(9, 3.25)); await rec.overlay('clearRing', 'me'); await rec.card({ target: '.ov-minimap', side: 'left', ...tx.minimapZoom })
await rec.moveTo('.leaflet-marker-icon.ov-player', { duration: 400, dx: -0.5, dy: 1.8 })
await at(v(9, 3.7)); await rec.wheel(-230, { steps: 4, duration: 360 })
await at(v(9, 4.55)); await rec.click('.ov-quest-list button >> nth=4', { duration: 380 })
await at(v(9, 5.6)); await rec.card({ target: '.ov-minimap', side: 'bottom', ...tx.minimapLook })
await drag(0, 90, 40, 450)
await at(v(9, 6.5)); await drag(1, WIDTH, 620, 520)
await at(v(9, 7.75)); await rec.overlay('clearAll'); await rec.overlay('keyHide')
console.log('t06 length', await finish())
