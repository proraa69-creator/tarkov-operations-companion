import type { GearStats } from '../domain/types'

type JsonRecord = Record<string, unknown>

const DEAFENING = new Set(['None', 'Low', 'Medium', 'High'])

/**
 * The tier-list stats of one json.tarkov.dev item (`<mode>/items`): body armor, armored rigs, armor plates and helmets (their
 * `properties` already count the default plates), and headsets. `materials` is the file's `armorMaterials`
 * (destructibility per material). Anything else, and a rig without armor, has none. Pure: the server builds its
 * catalog with it (src/data/catalogSource.ts).
 */
export function gearStatsOf(entry: JsonRecord, materials: unknown, lookup: (id: string) => JsonRecord | undefined = () => undefined, presetsOf: (id: string) => HelmetPreset[] | undefined = () => undefined): GearStats | undefined {
  const types = Array.isArray(entry.types) ? entry.types : []
  const properties = asRecord(entry.properties)
  if (types.includes('headphones') || properties.propertiesType === 'ItemPropertiesHeadphone') {
    return {
      kind: 'headphones',
      distanceModifier: num(properties.distanceModifier),
      distortion: num(properties.distortion),
      ambientVolume: num(properties.ambientVolume),
      compressorGain: num(properties.compressorGain),
      compressorThreshold: num(properties.compressorThreshold),
      conflictingIds: (Array.isArray(entry.conflictingItems) ? entry.conflictingItems : [])
        .map((value) => typeof value === 'string' ? value : String(asRecord(value).id ?? ''))
        .filter(Boolean),
    }
  }
  if (types.includes('backpack')) {
    const capacity = num(properties.capacity)
    return capacity ? { kind: 'backpack', capacity, speedPenalty: num(properties.speedPenalty) ?? 0, turnPenalty: num(properties.turnPenalty) ?? 0, ergoPenalty: num(properties.ergoPenalty) ?? 0 } : undefined
  }
  // Plate carriers are often typed `rig` alone: a rig with an armor class is an armored rig. Armor plates have their own
  // class (owner, 02.11.2026: «бронеплиты, по уровню защиты»).
  const kind = types.includes('helmet') ? 'helmet' : types.includes('armorPlate') ? 'plate' : types.includes('rig') ? 'rig' : types.includes('armor') ? 'armor' : undefined
  const armorClass = num(properties.class)
  if (!kind || !armorClass) return undefined
  const materialRef = properties.material
  const material = typeof materialRef === 'string' ? materialRef : text(asRecord(materialRef).id)
  const destructibility = num(asRecord(asRecord(materials)[material ?? '']).destructibility) ?? num(asRecord(materialRef).destructibility)
  const deafening = text(properties.deafening)
  return {
    kind,
    armorClass,
    durability: num(properties.durability),
    material,
    destructibility,
    zones: Array.isArray(properties.zones) ? properties.zones.length : num(properties.zones),
    speedPenalty: num(properties.speedPenalty) ?? 0,
    turnPenalty: num(properties.turnPenalty) ?? 0,
    ergoPenalty: num(properties.ergoPenalty) ?? 0,
    ...(kind === 'helmet' ? {
      deafening: deafening && DEAFENING.has(deafening) ? deafening as GearStats['deafening'] : undefined,
      blocksHeadset: properties.blocksHeadset === true,
      ...helmetFace(properties, armorClass, lookup, presetsOf(text(entry.id) ?? '') ?? []),
    } : {}),
  }
}

/** Stack sizes above one by item id from a whole items file (ammo: price per slot). */
export function stackSizeIndex(itemsRoot: unknown): Map<string, number> {
  const index = new Map<string, number>()
  for (const entry of Object.values(asRecord(asRecord(itemsRoot).items)).map(asRecord)) {
    const id = text(entry.id)
    const stack = num(entry.stackMaxSize)
    if (id && stack && stack > 1) index.set(id, stack)
  }
  return index
}

