// The app half of the Kappa scene in another language. The owner's app clip (src/app-kappa.mp4) shows the Russian
// interface, so the same moment is recorded in the app itself: «Collector items» in PvE at 0 of 44, then at 9.2 s (the
// moment kappa/build.mjs lines up with the key press) the 21 items the owner's scan found are checked, the way the scan
// marks them (localStorage + COLLECTOR_CHANGED_EVENT). 1920×1060 and 13.87 s, like the owner's clip.
//   node kappa/app-clip.mjs en   → promo/src/app-kappa-en.mp4
import { readFileSync } from 'node:fs'
import { openApp, record, close, ready, S } from '../rec.mjs'
import { squadBridge } from '../squad/bridge.mjs'
const lang = process.argv[2] ?? 'en'
// Item ids of the owner's 21 found items (the checked tiles of src/app-kappa.mp4 matched by name to the catalog).
const found = JSON.parse(readFileSync(`${S}/promo/rec/kappa-owner-21.json`, 'utf8'))
const EMPTY = `(() => { try { localStorage.setItem('tarkov-collector-items-v1:pve', '[]') } catch {} })()`
// The page as in the Windows app («Scan» and its hint show with a desktop bridge): the signed-in stand-in of the squad
// scene, which answers everything else with null / no-op.
const DESKTOP = squadBridge({ squadName: 'Night squad' })
const { page } = await openApp({ locale: lang, mode: 'pve', hash: '#/kappa-items', viewport: { width: 1920, height: 1060 }, extraInit: [EMPTY, DESKTOP] })
await ready(page, 2000)
const rec = await record(page, `${S}/promo/src/app-kappa-${lang}.mp4`, { rate: 0.5 })
rec.setMouse({ x: 1720, y: 960 })
await rec.until(9200)
await page.evaluate((ids) => { localStorage.setItem('tarkov-collector-items-v1:pve', JSON.stringify(ids)); window.dispatchEvent(new Event('tarkov-collector-changed')) }, found)
await rec.until(13870)
console.log('app-kappa', lang, await rec.stop(), 'frames')
await close()
