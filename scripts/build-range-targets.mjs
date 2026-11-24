#!/usr/bin/env node
/**
 * The targets of «Тир» (src/range): who stands at the range, their health per body part and the armour they are seen in.
 * Read from an SPT server database (the game's own bot files, offline): `bots/types/<type>.json` — `health.BodyParts`, the
 * equipment pools with their weights and the plates/inserts/visors of each armour (`inventory.mods`) — and
 * `templates/items.json` for which of those are armour and for the two facts tarkov.dev's items file does not carry: the
 * plate a carrier comes with in each slot (`filters[0].Plate`) and whether a hit stopped by that plate reaches the body
 * through soft armour (`filters[0].bluntDamageReduceFromSoftArmor`, the game's ×0.6 of the plate's blunt damage).
 * Everything else about an item (class, durability, material, zones) the page takes from the live catalogue.
 *
 *   node scripts/build-range-targets.mjs <SPT_Data/database> [out = src/range/rangeTargets.json]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const [, , databaseArg, outArg] = process.argv
if (!databaseArg) {
  console.error('usage: node scripts/build-range-targets.mjs <SPT_Data/database> [out]')
  process.exit(1)
}
const database = resolve(databaseArg)
const out = resolve(outArg ?? 'src/range/rangeTargets.json')
const items = JSON.parse(readFileSync(join(database, 'templates', 'items.json'), 'utf8'))

/** Bot types at the range: group, Russian and English names (owner, 22.11.2026: «персонажи … как в tarkov-lab»). */
const TARGETS = [
  ['pmcusec', 'pmc', 'ЧВК USEC', 'USEC PMC'],
  ['pmcbear', 'pmc', 'ЧВК BEAR', 'BEAR PMC'],
  ['assault', 'scav', 'Дикий', 'Scav'],
  ['marksman', 'scav', 'Дикий-снайпер', 'Scav sniper'],
  ['pmcbot', 'scav', 'Рейдер', 'Raider'],
  ['exusec', 'scav', 'Отступник', 'Rogue'],
  ['bossbully', 'boss', 'Решала', 'Reshala'],
  ['bosskilla', 'boss', 'Килла', 'Killa'],
  ['bossgluhar', 'boss', 'Глухарь', 'Glukhar'],
  ['bosssanitar', 'boss', 'Санитар', 'Sanitar'],
  ['bosstagilla', 'boss', 'Тагилла', 'Tagilla'],
  ['bosskojaniy', 'boss', 'Штурман', 'Shturman'],
  ['bossknight', 'boss', 'Рыцарь', 'Knight'],
  ['followerbigpipe', 'boss', 'Биг Пайп', 'Big Pipe'],
  ['followerbirdeye', 'boss', 'Бёрдай', 'Birdeye'],
  ['bosszryachiy', 'boss', 'Зрячий', 'Zryachiy'],
  ['bossboar', 'boss', 'Кабан', 'Kaban'],
  ['bosskolontay', 'boss', 'Коллонтай', 'Kollontay'],
  ['bosspartisan', 'boss', 'Партизан', 'Partisan'],
  ['sectantpriest', 'boss', 'Жрец', 'Cultist Priest'],
  ['sectantpredvestnik', 'boss', 'Предвестник', 'Harbinger'],
  ['sectantprizrak', 'boss', 'Призрак', 'Ghost'],
  ['sectantoni', 'boss', '«Они»', 'They'],
  ['followerbully', 'follower', 'Охрана Решалы', 'Reshala\'s guard'],
  ['followergluharassault', 'follower', 'Охрана Глухаря: штурмовик', 'Glukhar\'s assault guard'],
  ['followergluharsecurity', 'follower', 'Охрана Глухаря: охранник', 'Glukhar\'s security guard'],
  ['followergluharscout', 'follower', 'Охрана Глухаря: разведчик', 'Glukhar\'s scout'],
  ['followersanitar', 'follower', 'Охрана Санитара', 'Sanitar\'s guard'],
  ['followerkojaniy', 'follower', 'Охрана Штурмана', 'Shturman\'s guard'],
  ['followerzryachiy', 'follower', 'Последователь Зрячего', 'Zryachiy\'s follower'],
  ['followerboar', 'follower', 'Охрана Кабана', 'Kaban\'s guard'],
  ['followerboarclose1', 'follower', 'Басмач', 'Basmach'],
  ['followerboarclose2', 'follower', 'Гус', 'Gus'],
  ['bossboarsniper', 'follower', 'Снайпер Кабана', 'Kaban\'s sniper'],
  ['followerkolontayassault', 'follower', 'Охрана Коллонтая: штурмовик', 'Kollontay\'s assault guard'],
  ['followerkolontaysecurity', 'follower', 'Охрана Коллонтая: охранник', 'Kollontay\'s security guard'],
  ['sectantwarrior', 'follower', 'Сектант-воин', 'Cultist warrior'],
]

const BODY_PARTS = ['Head', 'Chest', 'Stomach', 'LeftArm', 'RightArm', 'LeftLeg', 'RightLeg']
const GEAR_SLOTS = ['Headwear', 'ArmorVest', 'TacticalVest', 'FaceCover', 'Eyewear']
/** Of a pool, the items kept: every one above this share, at least the first few. */
const MIN_SHARE = 0.005
const KEEP_AT_LEAST = 6
const MAX_ITEMS = 24

