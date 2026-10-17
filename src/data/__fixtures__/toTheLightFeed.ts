/**
 * A json.tarkov.dev feed as of 15.10.2026 for the «На свет» tests (src/data/curatedQuests.test.ts and the server's
 * server/src/services/questBase.test.ts), trimmed to what the catalog reads: no task of the series, «Источник
 * информации» without a previous task, the traders, the map places the series points at and the zones of the other tasks
 * that name the same places (each task trimmed to that one objective). The coordinates are the feed's own (regular/maps
 * and regular/tasks, read 15.10.2026), and the map config is tarkov.dev's (./toTheLightMapConfigs.ts).
 */
import { PLACE_SOURCE_TASKS } from '../curatedQuests'
import { TO_THE_LIGHT_MAP_CONFIGS } from './toTheLightMapConfigs'

type JsonRecord = Record<string, unknown>

export const INFORMATION_SOURCE_ID = '63966faeea19ac7ed845db2c'
export const OTHER_TASK_ID = '5936d90786f7742b1420ba5b'

const trader = (id: string, name: string, normalizedName: string) => ({ id, name, normalizedName, levels: [{ level: 1, requiredPlayerLevel: 1 }] })

const tasks = (extra: JsonRecord = {}) => ({
  tasks: {
    [INFORMATION_SOURCE_ID]: {
      id: INFORMATION_SOURCE_ID, name: `${INFORMATION_SOURCE_ID} name`, trader: '638f541a29ffd1183d187f57', minPlayerLevel: 0,
      taskRequirements: [], objectives: [], normalizedName: 'information-source',
    },
    [OTHER_TASK_ID]: {
      id: OTHER_TASK_ID, name: `${OTHER_TASK_ID} name`, trader: '54cb50c76803fa8b248b4571', minPlayerLevel: 1,
      taskRequirements: [], objectives: [{ id: 'd1', type: 'giveItem', description: 'd1', count: 1, items: ['5449016a4bdc2d6f028b456f'] }],
      normalizedName: 'debut',
    },
    ...PLACE_TASKS,
    ...extra,
  },
})

