import type { Item, Quest, RaidMode } from '../domain/types'
import type { AppLocale } from '../i18n/LocaleProvider'

/**
 * Quests the game has and tarkov.dev does not, curated from the community sources (owner, 15.10.2026: «еще в нашей базе
 * нету серии квестов "на свет" … добавь в нашу базу что бы отображалось в приложении»). docs/quests/na-svet-audit.md
 * lists the sources, what each says and what could not be sourced.
 *
 * The quests are added to the tarkov.dev tasks file as tasks of its own shape (src/data/catalogSource.ts calls
 * `withCuratedTasks` right after loading it), so they go through the same adapters as every other quest: the quest list,
 * the trader views, the quest detail, the map points (`zones`) and the log matching by the game's quest id. A task
 * tarkov.dev already has (the same id) is left to tarkov.dev: its data wins once it lists the quest again.
 *
 * Map points are never typed in here. An objective names a place of the tarkov.dev maps file (an extract, a transit, a
 * locked door) and takes that place's coordinates at build time; a place the maps file does not have gives no point.
 */

type JsonRecord = Record<string, unknown>

interface Text { ru: string; en: string }

/**
 * A place in the tarkov.dev maps file (`<mode>/maps`) by the map's normalizedName and a key the translation leaves alone:
 * a transit's id, an extract's id (its `name` is translated), a locked door's key.
 */
export type CuratedSpot =
  | { map: string; transit: string }
  | { map: string; extract: string }
  | { map: string; lockKey: string }

interface CuratedObjective {
  /** tarkov.dev objective type; `hideout` (return to the hideout) and `transit` are the game's, tarkov.dev has no name for them. */
  type: string
  text: Text
  count?: number
  optional?: boolean
  /** Maps by normalizedName. */
  maps?: string[]
  items?: string[]
  questItem?: string
  foundInRaid?: boolean
  dogTagLevel?: number
  /** Groups of alternative keys (one of each group is needed), tarkov.dev `requiredKeys`. */
  requiredKeys?: string[][]
  /** Items of which any one is used (tarkov.dev `useAny`, e.g. a flare). */
  useAny?: string[]
  shoot?: { targets: string[]; fromHour?: number; untilHour?: number }
  exitName?: string
  /** Places whose coordinates are the objective's points. */
  spots?: CuratedSpot[]
}

interface CuratedQuest {
  /** The game's quest id (the id in the game's log notifications). */
  id: string
  trader: string
  name: Text
  /** Other titles of the same quest: the community sites' variants and earlier in-game titles. */
  aliases?: string[]
  /** Previous quests (complete), in the game's order of the series. */
  after?: string[]
  experience: number
  objectives: CuratedObjective[]
  /** Items given on completion (tarkov.dev `finishRewards.items`). */
  rewards?: Array<[itemId: string, count: number]>
  /** Items given when the quest is taken (tarkov.dev `startRewards.items`). */
  startRewards?: Array<[itemId: string, count: number]>
  standing?: Array<[traderId: string, value: number]>
  craftUnlock?: { itemId: string; station: Text }
  /** Trader loyalty levels needed to get the quest. */
  loyalty?: Array<[traderId: string, level: number]>
  /** Given in a trader dialogue (tarkov.dev `otherRequirements` type dialogue). */
  dialogue?: boolean
  /** Seconds after the previous quest before this one appears (min, max). */
  delay?: [number, number]
  /** Items to bring that the task data cannot name (a flare of `useAny`, the transponder). */
  bring?: Array<{ itemIds: string[]; count: number; maps: string[]; objective: number }>
  /**
   * The quest's description in the app: how it opens, what to do, tips. Player-facing: no source names and no notes about
   * the data (those belong in docs/quests/na-svet-audit.md).
   */
  note: Text
}

export interface CuratedSeries {
  id: string
  name: Text
  gameVersion: string
  checkedAt: string
  modes: readonly RaidMode[]
  sources: readonly string[]
  quests: readonly CuratedQuest[]
}

const PRAPOR = '54cb50c76803fa8b248b4571'
const THERAPIST = '54cb57776803fa99248b456e'
const SKIER = '58330581ace78e27b8b10cee'
const PEACEKEEPER = '5935c25fb3acc3127c3d8cd9'
const MECHANIC = '5a7c2eca46aef81a7ca2145d'
const RAGMAN = '5ac3b934156ae10c4430e83c'
const JAEGER = '5c0647fdd443bc2504c2d371'
const LIGHTKEEPER = '638f541a29ffd1183d187f57'

