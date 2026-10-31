import type { GearStats } from '../domain/types'

type JsonRecord = Record<string, unknown>

const DEAFENING = new Set(['None', 'Low', 'Medium', 'High'])

/**
 * The tier-list stats of one json.tarkov.dev item (`<mode>/items`): body armor, armored rigs and helmets (their
 * `properties` already count the default plates), and headsets. `materials` is the file's `armorMaterials`
 * (destructibility per material). Anything else, and a rig without armor, has none. Pure: the server builds its
 * catalog with it (src/data/catalogSource.ts).
 */
export function gearStatsOf(entry: JsonRecord, materials: unknown): GearStats | undefined {
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
  const kind = types.includes('helmet') ? 'helmet' : types.includes('armor') ? types.includes('rig') ? 'rig' : 'armor' : undefined
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
    } : {}),
  }
}

/** Stats by item id from a whole items file. */
export function gearStatsIndex(itemsRoot: unknown): Map<string, GearStats> {
  const root = asRecord(itemsRoot)
  const index = new Map<string, GearStats>()
  for (const entry of Object.values(asRecord(root.items)).map(asRecord)) {
    const id = text(entry.id)
    const stats = id ? gearStatsOf(entry, root.armorMaterials) : undefined
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
