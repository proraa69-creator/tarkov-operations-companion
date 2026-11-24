// The bots of the offline copy (SPT 4.1.6, game client 0.16.9; the live game is newer, 1.3): how many guards come with a boss on
// each map, what they wear and carry, and what they may have on them. Read only, from SPT_Data/database:
//   locations/<map>/base.json → BossLocationSpawn (BossEscortType / BossEscortAmount, or Supports for guards of several kinds)
//   bots/types/<role>.json → inventory.equipment (weights), inventory.mods (plates), inventory.Ammo, inventory.items (loot
//   pools), chances, generation
// Used by boss-gear.mjs (the guards the live data lacks) and retinue-spt-report.mjs (what differs from the live data).
import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

/** SPT's location folders as the app names the maps (night Factory is the Factory, Ground Zero 21+ Ground Zero). */
export const SPT_MAPS = {
  bigmap: 'customs', factory4_day: 'factory', factory4_night: 'factory', interchange: 'interchange', laboratory: 'the-lab',
  labyrinth: 'the-labyrinth', lighthouse: 'lighthouse', rezervbase: 'reserve', sandbox: 'ground-zero', sandbox_high: 'ground-zero',
  shoreline: 'shoreline', tarkovstreets: 'streets-of-tarkov', woods: 'woods',
}

const PARENT = {
  money: '543be5dd4bdc2deb348b4569', ammo: '5485a8684bdc2da71d8b4567', ammoBox: '543be5cb4bdc2deb348b4568',
  magazine: '5448bc234bdc2d3c308b4569', grenade: '543be6564bdc2df4348b4568', stim: '5448f3a64bdc2d60728b456a',
  drug: '5448f3a14bdc2d27728b4569', medkit: '5448f39d4bdc2d0a728b4568', medical: '5448f3ac4bdc2dce718b4569',
  food: '5448e8d04bdc2ddf718b4569', drink: '5448e8d64bdc2dce718b4568',
}
const PLATE_SLOTS = { front_plate: 'front', back_plate: 'back', left_side_plate: 'side', right_side_plate: 'side' }

/** The SPT database, or undefined when the offline copy is not on this PC. */
export async function loadSpt(dir) {
  if (!dir || !existsSync(join(dir, 'bots/types'))) return undefined
  const json = async (path) => JSON.parse(await readFile(join(dir, path), 'utf8'))
  const [items, ru, en] = await Promise.all([json('templates/items.json'), json('locales/global/ru.json'), json('locales/global/en.json')])
  const spawns = []
  for (const folder of await readdir(join(dir, 'locations'))) {
    const file = join(dir, 'locations', folder, 'base.json')
    if (!SPT_MAPS[folder] || !existsSync(file)) continue
    for (const spawn of (await json(`locations/${folder}/base.json`)).BossLocationSpawn ?? []) spawns.push({ map: SPT_MAPS[folder], folder, ...spawn })
  }
  const bots = new Map()
  const bot = async (role) => {
    const key = role.toLowerCase()
    if (!bots.has(key)) bots.set(key, existsSync(join(dir, `bots/types/${key}.json`)) ? await json(`bots/types/${key}.json`) : undefined)
    return bots.get(key)
  }
  return { items, ru, en, spawns, bot }
}

const sum = (values) => values.reduce((total, value) => total + value, 0)
const add = (counts, key, value) => counts.set(key, (counts.get(key) ?? 0) + value)
const top = (counts, limit) => [...counts].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([key]) => key)
/** The mean of a generation weight table {"0":1,"1":2,"2":1} → 1. */
const mean = (weights = {}) => {
  const total = sum(Object.values(weights))
  return total ? sum(Object.entries(weights).map(([count, weight]) => Number(count) * weight)) / total : 0
}
const amounts = (text) => String(text ?? '').split(',').map(Number).filter((value) => Number.isFinite(value))

/**
 * How many of this kind come with the boss on each map in SPT: the support of its kind when the boss has supports (Glukhar,
 * Kaban, Kollontay, the Goons), else BossEscortType / BossEscortAmount; spawns that never happen (chance 0) left out.
 * → [{ map, min, max, chance }]
 */