/** Tasks of the feed whose zones are places of the series (PLACE_SOURCE_TASKS), with the objective holding the zone. */
const PLACE_TASKS: JsonRecord = {
  [PLACE_SOURCE_TASKS.steadySignal]: {
    id: PLACE_SOURCE_TASKS.steadySignal, name: `${PLACE_SOURCE_TASKS.steadySignal} name`, trader: '5a7c2eca46aef81a7ca2145d', minPlayerLevel: 0,
    taskRequirements: [], normalizedName: 'steady-signal',
    objectives: [{
      id: '6578ec473dbd035d04531a92', type: 'mark', description: '6578ec473dbd035d04531a92', count: 1, maps: ['5704e3c2d2720bac5b8b4567'],
      zones: [{
        id: 'q14_8_2', map: '5704e3c2d2720bac5b8b4567', position: { x: -209.22, y: 77.52, z: -279.78 },
        outline: [{ x: -210.7, y: 75.52, z: -281.3 }, { x: -210.74, y: 75.52, z: -278.3 }, { x: -207.74, y: 75.52, z: -278.26 }, { x: -207.7, y: 75.52, z: -281.26 }],
        top: 79.52, bottom: 75.52,
      }],
    }],
  },
  [PLACE_SOURCE_TASKS.thirstyDelivery]: {
    id: PLACE_SOURCE_TASKS.thirstyDelivery, name: `${PLACE_SOURCE_TASKS.thirstyDelivery} name`, trader: '58330581ace78e27b8b10cee', minPlayerLevel: 9,
    taskRequirements: [], normalizedName: 'thirsty-delivery',
    objectives: [{
      id: '6661a18a12e8457716d59f5d', type: 'visit', description: '6661a18a12e8457716d59f5d', count: 1, maps: ['56f40101d2720b2a4d8b45d6'],
      zones: [{
        id: 'place_2A2_unlock_3_customs', map: '56f40101d2720b2a4d8b45d6', position: { x: 11.71, y: -0.72, z: 35.59 },
        outline: [{ x: 10.31, y: -2.22, z: 35.19 }, { x: 10.7, y: -2.22, z: 36.64 }, { x: 13.11, y: -2.22, z: 36 }, { x: 12.73, y: -2.22, z: 34.55 }],
        top: 0.78, bottom: -2.22,
      }],
    }],
  },
  [PLACE_SOURCE_TASKS.bullshit]: {
    id: PLACE_SOURCE_TASKS.bullshit, name: `${PLACE_SOURCE_TASKS.bullshit} name`, trader: '58330581ace78e27b8b10cee', minPlayerLevel: 38,
    taskRequirements: [], normalizedName: 'bullshit',
    objectives: [{
      id: '5c0bc32986f7743e4d1002d2', type: 'plantItem', description: '5c0bc32986f7743e4d1002d2', count: 1, maps: ['5704e4dad2720bb55b8b4567'],
      zones: [{
        id: 'lighthouse_place_bullshit', map: '5704e4dad2720bb55b8b4567', position: { x: -62.24, y: 29.37, z: 132.98 },
        outline: [{ x: -63.9, y: 26.56, z: 129.85 }, { x: -64.16, y: 26.56, z: 135.95 }, { x: -60.58, y: 26.56, z: 136.11 }, { x: -60.31, y: 26.56, z: 130.01 }],
        top: 32.19, bottom: 26.56,
      }],
    }],
  },
  [PLACE_SOURCE_TASKS.invasiveTherapy]: {
    id: PLACE_SOURCE_TASKS.invasiveTherapy, name: `${PLACE_SOURCE_TASKS.invasiveTherapy} name`, trader: '54cb57776803fa99248b456e', minPlayerLevel: 0,
    taskRequirements: [], normalizedName: 'invasive-therapy',
    objectives: [{
      id: '6a7ae5f20bc48d094a928d3d', type: 'plantItem', description: '6a7ae5f20bc48d094a928d3d', count: 1, maps: ['5704e4dad2720bb55b8b4567'],
      zones: [{
        id: 'terapevt_tier_03_group_03_quest_03_01', map: '5704e4dad2720bb55b8b4567', position: { x: -120.61, y: 37.63, z: 79.69 },
        outline: [{ x: -121.79, y: 36.63, z: 78.91 }, { x: -121.39, y: 36.63, z: 80.87 }, { x: -119.43, y: 36.63, z: 80.47 }, { x: -119.83, y: 36.63, z: 78.51 }],
        top: 38.63, bottom: 36.63,
      }],
    }],
  },
}
/** The tasks of the feed besides the series' (they are quests of the catalog too). */
export const FEED_TASK_IDS = [INFORMATION_SOURCE_ID, OTHER_TASK_ID, ...Object.values(PLACE_SOURCE_TASKS)]

const taskNames = {
  ru: {
    [`${INFORMATION_SOURCE_ID} name`]: 'Источник информации', [`${OTHER_TASK_ID} name`]: 'Дебют', d1: 'Передать рубли',
    [`${PLACE_SOURCE_TASKS.steadySignal} name`]: 'Устойчивый сигнал', '6578ec473dbd035d04531a92': 'Пометить любую метеостанцию Маркером MS2000 на локации Лес',
    [`${PLACE_SOURCE_TASKS.thirstyDelivery} name`]: 'Водохлёб. Курьер', '6661a18a12e8457716d59f5d': 'Найти место закладки на локации Таможня',
    [`${PLACE_SOURCE_TASKS.bullshit} name`]: 'Деза', '5c0bc32986f7743e4d1002d2': 'Заложить винтовку AXMC в мусоре на теннисной площадке у шале на локации Маяк',
    [`${PLACE_SOURCE_TASKS.invasiveTherapy} name`]: 'Инвазивная терапия', '6a7ae5f20bc48d094a928d3d': 'Заложить коктейль "Обдолбос" в мед.блок, расположенный в верхнем шале отступников',
  },
  en: {
    [`${INFORMATION_SOURCE_ID} name`]: 'Information Source', [`${OTHER_TASK_ID} name`]: 'Debut', d1: 'Hand over roubles',
    [`${PLACE_SOURCE_TASKS.steadySignal} name`]: 'Steady Signal', '6578ec473dbd035d04531a92': 'Mark any of the weather stations with an MS2000 Marker on Woods',
    [`${PLACE_SOURCE_TASKS.thirstyDelivery} name`]: 'Thirsty - Delivery', '6661a18a12e8457716d59f5d': 'Locate the specified stash spot on Customs',
    [`${PLACE_SOURCE_TASKS.bullshit} name`]: 'Bullshit', '5c0bc32986f7743e4d1002d2': 'Stash an AXMC sniper rifle in the trash bags at the chalet tennis court on Lighthouse',
    [`${PLACE_SOURCE_TASKS.invasiveTherapy} name`]: 'Invasive Therapy', '6a7ae5f20bc48d094a928d3d': 'Stash any Obdolbos cocktail injector in the med bay at the upper Rogue chalet on Lighthouse',
  },
}

