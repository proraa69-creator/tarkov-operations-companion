/**
 * The range's armour catalogue: every helmet, body armour, armoured rig, plate, face shield, armoured mask and pair of
 * armoured glasses of the mode's items file (json.tarkov.dev `<mode>/items`: class, durability, material, blunt throughput,
 * ricochet, the colliders and plate zones each piece covers — the built-in soft inserts and helmet parts inline in
 * `armorSlots`), with the two facts the file lacks from the game's own item templates (rangeTargets.json: a carrier's
 * plate in each slot, and the plate slots over soft armour). Pure: see rangeArmor.test.ts.
 */
import { COLLIDERS, PLATE_ZONES, type ArmorPiece, type Collider, type PlateZone } from './rangeModel'
import targetsFile from './rangeTargets.json'
import partsFile from './rangeParts.json'

type Json = Record<string, unknown>

/** face: a visor or a mask (covers the eyes or the jaw); module: another helmet attachment (a top plate, an aventail). */
export type ArmorKind = 'helmet' | 'armor' | 'rig' | 'plate' | 'face' | 'module' | 'eyewear'

export interface PlateSlot {
  /** The slot's name in the item (Front_plate, Back_plate, Left_side_plate…). */
  name: string
  zones: PlateZone[]
  allowed: string[]
  /** The plate the item comes with. */
  defaultPlate?: string
  softReduce: boolean
}

export interface RangeItem {
  id: string
  name: string
  shortName: string
  icon: string
  kind: ArmorKind
  /** The best class of the item as worn by default. */
  armorClass: number
  /** Built-in pieces (soft inserts, a helmet's parts) or the item itself (a plate, a visor, glasses). */
  pieces: ArmorPiece[]
  plateSlots: PlateSlot[]
  /** Helmets: the visors (face) and the other attachments (module) its slots take. */
  visors: string[]
  modules: string[]
  /** Whether it covers the face (eyes or jaw) itself: masks and helmets with a built-in face. */
  coversFace: boolean
}

export interface ArmorCatalog {
  items: Map<string, RangeItem>
  list: RangeItem[]
  /** The rounds' penetration deviation (the game draws each shot's penetration around the round's). */
  deviation: Record<string, number>
}

export interface RangeTargetData {
  key: string
  group: 'pmc' | 'scav' | 'boss' | 'follower'
  ru: string
  en: string
  health: Array<Record<string, number>>
  gear: Partial<Record<'Headwear' | 'ArmorVest' | 'TacticalVest' | 'FaceCover' | 'Eyewear', { chance: number; items: Array<[string, number]> }>>
  mods: Record<string, Record<string, string[]>>
  modChances: Record<string, number>
}

interface TargetsFile { targets: RangeTargetData[]; slotDefaults: Record<string, Record<string, string>>; softReduce: string[] }
export const RANGE_TARGETS = (targetsFile as unknown as TargetsFile).targets
const SLOT_DEFAULTS = (targetsFile as unknown as TargetsFile).slotDefaults
const SOFT_REDUCE = new Set((targetsFile as unknown as TargetsFile).softReduce)
/** Plates, face shields, armoured masks and glasses from the game's templates (scripts/build-range-parts.mjs). */
const PARTS = (partsFile as unknown as { parts: Record<string, Json> }).parts

const COLLIDER_SET = new Set<string>(COLLIDERS)
const PLATE_SET = new Set<string>(PLATE_ZONES)

const record = (value: unknown): Json => value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {}
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : []
const text = (value: unknown) => typeof value === 'string' ? value : ''
const num = (value: unknown) => { const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value)); return Number.isFinite(parsed) ? parsed : 0 }

/** «Collider Type RibcageUp» → RibcageUp; «Armor Zone Plate_Korund_chest» → Plate_Korund_chest. */
export function readZones(zones: unknown): { colliders: Collider[]; plates: PlateZone[] } {
  const colliders: Collider[] = []
  const plates: PlateZone[] = []
  for (const zone of list(zones).map(text)) {
    const name = zone.replace(/^Collider Type\s+/, '').replace(/^Armor Zone\s+/, '').trim()
    if (COLLIDER_SET.has(name)) colliders.push(name as Collider)
    else if (PLATE_SET.has(name)) plates.push(name as PlateZone)
  }
  return { colliders, plates }
}

