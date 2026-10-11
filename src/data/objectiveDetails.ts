/**
 * Structured quest objectives (id, type, count, items, zones) from tarkov.dev task data.
 *
 * Two upstream shapes carry the same fields and are both accepted:
 *   - json.tarkov.dev `{mode}/tasks` (what the app loads): references are plain ids, e.g. `zone.map: "<id>"`;
 *   - the GraphQL API (`TASK_OBJECTIVES_QUERY` below): references are objects, e.g. `zone.map: { id }`.
 * Map ids are resolved to the app's canonical map ids by the caller.
 */
import type { ObjectiveZone, QuestObjective, WeaponBuildAttribute, WeaponBuildRequirement } from '../domain/types'

type JsonRecord = Record<string, unknown>

/**
 * GraphQL selection for objectives with their map zones (https://tarkov.dev/api). The app reads the same fields from
 * json.tarkov.dev; this query is the documented way to get them when the JSON feed is unavailable.
 */
export const TASK_OBJECTIVES_QUERY = `query TaskObjectiveZones($gameMode: GameMode, $lang: LanguageCode) {
  tasks(gameMode: $gameMode, lang: $lang) {
    id
    name
    normalizedName
    map { id }
    objectives {
      id
      type
      description
      optional
      maps { id }
      ... on TaskObjectiveBasic { zones { id map { id } position { x y z } outline { x y z } top bottom } }
      ... on TaskObjectiveMark { markerItem { id } zones { id map { id } position { x y z } outline { x y z } top bottom } }
      ... on TaskObjectiveShoot { count zones { id map { id } position { x y z } outline { x y z } top bottom } }
      ... on TaskObjectiveItem { count foundInRaid items { id } zones { id map { id } position { x y z } outline { x y z } top bottom } }
      ... on TaskObjectiveQuestItem { count questItem { id } possibleLocations { map { id } positions { x y z } } }
      ... on TaskObjectiveExtract { count }
      ... on TaskObjectiveBuildItem { item { id } containsAll { id } containsCategory { id name } attributes { name requirement { compareMethod value } } }
    }
  }
}`

