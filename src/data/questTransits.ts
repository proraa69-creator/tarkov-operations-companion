import type { Quest, QuestObjectiveTransit } from '../domain/types'
import { canonicalMapId, mapDisplayName } from './mapIds'

/**
 * Quests that span several locations and the transits between them (owner, 15.10.2026: «если изначально квест начинается
 * на одной карте, а далее нужен переход на другую, значит на карте точка выполнения должна быть на точке перехода с карты
 * на карту, на требуемую карту»).
 *
 * Transits (EFT 0.15+, the in-raid move from one location to another) come from the tarkov.dev maps file (`<mode>/maps`,
 * `transits`: id, the map it leads to, position, outline, top/bottom). Nothing here invents a place: a transit without
 * coordinates gives no point, a route the transits cannot make gives no point.
 *
 * A quest's transit points:
 * - a transit objective (tarkov.dev `extract` whose only accepted exit status is the transit, or a curated `transit`) is
 *   done AT the transit of its map that leads where its text says: its point is that transit;
 * - otherwise a quest whose objectives need exactly two locations shows, on each, the transit that leads to the other one;
 *   with no direct transit, the first transit of the shortest route over the transit graph. A quest on three or more
 *   locations without transit objectives is a tour of separate raids («Что-то мне это напоминает...»: eight maps), and a
 *   transit to every other map would bury the map in points: it gets none.
 */

type JsonRecord = Record<string, unknown>

/** One transit of the maps file, on the app's (canonical) map ids. */
export interface MapTransit {
  /** The feed's transit id (unique on its map, e.g. «5» on Streets). */
  id: string
  /** App map the transit stands on. */
  mapId: string
  /** App map it leads to. */
  toMapId: string
  /** The feed's own text in the catalog language, e.g. «Переход на Лабораторию» / «Transit to The Lab». */
  label: string
  /** What the game asks to pass (the feed's `conditions`), e.g. «Передать Ключ-карта доступа в TerraGroup Labs (1)». */
  condition?: string
  /** The feed's geometry, untouched (game coordinates). */
  position: JsonRecord
  outline?: unknown
  top?: unknown
  bottom?: unknown
}

/** A transit point of one quest on one map: the transit to take and where it finally leads. */
export interface QuestTransitPoint {
  questId: string
  /** The transit objective this point is (explicit), absent for a route between the quest's locations. */
  objectiveId?: string
  /** The objective's own text (explicit points). */
  objectiveText?: string
  /** The transit to take on this map (the first hop of the route). */
  transit: MapTransit
  /** The quest's locations this transit leads to (directly or as the first hop). */
  targets: string[]
  /** Maps of the shortest route per target, start and target included (a direct transit: [start, target]). */
  routes: string[][]
}

/** The transit exit status in the feed: its key and its translations (regular/tasks_ru «Переход», tasks_en «Transition»). */
const TRANSIT_STATUS = /^(?:marathon name|переход|transit|transition)$/i
/** A quest without transit objectives gets transit points only on this many locations (see the file's comment). */
const IMPLICIT_LOCATIONS = 2
/** A transit in an objective's text (tarkov.dev tasks_en / tasks_ru). */
const TRANSIT_TEXT = /\btransit\b|(?:^|\s)переход/iu

/** The maps file's transits, once per map and id. A map's variants (night Factory, Ground Zero 21+) come after the map itself. */
export function adaptMapTransits(mapsRoot: JsonRecord, resolveMapId: (rawId: string) => string): MapTransit[] {
  const rawMaps = Object.values(asRecord(mapsRoot.maps)).map(asRecord)
  const own = (rawMap: JsonRecord) => canonicalMapId(text(rawMap.normalizedName)) === text(rawMap.normalizedName)
  const ordered = [...rawMaps.filter(own), ...rawMaps.filter((rawMap) => !own(rawMap))]
  const seen = new Set<string>()
  const transits: MapTransit[] = []
  for (const rawMap of ordered) {
    const mapId = canonicalMapId(text(rawMap.normalizedName))
    if (!mapId) continue
    for (const raw of asArray(rawMap.transits)) {
      const id = text(raw.id) || String(raw.id ?? '')
      const toMapId = resolveMapId(text(raw.map))
      const position = asRecord(raw.position)
      if (!id || !toMapId || toMapId === mapId || seen.has(`${mapId}|${id}`)) continue
      if (!Number.isFinite(Number(position.x)) || !Number.isFinite(Number(position.z)) || position.x == null || position.z == null) continue
      seen.add(`${mapId}|${id}`)
      const label = text(raw.description)
      const condition = text(raw.conditions)
      transits.push({
        id,
        mapId,
        toMapId,
        // An untranslated key (`STR_TRANSIT_5_DESC`) is not a label.
        label: /_DESC$/i.test(label) ? '' : label,
        ...(condition && !/_COND$/i.test(condition) ? { condition } : {}),
        position,
        ...(raw.outline !== undefined ? { outline: raw.outline } : {}),
        ...(raw.top !== undefined ? { top: raw.top } : {}),
        ...(raw.bottom !== undefined ? { bottom: raw.bottom } : {}),
      })
    }
  }
  return transits
}