export interface CatalogInput {
  items: Json
  materials: Json
  /** `<id> Name` / `<id> ShortName` → text. */
  names: Json
  imageBase: string
  /** The pieces' properties to fall back on (default: rangeParts.json). */
  parts?: Record<string, Json>
}

/**
 * An item's properties; for a piece the file gives none of (json.tarkov.dev on 25.11.2026: `properties: null` for every
 * plate and face shield, report 228) the game's own, with the file's current class and durability over them.
 */
export function propertiesOf(entry: Json, parts: Record<string, Json> = PARTS): Json {
  const props = record(entry.properties)
  if (text(props.propertiesType)) return props
  const part = parts[text(entry.id)]
  if (!part) return props
  const armorClass = num(entry.armorClass)
  const durability = num(entry.maxDurability)
  return { ...part, ...(armorClass > 0 ? { class: armorClass } : {}), ...(durability > 0 ? { durability } : {}) }
}

const imageOf = (base: string, id: string) => `${base.replace(/\/$/, '')}/${id}-icon.webp`

function pieceOf(input: CatalogInput, key: string, itemId: string, name: string, props: Json, removable: boolean, extra: Partial<ArmorPiece> = {}): ArmorPiece | undefined {
  const armorClass = num(props.class)
  const durability = num(props.durability)
  if (armorClass <= 0 || durability <= 0) return undefined
  const { colliders, plates } = readZones(props.zones)
  const material = text(props.armorMaterial) || text(props.material) || text(record(props.material).id)
  const destructibility = num(record(input.materials[material]).destructibility) || 0.5
  const ricochet = num(props.ricochetX) > 0 ? { x: num(props.ricochetX), y: num(props.ricochetY), z: num(props.ricochetZ) } : undefined
  return {
    key, itemId, name, armorClass, maxDurability: durability, durability, material, destructibility,
    bluntThroughput: num(props.bluntThroughput), ...(ricochet ? { ricochet } : {}),
    colliders, plates, removable, ...extra,
  }
}

const nameOf = (input: CatalogInput, id: string, field: 'Name' | 'ShortName', fallback: string) => text(input.names[`${id} ${field}`]) || fallback

