/**
 * Spawn spots of quest items that tarkov.dev's tasks list only in part (owner, 20.11.2026: «Если есть спавны какие-то,
 * точки… вытаскивай из СПТ и добавляй к нам в базу»). The spots come from the database of the offline SPT 4.1.6 copy
 * (`locations/tarkovstreets/looseLoot.json`, `spawnpointsForced`: the statistics of live raids), and each quest's count was
 * checked against the EFT wiki's spawn list for the live game (Paramedic: «one of eight ambulances»; Urban Medicine: 10
 * spawns in the garage; Population Census: 5 in the housing office; Properties All Around: 6 in the real estate agency).
 * tarkov.dev's own positions stay first and are not repeated; docs/quests/spt-sync-2026-11-20.md has the comparison.
 *
 * The same in every mode: tarkov.dev's PvP, PvE and Season tasks list the same positions for these objectives.
 */

type JsonRecord = Record<string, unknown>

export interface QuestItemSpots {
  /** The quest's game id. */
  taskId: string
  /** The quest item of its «find» objective (tarkov.dev `findQuestItem.questItem`). */
  questItem: string
  /** tarkov.dev map id. */
  mapId: string
  /** Game metres, as SPT stores them (rounded to centimetres). */
  positions: ReadonlyArray<{ x: number; y: number; z: number }>
}

const STREETS = '5714dc692459777137212e12'

export const QUEST_ITEM_SPOTS: readonly QuestItemSpots[] = [
  // «Фельдшер» (Paramedic): the paramedic's GPhone X, one of eight ambulances; tarkov.dev lists three.
  {
    taskId: '64f3176921045e77405d63b5',
    questItem: '64f09c02b63b74469b6c149f',
    mapId: STREETS,
    positions: [
      { x: -53.88, y: 2.17, z: 198.96 },
      { x: -9.28, y: 2.88, z: 340.79 },
      { x: 83.25, y: 0.48, z: -10.4 },
      { x: 105.08, y: -1.61, z: 54.95 },
      { x: 131.35, y: 3.95, z: 239.26 },
    ],
  },
  // «Перепись населения» (Population Census): the housing office journal, five spots in the building; tarkov.dev lists one,
  // so the app took it for a 100 % spot.
  {
    taskId: '639135d89444fb141f4e6eea',
    questItem: '638e0057ab150a5f56238960',
    mapId: STREETS,
    positions: [
      { x: 84.01, y: 1.48, z: 129.82 },
      { x: 77.5, y: 1.65, z: 139.96 },
      { x: 83.27, y: 1.64, z: 124.54 },
      { x: 81.74, y: 1.89, z: 144.22 },
    ],
  },
  // «Городская медицина» (Urban Medicine): the container with drug samples, ten spots in the LexOs garage; tarkov.dev lists two.
  {
    taskId: '639135e0fa894f0a866afde6',
    questItem: '63927b29c115f907b14700b9',
    mapId: STREETS,
    positions: [
      { x: 95.21, y: 2.67, z: 323.8 },
      { x: 98.32, y: 2.67, z: 316.64 },
      { x: 92.78, y: 3.68, z: 324.08 },
      { x: 92.42, y: 4.3, z: 324.11 },
      { x: 97.53, y: 2.67, z: 317.08 },
      { x: 92.88, y: 2.67, z: 323.71 },
      { x: 97.12, y: 2.67, z: 320.44 },
    ],
  },
  // «Земельный вопрос» (Properties All Around): the cadastral registry records, six spots in the real estate agency;
  // tarkov.dev lists three.
  {
    taskId: '6573397ef3f8344c4575cd87',
    questItem: '657acb2ac900be5902191ac9',
    mapId: STREETS,
    positions: [
      { x: -66.35, y: 2.68, z: 462.52 },
      { x: -60.64, y: 3.67, z: 459.97 },
      { x: -48.33, y: 7.83, z: 460.16 },
    ],
  },
]

/** A listed position this close is the same spot. */
const SAME_SPOT_METRES = 1

const asRecord = (value: unknown): JsonRecord => (value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {})
const asArray = (value: unknown): JsonRecord[] => (Array.isArray(value) ? value.map(asRecord) : [])
/** A reference given as `"id"` (json.tarkov.dev) or `{ id }` (GraphQL). */
const refId = (value: unknown) => (typeof value === 'string' ? value : typeof asRecord(value).id === 'string' ? asRecord(value).id as string : '')
const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0)

/**
 * The tasks file with the spots its «find the quest item» objectives lack, appended after tarkov.dev's own and marked
 * `added` (so the points already drawn keep their ids: a merged point takes the id of the feed's spawn it covers,
 * src/data/mapMarkerAdapter.ts). An objective is found by its type and quest item: the translated file has the
 * objective's text in place of its id. A task the file has not got, or a spot it already lists, is left alone.
 */
export function withQuestItemSpots(tasksRoot: JsonRecord, list: readonly QuestItemSpots[] = QUEST_ITEM_SPOTS): JsonRecord {
  const tasks = asRecord(tasksRoot.tasks)
  const changed: JsonRecord = {}
  for (const spots of list) {
    const task = asRecord(changed[spots.taskId] ?? tasks[spots.taskId])
    const objectives = asArray(task.objectives)
    const at = objectives.findIndex((objective) => objective.type === 'findQuestItem' && refId(objective.questItem) === spots.questItem)
    if (at < 0) continue
    const objective = objectives[at]!
    const locations = asArray(objective.possibleLocations)
    const listed = locations.flatMap((location) => asArray(location.positions).map((position) => ({ map: refId(location.map), x: num(position.x), y: num(position.y), z: num(position.z) })))
    const missing = spots.positions.filter((spot) => !listed.some((position) => position.map === spots.mapId
      && Math.hypot(position.x - spot.x, position.y - spot.y, position.z - spot.z) < SAME_SPOT_METRES))
    if (!missing.length) continue
    const index = locations.findIndex((location) => refId(location.map) === spots.mapId)
    const nextLocations = index >= 0
      ? locations.map((location, i) => (i === index ? { ...location, positions: [...asArray(location.positions), ...missing.map((spot) => ({ ...spot, added: true }))] } : location))
      : [...locations, { map: spots.mapId, positions: missing.map((spot) => ({ ...spot, added: true })) }]
    const maps = Array.isArray(objective.maps) ? objective.maps : []
    const nextMaps = maps.some((map) => refId(map) === spots.mapId) ? maps : [...maps, spots.mapId]
    changed[spots.taskId] = { ...task, objectives: objectives.map((entry, i) => (i === at ? { ...objective, maps: nextMaps, possibleLocations: nextLocations } : entry)) }
  }
  return Object.keys(changed).length ? { ...tasksRoot, tasks: { ...tasks, ...changed } } : tasksRoot
}
