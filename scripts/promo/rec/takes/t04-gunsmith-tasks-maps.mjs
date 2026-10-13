// Scenes 5–7: Gunsmith (synced block, all parts, AKS-74U build, an exact part and one with alternatives), current tasks
// and story stages, maps (satellite/scheme, ruler, markers, «Сделал в этом рейде»).
import { beginTake } from '../take.mjs'
import { ready, settleImages } from '../rec.mjs'
const lang = process.argv[2] ?? 'ru'
const L = lang === 'en'
  ? { tasksNav: 'Current tasks', mapsNav: 'Maps', story: 'Story', tour: 'Tour', showOnMap: 'Show on map', customs: 'Customs', sat: 'Satellite', scheme: 'Scheme', ruler: 'Ruler', bosses: 'Bosses', doors: 'Doors', gunsmithAll: 'View all' }
  : { tasksNav: 'Текущие задания', mapsNav: 'Карты', story: 'Сюжетные', tour: 'Тур', showOnMap: 'Показать на карте', customs: 'Таможня', sat: 'Спутник', scheme: 'Схема', ruler: 'Рулетка', bosses: 'Боссы', doors: 'Двери', gunsmithAll: 'Посмотреть все' }
let donePoint = null
const go = async (page, hash) => { await page.evaluate((h) => { location.hash = h }, hash); await ready(page, 800) }
const { page, rec, at, v, scenes, tx, finish } = await beginTake('t04-gunsmith-tasks-maps', {
  lang, hash: '#/', mouse: { x: 1300, y: 640 },
  // Every page of the take once before the camera rolls: lazy code, images and map tiles are in.
  prepare: async (page) => {
    for (const hash of ['#/gunsmith', '#/quests', '#/maps/shoreline?quest=story-tour&stage=15']) await go(page, hash)
    // Customs the way the take reaches it (the map list), so the map sits where it will sit on camera.
    await page.locator('button.map-option', { hasText: L.customs }).click(); await ready(page, 800)
    await page.locator('button.map-view-trigger').click(); await page.locator('button.map-view-option', { hasText: L.sat }).click(); await page.waitForTimeout(2500); await settleImages(page)
    await page.locator('button.map-view-trigger').click(); await page.locator('button.map-view-option', { hasText: L.scheme }).click(); await page.waitForTimeout(800)
    const centers = () => page.evaluate(() => [...document.querySelectorAll('.leaflet-marker-icon')].map((m) => { const r = m.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } }))
    const same = (a, b) => a.length === b.length && a.every((p, i) => Math.hypot(p.x - b[i].x, p.y - b[i].y) < 0.5)
    // The markers have stopped moving (the map's fit to the new bounds is over).
    let before = await centers()
    for (let i = 0; i < 30; i += 1) { await page.waitForTimeout(300); const now = await centers(); if (same(now, before)) break; before = now }
    await page.locator('button.quest-raid-check').first().click(); await page.waitForTimeout(900)
    const after = await centers()
    donePoint = before.find((a) => !after.some((b) => Math.hypot(a.x - b.x, a.y - b.y) < 2) && a.x > 520 && a.x < 1540 && a.y > 140 && a.y < 1030) ?? null
    console.log('  raid-check point', donePoint)
    await page.locator('.quest-raid-note button').click(); await page.waitForTimeout(600)
    await go(page, '#/'); await page.evaluate(() => window.scrollTo(0, 0))
  },
})
const nearestMarker = async (x, y) => page.evaluate(([x, y]) => {
  let best = null
  for (const m of document.querySelectorAll('.leaflet-marker-icon')) {
    const r = m.getBoundingClientRect(); const cx = r.x + r.width / 2, cy = r.y + r.height / 2
    const d = Math.hypot(cx - x, cy - y)
    if (!best || d < best.d) best = { d, x: cx, y: cy }
  }
  return best
}, [x, y])
const freeSpot = async (x, y) => page.evaluate(([x, y]) => {
  const icons = [...document.querySelectorAll('.leaflet-marker-icon')].map((m) => { const r = m.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2] })
  const ok = (px, py) => {
    if (icons.some(([cx, cy]) => Math.hypot(cx - px, cy - py) < 46)) return false
    const el = document.elementFromPoint(px, py)
    return Boolean(el && el.closest('.leaflet-container') && !el.closest('.leaflet-marker-icon, .leaflet-interactive, .leaflet-tooltip, .leaflet-popup, .map-tools, .leaflet-control'))
  }
  for (let r = 0; r <= 160; r += 8) for (let a = 0; a < 360; a += 30) {
    const px = x + r * Math.cos(a * Math.PI / 180), py = y + r * Math.sin(a * Math.PI / 180)
    if (ok(px, py)) return { x: px, y: py }
  }
  return { x, y }
}, [x, y])
const gsSection = 'section.panel:has(.gunsmith-current-name)'