const ROUBLES = '5449016a4bdc2d6f028b456f'
const DOLLARS = '5696686a4bdc2da3298b456a'
const SIGNAL_JAMMER = '5ac78a9b86f7741cca0bbd8d'
const WIFI_CAMERA = '5b4391a586f7745321235ab2'
const RSP_YELLOW = '624c0b3340357b5f566e8766'
const FLARE_26X75_YELLOW = '62389be94d5d474bf712e709'
const BLUE_FOLDERS = '6389c8c5dbfd5e4b95197e6b'
const DSP_TRANSMITTER = '62e910aaf957f2915e0a5e36'
const V3_FLASH_DRIVE = '6331bb0d1aa9f42b804997a6'
const DOGTAG_BEAR = '59f32bb586f774757e1e8442'
const DOGTAG_USEC = '59f32c3b86f77472a31742f0'

/** Traders of the standing rewards, as the reward lines name them. */
const STANDING_NAMES: Record<string, Text> = { [LIGHTKEEPER]: { ru: 'Смотрителя', en: 'Lightkeeper' } }

/** «Источник информации» (Lightkeeper): the first task after the series. */
const INFORMATION_SOURCE = '63966faeea19ac7ed845db2c'

export const TO_THE_LIGHT_IDS = {
  trustButVerify: '6a880acc9216d0f5aa078305',
  falseCall: '6a880f5d9438980c42076efe',
  someoneCalled: '6a88270efbd24b6243010e6d',
  clipTheirWings: '6a8814d20d25ca7b2908e13e',
  fallenBird: '6a884d69d35a46046d0e808a',
  dangerousAmbitions: '6a8819620d25ca7b2908e14d',
  biteTheDust: '6a881bcf20dba6e9d70597a3',
  throwStones: '6a8820cb1f2b560baf0408a1',
  gatherStones: '6a8852bc184783d23e047902',
  otherSide: '6a88255e8636c03a2d09ba37',
  gettingAcquainted: '625d700cc48e6c62a440fab5',
} as const

const ID = TO_THE_LIGHT_IDS
const RETURN: CuratedObjective = { type: 'hideout', text: { ru: 'Вернуться в убежище', en: 'Return to the Hideout' } }

/**
 * «На свет» (To the Light): Mechanic's line to Lightkeeper of game version 1.1.5.0 (September 2026). It replaced the old
 * way to Lightkeeper («Сетевой провайдер», «Загладить вину»), and its last task is the old «Новое знакомство» (Getting
 * Acquainted) under the same id, renamed.
 */