const props = (id) => items[id]?._props ?? {}
const armorClassOf = (id) => Number.parseInt(String(props(id).armorClass ?? '0'), 10) || 0
/** An item that protects something itself or through its built-in or removable armour slots. */
function isArmor(id, depth = 0) {
  if (!items[id] || depth > 3) return false
  if (armorClassOf(id) > 0) return true
  const slots = props(id).Slots ?? []
  return slots.some((slot) => {
    const filter = slot._props?.filters?.[0]
    if (!filter) return false
    if ((filter.armorColliders?.length ?? 0) > 0 || (filter.armorPlateColliders?.length ?? 0) > 0) return true
    return (filter.Filter ?? []).some((child) => armorClassOf(child) > 0)
  })
}

/** The weighted pool as [id, share] pairs, most likely first. */
function pool(weights, keep = (id) => isArmor(id)) {
  const entries = Object.entries(weights ?? {}).filter(([id]) => keep(id))
  const total = entries.reduce((sum, [, weight]) => sum + Number(weight), 0)
  if (!total) return []
  const sorted = entries.map(([id, weight]) => [id, Number(weight) / total]).sort((a, b) => b[1] - a[1])
  return sorted.filter(([, share], index) => index < KEEP_AT_LEAST || share >= MIN_SHARE).slice(0, MAX_ITEMS)
    .map(([id, share]) => [id, Math.round(share * 1000) / 1000])
}

/** The armour pieces fitted to an armour item by the bot: slot name → [id, share] pairs (plates, inserts, visors). */
function fittedMods(mods, itemId, depth = 0) {
  const own = mods?.[itemId]
  if (!own || depth > 2) return undefined
  const result = {}
  // built-in pieces (locked: soft inserts, a helmet's own top/back/ears) come with the item; the catalogue has them
  const locked = new Set((props(itemId).Slots ?? []).filter((slot) => slot._props?.filters?.[0]?.locked).map((slot) => slot._name))
  for (const [slot, choices] of Object.entries(own)) {
    if (locked.has(slot)) continue
    const armored = (choices ?? []).filter((id) => isArmor(id))
    if (armored.length) result[slot] = armored.slice(0, MAX_ITEMS)
    // a visor on a mount (mod_mount → mod_equipment): one level down
    for (const id of choices ?? []) {
      const nested = fittedMods(mods, id, depth + 1)
      if (nested) for (const [inner, list] of Object.entries(nested)) result[`${slot}/${inner}`] = list
    }
  }
  return Object.keys(result).length ? result : undefined
}

const targets = []
for (const [key, group, ru, en] of TARGETS) {
  let bot
  try {
    bot = JSON.parse(readFileSync(join(database, 'bots', 'types', `${key}.json`), 'utf8'))
  } catch {
    console.warn(`skipped ${key}: no bot file`)
    continue
  }
  const health = (bot.health?.BodyParts ?? []).map((variant) => Object.fromEntries(BODY_PARTS.map((part) => [part, Math.round(Number(variant[part]?.max ?? variant[part]?.min ?? 0))])))
  const unique = [...new Map(health.map((variant) => [JSON.stringify(variant), variant])).values()]
  const gear = {}
  const mods = {}
  for (const slot of GEAR_SLOTS) {
    const chance = Number(bot.chances?.equipment?.[slot] ?? 0)
    const list = pool(bot.inventory?.equipment?.[slot])
    if (!chance || !list.length) continue
    gear[slot] = { chance, items: list }
    for (const [id] of list) {
      const fitted = fittedMods(bot.inventory?.mods, id)
      if (fitted) mods[id] = fitted
    }
  }
  const modChances = Object.fromEntries(Object.entries(bot.chances?.equipmentMods ?? {}).filter(([slot]) => /plate|equipment|mount/i.test(slot)).map(([slot, value]) => [slot, Number(value)]))
  targets.push({ key, group, ru, en, health: unique, gear, mods, modChances })
}

/** Every armour slot of every carrier and helmet: the plate it comes with, and the soft-armour flag of a plate slot. */
const slotDefaults = {}
const softReduce = []
for (const [id, item] of Object.entries(items)) {
  for (const slot of item._props?.Slots ?? []) {
    const filter = slot._props?.filters?.[0]
    if (!filter) continue
    const armorSlot = (filter.armorColliders?.length ?? 0) > 0 || (filter.armorPlateColliders?.length ?? 0) > 0
    if (!armorSlot) continue
    if (filter.Plate) (slotDefaults[id] ??= {})[slot._name] = filter.Plate
    if (filter.bluntDamageReduceFromSoftArmor) softReduce.push(`${id}:${slot._name}`)
  }
}

const result = {
  source: 'SPT database: bots/types (health, equipment, fitted armour) and templates/items (default plates, the soft-armour flag)',
  targets,
  slotDefaults,
  softReduce: softReduce.sort(),
}
writeFileSync(out, `${JSON.stringify(result)}\n`)
console.log(`${targets.length} targets, ${Object.keys(slotDefaults).length} items with armour slots, ${softReduce.length} plate slots over soft armour → ${out}`)
