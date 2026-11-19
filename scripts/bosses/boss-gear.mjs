// The weapons with their rounds and the armour plates of every boss in «Боссы» (report 178: «сборка + патрон… бронежилеты
// и их плиты»), from the game's bot loadouts as json.tarkov.dev lists them (`maps` → `mobs[*].equipment`: about fifteen
// generated loadouts per bot, the counts summed).
//   node scripts/bosses/boss-gear.mjs [--retinue] [--add] [--spt=<SPT database>] [folder with maps.json maps_pve.json
//   items.json items_ru.json items_en.json]
// → src/data/bossGear.json and src/data/bossRetinue.json; `--retinue` writes the retinue only and `--add` keeps the retinue's
// fields of the last run, adding only the missing ones: a new run draws a new loadout sample (about fifteen per bot) and the
// guns it lists change from run to run (20.11.2026: Basmach's four long guns were all different the next morning). Without a
// folder the files are fetched (regular mode: PvE lists the same
// loadouts, checked 17.11.2026, and the same guards' loot, checked 20.11.2026). The SPT database (the offline copy's
// SPT_Data/database, read only, default E:/SPT/SPT_Runtime/SPT_Data/database) gives the guards the live data lacks: Zryachiy's
// followers.
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadSpt, sptEscorts, sptGear, sptLoot } from './spt-bots.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const args = process.argv.slice(2)
const retinueOnly = args.includes('--retinue')
const addOnly = args.includes('--add')
const SPT = args.find((arg) => arg.startsWith('--spt='))?.slice('--spt='.length) ?? 'E:/SPT/SPT_Runtime/SPT_Data/database'
const folder = args.find((arg) => !arg.startsWith('--'))
const load = async (name, mode = 'regular') => {
  const file = mode === 'regular' ? name : `${name}_${mode}`
  const text = folder ? await readFile(join(folder, `${file}.json`), 'utf8') : await (await fetch(`https://json.tarkov.dev/${mode}/${name}`)).text()
  const json = JSON.parse(text)
  return json.data ?? json
}
const [maps, pveMaps, itemsFile, ru, en] = await Promise.all([load('maps'), load('maps', 'pve'), load('items'), load('items_ru'), load('items_en')])
const items = itemsFile.items ?? itemsFile

/** Gallery key → its bots: the boss (by map where his kit differs) and his guards. */
const BOSSES = {
  reshala: { groups: [['bossBully']], guards: ['followerBully'] },
  partisan: { groups: [['bossPartisan']] },
  'goon-1': { groups: [['followerBirdEye']] },
  'goon-2': { groups: [['bossKnight']] },
  'goon-3': { groups: [['followerBigPipe']] },
  shturman: { groups: [['bossKojaniy']], guards: ['followerKojaniy'] },
  sanitar: { groups: [['bossSanitar']], guards: ['followerSanitar'] },
  killa: { groups: [['bossKilla']] },
  tagilla: { groups: [['bossTagilla']] },
  'tagilla-2': { groups: [['bossTagillaAgro']] },
  glukhar: { groups: [['bossGluhar']], guards: ['followerGluharAssault', 'followerGluharSecurity', 'followerGluharScout'] },
  zryachiy: { groups: [['bossZryachiy']] },
  rogue: { groups: [['ExUsec']] },
  kaban: { groups: [['bossBoar']], guards: ['followerBoar', 'followerBoarClose1', 'followerBoarClose2', 'bossBoarSniper'] },
  kollontay: { groups: [['bossKolontay']], guards: ['followerKolontayAssault', 'followerKolontaySecurity'] },
  // Black Division: their kit is lighter on Labs and Icebreaker (class 4 plates) than elsewhere (5–6 and side plates; the
  // loadouts name Terminal, the app shows them on more maps): the heavy kit is «everywhere else»
  'black-division': { groups: [['blackDivision'], ['pmcBotBlackDiv', 'bossBullyBlackDiv', 'followerBullyBlackDiv']], elsewhere: 0 },
  wadge: { groups: [['bossWedge'], ['bossWedgeLab']], guards: ['followerWedgeLab'] },
  raiders: { groups: [['PmcBot']] },
  military: { groups: [['vsRF']] },
}
// Not here: the Cultist Priest (the loadouts list guns, yet he fights with his knife: the gallery keeps that) and Scourge
// (an event boss, his kit from the owner's screenshots).