/** Transits listed in the maps file without coordinates (they get no point): `map|id → target`. */
export function transitsWithoutPosition(mapsRoot: JsonRecord, resolveMapId: (rawId: string) => string): string[] {
  return Object.values(asRecord(mapsRoot.maps)).map(asRecord).flatMap((rawMap) => asArray(rawMap.transits).flatMap((raw) => {
    const position = asRecord(raw.position)
    const placed = position.x != null && position.z != null && Number.isFinite(Number(position.x)) && Number.isFinite(Number(position.z))
    return placed ? [] : [`${text(rawMap.normalizedName)}|${text(raw.id) || String(raw.id ?? '')} → ${resolveMapId(text(raw.map)) || text(raw.map)}`]
  }))
}

/**
 * The shortest chain of transits from one location to another (breadth-first over the transit graph; ties keep the
 * maps file's order). Undefined when the transits do not connect them; empty when it is the same location.
 */
export function shortestTransitRoute(transits: MapTransit[], fromMapId: string, toMapId: string): MapTransit[] | undefined {
  if (fromMapId === toMapId) return []
  const previous = new Map<string, MapTransit>()
  const visited = new Set([fromMapId])
  let frontier = [fromMapId]
  while (frontier.length) {
    const next: string[] = []
    for (const mapId of frontier) {
      for (const transit of transits) {
        if (transit.mapId !== mapId || visited.has(transit.toMapId)) continue
        visited.add(transit.toMapId)
        previous.set(transit.toMapId, transit)
        if (transit.toMapId === toMapId) {
          const route: MapTransit[] = []
          for (let step = previous.get(toMapId); step; step = step.mapId === fromMapId ? undefined : previous.get(step.mapId)) route.unshift(step)
          return route
        }
        next.push(transit.toMapId)
      }
    }
    frontier = next
  }
  return undefined
}

/**
 * A transit objective: done by taking a transit. tarkov.dev gives it as an `extract` that accepts only the transit exit
 * status («Совершить переход с Улиц Таркова на Лабораторию»), or an `extract` with no status whose text is a transit
 * («Use the transit from The Lab to Streets of Tarkov», «Новое начало»); the curated quests as `transit`.
 */
export function isTransitObjective(objective: JsonRecord) {
  const type = text(objective.type).toLowerCase()
  if (type === 'transit') return true
  if (type !== 'extract') return false
  const statuses = strings(objective.exitStatus)
  if (statuses.length) return statuses.every((status) => TRANSIT_STATUS.test(status.trim()))
  return TRANSIT_TEXT.test(text(objective.description))
}

/** What else the task says about where a transit objective leads. */
export interface TransitHints {
  /** The locations the quest needs (questLocations). */
  locations?: string[]
  /** One-location maps of the objectives after this one, in order: the transit leads where the quest goes on. */
  nextMaps?: string[]
}

/**
 * The transit a transit objective is done at, on one of the objective's maps:
 * 1. a curated objective's zone names it (`transit-<id>`);
 * 2. the objective's text names the target as the transit's own label does («… на Лабораторию», «… в Лес», «… to The Lab»);
 * 3. the first later objective on one location that a transit of the objective's maps leads to (the quest goes on there);
 * 4. the only transit of the objective's maps that leads to another location of the quest.
 * Nothing else: no transit is guessed.
 */
export function objectiveTransit(objective: JsonRecord, transits: MapTransit[], resolveMapId: (rawId: string) => string, hints: TransitHints = {}): MapTransit | undefined {
  const maps = objectiveMaps(objective, resolveMapId)
  if (!maps.length) return undefined
  const candidates = transits.filter((transit) => maps.includes(transit.mapId))
  for (const zone of asArray(objective.zones)) {
    const named = /^transit-(.+)$/.exec(text(zone.id))?.[1]
    const found = named ? candidates.find((transit) => transit.id === named && transit.mapId === resolveMapId(text(zone.map))) : undefined
    if (found) return found
  }
  const description = text(objective.description)
  const byText = candidates.filter((transit) => namesTarget(description, transit.label))
  if (byText.length === 1) return byText[0]
  for (const mapId of hints.nextMaps ?? []) {
    const leading = candidates.filter((transit) => transit.toMapId === mapId)
    if (leading.length === 1) return leading[0]
    if (leading.length > 1) break
  }
  const others = new Set([...maps, ...(hints.locations ?? [])])
  const byPlace = candidates.filter((transit) => others.has(transit.toMapId))
  return byPlace.length === 1 ? byPlace[0] : undefined
}