// 5 · Gunsmith
await at(v(5, -0.6)); await rec.moveTo('.gunsmith-current-name', { duration: 620 })
await at(v(5, 0.1)); await rec.ring({ id: 'gs', target: gsSection, pad: 6 }); await rec.card({ target: gsSection, side: 'left', ...tx.gunsmithBlock })
await at(v(5, 5.2)); await rec.overlay('clearAll')
await rec.click(`${gsSection} a.current-tasks-where`, { duration: 500 })
await at(v(5, 6.3)); await rec.ring({ id: 'part', target: 'button.gunsmith-part-row.is-selected', pad: 5 }); await rec.card({ target: 'button.gunsmith-part-row.is-selected', side: 'bottom', ...tx.gunsmithAll })
await at(v(5, 6.8)); await rec.moveTo('button.gunsmith-part-row.is-selected', { duration: 600 })
await at(v(5, 7.9)); await rec.click(null)
await at(v(5, 9.2)); await rec.overlay('clearAll')
await rec.ring({ id: 'build', target: 'button.gs-build-image', pad: 6 }); await rec.card({ target: 'button.gs-build-image', side: 'left', ...tx.gunsmithBuild })
await rec.moveTo('button.gs-build-image', { duration: 700, dx: 0.62, dy: 0.5 })
await at(v(5, 11.0)); await rec.overlay('clearAll'); await rec.reveal('a.gs-part', { block: 0.6, duration: 850 })
await at(v(5, 12.0)); await rec.moveTo('a.gs-part >> nth=0', { duration: 700 })
await rec.ring({ id: 'mod', target: 'a.gs-part:nth-of-type(1)', pad: 5, radius: 10 }); await rec.card({ target: 'a.gs-part:nth-of-type(1)', side: 'left', ...tx.gunsmithExact })
await at(v(5, 14.8)); await rec.overlay('clearAll'); await rec.moveTo('a.gs-part >> nth=2', { duration: 650 })
await rec.ring({ id: 'mod', target: 'a.gs-part:nth-of-type(3)', pad: 5, radius: 10 }); await rec.card({ target: 'a.gs-part:nth-of-type(3)', side: 'left', ...tx.gunsmithAlt })
await at(scenes[5].end - 0.3); await rec.overlay('clearAll')

// 6 · Current tasks and story stages
await at(v(6, -0.3)); await rec.click(`a.nav-link:has-text("${L.tasksNav}")`, { duration: 600 })
const list = 'section.panel:has(.catalog-list)'
await at(v(6, 0.5)); await page.locator(list).first().waitFor({ timeout: 4000 }).catch(() => {}); await rec.ring({ id: 'list', target: list, pad: 6 }); await rec.card({ target: list, side: 'right', ...tx.tasks })
await at(v(6, 1.5)); await rec.moveTo('button.quest-map-row-main >> nth=1', { duration: 600 })
await at(v(6, 2.5)); await rec.moveTo('button.quest-map-row-main >> nth=3', { duration: 500 })
await at(v(6, 3.3)); await rec.overlay('clearAll'); await rec.click(`button:text-is("${L.story}")`, { duration: 550 })
await at(v(6, 4.2)); await rec.click(`button.quest-map-row-main:has-text("${L.tour}")`, { duration: 450 })
const detail = 'aside.quest-detail'
await at(v(6, 4.85)); await rec.ring({ id: 'story', target: detail, pad: 6 }); await rec.card({ target: detail, side: 'left', ...tx.story })
await at(v(6, 5.6)); await rec.moveTo(`a[href*="stage="]`, { duration: 500 })
await at(v(6, 6.3)); await rec.overlay('clearAll'); await rec.click(null)
// The chapter's current stage on the map.
const stageMarker = '.leaflet-marker-icon:has(.map-marker.is-focused)'
await at(v(6, 6.9)); await page.locator(stageMarker).first().waitFor({ timeout: 4000 }).catch(() => {})
await rec.ring({ id: 'stage', target: stageMarker, pad: 9, radius: 26 }); await rec.card({ target: stageMarker, side: 'left', ...tx.storyMap })