export function sptEscorts(spt, bossName, role) {
  const out = []
  for (const spawn of spt.spawns) {
    if (spawn.BossName !== bossName || !(Number(spawn.BossChance) > 0)) continue
    const support = spawn.Supports?.length ? spawn.Supports.find((entry) => entry.BossEscortType === role) : undefined
    const list = spawn.Supports?.length ? amounts(support?.BossEscortAmount) : spawn.BossEscortType === role ? amounts(spawn.BossEscortAmount) : []
    if (!list.length || Math.max(...list) <= 0) continue
    out.push({ map: spawn.map, min: Math.min(...list), max: Math.max(...list), chance: Number(spawn.BossChance) })
  }
  return out
}

/** The parent chain of an SPT item template reaches this category. */
function isA(spt, id, parent) {
  for (let at = spt.items[id], hops = 0; at && hops < 12; at = spt.items[at._parent], hops++) if (at._id === parent || at._parent === parent) return true
  return false
}

/** What SPT's loot generation does with an item: its own count (meds, food…), the containers' loot, or none (money, rounds). */
function lootKind(spt, id) {
  if ([PARENT.money, PARENT.ammo, PARENT.ammoBox, PARENT.magazine, PARENT.grenade].some((parent) => isA(spt, id, parent))) return undefined
  if (isA(spt, id, PARENT.stim)) return 'stims'
  if (isA(spt, id, PARENT.drug)) return 'drugs'
  if (isA(spt, id, PARENT.medkit) || isA(spt, id, PARENT.medical)) return 'healing'
  if (isA(spt, id, PARENT.food)) return 'food'
  if (isA(spt, id, PARENT.drink)) return 'drink'
  return 'loot'
}

/**
 * The kit of one kind of bot from its SPT weights, in the shape of boss-gear.mjs's `gear()`: the chance of a slot × the item's
 * share of the slot's weights. `live` names items and gives armour classes from the live catalog (SPT's own when it lacks one).
 */
export async function sptGear(spt, role, live, limits = { weapons: 6, pistols: 2, ammo: 3, armor: 3, wear: 3 }) {
  const bot = await spt.bot(role)
  if (!bot) throw new Error(`SPT has no bot ${role}`)
  const { equipment, mods = {}, Ammo = {} } = bot.inventory
  const slotChance = (slot) => (bot.chances?.equipment?.[slot] ?? 0) / 100
  const odds = (slot) => {
    const pool = equipment[slot] ?? {}
    const total = sum(Object.values(pool))
    return new Map(total ? Object.entries(pool).map(([id, weight]) => [id, slotChance(slot) * weight / total]) : [])
  }
  const armorClass = (id) => live.armorClass(id) || Number(spt.items[id]?._props?.armorClass) || 0
  const longGuns = new Map([...odds('FirstPrimaryWeapon'), ...odds('SecondPrimaryWeapon')])
  const pistols = odds('Holster')
  const ammoOf = (id) => top(new Map(Object.entries(Ammo[spt.items[id]?._props?.ammoCaliber] ?? {})), limits.ammo)
  const weapons = [...top(longGuns, limits.weapons - Math.min(limits.pistols, pistols.size)), ...top(pistols, limits.pistols)]
    .map((id) => ({ id, name: live.name(id), ammo: ammoOf(id).map((round) => ({ id: round, name: live.name(round) })) }))
  const armor = new Map(), rigs = new Map(), helmets = new Map(), helmet = new Map(), face = new Map()
  const plates = { front: new Map(), back: new Map(), side: new Map() }
  let armored = 0, helmeted = 0
  for (const slot of ['ArmorVest', 'TacticalVest']) for (const [id, chance] of odds(slot)) {
    const cls = armorClass(id)
    // mods name the slots «Front_plate», chances «front_plate»
    const plateSlots = Object.entries(mods[id] ?? {}).filter(([name]) => PLATE_SLOTS[name.toLowerCase()])
    if (!cls && !plateSlots.length) { if (slot === 'TacticalVest') add(rigs, id, chance); continue }
    add(armor, id, chance)
    armored += chance
    for (const [name, pool] of plateSlots) {
      const slotName = name.toLowerCase()
      const modChance = (bot.chances?.equipmentMods?.[slotName] ?? 100) / 100
      for (const plate of pool) { const plateClass = armorClass(plate); if (plateClass) add(plates[PLATE_SLOTS[slotName]], plateClass, chance * modChance / pool.length) }
    }
  }
  for (const [id, chance] of odds('Headwear')) { const cls = armorClass(id); if (cls) { add(helmet, cls, chance); add(helmets, id, chance); helmeted += chance } }
  for (const [id, chance] of odds('FaceCover')) { const cls = armorClass(id); if (cls) add(face, cls, chance) }
  // an armoured mask on a third of them is no face armour to name (Zryachiy's followers: the Shattered mask, class 1, on 38 %)
  if (sum([...face.values()]) < 0.5) face.clear()
  const share = (value) => Math.min(1, Math.round(value * 100) / 100)
  const wear = (counts, limit) => [...new Map(top(counts, Infinity).map((id) => [live.name(id).en, { id, name: live.name(id) }])).values()].slice(0, limit)
  return {
    weapons,
    armor: wear(armor, limits.armor),
    armored: share(armored),
    plates: Object.fromEntries(Object.entries(plates).map(([side, counts]) => [side, classes(counts)]).filter(([, value]) => value)),
    helmet: classes(helmet),
    helmetId: top(helmets, 1)[0],
    helmeted: share(helmeted),
    face: classes(face),
    helmets: wear(helmets, limits.wear),
    rigs: wear(rigs, limits.wear),
  }
}