/** «Совершить переход с Резерва в Лес» names the target of «Переход на Лес»; «… с Лаборатории …» does not name «Переход на Лабораторию». */
function namesTarget(description: string, label: string) {
  const place = labelPlace(label)
  if (!place || !description) return false
  const pattern = new RegExp(`(?:^|[\\s(«"])(?:на|в|во|to)\\s+${escapeRegex(place)}(?![\\p{L}\\p{N}])`, 'iu')
  return pattern.test(description)
}

/**
 * The locations a quest needs: maps of its objectives that name one location (after merging a map's variants), and the
 * task's own map. An objective listing several locations («Woods or Interchange», «Eliminate Scavs on any of …») is a
 * choice, not a place to go, and adds none.
 */
export function questLocations(task: JsonRecord, resolveMapId: (rawId: string) => string): string[] {
  const locations: string[] = []
  const add = (mapId: string) => { if (mapId && !locations.includes(mapId)) locations.push(mapId) }
  add(resolveMapId(refId(task.map)))
  for (const objective of asArray(task.objectives)) {
    const maps = objectiveMaps(objective, resolveMapId)
    if (maps.length === 1) add(maps[0])
  }
  return locations
}

function transitHints(objectives: JsonRecord[], objective: JsonRecord, locations: string[], resolveMapId: (rawId: string) => string): TransitHints {
  const nextMaps = objectives.slice(objectives.indexOf(objective) + 1).flatMap((next) => {
    const maps = objectiveMaps(next, resolveMapId)
    return maps.length === 1 ? maps : []
  })
  return { locations, nextMaps }
}

/** The transit points of one task (tarkov.dev shape, already translated) — see the file's comment. */
export function questTransitPoints(task: JsonRecord, transits: MapTransit[], resolveMapId: (rawId: string) => string): QuestTransitPoint[] {
  const questId = text(task.id)
  if (!questId || !transits.length) return []
  const locations = questLocations(task, resolveMapId)
  const points: QuestTransitPoint[] = []
  const objectives = asArray(task.objectives)
  const explicit = objectives.filter(isTransitObjective)
  if (explicit.length) {
    for (const objective of explicit) {
      const transit = objectiveTransit(objective, transits, resolveMapId, transitHints(objectives, objective, locations, resolveMapId))
      // A curated objective with a zone at the transit is drawn by its zone already.
      if (!transit || asArray(objective.zones).length) continue
      points.push({ questId, objectiveId: text(objective.id) || undefined, objectiveText: text(objective.description) || undefined, transit, targets: [transit.toMapId], routes: [[transit.mapId, transit.toMapId]] })
    }
    return points
  }
  if (locations.length !== IMPLICIT_LOCATIONS) return []
  for (const from of locations) {
    const byTransit = new Map<string, QuestTransitPoint>()
    for (const to of locations) {
      if (to === from) continue
      const route = shortestTransitRoute(transits, from, to)
      if (!route?.length) continue
      const first = route[0]
      const path = [from, ...route.map((step) => step.toMapId)]
      const point = byTransit.get(first.id)
      if (point) { point.targets.push(to); point.routes.push(path) }
      else byTransit.set(first.id, { questId, transit: first, targets: [to], routes: [path] })
    }
    points.push(...byTransit.values())
  }
  return points
}

/** The objectives' transit: where it is taken and where it leads (QuestObjective.transit), by objective id. */
export function objectiveTransitsOf(task: JsonRecord, transits: MapTransit[], resolveMapId: (rawId: string) => string): Map<string, QuestObjectiveTransit> {
  const locations = questLocations(task, resolveMapId)
  const result = new Map<string, QuestObjectiveTransit>()
  const objectives = asArray(task.objectives)
  for (const objective of objectives) {
    const id = text(objective.id)
    if (!id || !isTransitObjective(objective)) continue
    const transit = objectiveTransit(objective, transits, resolveMapId, transitHints(objectives, objective, locations, resolveMapId))
    if (transit) result.set(id, { fromMapId: transit.mapId, toMapId: transit.toMapId, transitId: transit.id })
  }
  return result
}

