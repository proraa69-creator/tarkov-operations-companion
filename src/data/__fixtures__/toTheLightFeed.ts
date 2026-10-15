/**
 * A json.tarkov.dev feed as of 15.10.2026 for the «На свет» tests (src/data/curatedQuests.test.ts and the server's
 * server/src/services/questBase.test.ts), trimmed to what the catalog reads: no task of the series, «Источник
 * информации» without a previous task, the traders, and the map places the series points at. The coordinates are the
 * feed's own (regular/maps, read 15.10.2026).
 */
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
    ...extra,
  },
})

const taskNames = {
  ru: { [`${INFORMATION_SOURCE_ID} name`]: 'Источник информации', [`${OTHER_TASK_ID} name`]: 'Дебют', d1: 'Передать рубли' },
  en: { [`${INFORMATION_SOURCE_ID} name`]: 'Information Source', [`${OTHER_TASK_ID} name`]: 'Debut', d1: 'Hand over roubles' },
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
    '5704e554d2720bac5b8b456e': { id: '5704e554d2720bac5b8b456e', name: 'Shoreline', normalizedName: 'shoreline' },
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