const maps = {
  maps: {
    '5b0fc42d86f7744a585f9105': {
      id: '5b0fc42d86f7744a585f9105', name: 'The Lab', normalizedName: 'the-lab',
      extracts: [{ id: 'bb32a5dbbe8116e0765ed80a5ec7980e47676dc6', name: 'lab_Vent', faction: 'pmc', position: { x: -145.06, y: -2.46, z: -396.83 }, top: -0.89, bottom: -4.04 }],
    },
    '56f40101d2720b2a4d8b45d6': {
      id: '56f40101d2720b2a4d8b45d6', name: 'Customs', normalizedName: 'customs',
      transits: [{ id: '42', description: 'tr_customs_shoreline_DESC', map: '5704e554d2720bac5b8b456e', position: { x: 20.94, y: -0.33, z: 139.61 }, top: 1.82, bottom: -2.48 }],
      locks: [{ id: 'dorm-314', lockType: 'door', key: '5780cf7f2459777de4559322', position: { x: 180.67, y: 6.85, z: 183.72 } }],
    },
    '5704e3c2d2720bac5b8b4567': {
      id: '5704e3c2d2720bac5b8b4567', name: 'Woods', normalizedName: 'woods',
      transits: [{ id: '41', description: 'WOO_TRANSIT_41_DESC', map: '56f40101d2720b2a4d8b45d6', position: { x: -150.37, y: 1.11, z: 403.41 }, top: 3.92, bottom: -1.7 }],
    },
    '5704e554d2720bac5b8b456e': {
      id: '5704e554d2720bac5b8b456e', name: 'Shoreline', normalizedName: 'shoreline',
      extracts: [{
        id: '3475b9df1bf661d3c746ff1a1a8493bae828b939', name: 'Adm Basement', faction: 'scav', position: { x: -256.87, y: -7.71, z: -149.78 },
        outline: [{ x: -264.93, y: -9.46, z: -152.95 }, { x: -264.78, y: -9.46, z: -146.26 }, { x: -248.81, y: -9.46, z: -146.62 }, { x: -248.96, y: -9.46, z: -153.3 }],
        top: -5.95, bottom: -9.46,
      }],
    },
    '5704e5fad2720bc05b8b4567': {
      id: '5704e5fad2720bc05b8b4567', name: 'Reserve', normalizedName: 'reserve',
      locks: [
        { id: 'rb-bk', lockType: 'door', key: '5d80c60f86f77440373c4ece', position: { x: -157.88, y: -8.16, z: 72.87 } },
        { id: 'rb-vo', lockType: 'door', key: '5d80c62a86f7744036212b3f', position: { x: 189.65, y: -5.8, z: -224.79 } },
        { id: 'rb-pkpm', lockType: 'door', key: '5ede7a8229445733cb4c18e2', position: { x: -120.25, y: -13.48, z: 27.7 } },
      ],
    },
    '5714dc692459777137212e12': {
      id: '5714dc692459777137212e12', name: 'Streets of Tarkov', normalizedName: 'streets-of-tarkov',
      locks: [
        { id: 'factory', lockType: 'door', key: '63a3a93f8a56922e82001f5d', position: { x: -133.47, y: 9.71, z: 272.93 } },
        { id: 'mysterious', lockType: 'door', key: '64ccc25f95763a1ae376e447', position: { x: 186.18, y: 0.85, z: 227.44 } },
      ],
    },
    '5704e4dad2720bb55b8b4567': { id: '5704e4dad2720bb55b8b4567', name: 'Lighthouse', normalizedName: 'lighthouse' },
  },
}