/**
 * A helmet's face (owner, 02.11.2026: «маска 1щ килла должна быть с забралом и в тир листе S», «алтын тоже с забралом»):
 * the class that guards the eyes and the jaw — the helmet's own when it covers them (Tagilla's masks), else the best armored
 * face shield its slots take (Маска-1Щ: a class 6 visor on a class 4 helmet); 0 when nothing does. Top plates (SLAAP)
 * and aventails guard no face.
 */
function helmetFace(properties: JsonRecord, armorClass: number, lookup: (id: string) => JsonRecord | undefined, presets: HelmetPreset[]): Pick<GearStats, 'faceClass' | 'visorId' | 'presetId'> {
  if (coversFace(properties)) return { faceClass: armorClass }
  const slots = Array.isArray(properties.slots) ? properties.slots.map(asRecord) : []
  const visors: Array<{ id: string; armorClass: number }> = []
  for (const id of slots.flatMap((slot) => asRecord(slot.filters).allowedItems).flatMap((value) => Array.isArray(value) ? value : [value])) {
    const visorId = typeof id === 'string' ? id : text(asRecord(id).id)
    const visor = visorId ? asRecord(lookup(visorId)) : {}
    const visorClass = num(asRecord(visor.properties).class)
    if (visorId && visorClass && coversFace(asRecord(visor.properties))) visors.push({ id: visorId, armorClass: visorClass })
  }
  if (!visors.length) return { faceClass: 0 }
  // The best class; of equal ones the visor a preset of the helmet holds (its picture shows the helmet with it).
  const top = Math.max(...visors.map((visor) => visor.armorClass))
  const best = visors.filter((visor) => visor.armorClass === top)
  const withPreset = best.flatMap((visor) => { const preset = presets.find((entry) => entry.items.has(visor.id)); return preset ? [{ visor, preset }] : [] })[0]
  return withPreset ? { faceClass: top, visorId: withPreset.visor.id, presetId: withPreset.preset.id } : { faceClass: top, visorId: best[0]!.id }
}

/** A preset of an item (a helmet with its face shield on), with the items it holds. */
export interface HelmetPreset { id: string; items: ReadonlySet<string> }

/** The presets of every item by the item's id (`properties.baseItem`), from a whole items file. */
export function presetIndex(items: JsonRecord): Map<string, HelmetPreset[]> {
  const index = new Map<string, HelmetPreset[]>()
  for (const entry of Object.values(items).map(asRecord)) {
    const types = Array.isArray(entry.types) ? entry.types : []
    const id = text(entry.id)
    if (!id || !types.includes('preset')) continue
    const base = asRecord(entry.properties).baseItem
    const baseId = typeof base === 'string' ? base : text(asRecord(base).id)
    if (!baseId) continue
    const held = (Array.isArray(entry.containsItems) ? entry.containsItems : []).map((row) => { const item = asRecord(row).item; return typeof item === 'string' ? item : text(asRecord(item).id) ?? '' })
    index.set(baseId, [...(index.get(baseId) ?? []), { id, items: new Set(held.filter(Boolean)) }])
  }
  return index
}

/** The eyes or the jaw among an item's zones: the game's keys, or the catalog's translation of them («Голова, Глаза»). */
function coversFace(properties: JsonRecord) {
  return Array.isArray(properties.zones) && properties.zones.some((zone) => /Eyes|Jaw|глаз|челюст/i.test(String(zone)))
}

/** Stats by item id from a whole items file. */
export function gearStatsIndex(itemsRoot: unknown): Map<string, GearStats> {
  const root = asRecord(itemsRoot)
  const index = new Map<string, GearStats>()
  const items = asRecord(root.items)
  const presets = presetIndex(items)
  for (const entry of Object.values(items).map(asRecord)) {
    const id = text(entry.id)
    const stats = id ? gearStatsOf(entry, root.armorMaterials, (other) => asRecord(items[other]), (other) => presets.get(other)) : undefined
    if (id && stats) index.set(id, stats)
  }
  return index
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
}

function text(value: unknown) {
  return typeof value === 'string' && value ? value : undefined
}

function num(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value))
  return Number.isFinite(parsed) ? parsed : undefined
}
