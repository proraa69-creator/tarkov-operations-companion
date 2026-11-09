/**
 * «Устранения» on the map (owner, 08.11.2026: «все квесты, где нужно кого-либо уничтожить… сделать отдельное окно с этими
 * квестами… общий список… уничтожить там общее число диких, общее число ЧВК. И если с какого-то оружия, то пиши, с какого
 * оружия и сколько именно… Все это должно быть компактно»). Pure: what the window lists, its summary line, the zones the map
 * draws («Места устранения») and which quests leave «Квесты на карте» for the window.
 *
 * Only what the catalog has (tarkov.dev TaskObjectiveShoot, src/data/objectiveConditions.ts): the targets, the weapon, its
 * parts, the gear to wear, body parts, distance, hours, effects and the zones. Nothing is guessed; a choice of many weapons
 * gets their common class or calibre (from the items' own names) and otherwise one example and «+N».
 */
import type { Item, ItemRef, MapMarker, ModeProgress, ObjectiveConditions, Quest, QuestObjective } from '../domain/types'
import { canonicalMapId } from '../data/mapIds'
import { bodyPartWord, distanceText, targetWord, timeText } from '../overview/conditionText'
import { objectiveDone } from '../raidprep/objectives'

/** Who is to be killed, for the summary and the zone's colour: Scavs, PMCs, or anyone else (any target, bosses, Rogues…). */
export type KillKind = 'scav' | 'pmc' | 'other'

export type KillTagKind = 'weapon' | 'mods' | 'gear' | 'part' | 'distance' | 'hit' | 'time' | 'zone' | 'enemy' | 'player' | 'maps'

/** One condition in a word or two; `names`: every item a choice allows (the tooltip). Russian, through uiText when shown. */
export interface KillTag {
  kind: KillTagKind
  text: string
  names?: string[]
}

/** One kill objective of a current quest on the open map. */
export interface KillRow {
  key: string
  quest: Quest
  objective: QuestObjective
  kind: KillKind
  /** The targets in a word («Дикие», «ЧВК», «любые цели», a boss's name…). */
  target: string
  total: number
  current: number
  left: number
  /** Done, or its quest checked for this raid: last and dimmed, not in the summary, no zones. */
  settled: boolean
  tags: KillTag[]
  /** The objective's zones on this map, as Leaflet polygons ([lat, lng] = [z, x]). */
  zones: Array<Array<[number, number]>>
  /** The objective's point on this map (a click on the row flies there). */
  marker?: MapMarker
}

export interface KillSummary {
  scav: number
  pmc: number
  other: number
}

export const KILL_TYPE = 'shoot'

const PMC_TARGETS = new Set(['AnyPmc', 'Usec', 'Bear'])
const SCAV_TARGETS = new Set(['Savage', 'assaultGroup', 'Marksman'])
const ROGUE_TARGETS = new Set(['ExUsec', 'exUsecFree', 'bossKnight', 'followerBigPipe', 'followerBirdEye'])

export function isKillObjective(objective: Pick<QuestObjective, 'type'>) {
  return objective.type === KILL_TYPE
}

/** The objective counts on this map: it names it, or names no map (any map). */
export function killOnMap(objective: Pick<QuestObjective, 'mapIds'>, mapId: string) {
  const map = canonicalMapId(mapId)
  return !objective.mapIds?.length || objective.mapIds.some((id) => canonicalMapId(id) === map)
}

export function killKind(targets: ObjectiveConditions['targets']): KillKind {
  const keys = (targets ?? []).map((target) => target.key)
  if (!keys.length) return 'other'
  if (keys.every((key) => PMC_TARGETS.has(key))) return 'pmc'
  if (keys.every((key) => SCAV_TARGETS.has(key))) return 'scav'
  return 'other'
}

