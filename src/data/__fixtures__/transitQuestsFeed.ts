/**
 * A json.tarkov.dev feed (regular, read 15.10.2026) for the transit tests (src/data/questTransits.test.ts), trimmed to
 * what they read: «Непарадный Тарков» (Beneath The Streets) and «Цена независимости» (The Price of Independence) as the
 * tasks file has them, and the transits of the maps they cross. Coordinates, ids and texts are the feed's own.
 */
type JsonRecord = Record<string, unknown>

export const BENEATH_THE_STREETS = '66aba85403e0ee3101042877'
export const PRICE_OF_INDEPENDENCE = '6744af0969a58fceba101fed'
const THERAPIST = '54cb57776803fa99248b456e'
const REF = '656f0f98d80a697f855d34b1'

export const MAP_IDS = {
  factory: '55f2d3fd4bdc2d5f408b4567',
  customs: '56f40101d2720b2a4d8b45d6',
  woods: '5704e3c2d2720bac5b8b4567',
  lighthouse: '5704e4dad2720bb55b8b4567',
  shoreline: '5704e554d2720bac5b8b456e',
  reserve: '5704e5fad2720bc05b8b4567',
  interchange: '5714dbc024597771384a510d',
  streets: '5714dc692459777137212e12',
  lab: '5b0fc42d86f7744a585f9105',
  labDark: '6a294a5b5eb5f9a1700417b7',
  groundZero21: '65b8d6f5cdde2479cb2a3125',
} as const

const M = MAP_IDS
const transit = (id: string, description: string, map: string, x: number, y: number, z: number, top: number, bottom: number, conditions?: string) => ({
  id, description, map, position: { x, y, z }, top, bottom, ...(conditions ? { conditions } : {}),
})

export const transitMaps = {
  maps: {
    [M.factory]: { id: M.factory, name: `${M.factory} Name`, normalizedName: 'factory', transits: [
      transit('12', 'FAC_TRANSIT_12_DESC', M.woods, 24.36, 2.24, 60.22, 3.7, 0.78),
      transit('13', 'FAC_TRANSIT_13_DESC', M.customs, 17.34, 0.58, -49.62, 1.58, -0.42),
      transit('14', 'FAC_TRANSIT_14_DESC', M.labDark, -27.01, -3.09, -42.75, -2.09, -4.09, 'FAC_TRANSIT_14_COND'),
    ] },
    [M.customs]: { id: M.customs, name: `${M.customs} Name`, normalizedName: 'customs', transits: [
      transit('9', 'tr_customs_reserve_DESC', M.reserve, 650.64, 1.59, 124.94, 2.92, 0.26),
      transit('10', 'tr_customs_factory_DESC', M.factory, 354.31, 2.31, -190.1, 3.64, 0.98),
      transit('11', 'tr_customs_interchange_DESC', M.interchange, -334.22, 2.11, -211.95, 3.44, 0.78),
      transit('42', 'tr_customs_shoreline_DESC', M.shoreline, 20.94, -0.33, 139.61, 1.82, -2.48),
    ] },
    [M.woods]: { id: M.woods, name: `${M.woods} Name`, normalizedName: 'woods', transits: [
      transit('15', 'WOO_TRANSIT_15_DESC', M.factory, -362.05, 1.28, 361.18, 2.75, -0.18),
      transit('16', 'WOO_TRANSIT_16_DESC', M.reserve, 254.29, -8.71, 362.62, -6.22, -11.19),
      transit('17', 'WOO_TRANSIT_17_DESC', M.lighthouse, 496.04, -16.73, 348.29, -13.92, -19.54),
      transit('41', 'WOO_TRANSIT_41_DESC', M.customs, -150.37, 1.11, 403.41, 3.92, -1.7),
    ] },
    [M.lighthouse]: { id: M.lighthouse, name: `${M.lighthouse} Name`, normalizedName: 'lighthouse', transits: [
      transit('21', 'tr_lighthouse_shoreline_DESC', M.shoreline, -338.35, 17.54, -165.53, 31.29, 3.79),
      transit('22', 'tr_lighthouse_reserve_DESC', M.reserve, -293.34, 15.3, -780.71, 18.11, 12.49),
      transit('23', 'tr_lighthouse_woods_DESC', M.woods, 110.59, 6.78, -962.8, 9.59, 3.97),
    ] },
    [M.shoreline]: { id: M.shoreline, name: `${M.shoreline} Name`, normalizedName: 'shoreline', transits: [
      transit('24', 'SHO_TRANSIT_24_DESC', M.lighthouse, 416.78, -56.06, -214.15, -42.31, -69.81),
    ] },
    [M.reserve]: { id: M.reserve, name: `${M.reserve} Name`, normalizedName: 'reserve', transits: [
      transit('18', 'REZ_TRANSIT_18_DESC', M.customs, -195.85, -4.54, -115.66, -3.54, -5.54),
      transit('19', 'REZ_TRANSIT_19_DESC', M.woods, 215.99, -6.34, -202.36, -5.34, -7.34),
      transit('20', 'REZ_TRANSIT_20_DESC', M.lighthouse, 238.75, -6.25, -124.28, -5.25, -7.25),
    ] },
    [M.interchange]: { id: M.interchange, name: `${M.interchange} Name`, normalizedName: 'interchange', transits: [
      transit('6', 'tr_interchange_customs_DESC', M.customs, 280.26, 23.28, 435.08, 26.28, 20.28),
      transit('7', 'tr_interchange_streets_DESC', M.streets, 271.85, 24.1, -453.65, 27.1, 21.1),
    ] },
    [M.streets]: { id: M.streets, name: `${M.streets} Name`, normalizedName: 'streets-of-tarkov', transits: [
      transit('3', 'STR_TRANSIT_3_DESC', M.groundZero21, -258.04, 3.19, 104.69, 4.19, 2.19),
      transit('4', 'STR_TRANSIT_4_DESC', M.interchange, 290.55, 4.39, 501.98, 5.39, 3.39),
      transit('5', 'STR_TRANSIT_5_DESC', M.labDark, 209.52, -7.38, 82.4, -6.38, -8.38, 'STR_TRANSIT_5_COND'),
    ] },
    [M.lab]: { id: M.lab, name: `${M.lab} Name`, normalizedName: 'the-lab', transits: [
      transit('8', 'LAB_TRANSIT_8_DESC', M.streets, -170.14, 1.18, -420.56, 2.32, 0.04),
    ] },
    [M.labDark]: { id: M.labDark, name: `${M.labDark} Name`, normalizedName: 'the-lab-dark', transits: [] },
    [M.groundZero21]: { id: M.groundZero21, name: `${M.groundZero21} Name`, normalizedName: 'ground-zero-21', transits: [] },
  },
}