const WEAPON_SLOTS = new Set(['FirstPrimaryWeapon', 'SecondPrimaryWeapon', 'Holster'])
const PLATE_SLOTS = { Front_plate: 'front', Back_plate: 'back', Left_side_plate: 'side', Right_side_plate: 'side' }
const MAX_WEAPONS = 6
/** Every loadout has a pistol: no more than two of them, after the long guns. */
const MAX_PISTOLS = 2
const MAX_AMMO = 3
const MAX_ARMOR = 3
/** Helmets and rigs a guard wears, the most worn first. */
const MAX_WEAR = 3

const armorClass = (id) => Number(items[id]?.properties?.class) || 0
const name = (id) => ({ ru: ru[`${id} ShortName`] || ru[`${id} Name`] || id, en: en[`${id} ShortName`] || en[`${id} Name`] || id })
const add = (counts, key, count) => counts.set(key, (counts.get(key) ?? 0) + count)
const top = (counts, limit) => [...counts].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([key]) => key)

/** All rounds anywhere in a weapon (its magazine, its chamber, an underbarrel launcher). */
function rounds(entry, out = new Set()) {
  for (const part of entry.contains ?? []) {
    const slot = part.attributes?.slotNameId ?? ''
    if (slot === 'cartridges' || slot.startsWith('patron')) out.add(part.item)
  }
  return out
}

/**
 * A tactical device on a long gun (report 201, 20.11.2026: «свита Глухаря слепит фонарями сильно чаще других NPC»): white light
 * (blinds up close) or infrared (seen, and glaring, only through night vision); a device may be both or neither (a bare laser).
 */
const DEVICE_CATEGORIES = new Set(['55818b084bdc2d5b648b4571', '55818b164bdc2ddc698b456c', '55818b0e4bdc2dde698b456e'])
const FLASHLIGHT = '55818b084bdc2d5b648b4571'
const englishName = (id) => en[`${id} Name`] ?? ''
const isDevice = (id) => (items[id]?.categories ?? []).some((category) => DEVICE_CATEGORIES.has(category))
const whiteLight = (id) => items[id]?.categories?.includes(FLASHLIGHT) || /flashlight|light\b|DBAL-PL/i.test(englishName(id))
const infrared = (id) => /IR illuminator|PEQ|NGAL|MAWL|Perst-3/i.test(englishName(id))
function devicesOn(entry) {
  return [...new Set((entry.contains ?? []).map((part) => part.item).filter(isDevice))]
}

/** One class when ¾ of the plates have it, else the range: [class, class] or [min, max]. */
function classes(counts) {
  const total = [...counts.values()].reduce((sum, value) => sum + value, 0)
  if (!total) return undefined
  const [main, mainCount] = [...counts].sort((a, b) => b[1] - a[1])[0]
  if (mainCount / total >= 0.75) return [main, main]
  const all = [...counts.keys()]
  return [Math.min(...all), Math.max(...all)]
}