/**
 * The catalog's quests with their transits (QuestObjective.transit) and the maps a transit objective leads to among their
 * maps («Непарадный Тарков»: Streets of Tarkov, then The Lab). Quests without transit objectives are returned as they are.
 * `mapNameByApiId`: the feed's map ids and names → app map ids (catalogSource `buildMapNameIndex`).
 */
export function withQuestTransits(quests: Quest[], tasksRoot: JsonRecord, mapsRoot: JsonRecord, mapNameByApiId: Map<string, string>): Quest[] {
  const resolve = feedMapResolver(mapNameByApiId)
  const transits = adaptMapTransits(mapsRoot, resolve)
  if (!transits.length) return quests
  const tasks = asRecord(tasksRoot.tasks)
  return quests.map((quest) => {
    const task = asRecord(tasks[quest.id])
    const byObjective = objectiveTransitsOf(task, transits, resolve)
    if (!byObjective.size) return quest
    const legs = [...byObjective.values()]
    const mapIds = [...new Set([...(quest.mapIds ?? []), ...legs.flatMap((leg) => [leg.fromMapId, leg.toMapId])])]
    return {
      ...quest,
      mapIds,
      ...(quest.mapId ? {} : { mapId: legs[0].fromMapId }),
      objectiveDetails: quest.objectiveDetails?.map((objective) => {
        const transit = byObjective.get(objective.id)
        return transit ? { ...objective, transit, zoneBound: true } : objective
      }),
    }
  })
}

/** A feed map id or name → the app's map id. */
export function feedMapResolver(mapNameByApiId: Map<string, string>) {
  return (rawId: string) => {
    if (!rawId) return ''
    return canonicalMapId(mapNameByApiId.get(rawId) ?? mapNameByApiId.get(canonicalMapId(rawId)) ?? rawId)
  }
}

/** «на Лабораторию» of «Переход на Лабораторию», «to The Lab» of «Transit to The Lab»: how the texts name the target. */
export function labelTarget(label: string) {
  const match = /^\s*\S+\s+((?:на|to)\s+.+?)\s*$/iu.exec(label)
  return match ? match[1] : ''
}

/** The target's name as its transit label has it, without the preposition («Лабораторию», «The Lab»). */
function labelPlace(label: string) {
  return labelTarget(label).replace(/^(?:на|to)\s+/iu, '')
}

/** The marker texts of a quest transit point (Russian templates; src/i18n/uiEnglishMap.ts turns them into English). */
export function questTransitTexts(point: QuestTransitPoint, quest: Pick<Quest, 'name' | 'trader' | 'level'>, maps: Array<{ id: string; name: string }>, transits: MapTransit[]) {
  const name = (mapId: string) => mapDisplayName(mapId, maps)
  // «через Таможню»: the hop's name as the game's own transit label declines it.
  const via = (mapId: string) => labelPlace(transits.find((transit) => transit.toMapId === mapId && transit.label)?.label ?? '') || name(mapId)
  const lead = point.transit.label || `Переход на карту ${name(point.transit.toMapId)}`
  const title = `${lead} → ${/^«.*»$/u.test(quest.name.trim()) ? quest.name.trim() : `«${quest.name}»`}`
  const parts: string[] = []
  if (point.objectiveText) parts.push(point.objectiveText)
  else {
    parts.push(`Задание продолжается на ${point.targets.length > 1 ? 'локациях' : 'локации'} ${point.targets.map(name).join(', ')}.`)
    for (const route of point.routes) {
      if (route.length <= 2) continue
      parts.push(`Прямого перехода нет — маршрут: ${route.map(name).join(' → ')} (через ${route.slice(1, -1).map(via).join(', ')}).`)
    }
  }
  if (point.transit.condition) parts.push(`Условие перехода: ${point.transit.condition}.`)
  return { title, description: parts.join(' '), meta: `${quest.trader} · ур. ${quest.level}` }
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function objectiveMaps(objective: JsonRecord, resolveMapId: (rawId: string) => string) {
  const listed = (Array.isArray(objective.maps) ? objective.maps : []).map(refId).filter(Boolean)
  const raw = listed.length ? listed : [...asArray(objective.zones), ...asArray(objective.possibleLocations)].map((place) => refId(place.map)).filter(Boolean)
  return [...new Set(raw.map(resolveMapId).filter(Boolean))]
}

function refId(value: unknown) {
  if (typeof value === 'string') return value
  return text(asRecord(value).id) || text(asRecord(value).normalizedName)
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
}

function asArray(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.map(asRecord) : []
}

function text(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

function strings(value: unknown) {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}