/** The targets in a word: «Дикие» for the Scavs and their snipers, a group's name for many bosses, else their words. */
export function killTargetText(targets: ObjectiveConditions['targets']): string {
  const list = targets ?? []
  const keys = list.map((target) => target.key)
  if (!keys.length) return 'любые цели'
  if (keys.every((key) => SCAV_TARGETS.has(key)) && keys.some((key) => key === 'Savage' || key === 'assaultGroup')) return 'Дикие'
  if (keys.includes('AnyPmc')) return 'ЧВК'
  const words = [...new Set(list.map(targetWord))]
  if (words.length <= 2) return words.join(', ')
  if (keys.every((key) => ROGUE_TARGETS.has(key))) return 'отступники'
  if (keys.every((key) => /^(boss|infectedTagilla)/.test(key))) return 'боссы'
  if (keys.every((key) => /^follower/.test(key))) return 'охрана боссов'
  if (keys.every((key) => /^(boss|follower|infectedTagilla|tagillaHelper)/.test(key))) return 'боссы и охрана'
  if (keys.every((key) => /^sectant/.test(key))) return 'сектанты'
  return `${words[0]} +${words.length - 1}`
}

/**
 * A weapon's class from its tarkov.dev name (`normalizedName` ends in it: «…-bolt-action-sniper-rifle», «…-12ga-pump-action-
 * shotgun»). The order matters: a launcher before a grenade, a bolt-action before a sniper rifle, an SMG before a pistol.
 */
const WEAPON_CLASSES: Array<[RegExp, string]> = [
  [/grenade-launcher/, 'гранатомёт'],
  [/(grenade|khattabka)/, 'граната'],
  [/(bolt-action|single-shot-rifle|lever-action)/, 'болтовая винтовка'],
  [/shotgun/, 'дробовик'],
  [/submachine-gun/, 'пистолет-пулемёт'],
  [/(pistol|revolver|toy-gun)/, 'пистолет'],
  [/machine-gun/, 'пулемёт'],
  [/marksman-rifle/, 'марксманская винтовка'],
  [/sniper-rifle/, 'снайперская винтовка'],
  [/assault-(rifle|carbine)/, 'автомат'],
  [/carbine/, 'карабин'],
  [/(knife|axe|machete|bayonet|tomahawk|sword|crowbar|ice-pick|baton|kukri|dagger|gladius|entrenching-tool|hammer|cleaver|shovel|sickle)/, 'холодное оружие'],
]

export function weaponClassOf(item: Pick<Item, 'normalizedName'> | undefined): string | undefined {
  const slug = item?.normalizedName ?? ''
  return slug ? WEAPON_CLASSES.find(([pattern]) => pattern.test(slug))?.[1] : undefined
}

/** The game's calibre keys (tarkov.dev `caliber`) as players write them; one not listed is not named. */
const CALIBRES: Record<string, string> = {
  Caliber762x51: '7.62x51', Caliber762x39: '7.62x39', Caliber762x54R: '7.62x54R', Caliber556x45NATO: '5.56x45', Caliber545x39: '5.45x39',
  Caliber9x39: '9x39', Caliber12g: '12/70', Caliber20g: '20/70', Caliber9x19PARA: '9x19', Caliber9x18PM: '9x18', Caliber9x21: '9x21',
  Caliber762x25TT: '7.62x25', Caliber46x30: '4.6x30', Caliber57x28: '5.7x28', Caliber1143x23ACP: '.45 ACP', Caliber366TKM: '.366 TKM',
  Caliber86x70: '.338 LM', Caliber127x55: '12.7x55', Caliber762x35: '.300 BLK', Caliber68x51: '6.8x51', Caliber93x64: '9.3x64',
}

const distinctRefs = (refs: readonly ItemRef[]) => refs.filter((ref, index) => refs.findIndex((other) => other.id === ref.id) === index)

/**
 * An item's short name; one that is a weapon's short name too (the AK-12's suppressor is «АК-12» in the game) is called by
 * the longest plain word of its name instead: «глушитель» from «Глушитель 5.45x39 для АК-12», «suppressor» in English.
 */
function shortOf(ref: ItemRef, items: ReadonlyMap<string, Item>, taken?: ReadonlySet<string>) {
  const item = items.get(ref.id)
  const short = item?.shortName || item?.name || ref.name
  if (!taken?.has(short)) return short
  const words = (item?.name || ref.name).split(/\s+/).filter((word) => /^\p{L}+$/u.test(word))
  const word = words.reduce((best, entry) => (entry.length > best.length ? entry : best), '')
  return word ? word.toLocaleLowerCase() : short
}