function gear(mobIds) {
  const mobs = mobIds.map((id) => maps.mobs[id]).filter(Boolean)
  if (!mobs.length) throw new Error(`no mobs ${mobIds}`)
  const slotTotals = new Map()
  const weapons = new Map(), pistols = new Map(), ammo = new Map(), plates = { front: new Map(), back: new Map(), side: new Map() }
  const armor = new Map(), helmet = new Map(), helmets = new Map(), face = new Map(), rigs = new Map(), devices = new Map()
  let armored = 0, helmeted = 0, longGuns = 0, lit = 0, white = 0, ir = 0
  for (const mob of mobs) for (const entry of mob.equipment ?? []) {
    const slot = entry.attributes?.slot
    const count = entry.count ?? 1
    if (WEAPON_SLOTS.has(slot)) {
      add(slotTotals, slot, count)
      add(slot === 'Holster' ? pistols : weapons, entry.item, count)
      const own = ammo.get(entry.item) ?? new Map()
      for (const round of rounds(entry)) add(own, round, count)
      ammo.set(entry.item, own)
      if (slot !== 'Holster') {
        const found = devicesOn(entry)
        longGuns += count
        if (found.length) lit += count
        if (found.some(whiteLight)) white += count
        if (found.some(infrared)) ir += count
        for (const id of found) add(devices, id, count)
      }
    } else if (PLATE_SLOTS[slot]) {
      const cls = armorClass(entry.item)
      if (cls) add(plates[PLATE_SLOTS[slot]], cls, count)
      if (slot === 'Front_plate' && cls) armored += count
    } else if (slot === 'ArmorVest' || slot === 'TacticalVest') {
      const cls = armorClass(entry.item)
      // a rig without armour: «Разгрузка» of the retinue
      if (!cls && slot === 'TacticalVest') add(rigs, entry.item, count)
      if (!cls) continue
      add(armor, entry.item, count)
      // a soft vest without plate slots is armour too
      if (!items[entry.item]?.properties?.armorSlots?.some((s) => PLATE_SLOTS[s.nameId])) armored += count
    } else if (slot === 'Headwear' || slot === 'FaceCover') {
      const cls = armorClass(entry.item)
      if (!cls) continue
      add(slot === 'Headwear' ? helmet : face, cls, count)
      if (slot === 'Headwear') { helmeted += count; add(helmets, entry.item, count) }
    }
  }
  const samples = Math.max(...slotTotals.values(), 1)
  const share = (value) => Math.min(1, Math.round((value / samples) * 100) / 100)
  return {
    weapons: [...top(weapons, MAX_WEAPONS - Math.min(MAX_PISTOLS, pistols.size)), ...top(pistols, MAX_PISTOLS)].map((id) => ({
      id, name: name(id),
      ammo: top(ammo.get(id) ?? new Map(), MAX_AMMO).map((round) => ({ id: round, name: name(round) })),
    })),
    armor: wear(armor, MAX_ARMOR),
    armored: share(armored),
    plates: Object.fromEntries(Object.entries(plates).map(([side, counts]) => [side, classes(counts)]).filter(([, value]) => value)),
    helmet: classes(helmet),
    // the face its visor guards comes from the item catalog (the loadouts leave the visor out: Killa's Maska-1SCh)
    helmetId: top(helmets, 1)[0],
    helmeted: share(helmeted),
    face: classes(face),
    helmets: wear(helmets, MAX_WEAR),
    rigs: wear(rigs, MAX_WEAR),
    // the share of long guns with a device, with white light, with infrared; the devices the most fitted first
    ...(lit ? { lights: { share: ratio(lit, longGuns), white: ratio(white, longGuns), ir: ratio(ir, longGuns), devices: wear(devices, MAX_WEAR) } } : {}),
  }
}

const ratio = (part, whole) => Math.round((part / Math.max(whole, 1)) * 100) / 100

/** The most worn first, one tile per name (three 6B45 of different camo are one). */
function wear(counts, limit) {
  return [...new Map(top(counts, Infinity).map((id) => [name(id).en, { id, name: name(id) }])).values()].slice(0, limit)
}

/** The maps a group is on, as the app names them (the dark Lab is the Lab). */
function mapsOf(mobIds) {
  const out = new Set()
  for (const map of Object.values(maps.maps)) for (const boss of map.bosses ?? []) {
    if (!mobIds.includes(boss.mob)) continue
    const id = map.normalizedName === 'the-lab-dark' ? 'the-lab' : map.normalizedName
    out.add(id)
  }
  return [...out].sort()
}

if (!retinueOnly) {
  const out = {}
  for (const [key, { groups, guards, elsewhere }] of Object.entries(BOSSES)) {
    out[key] = {
      groups: groups.map((mobIds, at) => ({ ...(groups.length > 1 ? at === elsewhere ? { maps: [], elsewhere: true } : { maps: mapsOf(mobIds) } : {}), ...gear(mobIds) })),
      ...(guards ? { guards: gear(guards) } : {}),
    }
  }
  const file = join(root, 'src/data/bossGear.json')
  await writeFile(file, `${JSON.stringify(out, null, 1)}\n`)
  console.log(file, Object.keys(out).length)
}