export const TO_THE_LIGHT: CuratedSeries = {
  id: 'to-the-light',
  name: { ru: 'На свет', en: 'To the Light' },
  gameVersion: '1.1.5.0.47242',
  checkedAt: '2026-10-15',
  // tarkov.dev has no task of the series in any mode, but has Lightkeeper's tasks (which it opens) in all three; the
  // wiki gives no mode limit (docs/quests/na-svet-audit.md).
  modes: ['pvp', 'pve', 'seasonal'],
  sources: [
    'escapefromtarkov.fandom.com (EN) To the Light - …',
    'escapefromtarkov.fandom.com/ru На свет. … (infobox `node` = quest id)',
    'tarkov.help/en|ru/quest/…',
    'json.tarkov.dev regular/tasks_ru, tasks_en (the name of 625d700cc48e6c62a440fab5)',
    'json.tarkov.dev <mode>/maps (extracts, transits, locks)',
  ],
  quests: [
    {
      id: ID.trustButVerify,
      trader: MECHANIC,
      name: { ru: 'На свет. Доверяй, но проверяй', en: 'To the Light - Trust but Verify' },
      experience: 35_000,
      dialogue: true,
      loyalty: [[PRAPOR, 3], [THERAPIST, 3], [SKIER, 3], [PEACEKEEPER, 3], [MECHANIC, 3], [RAGMAN, 3], [JAEGER, 3]],
      objectives: [
        {
          type: 'plantQuestItem',
          maps: ['the-lab'],
          text: {
            ru: 'Заложить жесткий диск с дезой на Лабе в крытой серверной рядом с зоной испытаний оружия на локации Лаборатория (В одном рейде)',
            en: 'Stash the Hard drive with false data in the server room near the weapon testing area in The Lab (In one raid)',
          },
        },
        {
          type: 'extract',
          optional: true,
          maps: ['the-lab'],
          text: { ru: '(опционально) После этого нужно воспользоваться выходом «Вентиляционная шахта»', en: '(Optional) After that, extract through the Ventilation Shaft' },
        },
        {
          type: 'extract',
          maps: ['the-lab'],
          exitName: 'lab_Vent',
          // «Вентиляционная шахта» (lab_Vent)
          spots: [{ map: 'the-lab', extract: 'bb32a5dbbe8116e0765ed80a5ec7980e47676dc6' }],
          text: { ru: 'Воспользоваться выходом «Вентиляционная шахта» на локации Лаборатория (В одном рейде)', en: 'Extract from The Lab through the Ventilation Shaft (In one raid)' },
        },
      ],
      rewards: [[ROUBLES, 300_000], ['5c94bbff86f7747ee735c08f', 2]],
      note: {
        ru: 'Открывается в разговоре с Механиком (спросить о работе со Смотрителем) после главы «Тур», когда открыт доступ на Маяк, при 3-м уровне лояльности у Прапора, Терапевта, Лыжника, Миротворца, Механика, Барахольщика и Егеря. Жёсткий диск с дезой выдаётся при взятии задания. Закладка ~40 с, выход «Вентиляционная шахта» — без рюкзака; погибнете — диск снова придёт в сообщении от Механика.',
        en: 'Given in a talk with Mechanic (ask about working with Lightkeeper) after the Tour chapter has opened Lighthouse, with loyalty level 3 at Prapor, Therapist, Skier, Peacekeeper, Mechanic, Ragman and Jaeger. The hard drive with false data comes with the task. Stashing takes ~40 s, and the Ventilation Shaft is used without a backpack; if you die, the drive comes again in Mechanic\'s message.',
      },
    },
    {
      id: ID.falseCall,
      trader: MECHANIC,
      name: { ru: 'На свет. Ложный вызов', en: 'To the Light - False Call' },
      aliases: ['To the Light - False Alarm'],
      after: [ID.trustButVerify],
      delay: [600, 1800],
      experience: 30_000,
      objectives: [
        { type: 'shoot', count: 5, maps: ['customs'], shoot: { targets: ['Savage'], fromHour: 21, untilHour: 6 }, text: { ru: 'Устранить Диких на локации Таможня с 21:00 до 6:00 (В одном рейде)', en: 'Eliminate Scavs during 21:00-06:00 on Customs (In one raid)' } },
        { type: 'shoot', count: 1, maps: ['customs'], shoot: { targets: ['AnyPmc'], fromHour: 21, untilHour: 6 }, text: { ru: 'Устранить бойцов ЧВК с 21:00 до 6:00 на локации Таможня (В одном рейде)', en: 'Eliminate PMC operatives during 21:00-06:00 on Customs (In one raid)' } },
        { type: 'plantItem', maps: ['customs'], items: [WIFI_CAMERA], text: { ru: 'Спрятать Wi-Fi камеру у кондиционера на точке явки в магазине «Местный» на перекрёстке на локации Таможня (В одном рейде)', en: 'Hide a Wi-Fi camera at the AC unit at the convenience store near the bridge on Customs (In one raid)' } },
        { type: 'useItem', maps: ['customs'], useAny: [RSP_YELLOW, FLARE_26X75_YELLOW], spots: [{ map: 'customs', transit: '42' }], text: { ru: 'Подать сигнал РСП (Жёлтый) у перехода на локацию Берег (В одном рейде)', en: 'Launch a yellow signal flare at the Shoreline transit on Customs (In one raid)' } },
      ],
      bring: [{ itemIds: [RSP_YELLOW, FLARE_26X75_YELLOW], count: 1, maps: ['customs'], objective: 3 }],
      note: {
        ru: 'Появляется через 10–30 минут после «Доверяй, но проверяй». Всё — за один ночной рейд на Таможне. Возьмите ПНВ. Сигнал: РСП-30 (жёлтый) или жёлтый патрон 26x75 из сигнального пистолета СП-81 — стрелять вверх прямо у перехода на Берег, у автобуса.',
        en: 'Appears 10–30 minutes after Trust but Verify. Everything in one night raid on Customs. Bring NVGs. The signal: an RSP-30 (yellow) or a yellow 26x75 flare from the SP-81 signal pistol, fired upwards right at the Shoreline transit, by the bus.',
      },
    },
    {
      id: ID.someoneCalled,
      trader: MECHANIC,
      name: { ru: 'На свет. Вызывали?', en: 'To the Light - Someone Called?' },
      after: [ID.falseCall],
      experience: 10_000,
      objectives: [RETURN],
      rewards: [[ROUBLES, 300_000], ['5fc3f2d5900b1d5091531e57', 1], ['5a718b548dc32e000d46d262', 3], ['65702591c5d7d4cb4d07857c', 2], ['62178c4d4ecf221597654e3d', 3]],
      note: {
        ru: 'Берётся само сразу после «Ложного вызова», ещё в рейде; выполняется возвращением в убежище.',
        en: 'Starts by itself right after False Call, still in the raid; completed by returning to the hideout.',
      },
    },
    {
      id: ID.clipTheirWings,
      trader: MECHANIC,
      name: { ru: 'На свет. Подрезать крылья', en: 'To the Light - Clip Their Wings' },
      after: [ID.falseCall],
      delay: [600, 900],
      experience: 45_000,
      objectives: [
        { type: 'plantItem', maps: ['woods'], items: [SIGNAL_JAMMER], text: { ru: 'Установить подавитель сигналов в метеовышку в горах на локации Лес (В одном рейде)', en: 'Plant a Signal jammer at the weather station on the mountain on Woods (In one raid)' } },
        { type: 'plantItem', maps: ['woods'], items: [SIGNAL_JAMMER], text: { ru: 'Установить подавитель сигналов в сторожевой будке на лесопилке на локации Лес (В одном рейде)', en: 'Plant a Signal jammer at the sawmill guardhouse on Woods (In one raid)' } },
        { type: 'transit', maps: ['woods'], spots: [{ map: 'woods', transit: '41' }], text: { ru: 'Совершить переход с локации Лес на локацию Таможня (В одном рейде)', en: 'Use the transit from Woods to Customs (In one raid)' } },
        { type: 'plantItem', maps: ['customs'], items: [SIGNAL_JAMMER], text: { ru: 'Установить подавитель сигналов на втором этаже стройки у дороги на локации Таможня (В одном рейде)', en: 'Plant a Signal jammer on the second floor of the roadside construction site on Customs (In one raid)' } },
        { type: 'transit', maps: ['customs'], spots: [{ map: 'customs', transit: '42' }], text: { ru: 'Совершить переход с локации Таможня на локацию Берег (В одном рейде)', en: 'Use the transit from Customs to Shoreline (In one raid)' } },
        { type: 'plantItem', maps: ['shoreline'], items: [SIGNAL_JAMMER], text: { ru: 'Установить подавитель сигналов в архиве на 2 этаже административного корпуса санатория на локации Берег (В одном рейде)', en: 'Plant a Signal jammer at the second floor archives in the Health Resort admin building on Shoreline (In one raid)' } },
      ],
      note: {
        ru: 'Появляется через 10–15 минут после «Ложного вызова». Всё — за один заход через переходы Лес → Таможня → Берег; выход до последней цели — начинать заново. Нужно 4 подавителя сигналов (Механик, 1-й уровень лояльности).',
        en: 'Appears 10–15 minutes after False Call. Everything in one run through the transits Woods → Customs → Shoreline; extracting before the last objective starts it over. Needs 4 Signal jammers (Mechanic, loyalty level 1).',
      },
    },
    {
      id: ID.fallenBird,
      trader: MECHANIC,
      name: { ru: 'На свет. Павшая птица', en: 'To the Light - Fallen Bird' },
      after: [ID.clipTheirWings],
      experience: 10_000,
      objectives: [RETURN],
      rewards: [[ROUBLES, 500_000], ['6165ac306ef05c2ce828ef74', 1], ['6183d53f1cb55961fa0fdcda', 3], ['65702554bfc87b3a34093247', 4]],
      note: {
        ru: 'Берётся само сразу после «Подрезать крылья», ещё в рейде; выполняется возвращением в убежище.',
        en: 'Starts by itself right after Clip Their Wings, still in the raid; completed by returning to the hideout.',
      },
    },
    {
      id: ID.dangerousAmbitions,
      trader: MECHANIC,
      name: { ru: 'На свет. Опасные амбиции', en: 'To the Light - Dangerous Ambitions' },
      after: [ID.fallenBird],
      experience: 10_000,
      objectives: [{ type: 'giveQuestItem', text: { ru: 'Передать Миротворцу амулет от Смотрителя', en: 'Hand over the Amulet from Lightkeeper to Peacekeeper' } }],
      rewards: [[ROUBLES, 100_000]],
      note: {
        ru: 'Амулет от Смотрителя выдаётся при взятии задания; сдаётся Миротворцу в его задании «На свет. Фиаско» — оба выполняются вместе.',
        en: 'The Amulet from Lightkeeper comes with the task; it is handed to Peacekeeper in his task To the Light - Bite the Dust, and both are completed together.',
      },
    },
    {
      id: ID.biteTheDust,
      trader: PEACEKEEPER,
      name: { ru: 'На свет. Фиаско', en: 'To the Light - Bite the Dust' },
      aliases: ['To the Light - Fiasco'],
      after: [ID.fallenBird],
      experience: 10_000,
      objectives: [{ type: 'giveQuestItem', text: { ru: 'Передать улику, указывающую на организатора облавы', en: 'Hand over the evidence implicating the person behind the disruptions' } }],
      rewards: [[DOLLARS, 1_000], [BLUE_FOLDERS, 1]],
      note: {
        ru: 'Задание Миротворца, открывается вместе с «Опасными амбициями»: улика — амулет от Смотрителя из того задания.',
        en: 'Peacekeeper\'s task, opened together with Dangerous Ambitions: the evidence is the Amulet from Lightkeeper of that task.',
      },
    },
    {
      id: ID.throwStones,
      trader: MECHANIC,
      name: { ru: 'На свет. Время разбрасывать камни', en: 'To the Light - A Time to Throw Stones' },
      aliases: ['To the Light - A Time to Scatter Stones'],
      after: [ID.dangerousAmbitions],
      experience: 55_000,
      objectives: [{ type: 'shoot', count: 2, maps: ['the-lab'], shoot: { targets: ['AnyPmc'] }, text: { ru: 'Устранить бойцов ЧВК на локации Лаборатория (В одном рейде)', en: 'Eliminate PMC operatives in The Lab (In one raid)' } }],
      note: { ru: 'Два ЧВК за один рейд в Лаборатории.', en: 'Two PMCs within one raid in The Lab.' },
    },
    {
      id: ID.gatherStones,
      trader: MECHANIC,
      name: { ru: 'На свет. Время собирать камни', en: 'To the Light - A Time to Gather Stones' },
      after: [ID.throwStones],
      experience: 25_000,
      objectives: [{ type: 'giveItem', count: 3, items: [DOGTAG_BEAR, DOGTAG_USEC], foundInRaid: true, dogTagLevel: 30, text: { ru: 'Передать жетоны ЧВК 30 ур. и выше', en: 'Hand over PMC dogtags (Level 30 or higher)' } }],
      rewards: [['59faff1d86f7746c51718c9c', 3], ['5910968f86f77425cf569c32', 1], ['591094e086f7747caa7bb2ef', 1]],
      note: { ru: 'Жетоны ЧВК (BEAR или USEC) 30-го уровня и выше, найденные в рейде.', en: 'PMC dogtags (BEAR or USEC) of level 30 or higher, found in raid.' },
    },
    {
      id: ID.otherSide,
      trader: MECHANIC,
      name: { ru: 'На свет. Изнанка', en: 'To the Light - The Other Side' },
      after: [ID.gatherStones],
      experience: 65_000,
      objectives: [
        {
          type: 'plantItem', maps: ['reserve'], items: [BLUE_FOLDERS],
          requiredKeys: [['5d80c60f86f77440373c4ece', '5ede7a8229445733cb4c18e2', '5d80c62a86f7744036212b3f']],
          spots: [{ map: 'reserve', lockKey: '5d80c60f86f77440373c4ece' }, { map: 'reserve', lockKey: '5ede7a8229445733cb4c18e2' }, { map: 'reserve', lockKey: '5d80c62a86f7744036212b3f' }],
          text: { ru: 'Заложить документы компании TerraGroup в меченую комнату на локации Резерв', en: 'Stash the TerraGroup "Blue Folders" materials in any marked room on Reserve' },
        },
        {
          type: 'plantItem', maps: ['streets-of-tarkov'], items: [BLUE_FOLDERS],
          requiredKeys: [['63a3a93f8a56922e82001f5d', '64ccc25f95763a1ae376e447']],
          spots: [{ map: 'streets-of-tarkov', lockKey: '63a3a93f8a56922e82001f5d' }, { map: 'streets-of-tarkov', lockKey: '64ccc25f95763a1ae376e447' }],
          text: { ru: 'Заложить документы компании TerraGroup в меченую комнату на локации Улицы Таркова', en: 'Stash the TerraGroup "Blue Folders" materials in any marked room on Streets of Tarkov' },
        },
        {
          type: 'plantItem', maps: ['customs'], items: [BLUE_FOLDERS],
          requiredKeys: [['5780cf7f2459777de4559322']],
          spots: [{ map: 'customs', lockKey: '5780cf7f2459777de4559322' }],
          text: { ru: 'Заложить документы компании TerraGroup в меченую комнату на локации Таможня', en: 'Stash the TerraGroup "Blue Folders" materials in any marked room on Customs' },
        },
      ],
      rewards: [[ROUBLES, 300_000], ['5fc22d7c187fea44d52eda44', 1], ['5fc23426900b1d5091531e15', 3], ['657023ccbfc87b3a3409320a', 2]],
      standing: [[LIGHTKEEPER, 0.01]],
      note: {
        ru: 'Три папки «Документы компании TerraGroup» — по одной в меченую комнату на Резерве (РБ-БК, РБ-ПКПМ или РБ-ВО), Улицах Таркова (заброшенный завод или странная комната) и Таможне (комната 314 общежития). Ключ нужен один на локацию; папки можно купить, найти или сделать в Разведцентре 2-го уровня.',
        en: 'Three TerraGroup "Blue Folders" materials — one in a marked room each on Reserve (RB-BK, RB-PKPM or RB-VO), Streets of Tarkov (abandoned factory or mysterious room) and Customs (dorm room 314). One key per location; the folders can be bought, found or crafted in the Intelligence Center level 2.',
      },
    },
    {
      id: ID.gettingAcquainted,
      trader: MECHANIC,
      name: { ru: 'На свет. Новое знакомство', en: 'To the Light - Getting Acquainted' },
      // the same quest id was «Новое знакомство» (Getting Acquainted) before 1.1.5.0
      aliases: ['Новое знакомство', 'Getting Acquainted'],
      after: [ID.otherSide],
      experience: 32_000,
      objectives: [
        { type: 'findQuestItem', maps: ['lighthouse'], questItem: V3_FLASH_DRIVE, text: { ru: 'Раздобыть Флеш-накопитель V3 на локации Маяк', en: 'Obtain the V3 Flash drive on Lighthouse' } },
        { type: 'hideout', text: { ru: 'Перепрошить Радиопередатчик с помощью Флеш-накопителя V3', en: 'Reflash the Radio transmitter using the V3 Flash drive' } },
        { type: 'giveQuestItem', questItem: V3_FLASH_DRIVE, text: { ru: 'Передать флешку', en: 'Hand over the flash drive' } },
        { type: 'visit', maps: ['lighthouse'], text: { ru: 'Посетить здание Маяка', en: 'Visit the Lighthouse building' } },
      ],
      startRewards: [[DSP_TRANSMITTER, 1], ['6a8d581fe74010bf70069d83', 1], ['59fb023c86f7746d0d4b423c', 1]],
      craftUnlock: { itemId: DSP_TRANSMITTER, station: { ru: 'Разведцентр, ур. 2', en: 'Intelligence Center level 2' } },
      bring: [{ itemIds: [DSP_TRANSMITTER], count: 1, maps: ['lighthouse'], objective: 3 }],
      note: {
        ru: 'Флешка V3 лежит у шале на базе Отступников (верхнее и нижнее шале, коттеджи); перепрошивка — в Разведцентре 2-го уровня, при включённом электричестве. С перепрошитым радиопередатчиком в спецслоте Зрячий и мины на мосту пропускают к маяку; в группе он нужен у всех. Не стреляйте в Зрячего и не подходите к нему близко. После задания открывается Смотритель («Источник информации»).',
        en: 'The V3 flash drive lies around the chalets of the Rogue base (upper and lower chalet, cottages); the reflash is done in the Intelligence Center level 2 with power on. With the reflashed transmitter in the special slot, Zryachiy and the mines on the bridge let you through to the lighthouse; in a group everyone needs one. Do not aim at Zryachiy or come close to him. The task opens Lightkeeper (Information Source).',
      },
    },
  ],
}