function nameOf(ref: ItemRef, items: ReadonlyMap<string, Item>) {
  return items.get(ref.id)?.name || ref.name
}

/**
 * The weapon in a word: one weapon by its short name; a few by their short names; many by their common class
 * («болтовая винтовка», «дробовик») or calibre («калибр 7.62x39»); otherwise one example and «+N».
 */
export function weaponTag(weapons: readonly ItemRef[] | undefined, items: ReadonlyMap<string, Item>): KillTag | undefined {
  const refs = distinctRefs(weapons ?? [])
  if (!refs.length) return undefined
  const names = refs.map((ref) => nameOf(ref, items))
  if (refs.length === 1) return { kind: 'weapon', text: shortOf(refs[0], items), names }
  const classes = new Set(refs.map((ref) => weaponClassOf(items.get(ref.id))))
  const [only] = classes
  if (classes.size === 1 && only) return { kind: 'weapon', text: only, names }
  const shorts = [...new Set(refs.map((ref) => shortOf(ref, items)))]
  if (shorts.length <= 2 && shorts.join(' / ').length <= 24) return { kind: 'weapon', text: shorts.join(' / '), names }
  const calibres = new Set(refs.map((ref) => CALIBRES[items.get(ref.id)?.caliber ?? '']))
  const [calibre] = calibres
  if (calibres.size === 1 && calibre) return { kind: 'weapon', text: `калибр ${calibre}`, names }
  return { kind: 'weapon', text: `${shortOf(refs[0], items)} +${refs.length - 1}`, names }
}

/**
 * Gear to wear or weapon parts (any one option, every item of it): the items every option shares, one example of the rest
 * and «+N» for the other options («Ушанка + Жилет Дикого +8»).
 */
export function optionsTag(kind: 'gear' | 'mods', options: readonly ItemRef[][] | undefined, items: ReadonlyMap<string, Item>, taken?: ReadonlySet<string>): KillTag | undefined {
  const list = (options ?? []).map(distinctRefs).filter((option) => option.length > 0)
  if (!list.length) return undefined
  const shared = list[0].filter((ref) => list.every((option) => option.some((other) => other.id === ref.id)))
  const rest = list.map((option) => option.filter((ref) => !shared.some((other) => other.id === ref.id)))
  const variants = rest.filter((option) => option.length > 0)
  const shown = [...shared, ...(variants[0] ?? [])].map((ref) => shortOf(ref, items, taken))
  const more = variants.length > 1 ? ` +${variants.length - 1}` : ''
  const names = list.map((option) => option.map((ref) => nameOf(ref, items)).join(' + '))
  return { kind, text: `${shown.join(' + ')}${more}`, names }
}

/**
 * The zone's name as the objective's text says it («в окрестностях баз контрабандистов», «at the smuggler bases»): the
 * feed has only the zones' shapes, and the game names them in the objective.
 */