// The retinue of every boss who has one (owner, 20.11.2026: «боссам, у которых есть свита, нужно добавить в описание… какая
// свита, сколько человек, какая броня, оружие и какие у них патроны бывают»): each kind of guard with how many come on each map
// (`maps` → `bosses[*].escorts` of the boss's own spawn entries) and the kit of its loadouts, as the boss's own above. Names
// from the game's locale (json.tarkov.dev `maps_ru` / `maps_en`), shortened under the boss («Охранник Глухаря (разведчик)» →
// «Разведчик»). The loadouts are a sample (about fifteen per bot) drawn anew by tarkov.dev: a new run changes the lists a little.
const member = (mob, ru, en, fixed) => ({ mob, name: { ru, en }, ...(fixed ? { fixed } : {}) })
/** One of the Goons: his kit is the one on his own page (`ref`), not a second sample. */
const goon = (ref, mob, ru, en, fixed) => ({ ...member(mob, ru, en, fixed), ref })
const GOONS = ['bossKnight']
const RETINUE = {
  reshala: { boss: ['bossBully'], members: [member('followerBully', 'Охранник', 'Guard')] },
  shturman: { boss: ['bossKojaniy'], members: [member('followerKojaniy', 'Охранник', 'Guard')] },
  sanitar: { boss: ['bossSanitar'], members: [member('followerSanitar', 'Охранник', 'Guard')] },
  glukhar: { boss: ['bossGluhar'], members: [member('followerGluharAssault', 'Штурмовик', 'Assault'), member('followerGluharSecurity', 'Служба безопасности', 'Security'), member('followerGluharScout', 'Разведчик', 'Scout')] },
  kaban: { boss: ['bossBoar'], members: [member('followerBoar', 'Охранник', 'Guard'), member('followerBoarClose1', 'Башмак', 'Basmach'), member('followerBoarClose2', 'Гусь', 'Gus'), member('bossBoarSniper', 'Снайпер', 'Sniper')] },
  kollontay: { boss: ['bossKolontay'], members: [member('followerKolontayAssault', 'Штурмовик', 'Assault'), member('followerKolontaySecurity', 'Служба безопасности', 'Security')] },
  wadge: { boss: ['bossWedgeLab'], members: [member('followerWedgeLab', 'Охранник', 'Guard')] },
  'cultist-priest': { boss: ['sectantPriest'], members: [member('sectantWarrior', 'Сектант-воин', 'Cultist warrior')] },
  // Zryachiy's two followers on the island: the live data names none (no escort, no loadouts), the offline copy's does
  zryachiy: { spt: 'bossZryachiy', members: [member('followerZryachiy', 'Последователь', 'Follower')] },
  // The Goons walk as three: each one's page names the other two (on Icebreaker the Knight comes with Rogues: left out)
  'goon-1': { squad: true, boss: GOONS, members: [goon('goon-2', 'bossKnight', 'Рыцарь', 'Knight', 1), goon('goon-3', 'followerBigPipe', 'Биг Пайп', 'Big Pipe')] },
  'goon-2': { squad: true, boss: GOONS, members: [goon('goon-3', 'followerBigPipe', 'Биг Пайп', 'Big Pipe'), goon('goon-1', 'followerBirdEye', 'Бёрдай', 'Birdeye')] },
  'goon-3': { squad: true, boss: GOONS, members: [goon('goon-2', 'bossKnight', 'Рыцарь', 'Knight', 1), goon('goon-1', 'followerBirdEye', 'Бёрдай', 'Birdeye')] },
}

/** The app's map ids: the dark Lab is the Lab, Night Factory the Factory, Ground Zero 21+ Ground Zero. */
const MAP_ALIAS = { 'the-lab-dark': 'the-lab', 'night-factory': 'factory', 'ground-zero-21': 'ground-zero' }
const mapId = (map) => MAP_ALIAS[map.normalizedName] ?? map.normalizedName
/** How many of this kind come with the boss, by map: maps with the same count as one row, the most maps first. */
function countsOf(bossMobs, mob, fixed) {
  const byMap = new Map()
  for (const map of Object.values(maps.maps)) for (const boss of map.bosses ?? []) {
    if (!bossMobs.includes(boss.mob) || byMap.has(mapId(map))) continue
    const escorts = boss.escorts ?? []
    // the Goons: only where the Knight walks with the other two
    if (bossMobs === GOONS && !escorts.some((escort) => escort.mob === 'followerBigPipe')) continue
    const counts = fixed ? [fixed] : escorts.filter((escort) => escort.mob === mob).flatMap((escort) => escort.amount.map((amount) => amount.count))
    if (counts.length) byMap.set(mapId(map), [Math.min(...counts), Math.max(...counts)])
  }
  return countRows(byMap)
}

