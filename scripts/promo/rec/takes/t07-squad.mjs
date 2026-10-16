// Scene 10: «Отряд». A signed-in desktop shell with two friends and a squad (squad/bridge.mjs: made-up names, real
// quest ids): add a friend by nickname, the squad's quests by map, the raid plan's map priority.
import { beginTake } from '../take.mjs'
import { squadBridge } from '../squad/bridge.mjs'
const lang = process.argv[2] ?? 'ru'
const L = lang === 'en' ? { squadName: 'Night squad', add: 'Add friend' } : { squadName: 'Ночной отряд', add: 'Добавить в друзья' }
const { page, rec, at, v, scenes, tx, finish } = await beginTake('t07-squad', {
  lang, hash: '#/squad?tab=friends', mouse: { x: 1180, y: 760 }, extraInit: [squadBridge({ squadName: L.squadName })],
  prepare: async (page) => {
    // Every tab once: their data and lazy code are in before the camera rolls.
    for (const tab of ['squad', 'plan', 'friends']) { await page.evaluate((t) => { location.hash = `#/squad?tab=${t}` }, tab); await page.waitForTimeout(1800) }
  },
})
const addPanel = '.squad-start > form.panel'
const tab = (n) => `.squad-tabs button >> nth=${n}`

// «Отряд. Добавляй друзей прямо в приложении.»
await at(v(10, 0.05)); await rec.ring({ id: 'add', target: addPanel, pad: 6 }); await rec.card({ target: addPanel, side: 'left', ...tx.squad })
await at(v(10, 0.8)); await rec.click(`${addPanel} input`, { duration: 450, dx: 0.3 })
for (const ch of 'Badger_RU') { await page.keyboard.type(ch); await rec.vsleep(62) }
await at(v(10, 2.0)); await rec.click(`${addPanel} button[type=submit]`, { duration: 340 })
// «Ваши квесты синхронизируются:»
await at(v(10, 2.7)); await rec.overlay('clearAll'); await rec.click(tab(0), { duration: 520 })
await at(v(10, 3.45)); await rec.ring({ id: 'members', target: 'section.panel:has(.squad-title)', pad: 6 }); await rec.card({ target: 'section.panel:has(.squad-title)', side: 'bottom', ...tx.squadSync })
// «видно общие задания и какие карты сейчас важнее всего для всей группы.»
await at(v(10, 4.75)); await rec.overlay('clearAll'); await rec.ring({ id: 'map', target: '.squad-board-map', pad: 6 }); await rec.moveTo('.squad-board-common', { duration: 520 })
await at(v(10, 6.15)); await rec.overlay('clearAll'); await rec.click(tab(2), { duration: 480 })
await at(v(10, 6.85)); await rec.ring({ id: 'rank', target: '.squad-rank', pad: 6 }); await rec.card({ target: '.squad-rank', side: 'right', ...tx.squadPlan })
await rec.moveTo('.squad-rank', { duration: 520, dx: 0.7 })
await at(scenes[10].end - 0.4); await rec.overlay('clearAll')
console.log('t07 length', await finish())