/** The catalogue from a mode's items file (the parts needed). */
export function buildArmorCatalog(input: CatalogInput): ArmorCatalog {
  const items = new Map<string, RangeItem>()
  const deviation: Record<string, number> = {}
  const all = Object.values(input.items).map(record)
  const isFacePiece = (props: Json) => readZones(props.zones).colliders.some((collider) => collider === 'Eyes' || collider === 'Jaw')
  for (const entry of all) {
    const id = text(entry.id)
    const props = propertiesOf(entry, input.parts ?? PARTS)
    const type = text(props.propertiesType)
    const types = list(entry.types).map(text)
    if (!id || !type) continue
    if (type === 'ItemPropertiesAmmo') { const value = num(props.penetrationPowerDeviation); if (value > 0) deviation[id] = value; continue }
    const name = nameOf(input, id, 'Name', text(entry.name) || id)
    const shortName = nameOf(input, id, 'ShortName', text(entry.shortName) || name)
    let kind: ArmorKind | undefined
    if (type === 'ItemPropertiesGlasses') kind = 'eyewear'
    else if (type === 'ItemPropertiesArmorAttachment') kind = readZones(props.zones).plates.length ? 'plate' : isFacePiece(props) ? 'face' : 'module'
    // a mask worn on the face (Tagilla's, CQCM) has no inline parts and covers the eyes or the jaw; a helmet otherwise
    else if (type === 'ItemPropertiesHelmet') kind = !list(props.armorSlots).length && isFacePiece(props) ? 'face' : 'helmet'
    else if (type === 'ItemPropertiesArmor') kind = 'armor'
    else if (type === 'ItemPropertiesChestRig') kind = num(props.class) > 0 || list(props.armorSlots).length ? 'rig' : undefined
    if (!kind || (kind === 'helmet' && !types.includes('helmet') && !list(props.armorSlots).length && num(props.class) <= 0)) continue
    const pieces: ArmorPiece[] = []
    const plateSlots: PlateSlot[] = []
    const prefix = kind === 'rig' ? 'armor' : kind
    for (const slot of list(props.armorSlots).map(record)) {
      const slotName = text(slot.nameId) || text(slot.name)
      if (list(slot.allowedPlates).length) {
        plateSlots.push({
          name: slotName,
          zones: readZones(slot.zones).plates,
          allowed: list(slot.allowedPlates).map(text).filter(Boolean),
          defaultPlate: SLOT_DEFAULTS[id]?.[slotName],
          softReduce: SOFT_REDUCE.has(`${id}:${slotName}`),
        })
        continue
      }
      const insertId = text(slot.name).split(' ')[0] || id
      const piece = pieceOf(input, `${prefix}:${slotName}`, insertId, nameOf(input, insertId, 'Name', `${shortName} · ${slotName}`), slot, false)
      if (piece) pieces.push(piece)
    }
    // An item with no inline slots is a piece itself (a plate, a visor, glasses, a mask, an old helmet).
    if (!list(props.armorSlots).length) {
      const piece = pieceOf(input, `${prefix}:self`, id, name, props, kind === 'plate' || kind === 'face' || kind === 'module' || kind === 'eyewear')
      if (piece) {
        // glasses guard the eyes (their file has no zones)
        if (kind === 'eyewear' && !piece.colliders.length) piece.colliders = ['Eyes']
        pieces.push(piece)
      }
    }
    if (!pieces.length && !plateSlots.length) continue
    const attachments = kind === 'helmet'
      ? list(props.slots).map(record).flatMap((slot) => list(record(slot.filters).allowedItems).map(text)).filter(Boolean)
      : []
    items.set(id, {
      id, name, shortName, icon: imageOf(input.imageBase, id), kind, modules: attachments,
      armorClass: Math.max(num(props.class), ...pieces.map((piece) => piece.armorClass)),
      pieces, plateSlots, visors: attachments, coversFace: pieces.some((piece) => piece.colliders.includes('Eyes') || piece.colliders.includes('Jaw')),
    })
  }
  // Helmets keep only the attachments that are armour of the catalogue: visors and the other modules apart.
  for (const item of items.values()) {
    if (item.kind !== 'helmet') continue
    item.modules = item.visors.filter((other) => items.get(other)?.kind === 'module')
    item.visors = item.visors.filter((other) => items.get(other)?.kind === 'face')
  }
  const order: ArmorKind[] = ['helmet', 'face', 'module', 'eyewear', 'armor', 'rig', 'plate']
  const sorted = [...items.values()].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || b.armorClass - a.armorClass || a.shortName.localeCompare(b.shortName))
  return { items, list: sorted, deviation }
}

/** What a character wears at the range (ids; plates by slot name, a visor on the helmet). */
export interface KitChoice {
  helmet?: string
  visor?: string
  /** Another helmet attachment (a top plate, an aventail). */
  module?: string
  face?: string
  eyewear?: string
  /** Body armour or an armoured rig. */
  body?: string
  plates: Record<string, string | undefined>
}

export const EMPTY_KIT: KitChoice = { plates: {} }

/** The pieces of a chosen kit, fresh (full durability), in wearing order. */
export function kitPieces(catalog: ArmorCatalog, choice: KitChoice): ArmorPiece[] {
  const pieces: ArmorPiece[] = []
  const add = (id: string | undefined, prefix: string) => {
    const item = id ? catalog.items.get(id) : undefined
    if (!item) return undefined
    for (const piece of item.pieces) pieces.push({ ...piece, key: `${prefix}:${piece.key}`, colliders: [...piece.colliders], plates: [...piece.plates] })
    return item
  }
  const helmet = add(choice.helmet, 'helmet')
  if (helmet && choice.visor && helmet.visors.includes(choice.visor)) add(choice.visor, 'visor')
  if (helmet && choice.module && helmet.modules.includes(choice.module)) add(choice.module, 'module')
  add(choice.face, 'face')
  add(choice.eyewear, 'eyewear')
  const body = add(choice.body, 'body')
  for (const slot of body?.plateSlots ?? []) {
    const plateId = choice.plates[slot.name]
    const plate = plateId ? catalog.items.get(plateId) : undefined
    if (!plate || !slot.allowed.includes(plate.id)) continue
    for (const piece of plate.pieces) {
      // a plate covers the slot's zones that it is made for
      const zones = piece.plates.filter((zone) => slot.zones.includes(zone))
      pieces.push({ ...piece, key: `plate:${slot.name}`, plates: zones.length ? zones : [...slot.zones], colliders: [], softReduce: slot.softReduce, removable: true })
    }
  }
  return pieces
}