/** Every curated series. */
export const CURATED_SERIES: readonly CuratedSeries[] = [TO_THE_LIGHT]

export interface CuratedTaskContext {
  mode: RaidMode
  locale: AppLocale
  /** tarkov.dev `<mode>/maps` (the places the objectives point at). */
  maps: JsonRecord
  /** tarkov.dev `<mode>/traders`: a quest is added only when the feed has its trader. */
  traders: JsonRecord
}

export interface CuratedTasks {
  /** The tasks file with the curated tasks it lacked. */
  tasks: JsonRecord
  /** Ids of the tasks added (tarkov.dev did not have them). */
  added: ReadonlySet<string>
}

/** The curated quests this mode has, with their series and their place in it (1-based). */
export function curatedQuestsFor(mode: RaidMode): Array<{ series: CuratedSeries; quest: CuratedQuest; order: number }> {
  return CURATED_SERIES.filter((series) => series.modes.includes(mode))
    .flatMap((series) => series.quests.map((quest, index) => ({ series, quest, order: index + 1 })))
}

/**
 * The tarkov.dev tasks file with the curated tasks it does not have, in tarkov.dev's shape and already in the catalog's
 * language. «Источник информации», which tarkov.dev lists without a previous task since the series' last task left its
 * data, gets that task as its previous one again (only while tarkov.dev gives it none).
 */
