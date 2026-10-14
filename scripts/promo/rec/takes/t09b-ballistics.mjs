// Scene 14: ballistics. The penetration / damage chart, one round picked (7.62×54R ПС), its chance against armor 1–6.
import { beginTake } from '../take.mjs'
const lang = process.argv[2] ?? 'ru'
// 7.62×54R ПС: its chance falls from class 4 to 6 (a round that pierces everything would show 99% everywhere).
const ROUND = 'ПС'
const ROUND_NAME = lang === 'en' ? /7\.62x54mm R PS/ : /7\.62x54мм R ПС/
let roundDot = null
const { page, rec, at, v, scenes, tx, finish } = await beginTake('t09b-ballistics', {
  lang, hash: '#/ballistics', mouse: { x: 1500, y: 700 },
  // The chart point of the round: the hit circles near its label are hovered until the tooltip names it.
  prepare: async (page) => {
    const hits = await page.evaluate(() => [...document.querySelectorAll('circle.ammo-hit')].map((c) => { const r = c.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } }).filter((p) => p.x > 880 && p.x < 980))
    for (const hit of hits) {
      await page.mouse.move(hit.x, hit.y); await page.waitForTimeout(200)
      const name = await page.evaluate(() => document.querySelector('.ammo-tooltip-name')?.textContent ?? '')
      if (ROUND_NAME.test(name)) { roundDot = hit; break }
    }
    console.log('  round dot', roundDot)
    await page.mouse.move(1500, 700); await page.waitForTimeout(300)
  },
})
/** The chart point of a round: the hit circle nearest to its label (the label with the highest penetration if several). */
const dotOf = (label) => page.evaluate((label) => {
  const labels = [...document.querySelectorAll('text.ammo-label')].filter((t) => t.textContent.trim() === label)
  const best = labels.sort((a, b) => b.getBoundingClientRect().x - a.getBoundingClientRect().x)[0]
  if (!best) return null
  const lr = best.getBoundingClientRect()
  let near = null
  for (const c of document.querySelectorAll('circle.ammo-dot')) {
    const r = c.getBoundingClientRect(); const cx = r.x + r.width / 2, cy = r.y + r.height / 2
    const d = Math.hypot(cx - lr.x, cy - (lr.y + lr.height))
    if (!near || d < near.d) near = { d, x: cx, y: cy }
  }
  return near
}, label)
const armor = 'section.panel:has(.selected-ammo-head)'

// «Баллистика:»
await at(v(14, 0.0)); await rec.card({ at: { x: 1370, y: 300 }, ...tx.ballistics, arrow: false })
// «пробитие и урон каждого патрона против любого класса брони.»
await at(v(14, 1.1)); const dot = roundDot ?? await dotOf(ROUND); if (dot) await rec.moveTo(dot, { duration: 520 })
await at(v(14, 1.85)); await rec.click(null)
await at(v(14, 2.15)); await rec.overlay('hideCard', 'main'); await rec.reveal(armor, { block: 0.42, duration: 800 })
await at(v(14, 3.05)); await rec.ring({ id: 'armor', target: armor, pad: 6 }); await rec.card({ target: armor, side: 'top', ...tx.ballisticsArmor })
await rec.moveTo(`${armor} tbody tr:nth-child(5)`, { duration: 600, dx: 0.3 })
await at(scenes[14].end - 0.4); await rec.overlay('clearAll')
console.log('t09b length', await finish())