// 7 · Maps. The view switches and the ruler run on a slower clock: the map redraws (tiles, the scheme) take real time.
await at(v(7, -0.55)); await rec.overlay('clearAll'); await rec.setRate(0.1)
await rec.click(`button.map-option:has-text("${L.customs}")`, { duration: 480 })
await at(v(7, 0.45)); await rec.click('button.map-view-trigger', { duration: 350 })
await rec.card({ target: 'button.map-view-trigger', side: 'bottom', ...tx.mapLayers })
await at(v(7, 0.95)); await rec.click(`button.map-view-option:has-text("${L.sat}")`, { duration: 200 })
await at(v(7, 1.95)); await rec.click('button.map-view-trigger', { duration: 220 })
await at(v(7, 2.3)); await rec.click(`button.map-view-option:has-text("${L.scheme}")`, { duration: 180 })
await at(v(7, 2.6)); await rec.overlay('hideCard', 'main'); await rec.click(`button.map-tool:has-text("${L.ruler}")`, { duration: 330 })
await rec.card({ target: `button.map-tool:has-text("${L.ruler}")`, side: 'bottom', ...tx.ruler })
await at(v(7, 3.05)); await rec.click(await freeSpot(760, 560), { duration: 400 })
await at(v(7, 3.55)); await rec.click(await freeSpot(1240, 600), { duration: 600 })
await at(v(7, 4.45)); await rec.click(`button.map-tool:has-text("${L.ruler}")`, { duration: 420 })
await at(v(7, 4.95)); await rec.setRate(0.25); await rec.overlay('hideCard', 'main')
await rec.click(`button.layer-button:has-text("${L.bosses}")`, { duration: 560 })
await rec.card({ at: { x: 1090, y: 150 }, ...tx.markers, arrow: false })
for (const [t, x, y] of [[5.8, 1194, 481], [6.6, 1088, 600], [7.4, 1086, 486]]) {
  await at(v(7, t)); const m = await nearestMarker(x, y); if (m) await rec.moveTo({ x: m.x, y: m.y }, { duration: 520 })
}
// «Сделал в этом рейде»: the first quest's point (found in a dry run before the take) leaves the map, its row goes last.
await at(v(7, 8.3)); await rec.overlay('clearAll'); await rec.moveTo('button.quest-raid-check >> nth=0', { duration: 700 })
await rec.ring({ id: 'done', target: 'button.quest-raid-check', pad: 5, radius: 10 }); await rec.card({ target: 'button.quest-raid-check', side: 'left', ...tx.doneRaid })
await at(v(7, 9.4)); const point = donePoint ? await nearestMarker(donePoint.x, donePoint.y) : null
if (!point || point.d > 30) console.log('  raid-check point not on camera', point)
else await rec.ring({ id: 'point', target: { left: point.x - 22, top: point.y - 22, width: 44, height: 44 }, pad: 4, radius: 30 })
await at(v(7, 10.4)); await rec.overlay('clearRing', 'done'); await rec.click(null)
await at(v(7, 11.2)); await rec.overlay('clearRing', 'point')
await rec.ring({ id: 'row', target: '.quest-map-row.is-raid-checked', pad: 4, radius: 12 })
await at(v(7, 11.6)); await rec.moveTo('.quest-map-row.is-raid-checked', { duration: 800, dx: 0.45, dy: 0.5 })
await at(v(7, 12.6)); await rec.overlay('hideCard', 'main')
await at(scenes[7].end - 0.35); await rec.overlay('clearAll')
console.log('t04 length', await finish())