export function withCuratedTasks(tasksRoot: JsonRecord, context: CuratedTaskContext): CuratedTasks {
  const tasks = asRecord(tasksRoot.tasks)
  const traderIds = new Set(Object.values(context.traders).map((entry) => text(asRecord(entry).id)).filter(Boolean))
  const spots = spotIndex(context.maps)
  const added = new Set<string>()
  const next: JsonRecord = { ...tasks }
  for (const { quest } of curatedQuestsFor(context.mode)) {
    if (tasks[quest.id] || !traderIds.has(quest.trader)) continue
    next[quest.id] = rawTask(quest, context.locale, spots)
    added.add(quest.id)
  }
  const source = asRecord(next[INFORMATION_SOURCE])
  if (added.has(ID.gettingAcquainted) && Object.keys(source).length && !asArray(source.taskRequirements).length) {
    next[INFORMATION_SOURCE] = { ...source, taskRequirements: [{ task: ID.gettingAcquainted, status: ['complete'] }] }
  }
  return { tasks: added.size || next[INFORMATION_SOURCE] !== tasks[INFORMATION_SOURCE] ? { ...tasksRoot, tasks: next } : tasksRoot, added }
}

/**
 * What the task shape cannot carry, on the added quests: the curated description (how the quest opens, what to bring,
 * which points are missing), the other titles, the items to bring of `useAny` objectives, and the start rewards, the
 * standing and the craft the quest unlocks as reward lines.
 */