const MAP_NAMES: Record<string, [ru: string, en: string]> = {
  [M.factory]: ['Завод', 'Factory'], [M.customs]: ['Таможня', 'Customs'], [M.woods]: ['Лес', 'Woods'],
  [M.lighthouse]: ['Маяк', 'Lighthouse'], [M.shoreline]: ['Берег', 'Shoreline'], [M.reserve]: ['Резерв', 'Reserve'],
  [M.interchange]: ['Развязка', 'Interchange'], [M.streets]: ['Улицы Таркова', 'Streets of Tarkov'], [M.lab]: ['Лаборатория', 'The Lab'],
  [M.labDark]: ['Лаборатория (Dark)', 'The Lab (Dark)'], [M.groundZero21]: ['Эпицентр 21+', 'Ground Zero 21+'],
}

/** `<mode>/maps_ru` and `maps_en`: the transit labels and conditions as the game words them. */
export const transitMapNames: Record<'ru' | 'en', JsonRecord> = {
  ru: {
    ...Object.fromEntries(Object.entries(MAP_NAMES).map(([id, [ru]]) => [`${id} Name`, ru])),
    FAC_TRANSIT_12_DESC: 'Переход на Лес', FAC_TRANSIT_13_DESC: 'Переход на Таможню', FAC_TRANSIT_14_DESC: 'Переход на Лабораторию',
    FAC_TRANSIT_14_COND: 'Передать Ключ-карта доступа в TerraGroup Labs (1)',
    tr_customs_reserve_DESC: 'Переход на Резерв', tr_customs_factory_DESC: 'Переход на Завод', tr_customs_interchange_DESC: 'Переход на Развязку', tr_customs_shoreline_DESC: 'Переход на Берег',
    WOO_TRANSIT_15_DESC: 'Переход на Завод', WOO_TRANSIT_16_DESC: 'Переход на Резерв', WOO_TRANSIT_17_DESC: 'Переход на Маяк', WOO_TRANSIT_41_DESC: 'Переход на Таможню',
    tr_lighthouse_shoreline_DESC: 'Переход на Берег', tr_lighthouse_reserve_DESC: 'Переход на Резерв', tr_lighthouse_woods_DESC: 'Переход на Лес',
    SHO_TRANSIT_24_DESC: 'Переход на Маяк',
    REZ_TRANSIT_18_DESC: 'Переход на Таможню', REZ_TRANSIT_19_DESC: 'Переход на Лес', REZ_TRANSIT_20_DESC: 'Переход на Маяк',
    tr_interchange_customs_DESC: 'Переход на Таможню', tr_interchange_streets_DESC: 'Переход на Улицы Таркова',
    STR_TRANSIT_3_DESC: 'Переход на Эпицентр', STR_TRANSIT_4_DESC: 'Переход на Развязку', STR_TRANSIT_5_DESC: 'Переход на Лабораторию',
    STR_TRANSIT_5_COND: 'Передать Ключ-карта доступа в TerraGroup Labs (1)',
    LAB_TRANSIT_8_DESC: 'Переход на Улицы Таркова',
  },
  en: {
    ...Object.fromEntries(Object.entries(MAP_NAMES).map(([id, [, en]]) => [`${id} Name`, en])),
    FAC_TRANSIT_12_DESC: 'Transit to Woods', FAC_TRANSIT_13_DESC: 'Transit to Customs', FAC_TRANSIT_14_DESC: 'Transit to The Lab',
    FAC_TRANSIT_14_COND: 'TerraGroup Labs access keycard required (1)',
    tr_customs_reserve_DESC: 'Transit to Reserve', tr_customs_factory_DESC: 'Transit to Factory', tr_customs_interchange_DESC: 'Transit to Interchange', tr_customs_shoreline_DESC: 'Transit to Shoreline',
    WOO_TRANSIT_15_DESC: 'Transit to Factory', WOO_TRANSIT_16_DESC: 'Transit to Reserve', WOO_TRANSIT_17_DESC: 'Transit to Lighthouse', WOO_TRANSIT_41_DESC: 'Transit to Customs',
    tr_lighthouse_shoreline_DESC: 'Transit to Shoreline', tr_lighthouse_reserve_DESC: 'Transit to Reserve', tr_lighthouse_woods_DESC: 'Transit to Woods',
    SHO_TRANSIT_24_DESC: 'Transit to Lighthouse',
    REZ_TRANSIT_18_DESC: 'Transit to Customs', REZ_TRANSIT_19_DESC: 'Transit to Woods', REZ_TRANSIT_20_DESC: 'Transit to Lighthouse',
    tr_interchange_customs_DESC: 'Transit to Customs', tr_interchange_streets_DESC: 'Transit to Streets of Tarkov',
    STR_TRANSIT_3_DESC: 'Transit to Ground Zero', STR_TRANSIT_4_DESC: 'Transit to Interchange', STR_TRANSIT_5_DESC: 'Transit to The Lab',
    STR_TRANSIT_5_COND: 'TerraGroup Labs access keycard required (1)',
    LAB_TRANSIT_8_DESC: 'Transit to Streets of Tarkov',
  },
}