const RU_ZONE = /(?:^|\s)((?:в районе|на территории|в окрестностях|в здании|вокруг|на баз\S*|около|возле|внутри|в подземн\S+)\s.+?)(?=\s+на локаци|\s+используя|\s+\(|\.|$)/i
const EN_ZONE = /\b((?:inside|in|at|along|around|near|within)\s+the\s.+?)(?=\s+on\s+(?:the\s+)?[A-Z]|\s+using\b|\s+while\b|\s+with\b|\s+\(|\.|$)/

export function zonePhrase(description: string): string | undefined {
  const match = RU_ZONE.exec(description) ?? EN_ZONE.exec(description)
  const phrase = match?.[1]?.replace(/[,;:\s]+$/, '').trim()
  return phrase || undefined
}

/** Every condition of a kill objective in short words, in the order the window shows them. */
export function killTags(objective: Pick<QuestObjective, 'description' | 'conditions'>, items: ReadonlyMap<string, Item>, zoned = false): KillTag[] {
  const conditions = objective.conditions ?? {}
  const parts = [...new Set((conditions.bodyParts ?? []).map(bodyPartWord))]
  const zone = conditions.zoneNames?.length ? conditions.zoneNames.join(', ') : zoned ? zonePhrase(objective.description) ?? 'в зоне задания' : undefined
  const weaponShorts = new Set((conditions.weapons ?? []).map((ref) => shortOf(ref, items)))
  const tags: Array<KillTag | undefined> = [
    weaponTag(conditions.weapons, items),
    optionsTag('mods', conditions.mods, items, weaponShorts),
    optionsTag('gear', conditions.wearing, items),
    parts.length ? { kind: 'part', text: parts.join(', ') } : undefined,
    conditions.distance ? { kind: 'distance', text: distanceText(conditions.distance) } : undefined,
    conditions.hitOnly ? { kind: 'hit', text: 'попадание' } : undefined,
    conditions.time ? { kind: 'time', text: timeText(conditions.time) } : undefined,
    zone ? { kind: 'zone', text: zone } : undefined,
    ...(conditions.enemyEffects ?? []).map((effect): KillTag => ({ kind: 'enemy', text: effect })),
    ...(conditions.playerEffects ?? []).map((effect): KillTag => ({ kind: 'player', text: effect })),
  ]
  return tags.filter((tag): tag is KillTag => Boolean(tag))
}

/** How many of the objective are counted, and of how many (the game's log or the player's tick). */
export function killProgress(progress: Pick<ModeProgress, 'taskProgress' | 'objectiveProgress'>, questId: string, objective: Pick<QuestObjective, 'id' | 'count'>) {
  const record = progress.objectiveProgress?.[objective.id]
  const total = Math.max(1, Math.round(record?.target || objective.count || 1))
  const counted = record ? Math.min(total, Math.max(0, Math.round(record.current) || 0)) : 0
  const current = objectiveDone(progress, questId, objective.id) ? total : counted
  return { total, current, left: total - current }
}

type ZoneShape = Array<[number, number]>
const zoneKey = (zone: ZoneShape) => zone.map(([lat, lng]) => `${lat.toFixed(1)},${lng.toFixed(1)}`).join(';')

/** The objective's zones on this map: its points' outlines (the quest constructor may have moved them), else the feed's. */
function zonesOf(quest: Quest, objective: QuestObjective, mapId: string, points: readonly MapMarker[]): ZoneShape[] {
  const map = canonicalMapId(mapId)
  const own = points.filter((marker) => marker.questId === quest.id && marker.objectiveId === objective.id && canonicalMapId(marker.mapId) === map)
  const shapes: ZoneShape[] = own.flatMap((marker) => ((marker.outline?.length ?? 0) >= 3 ? [marker.outline!] : []))
  if (!shapes.length) {
    for (const zone of objective.zones ?? []) {
      if (canonicalMapId(zone.mapId) !== map || (zone.outline?.length ?? 0) < 3) continue
      shapes.push(zone.outline!.map((point): [number, number] => [point.z, point.x]))
    }
  }
  const seen = new Set<string>()
  return shapes.filter((zone) => !seen.has(zoneKey(zone)) && Boolean(seen.add(zoneKey(zone))))
}

const KIND_ORDER: Record<KillKind, number> = { scav: 0, pmc: 1, other: 2 }

export interface KillRowsInput {
  /** The current quests of the open map (not put aside). */
  quests: readonly Quest[]
  mapId: string
  progress: Pick<ModeProgress, 'taskProgress' | 'objectiveProgress'>
  items: ReadonlyMap<string, Item>
  /** The map's plotted points (zones and points of the quests). */
  points: readonly MapMarker[]
  /** Quests checked for this raid («Сделал в этом рейде»). */
  checked?: ReadonlySet<string> | ReadonlyMap<string, unknown>
  /** A map's name by its id: a kill that counts on other maps too says where («Любая карта», «Таможня, Маяк»). */
  mapName?: (mapId: string) => string
}

/**
 * Where else the kill counts (owner, 08.11.2026: «Вот, найти, нейтрализовать жнеца. На каких картах и это должно писаться»):
 * «Любая карта» for an objective that names no map, the maps' names when it names more than this one, nothing when only this.
 */
export function killMapsTag(objective: Pick<QuestObjective, 'mapIds'>, mapId: string, mapName: (mapId: string) => string = (id) => id): KillTag | undefined {
  const ids = [...new Set((objective.mapIds ?? []).map(canonicalMapId))]
  if (!ids.length) return { kind: 'maps', text: 'Любая карта' }
  if (ids.length === 1 && ids[0] === canonicalMapId(mapId)) return undefined
  return { kind: 'maps', text: ids.map(mapName).join(', ') }
}

/** Every kill objective of the current quests on this map: open ones first (Scavs, PMCs, the rest), then the settled ones. */
export function killRows({ quests, mapId, progress, items, points, checked, mapName }: KillRowsInput): KillRow[] {
  const rows: KillRow[] = []
  for (const quest of quests) {
    if (quest.kind === 'story' || quest.stages?.length) continue
    for (const objective of quest.objectiveDetails ?? []) {
      if (!isKillObjective(objective) || !objective.id || !killOnMap(objective, mapId)) continue
      const { total, current, left } = killProgress(progress, quest.id, objective)
      const settled = left === 0 || Boolean(checked?.has(quest.id))
      const zones = zonesOf(quest, objective, mapId, points)
      const map = canonicalMapId(mapId)
      const marker = points.find((point) => point.questId === quest.id && point.objectiveId === objective.id && canonicalMapId(point.mapId) === map)
      rows.push({
        key: `${quest.id}:${objective.id}`,
        quest,
        objective,
        kind: killKind(objective.conditions?.targets),
        target: killTargetText(objective.conditions?.targets),
        total,
        current,
        left,
        settled,
        tags: [
          ...killTags(objective, items, zones.length > 0 || Boolean(objective.zones?.some((zone) => canonicalMapId(zone.mapId) === map))),
          ...[killMapsTag(objective, mapId, mapName)].filter((tag): tag is KillTag => Boolean(tag)),
        ],
        zones: settled ? [] : zones,
        ...(marker ? { marker } : {}),
      })
    }
  }
  return rows.sort((a, b) => Number(a.settled) - Number(b.settled)
    || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
    || a.quest.level - b.quest.level
    || a.quest.name.localeCompare(b.quest.name, 'ru'))
}

/** «Дикие N · ЧВК N · Другие N»: what is still to kill on this map, summed over the open objectives. */
export function killSummary(rows: readonly KillRow[]): KillSummary {
  const summary: KillSummary = { scav: 0, pmc: 0, other: 0 }
  for (const row of rows) if (!row.settled) summary[row.kind] += row.left
  return summary
}

/** A zone's colour: green PMCs, orange Scavs and any other target, blue where PMCs and Scavs are both to be killed. */
export type KillZoneKind = 'pmc' | 'scav' | 'both'

/** The zones to draw: one per place, for every open objective whose kills are tied to that place. */
export interface KillZone {
  key: string
  /** The quests whose kills are here. */
  questIds: string[]
  kind: KillZoneKind
  /** The outline, its corners rounded. */
  positions: Array<[number, number]>
  /** The objectives it is for (the zone's hover window): Scavs, PMCs, the rest. */
  rows: KillRow[]
}

type Box = { south: number; north: number; west: number; east: number }
function boxOf(positions: ReadonlyArray<readonly [number, number]>): Box {
  const lat = positions.map((point) => point[0])
  const lng = positions.map((point) => point[1])
  return { south: Math.min(...lat), north: Math.max(...lat), west: Math.min(...lng), east: Math.max(...lng) }
}
const areaOf = (box: Box) => Math.max(0, box.north - box.south) * Math.max(0, box.east - box.west)
const overlapOf = (a: Box, b: Box) => areaOf({ south: Math.max(a.south, b.south), north: Math.min(a.north, b.north), west: Math.max(a.west, b.west), east: Math.min(a.east, b.east) })

/**
 * A zone over this share of the map is no place to kill in (owner, 08.11.2026: «Не просто отметка на полкарты… Там, где нету
 * конкретного места убийства, не надо»): «Долгая дорога» on Shoreline (44 %), «Хайкинг» on Woods (37 %); the smugglers' bases
 * are 11 %, the dorms 15 %.
 */
export const MAX_ZONE_SHARE = 0.3
/** Two zones are one place when they overlap over this much of the smaller one. */
const SAME_PLACE = 0.6

/**
 * The corners rounded (owner: «сделай более аккуратные территории. Не просто квадраты рандомные какие-то, а покрасивее»): each
 * corner becomes a curve from a quarter of the shorter edge before it to as far after it, at most CORNER metres.
 */
const CORNER = 45
const CORNER_STEPS = 6
export function roundedOutline(positions: ReadonlyArray<readonly [number, number]>): Array<[number, number]> {
  const points = positions.filter((point, index) => {
    const next = positions[(index + 1) % positions.length]!
    return Math.hypot(next[0] - point[0], next[1] - point[1]) > 1e-6
  })
  if (points.length < 3) return points.map((point) => [point[0], point[1]])
  const out: Array<[number, number]> = []
  for (let index = 0; index < points.length; index += 1) {
    const before = points[(index - 1 + points.length) % points.length]!
    const corner = points[index]!
    const after = points[(index + 1) % points.length]!
    const inLength = Math.hypot(corner[0] - before[0], corner[1] - before[1])
    const outLength = Math.hypot(after[0] - corner[0], after[1] - corner[1])
    const radius = Math.min(CORNER, Math.min(inLength, outLength) * 0.25)
    const from: [number, number] = [corner[0] + (before[0] - corner[0]) * (radius / inLength), corner[1] + (before[1] - corner[1]) * (radius / inLength)]
    const to: [number, number] = [corner[0] + (after[0] - corner[0]) * (radius / outLength), corner[1] + (after[1] - corner[1]) * (radius / outLength)]
    // a quadratic curve from `from` to `to` bent towards the corner
    for (let step = 0; step <= CORNER_STEPS; step += 1) {
      const k = step / CORNER_STEPS
      const a = (1 - k) * (1 - k)
      const b = 2 * (1 - k) * k
      const c = k * k
      out.push([a * from[0] + b * corner[0] + c * to[0], a * from[1] + b * corner[1] + c * to[1]])
    }
  }
  return out
}

/**
 * How much of the game's zone is drawn (owner, 08.11.2026: «зоны эти прям чуть-чуть уменьши или увеличь… чтобы у нас было
 * отличие от игры»): a little inside it, never outside, so a kill anywhere in the drawn zone counts in the game.
 */
export const ZONE_INSET = 0.96

/** The outline pulled toward its middle (the mean of its corners) by ZONE_INSET. */
export function insetOutline(positions: ReadonlyArray<readonly [number, number]>): Array<[number, number]> {
  if (!positions.length) return []
  const lat = positions.reduce((sum, point) => sum + point[0], 0) / positions.length
  const lng = positions.reduce((sum, point) => sum + point[1], 0) / positions.length
  return positions.map((point): [number, number] => [lat + (point[0] - lat) * ZONE_INSET, lng + (point[1] - lng) * ZONE_INSET])
}

/**
 * The zones of the open kill objectives, one per place: `extent` (the map's points) leaves out a zone over half the map; zones
 * of the same place (the smugglers' bases of two quests, a PMC and a Scav kill there) are one zone, blue when both PMCs and
 * Scavs are to be killed there (owner: «А если у нас и ЧВК, и диких надо в одной зоне убить? Тогда отмечай синим цветом»).
 * The biggest first: the smaller ones are drawn over them and can still be pointed at.
 */
export function killZones(rows: readonly KillRow[], extent?: ReadonlyArray<readonly [number, number]>): KillZone[] {
  const mapBox = extent && extent.length >= 2 ? boxOf(extent) : undefined
  const limit = mapBox && areaOf(mapBox) > 0 ? areaOf(mapBox) * MAX_ZONE_SHARE : Infinity
  const raw = rows.flatMap((row) => (row.settled ? [] : row.zones.map((positions, index) => ({
    id: `${row.key}:${index}`, row, positions, box: boxOf(positions), kind: (row.kind === 'pmc' ? 'pmc' : 'scav') as 'pmc' | 'scav',
  })))).filter((zone) => areaOf(zone.box) <= limit)
  const groups: Array<typeof raw> = []
  for (const zone of [...raw].sort((a, b) => areaOf(b.box) - areaOf(a.box))) {
    const place = groups.find((group) => group.some((other) => {
      const smaller = Math.min(areaOf(other.box), areaOf(zone.box))
      return smaller > 0 && overlapOf(other.box, zone.box) >= SAME_PLACE * smaller
    }))
    if (place) place.push(zone)
    else groups.push([zone])
  }
  return groups.map((group) => {
    const kinds = new Set(group.map((zone) => zone.kind))
    const here = [...new Map(group.map((zone) => [zone.row.key, zone.row])).values()]
    here.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.quest.level - b.quest.level)
    return {
      key: group.map((zone) => zone.id).sort().join('+'),
      questIds: [...new Set(here.map((row) => row.quest.id))],
      kind: kinds.size > 1 ? 'both' : group[0]!.kind,
      positions: roundedOutline(insetOutline(group[0]!.positions)),
      rows: here,
    } satisfies KillZone
  })
}

/**
 * The zones' look: dashed like the minefields, fainter and see-through; Scavs and any other target orange, PMCs green, both
 * blue (owner: «сделай просто ЧВК зеленые, дикие оранжевые… и ЧВК, и диких… синим цветом»). The chosen quest's zone stronger.
 */
export const KILL_ZONE_COLOURS = { scav: '#e8913a', pmc: '#5fc777', both: '#4f9dff' } as const

/** The chosen zone (its quest open): brighter in its own colour, the line solid (owner: «Должна просто подсвечиваться чуть ярче»). */
export function killZoneStyle(kind: KillZoneKind, focused = false) {
  const color = KILL_ZONE_COLOURS[kind]
  return { color, weight: focused ? 3 : 2, opacity: focused ? 1 : 0.8, dashArray: focused ? undefined : '7 6', lineCap: 'round' as const, lineJoin: 'round' as const, fillColor: color, fillOpacity: focused ? 0.3 : 0.11 }
}

/** Done at the trader or in the menu: never a place on the map. */
const OFF_MAP_TYPES = new Set(['giveItem', 'giveQuestItem', 'traderLevel', 'traderStanding', 'skill', 'buildWeapon', 'taskStatus', 'sellItem', 'experience'])
/** Something to find in the raid (an item, a key, a map): such a quest stays in «Актуальные квесты» even without a point. */
const FIND_TYPES = new Set(['findItem', 'findQuestItem'])

/**
 * Which quests leave «Актуальные квесты» for «Устранения» (owner, 08.11.2026: «в актуальных квестах только те, которые имеют
 * точку на карте… Все остальные идут в блок устранения… квесты, на которых надо что-либо найти… остается в актуальных квестах.
 * Устранение уходит только квесты с убийством»). A current quest of this map goes when it has a kill objective counting here and
 * nothing else to do here: no other open objective of it is a place on this map (a point or zone to visit, mark, plant, pick up)
 * or something to find in the raid, and none of its points on this map belong to anything but its kills. Its kills are listed in
 * «Устранения» either way. A quest with neither kills nor points (survive and extract) stays; story chapters stay.
 */
export function movesToKills(quest: Quest, mapId: string, progress: Pick<ModeProgress, 'taskProgress' | 'objectiveProgress'>, points: readonly MapMarker[]): boolean {
  if (quest.kind === 'story' || quest.stages?.length) return false
  const objectives = quest.objectiveDetails ?? []
  const kills = objectives.filter((objective) => isKillObjective(objective) && killOnMap(objective, mapId))
  if (!kills.length) return false
  const killIds = new Set(kills.map((objective) => objective.id))
  const map = canonicalMapId(mapId)
  const open = (objectiveId: string | undefined) => !objectiveDone(progress, quest.id, objectiveId)
  const placeHere = objectives.some((objective) => !isKillObjective(objective) && !OFF_MAP_TYPES.has(objective.type) && objective.zoneBound
    && (objective.mapIds ?? []).some((id) => canonicalMapId(id) === map) && open(objective.id))
  const findHere = objectives.some((objective) => FIND_TYPES.has(objective.type) && killOnMap(objective, mapId) && open(objective.id))
  if (placeHere || findHere) return false
  return !points.some((point) => point.questId === quest.id && canonicalMapId(point.mapId) === map
    && !(point.objectiveId && killIds.has(point.objectiveId)) && (!point.objectiveId || open(point.objectiveId)))
}