export function applyCuratedQuestNotes(quests: Quest[], added: ReadonlySet<string>, locale: AppLocale, items: Map<string, Item>): Quest[] {
  if (!added.size) return quests
  const curated = new Map(CURATED_SERIES.flatMap((series) => series.quests.map((quest, index) => [quest.id, { series, quest, order: index + 1 }] as const)))
  const itemName = (id: string) => items.get(id)?.name ?? id
  return quests.map((row) => {
    const entry = added.has(row.id) ? curated.get(row.id) : undefined
    if (!entry) return row
    const { series, quest, order } = entry
    const lead = locale === 'en'
      ? `${series.name.en} series (Mechanic → Lightkeeper), task ${order} of ${series.quests.length}.`
      : `Серия «${series.name.ru}» (Механик → Смотритель), задание ${order} из ${series.quests.length}.`
    const objectiveIds = row.objectiveIds ?? []
    const bring = (quest.bring ?? []).flatMap((need) => need.itemIds.map((itemId) => ({
      itemId,
      count: need.count,
      purpose: 'bring' as const,
      mapIds: need.maps,
      ...(objectiveIds[need.objective] ? { objectiveId: objectiveIds[need.objective] } : {}),
      ...(need.itemIds.length > 1 ? { alternatives: need.itemIds.length } : {}),
    })))
    const extraRewards = [
      ...(quest.standing ?? []).map(([traderId, value]) => locale === 'en'
        ? `${STANDING_NAMES[traderId]?.en ?? traderId} standing +${value}`
        : `Репутация у ${STANDING_NAMES[traderId]?.ru ?? traderId} +${String(value).replace('.', ',')}`),
      ...(quest.startRewards ?? []).map(([itemId, count]) => `${locale === 'en' ? 'On taking the task' : 'При взятии задания'}: ${itemName(itemId)} × ${count}`),
      ...(quest.craftUnlock ? [`${locale === 'en' ? 'Unlocks the craft' : 'Открывает крафт'}: ${itemName(quest.craftUnlock.itemId)} (${quest.craftUnlock.station[locale]})`] : []),
    ]
    const aliases = [...new Set([...(row.ocrAliases ?? []), ...(quest.aliases ?? [])])]
    return {
      ...row,
      description: `${lead} ${quest.note[locale]}`,
      ...(aliases.length ? { ocrAliases: aliases } : {}),
      rewards: [...row.rewards, ...extraRewards],
      raidRequirements: [...(row.raidRequirements ?? []), ...bring],
    }
  })
}