/** Maps with the same count as one row, the most maps first. */
function countRows(byMap) {
  const rows = new Map()
  for (const [id, [min, max]] of byMap) {
    const key = `${min}-${max}`
    rows.set(key, { min, max, maps: [...(rows.get(key)?.maps ?? []), id].sort() })
  }
  return [...rows.values()].sort((a, b) => b.maps.length - a.maps.length || a.min - b.min)
}

/**
 * What a guard may have on him (owner, 20.11.2026: «что с них дорогого… может упасть… если с них падает фигня всякая, это не
 * нужно показывать»): his loot pool with the share of bots that carry each item (json.tarkov.dev `mobs[*].items`, `prevalence`),
 * at least LOOT_MIN percent, money and rounds left out. The app keeps only the dear ones, by the tier list of the mode on screen
 * (src/gallery/retinueLoot.ts). PvE has its own list only where it differs (none did on 20.11.2026).
 */
const LOOT_MIN = 1
const MONEY = '543be5dd4bdc2deb348b4569'
function lootPool(mobs, mob) {
  return (mobs.mobs[mob]?.items ?? [])
    .filter((entry) => entry.attributes?.prevalence >= LOOT_MIN && items[entry.id] && !items[entry.id].categories?.includes(MONEY) && !items[entry.id].types?.includes('ammo'))
    .map((entry) => ({ id: entry.id, chance: Math.round(entry.attributes.prevalence * 10) / 10 }))
    .sort((a, b) => b.chance - a.chance || a.id.localeCompare(b.id))
}
function lootOf(mob) {
  const loot = lootPool(maps, mob)
  const pve = lootPool(pveMaps, mob)
  return { ...(loot.length ? { loot } : {}), ...(JSON.stringify(pve) !== JSON.stringify(loot) ? { lootPve: pve } : {}) }
}

// The offline copy (SPT), read only: the guards the live data lacks
const spt = await loadSpt(SPT)
const live = { name, armorClass }
const retinueFile = join(root, 'src/data/bossRetinue.json')
const before = existsSync(retinueFile) ? JSON.parse(await readFile(retinueFile, 'utf8')) : {}
async function fromSpt(key, bossName, { mob, name: memberName }) {
  const byMap = new Map()
  for (const escort of sptEscorts(spt, bossName, mob)) {
    const [min, max] = byMap.get(escort.map) ?? [Infinity, 0]
    byMap.set(escort.map, [Math.min(min, escort.min), Math.max(max, escort.max)])
  }
  const counts = countRows(byMap)
  if (!counts.length) throw new Error(`SPT: no counts ${key} ${mob}`)
  const loot = (await sptLoot(spt, mob, LOOT_MIN)).filter((entry) => items[entry.id])
  return { name: memberName, counts, ...(await sptGear(spt, mob, live)), ...(loot.length ? { loot } : {}) }
}

const retinue = {}
for (const [key, { boss, members, squad, spt: sptBoss }] of Object.entries(RETINUE)) {
  if (sptBoss && !spt) {
    // no offline copy on this PC: the last run's entry stays
    if (!before[key]) throw new Error(`${key}: needs the SPT database (--spt=…)`)
    console.warn(`${key}: SPT not found at ${SPT}, kept as it was`)
    retinue[key] = before[key]
    continue
  }
  retinue[key] = {
    ...(squad ? { squad: true } : {}),
    members: await Promise.all(members.map(async (entry) => {
      if (sptBoss) return fromSpt(key, sptBoss, entry)
      const { mob, name, fixed, ref } = entry
      const counts = countsOf(boss, mob, fixed)
      if (!counts.length) throw new Error(`no counts ${key} ${mob}`)
      const fresh = { name, counts, ...(ref ? { ref } : { ...gear([mob]), ...lootOf(mob) }) }
      // `--add`: the last run's fields stay (a new sample would change the guns shown), only the missing ones are added
      const old = addOnly ? before[key]?.members.find((member) => member.name.en === name.en) : undefined
      return old ? { ...fresh, ...old } : fresh
    })),
  }
}
await writeFile(retinueFile, `${JSON.stringify(retinue, null, 1)}\n`)
console.log(retinueFile, Object.keys(retinue).length)