const box = (x1: number, x2: number, z1: number, z2: number, y: number) => [{ x: x1, y, z: z1 }, { x: x1, y, z: z2 }, { x: x2, y, z: z2 }, { x: x2, y, z: z1 }]

export const transitTasks = {
  tasks: {
    [BENEATH_THE_STREETS]: {
      id: BENEATH_THE_STREETS, name: `${BENEATH_THE_STREETS} name`, trader: THERAPIST, minPlayerLevel: 37, taskRequirements: [],
      normalizedName: 'beneath-the-streets', map: null, experience: 24000,
      objectives: [
        { id: '66aba85403e0ee310104287a', description: '66aba85403e0ee310104287a', type: 'extract', count: 1, optional: false, exitStatus: ['marathon Name'], maps: [M.streets] },
        { id: '66b090f5723e7bbe8b518ca8', description: '66b090f5723e7bbe8b518ca8', type: 'visit', optional: false, maps: [M.lab],
          zones: [{ id: 'Server_room', map: M.lab, position: { x: -127.06, y: 5.22, z: -309.28 }, outline: box(-139.35, -114.78, -330.07, -288.5, 1.54), top: 8.89, bottom: 1.54 }] },
        { id: '66aba85403e0ee3101042878', description: '66aba85403e0ee3101042878', type: 'visit', optional: true, zones: [], maps: [] },
        { id: '66aba97b1000025218c82ea8', description: '66aba97b1000025218c82ea8', type: 'visit', optional: true, maps: [M.lab],
          zones: [{ id: 'Transits_streets', map: M.lab, position: { x: -169.96, y: 0.91, z: -419.24 }, outline: box(-174.2, -165.73, -423.38, -415.1, -0.09), top: 1.91, bottom: -0.09 }] },
        { id: '66b0910951c5294b9d213918', description: '66b0910951c5294b9d213918', type: 'visit', optional: false, maps: [M.lab],
          zones: [{ id: 'Dome', map: M.lab, position: { x: -172.44, y: 1.12, z: -370.93 }, top: 2.24, bottom: 0.01 }] },
        { id: '66b10eef0951e90ec383850b', description: '66b10eef0951e90ec383850b', type: 'visit', optional: false, maps: [M.lab],
          zones: [{ id: 'Control_room', map: M.lab, position: { x: -170.76, y: 5.11, z: -283.12 }, top: 6.48, bottom: 3.75 }] },
      ],
    },
    [PRICE_OF_INDEPENDENCE]: {
      id: PRICE_OF_INDEPENDENCE, name: `${PRICE_OF_INDEPENDENCE} name`, trader: REF, minPlayerLevel: 0, taskRequirements: [],
      normalizedName: 'the-price-of-independence', map: null, experience: 85400,
      // Trimmed: the quest items, flares and kill conditions are left out; types, maps and exit statuses are the feed's.
      objectives: [
        { id: '6745c8ccb4adeab3910332cc', description: '6745c8ccb4adeab3910332cc', type: 'findQuestItem', count: 1, optional: false, maps: [M.customs] },
        { id: '6745c8ee54d6972417ad7bad', description: '6745c8ee54d6972417ad7bad', type: 'extract', count: 1, optional: false, exitStatus: ['marathon Name'], maps: [M.customs] },
        { id: '6745c8de22c7ee46e3319c34', description: '6745c8de22c7ee46e3319c34', type: 'plantQuestItem', count: 1, optional: false, maps: [M.reserve] },
        { id: '6745c90842db81af412eae97', description: '6745c90842db81af412eae97', type: 'extract', count: 1, optional: false, exitStatus: ['marathon Name'], maps: [M.reserve] },
        { id: '6745c9482ac6bee79dca869a', description: '6745c9482ac6bee79dca869a', type: 'shoot', count: 1, optional: false, maps: [M.woods] },
        { id: '6745c9623d362cd373b1de93', description: '6745c9623d362cd373b1de93', type: 'extract', count: 1, optional: false, exitStatus: ['marathon Name'], maps: [M.woods] },
        { id: '6745c986a3e10e0bf6472d8e', description: '6745c986a3e10e0bf6472d8e', type: 'useItem', count: 1, optional: false, maps: [M.lighthouse] },
        { id: '6745c992bf76b3aeaf6370e0', description: '6745c992bf76b3aeaf6370e0', type: 'useItem', count: 1, optional: false, maps: [M.lighthouse] },
        { id: '6745c9b89c84a273d4a2dc28', description: '6745c9b89c84a273d4a2dc28', type: 'shoot', count: 1, optional: false,
          maps: [M.lighthouse, M.customs, M.shoreline, M.factory, M.reserve, M.streets, M.interchange, M.woods] },
        { id: '6745c9a86086867a2c723e9d', description: '6745c9a86086867a2c723e9d', type: 'extract', count: 1, optional: false, exitStatus: ['ExpBonusRunner', 'ExpBonusSurvived', 'marathon Name'], maps: [M.lighthouse] },
      ],
    },
  },
}