/** Coordinates of the places the curated objectives may point at, keyed `map|kind|id`. */
type SpotIndex = Map<string, JsonRecord>

function spotIndex(mapsRoot: JsonRecord): SpotIndex {
  const index: SpotIndex = new Map()
  for (const map of Object.values(asRecord(mapsRoot.maps)).map(asRecord)) {
    const name = text(map.normalizedName)
    if (!name) continue
    for (const transit of asArray(map.transits)) index.set(`${name}|transit|${text(transit.id)}`, transit)
    for (const extract of asArray(map.extracts)) index.set(`${name}|extract|${text(extract.id)}`, extract)
    for (const lock of asArray(map.locks)) if (text(lock.key)) index.set(`${name}|lock|${text(lock.key)}`, lock)
  }
  return index
}

function spotKey(spot: CuratedSpot) {
  if ('transit' in spot) return `${spot.map}|transit|${spot.transit}`
  if ('extract' in spot) return `${spot.map}|extract|${spot.extract}`
  return `${spot.map}|lock|${spot.lockKey}`
}

function spotZoneId(spot: CuratedSpot) {
  if ('transit' in spot) return `transit-${spot.transit}`
  if ('extract' in spot) return `extract-${spot.extract}`
  return `lock-${spot.lockKey}`
}