const TRADERS: Array<[id: string, normalizedName: string, ru: string, en: string]> = [
  ['54cb50c76803fa8b248b4571', 'prapor', 'Прапор', 'Prapor'],
  ['5935c25fb3acc3127c3d8cd9', 'peacekeeper', 'Миротворец', 'Peacekeeper'],
  ['5a7c2eca46aef81a7ca2145d', 'mechanic', 'Механик', 'Mechanic'],
  ['638f541a29ffd1183d187f57', 'lightkeeper', 'Смотритель', 'Lightkeeper'],
  ['54cb57776803fa99248b456e', 'therapist', 'Терапевт', 'Therapist'],
  ['58330581ace78e27b8b10cee', 'skier', 'Лыжник', 'Skier'],
]
const SERIES_TRADERS = new Set(['5a7c2eca46aef81a7ca2145d', '5935c25fb3acc3127c3d8cd9'])
const traders = (withoutSeries = false) => Object.fromEntries(TRADERS.filter(([id]) => !withoutSeries || !SERIES_TRADERS.has(id))
  .map(([id, normalizedName]) => [id, trader(id, `${id} Nickname`, normalizedName)]))
const traderNames = {
  ru: Object.fromEntries(TRADERS.map(([id, , ru]) => [`${id} Nickname`, ru])),
  en: Object.fromEntries(TRADERS.map(([id, , , en]) => [`${id} Nickname`, en])),
}

const items = {
  items: {
    '5449016a4bdc2d6f028b456f': { id: '5449016a4bdc2d6f028b456f', name: 'Рубли', shortName: '₽', types: ['money'] },
    '5ac78a9b86f7741cca0bbd8d': { id: '5ac78a9b86f7741cca0bbd8d', name: 'Подавитель сигналов', shortName: 'Подавитель', types: ['barter'] },
    '5780cf7f2459777de4559322': { id: '5780cf7f2459777de4559322', name: 'Ключ от комнаты 314 общежития (Меченый)', shortName: '314', types: ['keys'] },
    '62e910aaf957f2915e0a5e36': { id: '62e910aaf957f2915e0a5e36', name: 'Цифровой защищенный DSP радиопередатчик', shortName: 'DSPT', types: ['barter'] },
    '6a8d581fe74010bf70069d83': { id: '6a8d581fe74010bf70069d83', name: 'Ключ от схрона на Маяке', shortName: 'Маяк', types: ['keys'] },
    '59fb023c86f7746d0d4b423c': { id: '59fb023c86f7746d0d4b423c', name: 'Оружейный кейс', shortName: 'Оружие', types: ['container'] },
    '5b4391a586f7745321235ab2': { id: '5b4391a586f7745321235ab2', name: 'WI-FI камера', shortName: 'Камера', types: ['barter'] },
  },
}

export interface FeedOptions {
  /** Tasks the feed has besides its two, e.g. a task of the series once tarkov.dev lists it again. */
  extraTasks?: JsonRecord
  /** Leave Mechanic and Peacekeeper out of the traders file. */
  withoutSeriesTraders?: boolean
}

/** A fetcher answering json.tarkov.dev `<mode>/<endpoint>[_<locale>]` with the feed above (any mode). */
export function toTheLightFetcher(options: FeedOptions = {}): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input)
    if (url.endsWith('/map-tiles/maps.json')) return new Response(JSON.stringify(TO_THE_LIGHT_MAP_CONFIGS), { status: 200 })
    const match = /json\.tarkov\.dev\/[a-z-]+\/([a-z]+)(?:_([a-z]+))?$/.exec(url)
    if (!match) return new Response('', { status: 404 })
    const [, endpoint, locale] = match
    const lang = locale === 'en' ? 'en' : 'ru'
    let data: unknown = {}
    if (endpoint === 'tasks') data = locale ? taskNames[lang] : tasks(options.extraTasks)
    if (endpoint === 'maps' && !locale) data = maps
    if (endpoint === 'items' && !locale) data = items
    if (endpoint === 'traders') data = locale ? traderNames[lang] : traders(options.withoutSeriesTraders)
    return new Response(JSON.stringify({ data }), { status: 200 })
  }) as typeof fetch
}