const asRecord = (value: unknown): JsonRecord => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
const asArray = (value: unknown): JsonRecord[] => Array.isArray(value) ? value.map(asRecord) : []
const text = (value: unknown) => typeof value === 'string' ? value : typeof value === 'number' ? String(value) : ''
/** A reference given as `"id"` (JSON feed) or `{ id }` (GraphQL). */
const refId = (value: unknown) => text(value) || text(asRecord(value).id)
const finite = (value: unknown) => {
  if (value === null || value === undefined || value === '') return undefined
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

function point(value: unknown): { x: number; y?: number; z: number } | undefined {
  const record = asRecord(value)
  const x = finite(record.x)
  const z = finite(record.z)
  if (x === undefined || z === undefined) return undefined
  const y = finite(record.y)
  return y === undefined ? { x, z } : { x, y, z }
}

/**
 * Adapts one task's raw objectives. `resolveMapId` turns an upstream map id into the app map id ('' = unknown);
 * `categoryName` names an item category id (json.tarkov.dev gives a Gunsmith part's `containsCategory` as bare ids).
 */
export function adaptObjectiveDetails(rawObjectives: unknown, resolveMapId: (upstreamId: string) => string | undefined, categoryName?: (id: string) => string | undefined): QuestObjective[] {
  return asArray(rawObjectives).flatMap((objective): QuestObjective[] => {
    const id = text(objective.id)
    if (!id) return []
    const listedMaps = (Array.isArray(objective.maps) ? objective.maps : []).map(refId).filter(Boolean)
    const fallbackMap = listedMaps[0] ?? ''
    const zones: ObjectiveZone[] = asArray(objective.zones).flatMap((zone) => {
      const mapId = resolveMapId(refId(zone.map) || fallbackMap)
      const position = point(zone.position)
      if (!mapId || !position) return []
      const outline = (Array.isArray(zone.outline) ? zone.outline : []).map(point).filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
      const top = finite(zone.top)
      const bottom = finite(zone.bottom ?? zone.botom)
      return [{
        ...(text(zone.id) ? { id: text(zone.id) } : {}),
        mapId,
        position,
        ...(outline.length >= 3 ? { outline } : {}),
        ...(top !== undefined ? { top } : {}),
        ...(bottom !== undefined ? { bottom } : {}),
      }]
    })
    const itemSpots = asArray(objective.possibleLocations).flatMap((location) => {
      const mapId = resolveMapId(refId(location.map) || fallbackMap)
      if (!mapId) return []
      return (Array.isArray(location.positions) ? location.positions : []).map(point)
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
        .map((position) => ({ mapId, ...position }))
    })
    const itemIds = [...new Set([
      ...(Array.isArray(objective.items) ? objective.items : []).map(refId),
      refId(objective.item),
      refId(objective.markerItem),
      refId(objective.questItem),
    ].filter(Boolean))]
    // Listed maps first; otherwise the maps of its zones / quest-item spots (an objective with neither = any map).
    const listedIds = listedMaps.map((entry) => resolveMapId(entry)).filter((entry): entry is string => Boolean(entry))
    const placeMaps = [...asArray(objective.zones), ...asArray(objective.possibleLocations)].map((place) => resolveMapId(refId(place.map)))
      .filter((entry): entry is string => Boolean(entry))
    const mapIds = [...new Set(listedIds.length ? listedIds : [...zones.map((zone) => zone.mapId), ...itemSpots.map((spot) => spot.mapId), ...placeMaps])]
    const count = Math.round(finite(objective.count) ?? 1)
    const build = weaponBuild(objective, categoryName)
    return [{
      id,
      type: text(objective.type) || 'unknown',
      description: text(objective.description),
      ...(objective.optional === true ? { optional: true } : {}),
      count: count >= 1 ? count : 1,
      ...(itemIds.length ? { itemIds } : {}),
      ...(objective.foundInRaid === true ? { foundInRaid: true } : {}),
      ...(mapIds.length ? { mapIds } : {}),
      ...(zones.length ? { zones } : {}),
      ...(itemSpots.length ? { itemSpots } : {}),
      // Zones or possible quest-item spots make it a map point; kill, hand over, skill… stay a checklist step.
      ...(zones.length || itemSpots.length || asArray(objective.zones).length || asArray(objective.possibleLocations).length ? { zoneBound: true } : {}),
      ...(build ? { build } : {}),
    }]
  })
}

const COMPARE = new Map<string, WeaponBuildAttribute['compare']>([['>=', '>='], ['<=', '<='], ['>', '>'], ['<', '<'], ['=', '='], ['==', '=']])

/**
 * A buildWeapon objective («Оружейник»): the weapon (`item`), the parts it must contain (`containsAll`, `containsOne`),
 * part categories (`containsCategory`) and stats. The two upstream shapes differ (tarkov-data-manager
 * update-quests.mjs, updateStaticApi):
 *   - GraphQL: `attributes: [{ name, requirement: { compareMethod, value } }]`, references `{ id, name }`;
 *   - json.tarkov.dev (what the app loads): `buildAttributes: { ergonomics: { compareMethod, value }, … }`, references
 *     are bare ids (`containsCategory` too: its names come from `categoryName`, the items file's `itemCategories`).
 * The game lists all ten stats on every part; a stat the part does not ask for has the value 0 and is left out, as on
 * tarkov.dev.
 */
export function weaponBuild(objective: JsonRecord, categoryName?: (id: string) => string | undefined): WeaponBuildRequirement | undefined {
  const type = text(objective.type).toLowerCase()
  const weaponId = refId(objective.item)
  const buildAttributes = asRecord(objective.buildAttributes)
  if (!weaponId || (type !== 'buildweapon' && !Array.isArray(objective.containsAll) && !Array.isArray(objective.attributes) && !Object.keys(buildAttributes).length)) return undefined
  const ids = (value: unknown) => [...new Set((Array.isArray(value) ? value : []).map((entry) => refId(entry) || refId(asRecord(entry).item)).filter(Boolean))]
  const rawAttributes: JsonRecord[] = Array.isArray(objective.attributes)
    ? asArray(objective.attributes)
    : Object.entries(buildAttributes).map(([name, requirement]) => ({ name, requirement }))
  const attributes = rawAttributes.flatMap((entry): WeaponBuildAttribute[] => {
    const requirement = asRecord(entry.requirement)
    const name = text(entry.name)
    const compare = COMPARE.get(text(requirement.compareMethod ?? entry.compareMethod).trim())
    const value = finite(requirement.value ?? entry.value)
    return name && compare && value !== undefined && value !== 0 ? [{ name, compare, value }] : []
  })
  const categories = (Array.isArray(objective.containsCategory) ? objective.containsCategory : []).flatMap((entry) => {
    const id = refId(entry)
    const name = text(asRecord(entry).name) || (id ? categoryName?.(id) : undefined)
    return id ? [{ id, name: name || id }] : []
  })
  const anyOfIds = ids(objective.containsOne)
  return {
    weaponId,
    partIds: ids(objective.containsAll),
    ...(anyOfIds.length ? { anyOfIds } : {}),
    ...(categories.length ? { categories } : {}),
    attributes,
  }
}

/** Objectives per task id from a GraphQL `tasks` answer (`{ data: { tasks: [...] } }` or the bare list). */
export function adaptGraphqlTaskObjectives(response: unknown, resolveMapId: (upstreamId: string) => string | undefined): Map<string, QuestObjective[]> {
  const root = asRecord(response)
  const tasks = Array.isArray(response) ? response : Array.isArray(asRecord(root.data).tasks) ? asRecord(root.data).tasks : root.tasks
  const result = new Map<string, QuestObjective[]>()
  for (const task of asArray(tasks)) {
    const id = text(task.id)
    if (id) result.set(id, adaptObjectiveDetails(task.objectives, resolveMapId))
  }
  return result
}