/** A zone of tarkov.dev's shape at the place, with its position, outline and heights exactly as the maps file has them. */
function zoneAt(spot: CuratedSpot, spots: SpotIndex): JsonRecord | undefined {
  const place = spots.get(spotKey(spot))
  const position = asRecord(place?.position)
  if (!place || typeof position.x !== 'number' || typeof position.z !== 'number') return undefined
  return {
    id: spotZoneId(spot),
    map: spot.map,
    position,
    ...(Array.isArray(place.outline) ? { outline: place.outline } : {}),
    ...(typeof place.top === 'number' ? { top: place.top } : {}),
    ...(typeof place.bottom === 'number' ? { bottom: place.bottom } : {}),
  }
}

function rawTask(quest: CuratedQuest, locale: AppLocale, spots: SpotIndex): JsonRecord {
  const items = (list: Array<[string, number]> = []) => list.map(([item, count]) => ({ item, count, attributes: {} }))
  return {
    id: quest.id,
    name: quest.name[locale],
    trader: quest.trader,
    minPlayerLevel: 0,
    taskRequirements: (quest.after ?? []).map((task) => ({ task, status: ['complete'] })),
    traderRequirements: (quest.loyalty ?? []).map(([trader, value]) => ({ trader, requirementType: 'level', compareMethod: '>=', value })),
    otherRequirements: quest.dialogue ? [{ type: 'dialogue', traders: [quest.trader] }] : [],
    objectives: quest.objectives.map((objective, index) => rawObjective(quest.id, index, objective, locale, spots)),
    failConditions: [],
    startRewards: { items: items(quest.startRewards), craftUnlock: quest.craftUnlock ? [{ items: [{ item: quest.craftUnlock.itemId, count: 1 }] }] : [] },
    finishRewards: {
      items: items(quest.rewards),
      traderStanding: (quest.standing ?? []).map(([trader, standing]) => ({ trader, standing })),
    },
    experience: quest.experience,
    factionName: 'Any',
    neededKeys: [],
    availableDelaySecondsMin: quest.delay?.[0] ?? 0,
    availableDelaySecondsMax: quest.delay?.[1] ?? 0,
    normalizedName: slug(quest.name.en),
    kappaRequired: false,
    lightkeeperRequired: false,
    map: null,
  }
}

function rawObjective(questId: string, index: number, objective: CuratedObjective, locale: AppLocale, spots: SpotIndex): JsonRecord {
  const zones = (objective.spots ?? []).map((spot) => zoneAt(spot, spots)).filter((zone): zone is JsonRecord => Boolean(zone))
  return {
    // The game's objective ids are not published; these are stable and never look like a game id.
    id: `${questId}-objective-${index + 1}`,
    type: objective.type,
    description: objective.text[locale],
    count: objective.count ?? 1,
    optional: objective.optional === true,
    maps: objective.maps ?? [],
    zones,
    ...(objective.items ? { items: objective.items, foundInRaid: objective.foundInRaid === true } : {}),
    ...(objective.dogTagLevel ? { dogTagLevel: objective.dogTagLevel } : {}),
    ...(objective.questItem ? { questItem: objective.questItem } : {}),
    ...(objective.requiredKeys ? { requiredKeys: objective.requiredKeys } : {}),
    ...(objective.useAny ? { useAny: objective.useAny, compareMethod: '>=' } : {}),
    ...(objective.exitName ? { exitName: objective.exitName, exitStatus: ['Survived', 'Runner'] } : {}),
    ...(objective.shoot ? {
      shotType: 'kill',
      targetNames: objective.shoot.targets,
      timeFromHour: objective.shoot.fromHour ?? 0,
      timeUntilHour: objective.shoot.untilHour ?? 0,
    } : {}),
  }
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
}

function asArray(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.map(asRecord) : []
}

function text(value: unknown) {
  return typeof value === 'string' ? value : ''
}
