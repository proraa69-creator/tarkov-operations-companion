#!/usr/bin/env node
/**
 * The armour pieces of «Полигон» that are items of their own — plates, face shields, armoured masks, armoured glasses, the
 * old one-piece helmets — and the armoured rigs, as tarkov.dev's items file describes them (`properties`: class,
 * durability, material, blunt throughput, ricochet, zones; a rig's `armorSlots`), read from an SPT server database
 * (`templates/items.json`, the game's own templates).
 * The page takes them only for an item whose `properties` the live file leaves out: on 25.11.2026 json.tarkov.dev gave
 * `properties: null` for every plate, face shield and rig, and no plate or visor could be chosen at the range (report 228).
 * The live file's own class and durability (`armorClass`, `maxDurability`) still win over these.
 *
 *   node scripts/build-range-parts.mjs <SPT_Data/database> [out = src/range/rangeParts.json]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const [, , databaseArg, outArg] = process.argv
if (!databaseArg) {
  console.error('usage: node scripts/build-range-parts.mjs <SPT_Data/database> [out]')
  process.exit(1)
}
const database = resolve(databaseArg)
const out = resolve(outArg ?? 'src/range/rangeParts.json')
const items = JSON.parse(readFileSync(join(database, 'templates', 'items.json'), 'utf8'))

/** The item's parent → the properties type tarkov.dev gives it (built-in inserts are inline in their item already). */
const TYPES = {
  '644120aa86ffbe10ee032b6f': 'ItemPropertiesArmorAttachment', // ArmorPlate
  '57bef4c42459772e8d35a53b': 'ItemPropertiesArmorAttachment', // ArmoredEquipment: face shields, helmet modules
  '5a341c4686f77469e155819e': 'ItemPropertiesHelmet', // FaceCover: armoured masks
  '5a341c4086f77401f2541505': 'ItemPropertiesHelmet', // Headwear: helmets without inline parts
  '5448e5724bdc2ddf718b4568': 'ItemPropertiesGlasses', // Visors: armoured glasses
}

const round = (value) => Math.round(Number(value) * 10000) / 10000
const parts = {}
for (const [id, item] of Object.entries(items)) {
  const type = TYPES[item._parent]
  const props = item._props ?? {}
  const armorClass = Number.parseInt(String(props.armorClass ?? '0'), 10) || 0
  if (!type || item._type !== 'Item' || armorClass <= 0) continue
  // an item with armour slots of its own describes its parts inline (tarkov.dev's armorSlots), not here
  const inline = (props.Slots ?? []).some((slot) => {
    const filter = slot._props?.filters?.[0]
    return (filter?.armorColliders?.length ?? 0) > 0 || (filter?.armorPlateColliders?.length ?? 0) > 0
  })
  if (inline) continue
  const ricochet = props.RicochetParams ?? {}
  parts[id] = {
    propertiesType: type,
    class: armorClass,
    durability: Number(props.MaxDurability ?? props.Durability ?? 0),
    armorMaterial: String(props.ArmorMaterial ?? ''),
    bluntThroughput: round(props.BluntThroughput ?? 0),
    ricochetX: round(ricochet.x ?? 0), ricochetY: round(ricochet.y ?? 0), ricochetZ: round(ricochet.z ?? 0),
    zones: [
      ...(props.armorColliders ?? []).map((name) => `Collider Type ${name}`),
      ...(props.armorPlateColliders ?? []).map((name) => `Armor Zone ${name}`),
    ],
  }
}

/**
 * Armoured rigs (their properties were null that day too): the built-in inserts inline and the plate slots with the plates
 * they take, in tarkov.dev's `armorSlots` form.
 */
const VEST = '5448e5284bdc2dcb718b4567'
const zonesOf = (filter) => [
  ...(filter.armorColliders ?? []).map((name) => `Collider Type ${name}`),
  ...(filter.armorPlateColliders ?? []).map((name) => `Armor Zone ${name}`),
]
for (const [id, item] of Object.entries(items)) {
  if (item._parent !== VEST || item._type !== 'Item') continue
  const armorSlots = []
  for (const slot of item._props?.Slots ?? []) {
    const filter = slot._props?.filters?.[0]
    if (!filter || !((filter.armorColliders?.length ?? 0) > 0 || (filter.armorPlateColliders?.length ?? 0) > 0)) continue
    if (!filter.locked) {
      armorSlots.push({ nameId: slot._name, name: slot._name, zones: zonesOf(filter), allowedPlates: filter.Filter ?? [] })
      continue
    }
    const insertId = filter.Plate ?? filter.Filter?.[0]
    const insert = items[insertId]?._props ?? {}
    const armorClass = Number.parseInt(String(insert.armorClass ?? '0'), 10) || 0
    if (armorClass <= 0) continue
    const ricochet = insert.RicochetParams ?? {}
    armorSlots.push({
      nameId: slot._name, name: `${insertId} Name`, class: armorClass,
      durability: Number(insert.MaxDurability ?? insert.Durability ?? 0),
      armorMaterial: String(insert.ArmorMaterial ?? ''), bluntThroughput: round(insert.BluntThroughput ?? 0),
      ricochetX: round(ricochet.x ?? 0), ricochetY: round(ricochet.y ?? 0), ricochetZ: round(ricochet.z ?? 0),
      zones: zonesOf(filter),
    })
  }
  if (armorSlots.length) parts[id] = { propertiesType: 'ItemPropertiesChestRig', class: 0, armorSlots }
}

const result = { source: 'SPT database: templates/items (plates, face shields, armoured masks and glasses, armoured rigs)', parts }
writeFileSync(out, `${JSON.stringify(result)}\n`)
console.log(`${Object.keys(parts).length} armour pieces → ${out}`)
