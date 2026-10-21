// The phone take of the phone-apps ad: the app on the phone from the intro to the end of «testing», at 804 × 1748
// (iPhone 17 @2x), in the ad's language. Taps through «Обзор», «Квесты» and «Оружейник» back to «Обзор»; on the PC's
// screenshot the stand-in server sends the position and the app itself opens Customs with the player; then the PC's
// recognised item arrives as the card on the map; at the end «Ещё» with «Чат с поддержкой». The boxes of what the
// stage points at (the tabs, the map's name, the player, the card, its prices and «Каппа», the chat) are written next
// to the take, in phone points.
//   node phone-ad/take.mjs ru|en   → promo/out/phone-ad/phone-<lang>.mp4 and boxes-<lang>.json
import { writeFileSync } from 'node:fs'
import { close, record, S } from '../rec.mjs'
import { book, CUSTOMS_POSITION, openPhone, pageNow, PHONE, ready } from './phone.mjs'
import { takeSpan, timeline } from './timeline.mjs'

const lang = process.argv[2] === 'en' ? 'en' : 'ru'
const { moments: M } = timeline(lang)
const TAKE = takeSpan(lang)
const BOOK = book(lang)

const { page, server } = await openPhone({
  lang,
  prepare: async (page) => {
    // «Оружейник», the Customs map, its tiles and the item picture once before the take, so they show at once on camera.
    await page.evaluate(() => { location.hash = '#/gunsmith' })
    await ready(page, 1500)
    await page.evaluate(() => { location.hash = '#/quests' })
    await ready(page, 1000)
    await page.evaluate(() => { location.hash = '#/maps/customs' })
    await ready(page, 2500)
    await page.evaluate((url) => new Promise((resolve) => { const img = new Image(); img.onload = img.onerror = resolve; img.src = url }), BOOK.iconUrl)
    await page.evaluate(() => { location.hash = '#/' })
    await ready(page, 2000)
    await page.evaluate(() => window.scrollTo(0, 0))
  },
})

/** Boxes (phone points) of the elements the stage points at, as they are at this moment. */
const boxes = {}
async function remember(name, selector, { text } = {}) {
  const box = await page.evaluate(([selector, text]) => {
    const nodes = [...document.querySelectorAll(selector)].filter((node) => !text || new RegExp(text, 'i').test(node.textContent ?? ''))
    const node = nodes.find((n) => { const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0 })
    if (!node) return null
    const r = node.getBoundingClientRect()
    return { x: r.left, y: r.top, w: r.width, h: r.height }
  }, [selector, text ?? null])
  if (!box) console.log('  no box for', name, selector)
  boxes[name] = box
}

const rec = await record(page, `${S}/promo/out/phone-ad/phone-${lang}.mp4`, { rate: Number(process.env.PROMO_RATE) || 0.2, maxWidth: PHONE.width * PHONE.scale, maxHeight: PHONE.height * PHONE.scale })
rec.setMouse({ x: 300, y: 980 })
const at = async (t) => { const late = rec.vnow() / 1000 - t; if (late > 0.12) console.log(`  late by ${late.toFixed(2)} s for ${t.toFixed(2)}`); await rec.until(t * 1000) }
const tab = (n) => `.mobile-tab >> nth=${n}`
/** A tap on a bottom tab once the tab bar is drawn (a page change may redraw it). */
const tapTab = async (n, duration) => { await page.locator(tab(n)).waitFor({ state: 'visible', timeout: 20_000 }); await rec.click(tab(n), { duration }) }

// Intro and the tour: «Обзор» as it opens, then «Квесты», «Оружейник» and back.
await remember('nav', 'nav.mobile-nav, .mobile-nav, nav:has(.mobile-tab)')
await at(6.1); await rec.scroll(null, 760, 1500)
await at(7.9); await remember('tabQuests', '.mobile-tab', { text: 'Квесты|Quests' }); await tapTab(1, 420)
await at(8.9); await rec.scroll(null, 320, 800)
await at(9.8); await remember('tabGunsmith', '.mobile-tab', { text: 'Оружейник|Gunsmith' }); await tapTab(3, 420)
await at(10.9); await tapTab(0, 420)
await at(11.3); await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))

// The PC's screenshot: its position reaches the phone, and the app opens the raid's map with the player on it.
await at(M.positionSent); server.send({ position: { ...CUSTOMS_POSITION, at: await pageNow(page) } })
await at(M.positionSent + 1.0)
await remember('player', '.leaflet-marker-icon.ov-player')
await remember('mapName', 'button, .select, [role="combobox"]', { text: '^\\s*(Таможня|Customs)' })
await rec.ring({ id: 'me', target: '.leaflet-marker-icon.ov-player', pad: 10, radius: 30 })
await at(M.itemSent - 0.3); await rec.overlay('clearRing', 'me')

// The PC's recognised item: its card on the map.
await at(M.itemSent); server.send({ item: { ...BOOK, at: await pageNow(page) } })
await at(M.itemSent + 0.45)
await remember('card', '.map-item-card')
await remember('prices', '.map-item-card-prices')
await remember('kappa', '.map-item-card-tag.is-kappa')
await rec.ring({ id: 'item', target: '.map-item-card', pad: 6, radius: 14 })
await at(timeline(lang).scenes.item[1] - 0.3); await rec.overlay('clearRing', 'item')

// «пишите нам»: «Ещё» → «Чат с поддержкой».
await at(M.more); await tapTab(4, 450)
await at(M.chat)
await remember('chat', 'button, a', { text: 'Чат с поддержкой|Support chat' })
await rec.ring({ id: 'chat', target: 'button:has-text("Чат с поддержкой"), a:has-text("Чат с поддержкой"), button:has-text("Support chat"), a:has-text("Support chat")', pad: 4, radius: 14 })
await at(TAKE.to - 0.05)
await rec.stop()
await close()
writeFileSync(`${S}/promo/out/phone-ad/boxes-${lang}.json`, JSON.stringify(boxes, null, 1))
console.log('boxes', Object.fromEntries(Object.entries(boxes).map(([k, v]) => [k, v && `${Math.round(v.x)},${Math.round(v.y)} ${Math.round(v.w)}×${Math.round(v.h)}`])))
