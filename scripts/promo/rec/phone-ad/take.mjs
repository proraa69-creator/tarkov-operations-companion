// The phone take of the phone-apps ad: the app on the phone from the intro to the end of «testing» (timeline.mjs TAKE),
// at 804 × 1748 (iPhone 17 @2x). Taps through «Обзор», «Квесты» and «Оружейник» back to «Обзор»; on the PC's screenshot
// the stand-in server sends the position and the app itself opens Customs with the player; then the PC's recognised
// item arrives as the card on the map; at the end «Ещё» with «Чат с поддержкой».
//   node phone-ad/take.mjs   → promo/out/phone-ad/phone.mp4
import { close, record, S } from '../rec.mjs'
import { BOOK, CUSTOMS_POSITION, openPhone, pageNow, PHONE, ready } from './phone.mjs'
import { MOMENTS, TAKE } from './timeline.mjs'

const { page, server } = await openPhone({
  prepare: async (page) => {
    // The Customs map, its tiles and the item picture once before the take, so they show at once on camera.
    await page.evaluate(() => { location.hash = '#/maps/customs' })
    await ready(page, 2500)
    await page.evaluate((url) => new Promise((resolve) => { const img = new Image(); img.onload = img.onerror = resolve; img.src = url }), BOOK.iconUrl)
    await page.evaluate(() => { location.hash = '#/' })
    await ready(page, 2000)
    await page.evaluate(() => window.scrollTo(0, 0))
  },
})
const rec = await record(page, `${S}/promo/out/phone-ad/phone.mp4`, { rate: Number(process.env.PROMO_RATE) || 0.2, maxWidth: PHONE.width * PHONE.scale, maxHeight: PHONE.height * PHONE.scale })
rec.setMouse({ x: 300, y: 980 })
const at = async (t) => { const late = rec.vnow() / 1000 - t; if (late > 0.12) console.log(`  late by ${late.toFixed(2)} s for ${t.toFixed(2)}`); await rec.until(t * 1000) }
const tab = (name) => `.mobile-tab:has-text("${name}")`

// Intro and the start of the tour: «Обзор» as it opens.
await at(6.1); await rec.scroll(null, 760, 1500)
await at(7.9); await rec.click(tab('Квесты'), { duration: 420 })
await at(8.9); await rec.scroll(null, 320, 800)
await at(9.8); await rec.click(tab('Оружейник'), { duration: 420 })
await at(10.9); await rec.click(tab('Обзор'), { duration: 420 })
await at(11.3); await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))

// The PC's screenshot: its position reaches the phone, and the app opens the raid's map with the player on it.
await at(MOMENTS.positionSent); server.send({ position: { ...CUSTOMS_POSITION, at: await pageNow(page) } })
await at(MOMENTS.positionSent + 1.0); await rec.ring({ id: 'me', target: '.leaflet-marker-icon.ov-player', pad: 10, radius: 30 })
await at(17.9); await rec.overlay('clearRing', 'me')

// The PC's recognised item: its card on the map.
await at(MOMENTS.itemSent); server.send({ item: { ...BOOK, at: await pageNow(page) } })
await at(MOMENTS.itemSent + 0.45); await rec.ring({ id: 'item', target: '.map-item-card', pad: 6, radius: 14 })
await at(24.0); await rec.overlay('clearRing', 'item')

// «пишите нам»: «Ещё» → «Чат с поддержкой».
await at(25.1); await rec.click('.mobile-tab:has-text("Ещё")', { duration: 450 })
await at(26.9); await rec.ring({ id: 'chat', target: 'button:has-text("Чат с поддержкой"), a:has-text("Чат с поддержкой")', pad: 4, radius: 14 })
await at(TAKE.to - 0.05)
await rec.stop()
await close()
