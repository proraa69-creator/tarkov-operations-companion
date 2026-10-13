// Scenes 2–4a: three modes, quests synced from the game, quests of the chosen map, raid requirements, «Предметы».
import { beginTake } from '../take.mjs'
import { warmModes } from '../rec.mjs'
const lang = process.argv[2] ?? 'ru'
const L = lang === 'en' ? { pve: 'PvE', season: 'Season', pvp: 'PvP', pick: 'Choose map', woods: 'Woods', tasks: 'Current tasks' } : { pve: 'PvE', season: 'Сезон', pvp: 'PvP', pick: 'Выбрать карту', woods: 'Лес', tasks: 'Текущие задания' }
const { page, rec, at, v, scenes, tx, finish } = await beginTake('t02-overview', { lang, hash: '#/', prepare: (page) => warmModes(page) })
const mode = (label) => `.mode-switch button:text-is("${label}")`
const statsRect = async () => {
  const boxes = await Promise.all([0, 1].map((i) => page.locator('.stat-grid .stat-card').nth(i).boundingBox()))
  return { left: boxes[0].x, top: boxes[0].y, width: boxes[1].x + boxes[1].width - boxes[0].x, height: boxes[0].height }
}
const tasksPanel = `section.panel:has(.panel-title:has-text("${L.tasks}"))`

// 2 · Three modes
await at(v(2, -0.35)); await rec.moveTo(mode(L.pve), { duration: 700 })
await at(v(2, 0.05)); await rec.ring({ id: 'modes', target: '.mode-switch', pad: 6 }); await rec.card({ target: '.mode-switch', side: 'bottom', ...tx.modes })
await at(v(2, 0.97)); await rec.click(mode(L.pve), { duration: 250 })
await at(v(2, 1.95)); await rec.click(mode(L.season), { duration: 300 })
await at(v(2, 3.03)); await rec.click(mode(L.pvp), { duration: 350 })
await at(v(2, 3.4)); await rec.overlay('clearRing', 'modes'); await rec.overlay('hideCard', 'main')
await rec.ring({ id: 'stats', target: await statsRect(), pad: 8, radius: 14 })
await rec.card({ target: await statsRect(), side: 'bottom', ...tx.stats })
await at(scenes[2].end - 0.35); await rec.overlay('clearAll')

// 3 · Synced quests, quests of the chosen map, raid requirements
await at(v(3, -0.2)); await rec.moveTo(`${tasksPanel} a >> nth=0`, { duration: 800 })
await at(v(3, 0.1)); await rec.ring({ id: 'tasks', target: tasksPanel, pad: 6 }); await rec.card({ target: tasksPanel, side: 'left', ...tx.sync })
await at(v(3, 2.9)); await rec.moveTo(`${tasksPanel} a >> nth=1`, { duration: 450 })
await at(v(3, 4.3)); await rec.moveTo(`${tasksPanel} a >> nth=2`, { duration: 450 })
await at(v(3, 6.2)); await rec.overlay('clearAll')
await rec.click(`button:has-text("${L.pick}")`, { duration: 650 })
await at(v(3, 6.9)); await rec.card({ id: 'pick', target: '.raid-card', side: 'right', ...tx.pickMap, arrow: false })
await at(v(3, 7.5)); await rec.click(`.raid-card button:text-is("${L.woods}")`, { duration: 650 })
await at(v(3, 8.5)); await rec.overlay('hideCard', 'pick'); await rec.ring({ id: 'tasks', target: tasksPanel, pad: 6 }); await rec.card({ target: tasksPanel, side: 'left', ...tx.mapQuests })
await at(v(3, 10.1)); await rec.overlay('clearAll'); await rec.scroll(null, 300, 700)
await at(v(3, 10.9)); await rec.ring({ id: 'needs', target: 'section.raid-needs', pad: 6 }); await rec.card({ target: 'section.raid-needs', side: 'top', ...tx.raidNeeds })
await at(v(3, 12.3)); await rec.moveTo('section.raid-needs a.raid-need >> nth=0', { duration: 600 })
await at(v(3, 13.6)); await rec.moveTo('section.raid-needs a.raid-need >> nth=1', { duration: 500 })
await at(scenes[3].end - 0.75); await rec.overlay('clearAll'); await rec.scroll(null, -300, 550)

// 4a · «Предметы» (the stash clip follows in t03)
await at(scenes[4].start - 0.1); await rec.moveTo('a.kappa-items-button', { duration: 550 })
await rec.ring({ id: 'kappa', target: 'a.kappa-items-button', pad: 5, radius: 10 })
await rec.card({ target: '.kappa-card', side: 'bottom', ...tx.kappa })
await at(v(4, 0.95)); await rec.overlay('clearAll'); await rec.click(null)
console.log('t02 length', await finish())
