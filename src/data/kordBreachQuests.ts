import type { CuratedObjective, CuratedQuest, CuratedSeries, CuratedSpot } from './curatedQuests'

/**
 * «KORD BREACH»: the story line of Season 1 (seasonal mode only, since August 2026), 21 quests from Prapor to Lightkeeper.
 * tarkov.dev has none of them in any mode (owner, 19.11.2026: «этого квеста нету у нас в базе, добавь его … собери
 * цепочку»). docs/quests/kord-breach.md lists the sources, where they disagree and what the app follows.
 *
 * Ids: the Russian wiki's `node`, checked in the owner's logs of 19.11.2026 where the game names them (the quests taken,
 * the season rewards' conditions). Four quests have no published id yet: they get an id of their own that never looks like
 * a game id, and their log lines are not matched until the game's id is known.
 */
export const KORD_BREACH_IDS = {
  uninvitedGuests1: '6a4f528221e50974ab006f6f',
  uninvitedGuests2: '6a4f53f6be2cd3a87c0b708d',
  unansweredCalls: '6a4f83001b7350af050b2e1f',
  castTheNet: '6a4f5a3d6bfb56d6de0b2dd8',
  knowYourEnemy: '6a4f5b7a5bf30a99be02698c',
  reverseGear: '6a4f5c207368e70cae00e6ec',
  ridingTheWave: '6a4f833633bd1e904c091ef2',
  keyToUnderstanding: '6a4f5eed0aba4eefcd0b1cc7',
  whatsInTheBag: 'kord-breach-whats-in-the-bag',
  forbiddenKnowledge: '6a4f5fda45f72a73f3089a8a',
  sheepInWolfsClothing: '6a4f602f02d214b87f065c40',
  finalStretch: 'kord-breach-final-stretch',
  consequences: 'kord-breach-consequences',
  desperateAssault: '6a4f789e78d54a8494027cbf',
  stayClear: '6a4f8365d46563d5d90b6ccc',
  breakTheChain: 'kord-breach-break-the-chain',
  digitalPuzzle: '6a4f7a63e41198323708563b',
  priceForInformation: '680fa1f6fff4a8d640066b42',
  nameOfHumanity: '6a4f82d2c871d92f960543c6',
  goodOfTheChosen: '6a8d4ea68a0ba8e3c5036b95',
  historicalProspects: '6a4f82e11b7350af050b2e1c',
} as const

const K = KORD_BREACH_IDS

const PRAPOR = '54cb50c76803fa8b248b4571'
const THERAPIST = '54cb57776803fa99248b456e'
const FENCE = '579dc571d53a0658a154fbec'
const MECHANIC = '5a7c2eca46aef81a7ca2145d'
const RAGMAN = '5ac3b934156ae10c4430e83c'
const JAEGER = '5c0647fdd443bc2504c2d371'
const LIGHTKEEPER = '638f541a29ffd1183d187f57'
const BTR_DRIVER = '656f0f98d80a697f855d34b1'

const ROUBLES = '5449016a4bdc2d6f028b456f'
const WIFI_CAMERA = '5b4391a586f7745321235ab2'
const RPK16 = '5beed0f50db834001c062b12'
const AK74_6L23_MAG = '55d480c04bdc2d1d4e8b456a'
const PP_GS_PACK_120 = '57372d1b2459776862260581'
const FIERCE_HATCHLING = '5d1b376e86f774252519444e'
const F1 = '5710c24ad2720bc3458b45a3'
const RGD5 = '5448be9a4bdc2dfd2f8b456a'
const ARMOR_6B23_2_FLORA = '5c0e57ba86f7747fa141986d'
const BRIEFCASE_WITH_DOCUMENTS = '6a3563dacdaebb512e0a009c'
const LABS_KEYCARD = '5c94bbff86f7747ee735c08f'
const INTELLIGENCE_FOLDER = '5c12613b86f7743bbe2c3f76'
const TOPOGRAPHIC_MAPS = '62a0a124de7ac81993580542'
const TEP300_COYOTE = '68bf405779c8186398099017'
const MONEY_CASE = '59fb016586f7746d0d4b423a'
/** «Norinco QBZ-191 5.8x42 QBZ-192»: the build the game shows among the rewards. */
const QBZ191_QBZ192 = '6a3a73f7e7aba1d34a094a57'
const RB_BK = '5d80c60f86f77440373c4ece'
const ELECTRIC_DRILL = '59e35de086f7741778269d84'
const COFDM = '5c052f6886f7746b1e3db148'
const CYCLON = '5e2aee0a86f774755a234b62'
const TOOLSET = '590c2e1186f77425357b6124'
const WEAPON_REPAIR_KIT = '5910968f86f77425cf569c32'
const ARMOR_REPAIR_KIT = '591094e086f7747caa7bb2ef'
const TP200 = '60391b0fb847c71012789415'
const G28 = '6176aca650224f204c1da3fb'
const HK417_MAG_10 = '617130016c780c1e710c9a24'
const M62_PACK_20 = '65702554bfc87b3a34093247'
const SCAR_H_FDE = '6165ac306ef05c2ce828ef74'
const SCAR_H_MAG_20 = '618168dc8004cc50514c34fc'
const M80_PACK_20 = '65702558cfc010a0f5006a25'
const THICC_WEAPON_CASE = '5b6d9ce188a4501afc1b2b25'
const THICC_ITEM_CASE = '5c0a840b86f7742ffa4f2482'
const GRIZZLY = '590c657e86f77412b013051d'
const CMS = '5d02778e86f774203e7dedbe'
const BAGARIY_EMR = '628d0618d1ba6e4fa07ce5a4'
const AVS_RANGER_GREEN = '544a5caa4bdc2d1a388b4568'
const RB_VO = '5d80c62a86f7744036212b3f'
const RB_PKPM = '5ede7a8229445733cb4c18e2'
const PHYSICAL_BITCOIN = '59faff1d86f7746c51718c9c'
const SUBSTATION_MARKED_KEY = '62987dfc402c7f69bf010923'
const RSP_YELLOW = '624c0b3340357b5f566e8766'
const DOGTAG_BEAR = '59f32bb586f774757e1e8442'
const DOGTAG_USEC = '59f32c3b86f77472a31742f0'
const KORD_SSD = '6a5f9c49b8281c31a1062aea'
const BD_ENCRYPTION_KEYS = '6a5f9cfcc409750b6e065592'