/** A carrier with the plates it comes with. */
export function defaultPlates(catalog: ArmorCatalog, bodyId: string | undefined): Record<string, string | undefined> {
  const body = bodyId ? catalog.items.get(bodyId) : undefined
  return Object.fromEntries((body?.plateSlots ?? []).map((slot) => [slot.name, slot.defaultPlate && catalog.items.has(slot.defaultPlate) ? slot.defaultPlate : undefined]))
}

/** The most likely kit of a target (its commonest helmet and armour with what the bot fits to them). */
export function likelyKit(catalog: ArmorCatalog, target: RangeTargetData): KitChoice {
  return kitFrom(catalog, target, (items) => items[0]?.[0], () => true)
}

/** A kit drawn as the game draws a bot's equipment (each slot by its chance, then the items by weight). */
export function randomKit(catalog: ArmorCatalog, target: RangeTargetData, random: () => number): KitChoice {
  const pick = (items: Array<[string, number]>) => {
    let roll = random() * items.reduce((sum, [, share]) => sum + share, 0)
    for (const [id, share] of items) { roll -= share; if (roll <= 0) return id }
    return items[items.length - 1]?.[0]
  }
  return kitFrom(catalog, target, pick, (chance) => random() * 100 < chance)
}

function kitFrom(catalog: ArmorCatalog, target: RangeTargetData, pick: (items: Array<[string, number]>) => string | undefined, wears: (chance: number) => boolean): KitChoice {
  const known = (slot: keyof RangeTargetData['gear']) => {
    const gear = target.gear[slot]
    if (!gear || !wears(gear.chance)) return undefined
    const items = gear.items.filter(([id]) => catalog.items.has(id))
    return items.length ? pick(items) : undefined
  }
  const helmetId = known('Headwear')
  const helmetItem = helmetId ? catalog.items.get(helmetId) : undefined
  const choice: KitChoice = { plates: {} }
  if (helmetItem?.kind === 'helmet') {
    choice.helmet = helmetItem.id
    const fitted = target.mods[helmetItem.id] ?? {}
    const visor = Object.values(fitted).flat().find((id) => helmetItem.visors.includes(id))
    if (visor && wears(target.modChances.mod_equipment ?? target.modChances.mod_equipment_000 ?? 100)) choice.visor = visor
    const helmetModule = Object.values(fitted).flat().find((id) => helmetItem.modules.includes(id))
    if (helmetModule && wears(target.modChances.mod_equipment_001 ?? target.modChances.mod_equipment ?? 100)) choice.module = helmetModule
  } else if (helmetItem?.kind === 'face') choice.face = helmetItem.id
  const face = known('FaceCover')
  if (face && catalog.items.get(face)?.kind === 'face') choice.face = face
  const eyewear = known('Eyewear')
  if (eyewear && catalog.items.get(eyewear)?.kind === 'eyewear') choice.eyewear = eyewear
  const body = known('ArmorVest') ?? known('TacticalVest')
  if (body) {
    choice.body = body
    const fitted = target.mods[body] ?? {}
    const slots = catalog.items.get(body)?.plateSlots ?? []
    for (const slot of slots) {
      const options = (Object.entries(fitted).find(([name]) => name.toLowerCase() === slot.name.toLowerCase())?.[1] ?? []).filter((id) => slot.allowed.includes(id) && catalog.items.has(id))
      const chance = target.modChances[slot.name.toLowerCase()] ?? 100
      choice.plates[slot.name] = options.length && wears(chance) ? pick(options.map((id) => [id, 1])) : undefined
    }
  }
  return choice
}
