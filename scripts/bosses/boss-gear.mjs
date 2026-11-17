// The weapons with their rounds and the armour plates of every boss in «Боссы» (report 178: «сборка + патрон… бронежилеты
// и их плиты»), from the game's bot loadouts as json.tarkov.dev lists them (`maps` → `mobs[*].equipment`: about fifteen
// generated loadouts per bot, the counts summed).
//   node scripts/bosses/boss-gear.mjs [folder with maps.json items.json items_ru.json items_en.json]
// → src/data/bossGear.json. Without a folder the four files are fetched (regular mode: PvE lists the same loadouts,
// checked 17.11.2026).
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const folder = process.argv[2]
const load = async (name) => {
  const text = folder ? await readFile(join(folder, `${name}.json`), 'utf8') : await (await fetch(`https://json.tarkov.dev/regular/${name}`)).text()
  const json = JSON.parse(text)
  return json.data ?? json
}
const [maps, itemsFile, ru, en] = await Promise.all([load('maps'), load('items'), load('items_ru'), load('items_en')])
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
  const armor = new Map(), helmet = new Map(), helmets = new Map(), face = new Map()
  let armored = 0, helmeted = 0
  for (const mob of mobs) for (const entry of mob.equipment ?? []) {
    const slot = entry.attributes?.slot
    const count = entry.count ?? 1
    if (WEAPON_SLOTS.has(slot)) {
      add(slotTotals, slot, count)
      add(slot === 'Holster' ? pistols : weapons, entry.item, count)
      const own = ammo.get(entry.item) ?? new Map()
      for (const round of rounds(entry)) add(own, round, count)
      ammo.set(entry.item, own)
    } else if (PLATE_SLOTS[slot]) {
      const cls = armorClass(entry.item)
      if (cls) add(plates[PLATE_SLOTS[slot]], cls, count)
      if (slot === 'Front_plate' && cls) armored += count
    } else if (slot === 'ArmorVest' || slot === 'TacticalVest') {
      const cls = armorClass(entry.item)
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
    // one tile per name (three 6B45 of different camo are one)
    armor: [...new Map(top(armor, Infinity).map((id) => [name(id).en, { id, name: name(id) }])).values()].slice(0, MAX_ARMOR),
    armored: share(armored),
    plates: Object.fromEntries(Object.entries(plates).map(([side, counts]) => [side, classes(counts)]).filter(([, value]) => value)),
    helmet: classes(helmet),
    // the face its visor guards comes from the item catalog (the loadouts leave the visor out: Killa's Maska-1SCh)
    helmetId: top(helmets, 1)[0],
    helmeted: share(helmeted),
    face: classes(face),
  }
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