const BD_LV119_V1 = '689479a4a733b1602007e2eb'
const BD_FCPC_V5 = '689479cb47e5acd1e10be986'
const BD_LV119_V2 = '689479eb30cc5ba7be00f5ff'
const BD_SIEGE_R = '68947a4be4bf255d1b0ca746'
const BD_PLATE_CARRIERS = [BD_SIEGE_R, BD_LV119_V2, BD_FCPC_V5, BD_LV119_V1]
const TT_MODULAR_45_MCB = '68947a8ce4bf255d1b0ca759'
const MR_2DAY_BLACK = '68947ab5a733b1602007e2fe'
const MR_NICE_FRAME = '68947ad3e4bf255d1b0ca75c'
const AVON_M53A1 = '689b880fff8b4adc420f5b56'
const SOTR = '689b404db49f27df1c0873f6'
const GATORZ = '689b3fffa1295e322207a677'

const SHORELINE = ['shoreline']
const GROUND_ZERO = ['ground-zero', 'ground-zero-21']
const STREETS = ['streets-of-tarkov']

/**
 * The four spots of the WI-FI cameras («Забросить невод» puts them, «Задняя передача» takes them back; report 204: «Не
 * отображаются места закладки»; owner, 20.11.2026: «можешь через SPT сам найти в игре эти точки»). Found in the offline copy of
 * the game, each matching its picture in tarkov.help's guide: the Ural by the power station's substation, the excavator by the
 * stream, the cargo truck's tractor on the ramp to Mira Ave, the yellow bus underground. Positions of these objects in the
 * game's world, with their heights (E:\SPT-photo\approved\kord-breach\places.json).
 */
const foundSpots = (maps: string[], id: string, x: number, y: number, z: number): CuratedSpot[] => maps.map((map) => ({ map, point: { id: `kb-${id}`, x, y, z } }))
const CAMERA_SPOTS = {
  ural: foundSpots(SHORELINE, 'camera-ural', -180.39, -38.31, 141.08),
  excavator: foundSpots(SHORELINE, 'camera-excavator', -603.54, -28.33, -203.79),
  truck: foundSpots(GROUND_ZERO, 'camera-truck', 118.59, 23.46, 63.41),
  bus: foundSpots(GROUND_ZERO, 'camera-bus', 82.02, 15.49, 121.42),
}
/** The reception desk on the TerraGroup office's second floor («Звонки без ответа»), found the same way: the desk the guide's arrow shows. */
const TG_RECEPTION = foundSpots(GROUND_ZERO, 'tg-reception', -37.02, 30.73, 64.97)

const BD = { targets: ['blackDivision'] }

/** A Black Division item to find in raid and hand over («На волне популярности»). */
const handOverFound = (item: string, ru: string, en: string): CuratedObjective => ({
  type: 'giveItem', items: [item], foundInRaid: true,
  text: { ru: `Найти в рейде и передать: ${ru}`, en: `Hand over the found in raid item: ${en}` },
})