/** `<mode>/tasks_ru` and `tasks_en`. */
export const transitTaskNames: Record<'ru' | 'en', JsonRecord> = {
  ru: {
    [`${BENEATH_THE_STREETS} name`]: 'Непарадный Тарков',
    '66aba85403e0ee310104287a': 'Совершить переход с Улиц Таркова на Лабораторию (За один рейд)',
    '66b090f5723e7bbe8b518ca8': 'Посетить серверную на локации Лаборатория (За один рейд)',
    '66aba85403e0ee3101042878': 'Найти место перехода с Улиц Таркова на Лабораторию (За один рейд)',
    '66aba97b1000025218c82ea8': 'Найти место перехода с Лаборатории на Улицы Таркова (За один рейд)',
    '66b0910951c5294b9d213918': 'Посетить лабораторный купол на локации Лаборатория (За один рейд)',
    '66b10eef0951e90ec383850b': 'Посетить комнату управления на локации Лаборатория (За один рейд)',
    [`${PRICE_OF_INDEPENDENCE} name`]: 'Цена независимости',
    '6745c8ccb4adeab3910332cc': 'Найти письмо с компроматом на локации Таможня',
    '6745c8ee54d6972417ad7bad': 'Совершить переход с Таможни на Резерв',
    '6745c8de22c7ee46e3319c34': 'Заложить письмо на третьем этаже штаба на локации Резерв',
    '6745c90842db81af412eae97': 'Совершить переход с Резерва в Лес',
    '6745c9482ac6bee79dca869a': 'Устранить любую цель на локации Лес',
    '6745c9623d362cd373b1de93': 'Совершить переход с Леса на Маяк',
    '6745c986a3e10e0bf6472d8e': 'Подать сигнал жёлтой ракетницей у склада на ж/д станции на локации Маяк',
    '6745c992bf76b3aeaf6370e0': 'Подать сигнал жёлтой ракетницей у пирса на локации Маяк',
    '6745c9b89c84a273d4a2dc28': 'Устранить Диких за все переходы в одном рейде',
    '6745c9a86086867a2c723e9d': 'Выжить и выйти с локации Маяк',
    'marathon Name': 'Переход', ExpBonusRunner: 'Сквозная пробежка', ExpBonusSurvived: 'Выжил',
  },
  en: {
    [`${BENEATH_THE_STREETS} name`]: 'Beneath The Streets',
    '66aba85403e0ee310104287a': 'Use the transit from Streets of Tarkov to The Lab (In one raid)',
    '66b090f5723e7bbe8b518ca8': 'Scout the server room in The Lab (In one raid)',
    '66aba85403e0ee3101042878': 'Locate the passage leading to The Lab on Streets of Tarkov (In one raid)',
    '66aba97b1000025218c82ea8': 'Locate the passage leading to Streets of Tarkov in The Lab (In one raid)',
    '66b0910951c5294b9d213918': 'Scout the hazard dome in The Lab (In one raid)',
    '66b10eef0951e90ec383850b': 'Scout the control room in The Lab (In one raid)',
    [`${PRICE_OF_INDEPENDENCE} name`]: 'The Price of Independence',
    '6745c8ccb4adeab3910332cc': 'Locate and obtain the incriminating letter on Customs',
    '6745c8ee54d6972417ad7bad': 'Use the transit from Customs to Reserve',
    '6745c8de22c7ee46e3319c34': 'Stash the letter on the third floor of the military headquarters on Reserve',
    '6745c90842db81af412eae97': 'Use the transit from Reserve to Woods',
    '6745c9482ac6bee79dca869a': 'Eliminate any target on Woods',
    '6745c9623d362cd373b1de93': 'Use the transit from Woods to Lighthouse',
    '6745c986a3e10e0bf6472d8e': 'Launch a yellow signal flare at the train station warehouse on Lighthouse',
    '6745c992bf76b3aeaf6370e0': 'Launch a yellow signal flare at the pier on Lighthouse',
    '6745c9b89c84a273d4a2dc28': 'Eliminate Scavs while completing the other objectives',
    '6745c9a86086867a2c723e9d': 'Survive and extract from Lighthouse',
    'marathon Name': 'Transition', ExpBonusRunner: 'Runner', ExpBonusSurvived: 'Survived',
  },
}