/** One class when ¾ of the weight has it, else the range (as boss-gear.mjs). */
function classes(counts) {
  const total = sum([...counts.values()])
  if (!total) return undefined
  const [main, mainCount] = [...counts].sort((a, b) => b[1] - a[1])[0]
  if (mainCount / total >= 0.75) return [main, main]
  const all = [...counts.keys()]
  return [Math.min(...all), Math.max(...all)]
}

/**
 * What one bot may have on him, in percent of bots, estimated from SPT's loot generation: the backpack's, the rig's and the
 * pockets' loot from their own pools (a backpack's only when he wears one), meds, stims, food and drink by their own counts
 * from all three pools; the secure container (it cannot be looted), money, rounds, magazines and grenades left out.
 * → [{ id, chance }], the likeliest first, those of at least `min` percent.
 */
export async function sptLoot(spt, role, min = 1) {
  const bot = await spt.bot(role)
  const pools = bot?.inventory?.items ?? {}
  const generation = bot?.generation?.items ?? {}
  const chance = (slot) => (bot?.chances?.equipment?.[slot] ?? 0) / 100
  const miss = new Map()
  const draw = (pool, odds, picks, kind) => {
    const entries = Object.entries(pool).filter(([id]) => lootKind(spt, id) === kind)
    const total = sum(entries.map(([, weight]) => weight))
    if (!total || !picks || !odds) return
    for (const [id, weight] of entries) {
      const hit = odds * (1 - (1 - weight / total) ** picks)
      miss.set(id, (miss.get(id) ?? 1) * (1 - hit))
    }
  }
  draw(pools.Backpack ?? {}, chance('Backpack'), mean(generation.backpackLoot?.weights), 'loot')
  draw(pools.TacticalVest ?? {}, chance('TacticalVest'), mean(generation.vestLoot?.weights), 'loot')
  draw(pools.Pockets ?? {}, 1, mean(generation.pocketLoot?.weights), 'loot')
  draw(pools.SpecialLoot ?? {}, 1, mean(generation.specialItems?.weights), 'loot')
  const all = {}
  for (const pool of ['Backpack', 'TacticalVest', 'Pockets']) for (const [id, weight] of Object.entries(pools[pool] ?? {})) all[id] = (all[id] ?? 0) + weight
  for (const kind of ['healing', 'drugs', 'stims', 'food', 'drink']) draw(all, 1, mean(generation[kind]?.weights), kind)
  return [...miss].map(([id, left]) => ({ id, chance: Math.round((1 - left) * 1000) / 10 }))
    .filter((entry) => entry.chance >= min).sort((a, b) => b.chance - a.chance)
}