const quests: CuratedQuest[] = [
  {
    id: K.uninvitedGuests1,
    trader: PRAPOR,
    name: { ru: 'Незваные гости. Часть 1 [KORD BREACH]', en: 'Uninvited Guests - Part 1 [KORD BREACH]' },
    aliases: ['Незваные гости. Часть 1', 'Uninvited Guests - Part 1'],
    experience: 6_000,
    objectives: [
      { type: 'findQuestItem', maps: SHORELINE, text: { ru: 'Найти кейс с военным оборудованием', en: 'Locate and obtain the case with military equipment' } },
      { type: 'visit', optional: true, maps: SHORELINE, text: { ru: 'Осмотреть помещение рядом с вышкой Sordi на локации Берег', en: 'Investigate the shack next to the Sordi tower on Shoreline' } },
      { type: 'visit', optional: true, maps: SHORELINE, text: { ru: 'Осмотреть второй этаж здания метеостанции на локации Берег', en: 'Investigate the second floor of the weather station building on Shoreline' } },
      { type: 'visit', optional: true, maps: SHORELINE, text: { ru: 'Осмотреть ГЭС на локации Берег', en: 'Investigate the hydroelectric power station on Shoreline' } },
    ],
    rewards: [[ROUBLES, 18_000], [RPK16, 1], [AK74_6L23_MAG, 3], [PP_GS_PACK_120, 1]],
    note: {
      ru: 'Первый квест сезонной линии KORD BREACH, только в Сезоне. Кейс лежит в одном из трёх мест на Берегу: в будке у вышки Sordi, на втором этаже метеостанции или на втором этаже ГЭС у синей комнаты. С кейсом нужно выйти из рейда, отдают его водителю БТР. Взяв квест, получите ещё «Незваные гости. Часть 2» и «Звонки без ответа».',
      en: 'The first quest of the KORD BREACH season line, Season only. The case is in one of three places on Shoreline: the shack by the Sordi tower, the second floor of the weather station or the second floor of the power station by the blue room. Extract with it; it goes to the BTR Driver. Taking the quest also gives Uninvited Guests - Part 2 and Unanswered Calls.',
    },
  },
  {
    id: K.uninvitedGuests2,
    trader: BTR_DRIVER,
    name: { ru: 'Незваные гости. Часть 2 [KORD BREACH]', en: 'Uninvited Guests - Part 2 [KORD BREACH]' },
    aliases: ['Незваные гости. Часть 2', 'Uninvited Guests - Part 2'],
    afterAccepted: [K.uninvitedGuests1],
    experience: 5_000,
    objectives: [
      { type: 'giveQuestItem', text: { ru: 'Найти и передать кейс с военным оборудованием', en: 'Obtain and hand over the case with military equipment' } },
    ],
    note: {
      ru: 'Приходит вместе с первой частью. Отдайте водителю БТР кейс, найденный по первой части.',
      en: 'Comes with Part 1. Give the BTR Driver the case found in Part 1.',
    },
  },
  {
    id: K.unansweredCalls,
    trader: THERAPIST,
    name: { ru: 'Звонки без ответа [KORD BREACH]', en: 'Unanswered Calls [KORD BREACH]' },
    aliases: ['Звонки без ответа', 'Unanswered Calls'],
    afterAccepted: [K.uninvitedGuests1],
    experience: 11_000,
    objectives: [
      { type: 'plantQuestItem', maps: GROUND_ZERO, spots: TG_RECEPTION, text: { ru: 'Заложить послание Терапевта у стойки регистрации на втором этаже главного офиса TerraGroup на локации Эпицентр (за один рейд)', en: 'Stash Therapist\'s letter at the reception desk on the second floor of the TerraGroup office on Ground Zero (in one raid)' } },
      {
        type: 'extract', maps: GROUND_ZERO,
        spots: [
          { map: 'ground-zero', extract: '58b21021d80db728cd7db688a00677980593bf85' }, { map: 'ground-zero', extract: 'af20846a32f03fec90986c60eb732da7b87f72b0' },
          { map: 'ground-zero-21', extract: '1bb328c35dbf9c2127defe6df5a48c630ece92a1' }, { map: 'ground-zero-21', extract: 'c812e0bac1d630c34af374428e34cf10dc344e9b' },
        ],
        text: { ru: 'Воспользоваться выходом «Спуск в подвал в Nakatani» или «Пункт МЧС» (за один рейд)', en: 'Extract through the Nakatani Basement Stairs or the Emercom Checkpoint (in one raid)' },
      },
    ],
    rewards: [[ROUBLES, 180_000], [GRIZZLY, 2], [CMS, 3]],
    note: {
      ru: 'Открывается, когда взята «Незваные гости. Часть 1». Письмо Терапевт выдаёт с квестом. После закладки уходите только через «Спуск в подвал в Nakatani» или «Пункт МЧС» и не используйте РСП. Смерть или другой выход проваливают квест, письмо тогда снова придёт в сообщениях Терапевта.',
      en: 'Opens once Uninvited Guests - Part 1 is taken. Therapist gives the letter with the quest. After stashing it, leave only through the Nakatani Basement Stairs or the Emercom Checkpoint and do not use a signal flare. Dying or another exit fails the quest; the letter then comes again in Therapist\'s messages.',
    },
  },
  {
    id: K.castTheNet,
    trader: PRAPOR,
    name: { ru: 'Забросить невод [KORD BREACH]', en: 'Cast the Net [KORD BREACH]' },
    aliases: ['Забросить невод', 'Cast the Net'],
    after: [K.uninvitedGuests2],
    experience: 11_000,
    objectives: [
      { type: 'plantItem', maps: SHORELINE, spots: CAMERA_SPOTS.ural, items: [WIFI_CAMERA], text: { ru: 'Закрепить Wi-Fi камеру на грузовике «Урал» рядом с ГЭС на локации Берег', en: 'Plant a WI-FI Camera in the Ural truck near the hydroelectric power station on Shoreline' } },
      { type: 'plantItem', maps: SHORELINE, spots: CAMERA_SPOTS.excavator, items: [WIFI_CAMERA], text: { ru: 'Закрепить Wi-Fi камеру на экскаваторе у ручья, протекающего под базой контрабандистов на локации Берег', en: 'Plant a WI-FI Camera in the excavator at the stream near the smugglers\' base on Shoreline' } },
      { type: 'plantItem', maps: GROUND_ZERO, spots: CAMERA_SPOTS.truck, items: [WIFI_CAMERA], text: { ru: 'Закрепить Wi-Fi камеру на кабине фуры, стоящей на спуске к проспекту Мира на локации Эпицентр', en: 'Plant a WI-FI Camera in the cargo truck cabin near Mira Ave on Ground Zero' } },
      { type: 'plantItem', maps: GROUND_ZERO, spots: CAMERA_SPOTS.bus, items: [WIFI_CAMERA], text: { ru: 'Закрепить Wi-Fi камеру внутри жёлтого автобуса на подземном уровне на локации Эпицентр', en: 'Plant a WI-FI Camera inside the yellow bus in the underground tunnel on Ground Zero' } },
    ],
    startRewards: [[WIFI_CAMERA, 6]],
    rewards: [[ROUBLES, 180_000], [FIERCE_HATCHLING, 2]],
    note: {
      ru: 'Камеры Прапор выдаёт с квестом. Две ставятся на Берегу, две на Эпицентре, можно за разные рейды.',
      en: 'Prapor gives the cameras with the quest. Two go on Shoreline and two on Ground Zero, in any number of raids.',
    },
  },
  {
    id: K.knowYourEnemy,
    trader: PRAPOR,
    name: { ru: 'Знай своего врага [KORD BREACH]', en: 'Know Your Enemy [KORD BREACH]' },
    aliases: ['Знай своего врага', 'Know Your Enemy'],
    after: [K.castTheNet],
    experience: 11_000,
    objectives: [
      { type: 'giveItem', count: 3, items: BD_PLATE_CARRIERS, text: { ru: 'Передать снаряжение Black Division', en: 'Hand over any Black Division plate carriers' } },
    ],
    rewards: [[ROUBLES, 180_000], [F1, 5], [RGD5, 5]],
    note: {
      ru: 'Нужны три любых чехла для бронеплит Black Division. Их носят бойцы Black Division, они бывают и в ящиках со снаряжением Black Division из боевого пропуска.',
      en: 'Any three Black Division plate carriers. Black Division operatives wear them, and the Black Division gear crates of the BattlePass hold them too.',
    },
  },
  {
    id: K.reverseGear,
    trader: PRAPOR,
    name: { ru: 'Задняя передача [KORD BREACH]', en: 'Reverse Gear [KORD BREACH]' },
    aliases: ['Задняя передача', 'Reverse Gear'],
    after: [K.knowYourEnemy],
    delay: [0, 7_200],
    experience: 11_000,
    objectives: [
      { type: 'findQuestItem', maps: SHORELINE, spots: CAMERA_SPOTS.ural, text: { ru: 'Найти WI-FI камеру с грузовика «Урал» рядом с ГЭС на локации Берег', en: 'Locate and obtain the WI-FI Camera from the Ural truck near the hydroelectric power station on Shoreline' } },
      { type: 'giveQuestItem', text: { ru: 'Передать найденную камеру', en: 'Hand over the camera' } },
      { type: 'findQuestItem', maps: SHORELINE, spots: CAMERA_SPOTS.excavator, text: { ru: 'Найти WI-FI камеру с экскаватора на территории контрабандистов на локации Берег', en: 'Locate and obtain the WI-FI Camera from the excavator at the stream near the smugglers\' base on Shoreline' } },
      { type: 'giveQuestItem', text: { ru: 'Передать найденную камеру', en: 'Hand over the camera' } },
      { type: 'findQuestItem', maps: GROUND_ZERO, spots: CAMERA_SPOTS.truck, text: { ru: 'Найти WI-FI камеру с кабины фуры на спуске к проспекту Мира на локации Эпицентр', en: 'Locate and obtain the WI-FI Camera from the cargo truck cabin near Mira Ave on Ground Zero' } },
      { type: 'giveQuestItem', text: { ru: 'Передать найденную камеру', en: 'Hand over the camera' } },
      { type: 'findQuestItem', maps: GROUND_ZERO, spots: CAMERA_SPOTS.bus, text: { ru: 'Найти WI-FI камеру с жёлтого автобуса на подземном уровне на локации Эпицентр', en: 'Locate and obtain the WI-FI Camera from the yellow bus in the underground tunnel on Ground Zero' } },
      { type: 'giveQuestItem', text: { ru: 'Передать найденную камеру', en: 'Hand over the camera' } },
    ],
    rewards: [[ROUBLES, 180_000], [ARMOR_6B23_2_FLORA, 2], [BRIEFCASE_WITH_DOCUMENTS, 1]],
    rewardNotes: [{ ru: 'Сезонная награда: очки Gatorz «Specter MILSPEC» у Миротворца (1-й уровень лояльности)', en: 'Season reward: Gatorz Specter MILSPEC glasses at Peacekeeper (loyalty level 1)' }],
    note: {
      ru: 'Появляется в течение двух часов после «Знай своего врага». Камеры забирают с тех же мест, где их ставили по «Забросить невод».',
      en: 'Appears within two hours after Know Your Enemy. The cameras are picked up where Cast the Net placed them.',
    },
  },
  {
    id: K.ridingTheWave,
    trader: RAGMAN,
    name: { ru: 'На волне популярности [KORD BREACH]', en: 'Riding the Wave [KORD BREACH]' },
    aliases: ['На волне популярности', 'Riding the Wave'],
    after: [K.reverseGear],
    experience: 30_000,
    objectives: [
      handOverFound(BD_SIEGE_R, 'Чехол для бронеплит First Spear «Siege-R Optimized M.A.S.S.» (Black Division)', 'First Spear Siege-R Optimized M.A.S.S. Plate Carrier (Black Division)'),
      handOverFound(BD_LV119_V2, 'Чехол для бронеплит Spiritus Systems «LV-119» (Black Division, Снаряженный)', 'Spiritus Systems LV-119 Plate Carrier (Black Division V2)'),
      handOverFound(BD_FCPC_V5, 'Чехол для бронеплит Ferro Concepts «FCPC V5» (Black Division)', 'Ferro Concepts FCPC V5 Plate Carrier (Black Division)'),
      handOverFound(BD_LV119_V1, 'Чехол для бронеплит Spiritus Systems «LV-119» (Black Division, Облегченный)', 'Spiritus Systems LV-119 Plate Carrier (Black Division V1)'),
      handOverFound(TT_MODULAR_45_MCB, 'Рюкзак Tasmanian Tiger «Modular Pack 45 Plus» (MultiCam Black)', 'Tasmanian Tiger Modular Pack 45 Plus (MultiCam Black)'),
      handOverFound(MR_2DAY_BLACK, 'Рюкзак Mystery Ranch «2 Day Assault Pack» (Черный)', 'Mystery Ranch 2 Day Assault Pack (Black)'),
      handOverFound(MR_NICE_FRAME, 'Грузовая рама Mystery Ranch «NICE Frame Load Sling» с защитным кейсом', 'Mystery Ranch NICE Frame Load Sling'),
      handOverFound(AVON_M53A1, 'Противогаз AVON «M53A1»', 'Avon M53A1 gas mask'),
      handOverFound(SOTR, 'Респиратор Gentex Ops-Core «SOTR»', 'Gentex Ops-Core SOTR respirator'),
      handOverFound(GATORZ, 'Защитные очки Gatorz «Specter MILSPEC»', 'Gatorz Specter MILSPEC ballistic glasses'),
    ],
    rewards: [[ROUBLES, 300_000], [BAGARIY_EMR, 1], [AVS_RANGER_GREEN, 3]],
    note: {
      ru: 'Всё снаряжение Black Division, найденное в рейде, по одному предмету. Его носят бойцы Black Division; больше всего его на Ледоколе.',
      en: 'All of the Black Division gear, found in raid, one of each. Black Division operatives wear it; the Icebreaker has the most.',
    },
  },
  {
    id: K.keyToUnderstanding,
    trader: FENCE,
    name: { ru: 'Ключ к пониманию [KORD BREACH]', en: 'Key to Understanding [KORD BREACH]' },
    aliases: ['Ключ к пониманию', 'Key to Understanding'],
    after: [K.reverseGear],
    level: 20,
    experience: 30_000,
    objectives: [
      { type: 'findItem', items: [BD_ENCRYPTION_KEYS], foundInRaid: true, text: { ru: 'Найти и забрать Ключи шифрования Black Division', en: 'Locate and obtain the Black Division encryption keys' } },
      { type: 'giveItem', items: [BD_ENCRYPTION_KEYS], foundInRaid: true, text: { ru: 'Передать найденный предмет', en: 'Hand over the found item' } },
    ],
    rewards: [[ROUBLES, 300_000], [LABS_KEYCARD, 2]],
    note: {
      ru: 'Нужен 20-й уровень. Ключи шифрования выпадают с бойцов Black Division на обычных локациях, на Ледоколе их нет.',
      en: 'Needs level 20. The encryption keys drop from Black Division operatives on the regular maps, not on the Icebreaker.',
    },
  },
  {
    id: K.whatsInTheBag,
    trader: FENCE,
    name: { ru: 'Что в сумке? [KORD BREACH]', en: 'What\'s in the Bag? [KORD BREACH]' },
    aliases: ['Что в сумке?', 'What\'s in the Bag?'],
    after: [K.keyToUnderstanding],
    delay: [3_600, 7_200],
    experience: 30_000,
    objectives: [
      { type: 'findItem', items: [BRIEFCASE_WITH_DOCUMENTS], foundInRaid: true, text: { ru: 'Найти и забрать Портфель с документами', en: 'Locate and obtain the Briefcase with documents' } },
      { type: 'giveItem', items: [BRIEFCASE_WITH_DOCUMENTS], foundInRaid: true, text: { ru: 'Передать найденный предмет', en: 'Hand over the found item' } },
    ],
    rewards: [[ROUBLES, 300_000], [INTELLIGENCE_FOLDER, 1], [TOPOGRAPHIC_MAPS, 1]],
    note: {
      ru: 'Появляется через 1–2 часа после «Ключ к пониманию». Портфель с документами изредка бывает у бойцов Black Division, его также дают за 5 жетонов Black Division на круге сектантов.',
      en: 'Appears 1–2 hours after Key to Understanding. Black Division operatives sometimes carry the briefcase; the cultist circle also gives one for 5 Black Division dogtags.',
    },
  },
  {
    id: K.forbiddenKnowledge,
    trader: FENCE,
    name: { ru: 'Запретные знания [KORD BREACH]', en: 'Forbidden Knowledge [KORD BREACH]' },
    aliases: ['Запретные знания', 'Forbidden Knowledge'],
    after: [K.whatsInTheBag],
    experience: 30_000,
    objectives: [
      { type: 'findItem', count: 2, items: [KORD_SSD], foundInRaid: true, text: { ru: 'Найти в рейде SSD диски 14-4 KORD', en: 'Locate and obtain the 14-4 KORD SSDs' } },
      { type: 'giveItem', count: 2, items: [KORD_SSD], foundInRaid: true, text: { ru: 'Передать найденные SSD диски', en: 'Hand over the found intel' } },
    ],
    rewards: [[ROUBLES, 300_000], [TEP300_COYOTE, 3]],
    rewardNotes: [{ ru: 'Сезонная награда: противогаз AVON «M53A1» у Миротворца (2-й уровень лояльности)', en: 'Season reward: Avon M53A1 gas mask at Peacekeeper (loyalty level 2)' }],
    note: {
      ru: 'SSD диски выпадают с бойцов Black Division; чаще всего они на Улицах, Берегу и Лаборатории (там они появляются после включения выхода).',
      en: 'The SSDs drop from Black Division operatives, most often on Streets, Shoreline and The Lab (there they appear once an exit is switched on).',
    },
  },
  {
    id: K.sheepInWolfsClothing,
    trader: FENCE,
    name: { ru: 'Волк в овечьей шкуре [KORD BREACH]', en: 'Sheep in Wolf\'s Clothing [KORD BREACH]' },
    aliases: ['Волк в овечьей шкуре', 'Sheep in Wolf\'s Clothing'],
    after: [K.forbiddenKnowledge],
    experience: 30_000,
    objectives: [
      { type: 'shoot', count: 8, shoot: BD, text: { ru: 'Устранить бойцов Black Division, надев чехол для бронеплит Black Division', en: 'Eliminate Black Division operatives while wearing a Black Division plate carrier' } },
    ],
    rewards: [[ROUBLES, 300_000], [MONEY_CASE, 1], [QBZ191_QBZ192, 1]],
    rewardNotes: [
      { ru: 'Открывает покупку Norinco QBZ-191 у Лыжника (3-й уровень лояльности)', en: 'Unlocks the Norinco QBZ-191 at Skier (loyalty level 3)' },
      { ru: 'Сезонная награда: рюкзак Mystery Ranch «2 Day Assault Pack» у Барахольщика (3-й уровень лояльности, 25-й уровень)', en: 'Season reward: Mystery Ranch 2 Day Assault Pack at Ragman (loyalty level 3, level 25)' },
    ],
    note: {
      ru: 'Наденьте любой чехол для бронеплит Black Division. Бойцы Black Division бывают на Берегу, Улицах, Эпицентре (21+) и в Лесу.',
      en: 'Wear any Black Division plate carrier. Black Division operatives roam Shoreline, Streets, Ground Zero (21+) and Woods.',
    },
  },
  {
    id: K.finalStretch,
    trader: FENCE,
    name: { ru: 'Финишная прямая [KORD BREACH]', en: 'Final Stretch [KORD BREACH]' },
    aliases: ['Финишная прямая', 'Final Stretch'],
    after: [K.sheepInWolfsClothing],
    experience: 35_000,
    objectives: [
      { type: 'findQuestItem', maps: STREETS, text: { ru: 'Найти и забрать ноутбук из схрона Скупщика на локации Улицы Таркова', en: 'Locate and obtain the laptop from Fence\'s stash on Streets of Tarkov' } },
      { type: 'giveQuestItem', text: { ru: 'Передать найденный предмет', en: 'Hand over the found item' } },
    ],
    rewards: [[ROUBLES, 300_000], [RB_BK, 1], [BRIEFCASE_WITH_DOCUMENTS, 1]],
    rewardNotes: [{ ru: 'Достижение «Деньги не пахнут?»', en: 'Achievement «Profit Over Principles»' }],
    note: {
      ru: 'Выбор: ноутбук с Улиц можно отдать Скупщику (этот квест) или расшифровать и отдать Механику («Последствия наших решений»). Выполнив один, вы провалите другой; дальше линия идёт к Механику в любом случае.',
      en: 'A choice: the laptop from Streets goes either to Fence (this quest) or, decrypted, to Mechanic (Consequences of Our Decisions). Completing one fails the other; the line goes on to Mechanic either way.',
    },
  },
  {
    id: K.consequences,
    trader: MECHANIC,
    name: { ru: 'Последствия наших решений [KORD BREACH]', en: 'Consequences of Our Decisions [KORD BREACH]' },
    aliases: ['Последствия наших решений', 'Consequences of Our Decisions'],
    afterAccepted: [K.finalStretch],
    experience: 35_000,
    objectives: [
      { type: 'hideout', text: { ru: 'Расшифровать данные с ноутбука с секретного объекта', en: 'Decrypt the data from the secret facility laptop' } },
      { type: 'hideout', text: { ru: 'Прочитать данные, полученные с ноутбука Скупщика', en: 'Read the data recovered from Fence\'s laptop' } },
      { type: 'giveQuestItem', text: { ru: 'Передать ноутбук', en: 'Hand over the laptop' } },
    ],
    rewards: [[ROUBLES, 300_000], [ELECTRIC_DRILL, 5], [COFDM, 3], [CYCLON, 5], [TOOLSET, 5], [BRIEFCASE_WITH_DOCUMENTS, 1]],
    rewardNotes: [{ ru: 'Достижение «Деньги не пахнут?»', en: 'Achievement «Profit Over Principles»' }],
    note: {
      ru: 'Открывается, когда взята «Финишная прямая». Ноутбук с Улиц расшифровывают в убежище и отдают Механику; выполнив этот квест, вы провалите «Финишную прямую».',
      en: 'Opens once Final Stretch is taken. The laptop from Streets is decrypted in the Hideout and given to Mechanic; completing this quest fails Final Stretch.',
    },
  },
  {
    id: K.desperateAssault,
    trader: MECHANIC,
    name: { ru: 'Отчаянный штурм [KORD BREACH]', en: 'Desperate Assault [KORD BREACH]' },
    aliases: ['Отчаянный штурм', 'Desperate Assault'],
    afterDecided: [K.finalStretch, K.consequences],
    experience: 30_000,
    objectives: [
      { type: 'shoot', count: 8, maps: ['the-lab'], shoot: BD, text: { ru: 'Устранить бойцов Black Division на локации Лаборатория', en: 'Eliminate Black Division operatives in The Lab' } },
    ],
    rewards: [[ROUBLES, 300_000], [WEAPON_REPAIR_KIT, 1], [ARMOR_REPAIR_KIT, 1]],
    note: {
      ru: 'Открывается после «Финишной прямой» или «Последствий наших решений». На Лаборатории бойцы Black Division появляются вместо рейдеров, в тех же местах. Они хорошо экипированы, возьмите ПНВ и пробивные патроны.',
      en: 'Opens after Final Stretch or Consequences of Our Decisions. In The Lab, Black Division operatives take the Raiders\' place and spawns. They are well equipped: bring night vision and penetrating ammo.',
    },
  },
  {
    id: K.stayClear,
    trader: JAEGER,
    name: { ru: 'Капкан [KORD BREACH]', en: 'Stay Clear of Blast Zone [KORD BREACH]' },
    aliases: ['Капкан', 'Stay Clear of Blast Zone'],
    afterAccepted: [K.desperateAssault],
    experience: 30_000,
    objectives: [
      { type: 'plantItem', maps: SHORELINE, items: [TP200], text: { ru: 'Заложить тротиловую шашку ТП-200 у первого пролома в заборе рядом с западным крылом санатория «Лазурный берег»', en: 'Plant a TP-200 TNT brick at the first fence breach by the west wing of the Health Resort on Shoreline' } },
      { type: 'plantItem', maps: SHORELINE, items: [TP200], text: { ru: 'Заложить тротиловую шашку ТП-200 у второго пролома в заборе рядом с западным крылом санатория «Лазурный берег»', en: 'Plant a TP-200 TNT brick at the second fence breach by the west wing of the Health Resort on Shoreline' } },
      { type: 'plantItem', maps: SHORELINE, items: [TP200], text: { ru: 'Заложить тротиловую шашку ТП-200 у пролома в заборе рядом с восточным крылом санатория «Лазурный берег»', en: 'Plant a TP-200 TNT brick at the fence breach by the east wing of the Health Resort on Shoreline' } },
    ],
    rewards: [[ROUBLES, 300_000], [G28, 1], [HK417_MAG_10, 3], [M62_PACK_20, 2]],
    note: {
      ru: 'Открывается, когда взят «Отчаянный штурм». Нужны 3 тротиловые шашки ТП-200.',
      en: 'Opens once Desperate Assault is taken. Needs 3 TP-200 TNT bricks.',
    },
  },
  {
    id: K.breakTheChain,
    trader: MECHANIC,
    name: { ru: 'Разрыв цепи [KORD BREACH]', en: 'Break the Chain [KORD BREACH]' },
    aliases: ['Разрыв цепи', 'Break the Chain'],
    after: [K.desperateAssault],
    experience: 30_000,
    objectives: [
      { type: 'visit', maps: ['customs'], text: { ru: 'Уничтожить ретранслятор на заводской трубе рядом с незаконченной стройкой на локации Таможня', en: 'Destroy the transmitter on the factory chimney near the unfinished construction site on Customs' } },
      { type: 'visit', maps: ['customs'], text: { ru: 'Уничтожить ретранслятор на вышке ЛЭП на локации Таможня', en: 'Destroy the transmitter on the power line tower on Customs' } },
      { type: 'visit', maps: ['woods'], text: { ru: 'Уничтожить ретранслятор на вершине скалы на локации Лес', en: 'Destroy the transmitter on top of the mountain on Woods' } },
      { type: 'visit', maps: ['woods'], text: { ru: 'Уничтожить ретранслятор на вышке сотовой связи на локации Лес', en: 'Destroy the transmitter on the cell tower on Woods' } },
    ],
    rewards: [[ROUBLES, 300_000], [SCAR_H_FDE, 1], [SCAR_H_MAG_20, 3], [M80_PACK_20, 5]],
    note: {
      ru: 'Ретрансляторы стоят высоко, их расстреливают издалека; пригодится оптический прицел. На Лесу один на снайперской горе, другой у бункера Диких.',
      en: 'The transmitters sit high up and are shot from a distance, so bring a scope. On Woods one is on the sniper mountain, the other by the Scav bunker.',
    },
  },
  {
    id: K.digitalPuzzle,
    trader: MECHANIC,
    name: { ru: 'Цифровой пазл [KORD BREACH]', en: 'Digital Puzzle [KORD BREACH]' },
    aliases: ['Цифровой пазл', 'Digital Puzzle'],
    after: [K.breakTheChain],
    experience: 35_000,
    objectives: [
      { type: 'giveQuestItem', text: { ru: 'Передать данные с защищённого ноутбука Black Division', en: 'Hand over the data from the Black Division rugged laptop' } },
    ],
    rewards: [[ROUBLES, 150_000], [THICC_WEAPON_CASE, 1], [THICC_ITEM_CASE, 1], [BRIEFCASE_WITH_DOCUMENTS, 1]],
    rewardNotes: [{ ru: 'Сезонная награда: чехол Spiritus Systems «LV-119» (Black Division, Облегченный) у Миротворца (4-й уровень лояльности, 30-й уровень)', en: 'Season reward: Spiritus Systems LV-119 Plate Carrier (Black Division V1) at Peacekeeper (loyalty level 4, level 30)' }],
    note: {
      ru: 'Защищённый ноутбук Black Division изредка бывает у бойцов Black Division. Его расшифровывают в Разведцентре (1-й уровень) и отдают данные Механику.',
      en: 'Black Division operatives rarely carry the rugged laptop. Decrypt it in the Intelligence Center (level 1) and give the data to Mechanic.',
    },
  },
  {
    id: K.priceForInformation,
    trader: LIGHTKEEPER,
    name: { ru: 'Плата за информацию [KORD BREACH]', en: 'Price for Information [KORD BREACH]' },
    aliases: ['Плата за информацию', 'Price for Information'],
    after: [K.digitalPuzzle],
    experience: 65_000,
    objectives: [
      { type: 'transit', maps: SHORELINE, spots: [{ map: 'shoreline', transit: '24' }], text: { ru: 'Совершить переход с локации Берег на локацию Маяк (В одном рейде)', en: 'Use the transit from Shoreline to Lighthouse (In one raid)' } },
      { type: 'transit', maps: ['lighthouse'], spots: [{ map: 'lighthouse', transit: '22' }], text: { ru: 'Совершить переход с локации Маяк на локацию Резерв (В одном рейде)', en: 'Use the transit from Lighthouse to Reserve (In one raid)' } },
      { type: 'transit', maps: ['reserve'], spots: [{ map: 'reserve', transit: '19' }], text: { ru: 'Совершить переход с локации Резерв на локацию Лес (В одном рейде)', en: 'Use the transit from Reserve to Woods (In one raid)' } },
      { type: 'shoot', count: 10, maps: ['shoreline', 'lighthouse', 'reserve', 'woods'], shoot: { targets: ['Any'] }, text: { ru: 'Устранить любую цель, кроме бойцов Black Division (В одном рейде)', en: 'Eliminate any targets except Black Division while completing the other objectives' } },
    ],
    rewards: [[RB_VO, 1]],
    note: {
      ru: 'Всё за один заход: Берег → Маяк → Резерв → Лес через переходы, по пути 10 убийств любых целей, кроме Black Division.',
      en: 'All in one run: Shoreline → Lighthouse → Reserve → Woods through the transits, with 10 kills of anything but Black Division on the way.',
    },
  },
  {
    id: K.nameOfHumanity,
    trader: LIGHTKEEPER,
    name: { ru: 'Во имя человечества... [KORD BREACH]', en: 'In the Name of Humanity... [KORD BREACH]' },
    aliases: ['Во имя человечества...', 'In the Name of Humanity...'],
    after: [K.priceForInformation],
    experience: 70_000,
    objectives: [
      { type: 'shoot', count: 3, maps: ['interchange'], shoot: { targets: ['Any'], fromHour: 20, untilHour: 8 }, text: { ru: 'Устранить любые цели в период с 20:00 до 08:00 на локации Развязка (за один рейд)', en: 'Eliminate any targets during 20:00-08:00 on Interchange (In one raid)' } },
      { type: 'visit', maps: ['interchange'], text: { ru: 'Найти скрытую панель для ключ-карты в туалете закусочной «Burger Spot» на локации Развязка (за один рейд)', en: 'Locate the hidden keycard panel in the Burger Spot bathroom on Interchange (In one raid)' } },
      { type: 'visit', maps: ['interchange'], text: { ru: 'Найти скрытую безопасную комнату TerraGroup на локации Развязка (за один рейд)', en: 'Locate the hidden TerraGroup saferoom on Interchange (In one raid)' } },
      { type: 'visit', maps: ['interchange'], text: { ru: 'Найти контейнер №14 и получить к нему доступ на локации Развязка (за один рейд)', en: 'Locate and access Container 14 on Interchange (In one raid)' } },
      { type: 'findQuestItem', maps: ['interchange'], text: { ru: 'Забрать кейс из углеволокна из контейнера №14 на локации Развязка (за один рейд)', en: 'Obtain the carbon fiber case from Container 14 on Interchange (In one raid)' } },
      { type: 'transit', maps: ['interchange'], spots: [{ map: 'interchange', transit: '7' }], text: { ru: 'Воспользоваться переходом с локации Развязка на локацию Улицы Таркова (за один рейд)', en: 'Use the transit from Interchange to Streets of Tarkov (In one raid)' } },
      { type: 'shoot', count: 3, maps: STREETS, shoot: { targets: ['Any'], fromHour: 20, untilHour: 8 }, text: { ru: 'Устранить любые цели в период с 20:00 до 08:00 на локации Улицы Таркова (за один рейд)', en: 'Eliminate any targets during 20:00-08:00 on Streets of Tarkov (In one raid)' } },
      { type: 'plantQuestItem', maps: STREETS, text: { ru: 'Спрятать кейс из углеволокна на балконе 3-го этажа ресторана отеля Pinewood на локации Улицы Таркова (за один рейд)', en: 'Stash the carbon fiber case on the 3rd floor balcony of the Pinewood Hotel restaurant on Streets of Tarkov (In one raid)' } },
      { type: 'useItem', maps: STREETS, useAny: [RSP_YELLOW], text: { ru: 'Запустить жёлтую сигнальную ракету в сторону трамвая, упавшего в коллектор, на локации Улицы Таркова (за один рейд)', en: 'Launch a yellow signal flare at the tram that collapsed into the sewers on Streets of Tarkov (In one raid)' } },
    ],
    note: {
      ru: 'Всё за один заход: ночью на Развязке, затем переход на Улицы. Нужны ключ-карта для панели в туалете Burger Spot (сначала включите питание) и жёлтая сигнальная ракета.',
      en: 'All in one run: Interchange at night, then the transit to Streets. Bring the keycard for the panel in the Burger Spot bathroom (switch the power on first) and a yellow signal flare.',
    },
  },
  {
    id: K.goodOfTheChosen,
    trader: LIGHTKEEPER,
    name: { ru: '...во благо избранных [KORD BREACH]', en: '...for the Good of the Chosen [KORD BREACH]' },
    aliases: ['...во благо избранных', '...for the Good of the Chosen'],
    after: [K.nameOfHumanity],
    experience: 30_000,
    objectives: [{ type: 'dialogue', text: { ru: 'Доложить Смотрителю', en: 'Report back to Lightkeeper' } }],
    note: { ru: 'Поговорите со Смотрителем.', en: 'Talk to Lightkeeper.' },
  },
  {
    id: K.historicalProspects,
    trader: LIGHTKEEPER,
    name: { ru: 'Исторические перспективы [KORD BREACH]', en: 'Historical Prospects [KORD BREACH]' },
    aliases: ['Исторические перспективы', 'Historical Prospects'],
    after: [K.goodOfTheChosen],
    experience: 100_000,
    objectives: [
      { type: 'shoot', count: 3, maps: ['customs'], shoot: { targets: ['AnyPmc'], fromHour: 22, untilHour: 8 }, text: { ru: 'Убить бойцов ЧВК в период с 22:00 до 8:00 на локации Таможня', en: 'Eliminate PMC operatives during 22:00-08:00 on Customs' } },
      { type: 'plantItem', count: 3, maps: ['customs'], items: [DOGTAG_BEAR, DOGTAG_USEC], text: { ru: 'Заложить жетоны ЧВК в меченой комнате на локации Таможня', en: 'Stash PMC dogtags in the marked room on Customs' } },
      { type: 'shoot', count: 3, maps: ['woods'], shoot: { targets: ['AnyPmc'], fromHour: 22, untilHour: 8 }, text: { ru: 'Убить бойцов ЧВК в период с 22:00 до 8:00 на локации Лес', en: 'Eliminate PMC operatives during 22:00-08:00 on Woods' } },
      { type: 'plantItem', count: 3, maps: ['woods'], items: [DOGTAG_BEAR, DOGTAG_USEC], text: { ru: 'Заложить жетоны ЧВК в круге сектантов в заброшенной деревне на локации Лес', en: 'Stash PMC dogtags at the abandoned village marked circle on Woods' } },
      { type: 'shoot', count: 3, maps: STREETS, shoot: { targets: ['AnyPmc'], fromHour: 22, untilHour: 8 }, text: { ru: 'Убить бойцов ЧВК в период с 22:00 до 8:00 на локации Улицы Таркова', en: 'Eliminate PMC operatives during 22:00-08:00 on Streets of Tarkov' } },
      { type: 'plantItem', count: 3, maps: STREETS, items: [DOGTAG_BEAR, DOGTAG_USEC], text: { ru: 'Заложить жетоны ЧВК в круге сектантов на втором этаже дома на Никитской, 8', en: 'Stash PMC dogtags in the marked circle in the Nikitskaya St. 8 second floor apartment on Streets of Tarkov' } },
    ],
    rewards: [[RB_PKPM, 1], [BRIEFCASE_WITH_DOCUMENTS, 1], [PHYSICAL_BITCOIN, 2], [SUBSTATION_MARKED_KEY, 1]],
    rewardNotes: [
      { ru: 'Сезонная награда: чехол First Spear «Siege-R Optimized M.A.S.S.» (Black Division) у Миротворца (4-й уровень лояльности, 30-й уровень)', en: 'Season reward: First Spear Siege-R Optimized M.A.S.S. Plate Carrier (Black Division) at Peacekeeper (loyalty level 4, level 30)' },
    ],
    note: {
      ru: 'Последний квест линии. Для меченой комнаты на Таможне нужен ключ от меченой комнаты; жетоны берите с убитых ЧВК.',
      en: 'The last quest of the line. The marked room on Customs needs the marked key; take the dogtags from the PMCs you kill.',
    },
  },
]

/** «KORD BREACH» (Season 1): Prapor → BTR Driver → Fence → Mechanic → Lightkeeper, with side quests at Therapist, Ragman and Jaeger. */
export const KORD_BREACH: CuratedSeries = {
  id: 'kord-breach',
  name: { ru: 'KORD BREACH', en: 'KORD BREACH' },
  route: { ru: 'сезонная линия: Прапор → Скупщик → Механик → Смотритель', en: 'season line: Prapor → Fence → Mechanic → Lightkeeper' },
  gameVersion: '1.3.0.2.48779',
  checkedAt: '2026-11-19',
  modes: ['seasonal'],
  sources: [
    'https://escapefromtarkov.fandom.com/wiki/Seasons', 'https://escapefromtarkov.fandom.com/wiki/KORD_BREACH',
    'https://escapefromtarkov.fandom.com/ru/wiki/Незваные_гости._Часть_1', 'https://tarkov.help/ru/quest/nezvanie-gosti-chast-1-kord-breach',
    'https://tarkovforge.com/task-guide/digital-puzzle',
  ],
  quests,
}