const traders = {
  [THERAPIST]: { id: THERAPIST, name: `${THERAPIST} Nickname`, normalizedName: 'therapist', levels: [{ level: 1, requiredPlayerLevel: 1 }] },
  [REF]: { id: REF, name: `${REF} Nickname`, normalizedName: 'ref', levels: [{ level: 1, requiredPlayerLevel: 1 }] },
}
const traderNames = {
  ru: { [`${THERAPIST} Nickname`]: 'Терапевт', [`${REF} Nickname`]: 'Лыжник' },
  en: { [`${THERAPIST} Nickname`]: 'Therapist', [`${REF} Nickname`]: 'Ref' },
}

/** A fetcher answering json.tarkov.dev `<mode>/<endpoint>[_<locale>]` with the feed above (any mode). */
export function transitQuestsFetcher(): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input)
    const match = /json\.tarkov\.dev\/[a-z-]+\/([a-z]+)(?:_([a-z]+))?$/.exec(url)
    if (!match) return new Response('', { status: 404 })
    const [, endpoint, locale] = match
    const lang = locale === 'en' ? 'en' : 'ru'
    let data: unknown = {}
    if (endpoint === 'tasks') data = locale ? transitTaskNames[lang] : transitTasks
    if (endpoint === 'maps') data = locale ? transitMapNames[lang] : transitMaps
    if (endpoint === 'traders') data = locale ? traderNames[lang] : traders
    return new Response(JSON.stringify({ data }), { status: 200 })
  }) as typeof fetch
}
