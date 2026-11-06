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
 * Map points are not typed in here. An objective names a place of the tarkov.dev files of its mode: an extract, a transit
 * or a locked door of the maps file, or the zone of another tarkov.dev task that names the same place (the weather station
 * on the mountain, the tennis court at the chalets), and takes that place's coordinates at build time; a place the files do
 * not have gives no point. The exceptions are copied, never made up: `archived`, the zone tarkov.dev published for the same
 * objective of the same quest id before it dropped the quest (docs/quests/na-svet-audit.md names the copies it was read
 * from), a `floor`, the heights of a floor in tarkov.dev's map config, and a `point`, a place a public community map marks
 * for the quest, carried over to game coordinates by the exits both maps have (docs/quests/halloween-2026.md).
 */

type JsonRecord = Record<string, unknown>

export interface CuratedText { ru: string; en: string }
type Text = CuratedText

/**
 * A place by the map's normalizedName and a key the translation leaves alone: in the tarkov.dev maps file (`<mode>/maps`)
 * a transit's id, an extract's id (its `name` is translated) or a locked door's key; in the tasks file (`<mode>/tasks`) a
 * zone of another task (`taskZone`: that task's id and the zone's id); `archived`: a zone the current files no longer
 * have (see the header).
 *
 * `building`: the place is only the building the objective is in (another room of it, an extract in its basement), so the
 * point keeps the position and drops that room's outline and heights. `floor` (with `building`): the floor the objective is
 * on, as the [bottom, top] heights of that floor in tarkov.dev's map config; the point then has no height of its own.
 */
type CuratedPlace =
  | { map: string; transit: string }
  | { map: string; extract: string }
  | { map: string; lockKey: string }
  | { map: string; taskZone: { task: string; zone: string } }
  | { map: string; archived: ArchivedZone }
  | { map: string; point: MarkedPoint }

export type CuratedSpot = CuratedPlace & { building?: boolean; floor?: [bottom: number, top: number] }

/** A place a community map marks (game coordinates, no height); `id` names the marker it came from. */
export interface MarkedPoint { id: string; x: number; z: number }

/** A zone of tarkov.dev's shape (game coordinates) as tarkov.dev published it. */
export interface ArchivedZone {
  id: string
  position: { x: number; y: number; z: number }
  outline?: Array<{ x: number; y: number; z: number }>
  top?: number
  bottom?: number
}

export interface CuratedObjective {
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

export interface CuratedQuest {
  /** The game's quest id (the id in the game's log notifications). */
  id: string
  trader: string
  name: Text
  /** Other titles of the same quest: the community sites' variants and earlier in-game titles. */
  aliases?: string[]
  /** Previous quests (complete), in the game's order of the series. */
  after?: string[]
  /** Quests that only need to be taken (active or complete), e.g. a side task given on accepting another one. */
  afterAccepted?: string[]
  /** Quests of a choice that must be over either way (complete, or failed by the other side's quest). */
  afterDecided?: string[]
  /** The game's other ids of the same quest (a choice quest given under another id on the other branch): their log lines count here. */
  otherIds?: string[]
  experience: number
  objectives: CuratedObjective[]
  /** Items given on completion (tarkov.dev `finishRewards.items`). */
  rewards?: Array<[itemId: string, count: number]>
  /** A mode's own `rewards`, where it gives other items than the rest («Позывной "Малахит"» in Season). */
  modeRewards?: Partial<Record<RaidMode, Array<[itemId: string, count: number]>>>
  /** Items given when the quest is taken (tarkov.dev `startRewards.items`). */
  startRewards?: Array<[itemId: string, count: number]>
  standing?: Array<[traderId: string, value: number]>
  /** Pictures of where to look: files of src/assets/quest-guides (the owner's in-game screenshots) and their captions. */
  guideImages?: Array<{ file: string; caption: Text }>
  /** Skill rewards as the game's reward line names them («Здоровье +1 уровень»). */
  skills?: Text[]
  /** Reward lines the item list cannot carry: a branch's own rewards of a choice quest, an achievement. */
  rewardNotes?: Text[]
  craftUnlock?: { itemId: string; station: Text }
  /** Trader loyalty levels needed to get the quest. */
  loyalty?: Array<[traderId: string, level: number]>
  /** Given in a trader dialogue (tarkov.dev `otherRequirements` type dialogue). */
  dialogue?: boolean
  /** Opens at something the app cannot see (a stage of a story chapter): held back as «откроется в игре» until the logs show it. */
  opensInGame?: boolean
  /** Seconds after the previous quest before this one appears (min, max). */
  delay?: [number, number]
  /** Items to bring that the task data cannot name (the transponder); a flare of `useAny` comes with its objective. */
  bring?: Array<{ itemIds: string[]; count: number; maps: string[]; objective: number }>
  /**
   * The quest's description in the app: how it opens, what to do, tips. Player-facing: no source names and no notes about
   * the data (those belong in docs/quests/na-svet-audit.md).
   */
  note: Text
  /** The modes the quest is in, when not every mode of its series (the owner's event quests, src/data/eventQuestDefinitions.ts). */
  modes?: readonly RaidMode[]
  /** ISO time the event ends: from then on the app leaves the quest out (default: the series' `endsAt`). */
  endsAt?: string
  /** Switched off by the owner: left out everywhere. */
  hidden?: boolean
}

export interface CuratedSeries {
  id: string
  name: Text
  /** Who gives the series, or what it belongs to, for the lead of every quest's description. */
  route: Text
  gameVersion: string
  checkedAt: string
  modes: readonly RaidMode[]
  sources: readonly string[]
  quests: readonly CuratedQuest[]
  /** An in-game event (the owner edits its quests in «Ивент-квесты», src/components/EventQuestsEditor.tsx). */
  event?: boolean
  /** ISO time the event ends: its quests are left out from then on (a quest's own `endsAt` comes first). */
  endsAt?: string
}

const PRAPOR = '54cb50c76803fa8b248b4571'
const THERAPIST = '54cb57776803fa99248b456e'
const SKIER = '58330581ace78e27b8b10cee'
const PEACEKEEPER = '5935c25fb3acc3127c3d8cd9'
const MECHANIC = '5a7c2eca46aef81a7ca2145d'
const RAGMAN = '5ac3b934156ae10c4430e83c'
const JAEGER = '5c0647fdd443bc2504c2d371'
const LIGHTKEEPER = '638f541a29ffd1183d187f57'
const BTR_DRIVER = '656f0f98d80a697f855d34b1'
/** «Рука помощи» (Mechanic): taking it opens the BTR Driver's quests. */
const A_HELPING_HAND = '6752f6d83038f7df520c83e8'

const ROUBLES = '5449016a4bdc2d6f028b456f'
const DOLLARS = '5696686a4bdc2da3298b456a'
const EUROS = '569668774bdc2da2298b4568'
const SIGNAL_JAMMER = '5ac78a9b86f7741cca0bbd8d'
const WIFI_CAMERA = '5b4391a586f7745321235ab2'
const RSP_YELLOW = '624c0b3340357b5f566e8766'
const FLARE_26X75_YELLOW = '62389be94d5d474bf712e709'
const BLUE_FOLDERS = '6389c8c5dbfd5e4b95197e6b'
const DSP_TRANSMITTER = '62e910aaf957f2915e0a5e36'
const LIGHTHOUSE_STASH_KEY = '6a8d581fe74010bf70069d83'
const WEAPON_CASE = '59fb023c86f7746d0d4b423c'
const V3_FLASH_DRIVE = '6331bb0d1aa9f42b804997a6'
const DOGTAG_BEAR = '59f32bb586f774757e1e8442'
const DOGTAG_USEC = '59f32c3b86f77472a31742f0'
const SVDS = '5c46fbd72e2216398b5a8c9c'
const SVD_MAG_10 = '5c471c442e221602b542a6f8'
const PS_GZH_PACK_20 = '6570257cc5d7d4cb4d078579'
const ELECTRONIC_COMPONENTS = '6389c70ca33d8c4cdf4932c6'
const MILITARY_CABLE = '5d0375ff86f774186372f685'
const CAPACITORS = '5c06782b86f77426df5407d2'
const RIG_6B45_MEDIC = '68948aebd8f2b85fb705e2b0'
const RSP_RED = '62178c4d4ecf221597654e3d'
const FLARE_26X75_RED = '62389ba9a63f32501b1b4451'
const GRENADE_CASE = '5e2af55f86f7746d4159f07c'
const AS_VAL = '57c44b372459772d2b39b8ce'
const VAL_MAG_6L25 = '57838f9f2459774a150289a0'
const PAB9_PACK_20 = '657025cfbfc87b3a34093253'
/** S.I. Tretyakov's personnel file: the game's id (the wiki's item page); tarkov.dev's quest items do not have it. */
const TRETYAKOV_FILE = '6a8c6ff9795e10dd8c01d2ba'
const MASKA_SHIELD_OD = '5c0919b50db834001b7ce3b9'
const MASKA_HELMET_OD = '5c091a4e0db834001d5addc8'
const LSHZ_SHIELD = '5d6d3829a4b9361bc8618943'
const LSHZ_HELMET_BLACK = '5d6d3716a4b9361bc8618872'
/** «Бронепоезд» on Lighthouse: the extract's id in the maps file. */
const ARMORED_TRAIN_EXIT = 'cc16b27f07697867c3afe8731a5323f8b6db7574'
const KIRASA_N = '5b44d22286f774172b0c9de8'
const KIRASA_N_GREEN = '67ab2f28dafe3b22670c9116'
const THOR_CRV = '609e8540d5c319764c2bc2e9'
const THOR_CRV_HEAD_EYES = '68a89146212dbbeead0d5636'
const PROFLEX_DX5 = '69413241b1ce1e5fbb09ed0a'
const NL545_GP = '68c2940aecc41cc5490bd40e'
const PMAG_545_FDE = '68d566b2aa07af2e14059e01'
const AMMO_7N40_120 = '6570900858b315e8b70a8a98'
const SICC = '5d235bb686f77443f4331278'
const BITCOIN = '59faff1d86f7746c51718c9c'
const MS2000 = '5991b51486f77447b112d44f'
const MCX_SPEAR = '65290f395ae2ae97b80fdf2d'
const L7AWM_MAG_20 = '65293c38fc460e50a509cb25'
const SIG_FMJ_PACK_20 = '67600a42b32eb5d23e0eb459'
const SUBSTATION_MARKED_KEY = '62987dfc402c7f69bf010923'
const VPX_STORAGE = '5c05300686f7746dce784e5d'
const VIRTEX = '5c05308086f7746b2101e90b'
const MILITARY_FLASH_DRIVE = '62a0a16d0b9d3c46de5b6e97'
const PIPE_GRIP_WRENCH = '619cbfccbedcde2f5b3f7bdd'
const RATCHET_WRENCH = '60391afc25aff57af81f7085'
const ELECTRIC_DRILL = '59e35de086f7741778269d84'
const SUDAK_TUDAK_KIT = '6a8c4c7999baf8bd5802f7fe'

/** Traders of the standing rewards, as the reward lines name them. */
const STANDING_NAMES: Record<string, Text> = { [LIGHTKEEPER]: { ru: 'Смотрителя', en: 'Lightkeeper' } }

/** «Источник информации» (Lightkeeper): the first task after the series. */
const INFORMATION_SOURCE = '63966faeea19ac7ed845db2c'

/**
 * tarkov.dev tasks whose zones are the same places as objectives of the series (in all three modes' tasks files,
 * 15.10.2026; docs/quests/na-svet-audit.md says how each place was matched).
 */
export const PLACE_SOURCE_TASKS = {
  /** «Устойчивый сигнал» (Steady Signal): «Mark any of the weather stations»; zone q14_8_2 is the one on the mountain. */
  steadySignal: '6578ec473dbd035d04531a8d',
  /** «Водохлёб. Курьер» (Thirsty - Delivery): its Customs stash spot is in the store at the crossroads. */
  thirstyDelivery: '665eec4a4dfc83b0ed0a9dca',
  /** «Деза» (Bullshit): «the trash bags at the chalet tennis court on Lighthouse». */
  bullshit: '5c0bbaa886f7746941031d82',
  /** «Инвазивная терапия» (Invasive Therapy): «the med bay at the upper Rogue chalet on Lighthouse». */
  invasiveTherapy: '6a7ae35b2dbf91eb050af95a',
} as const

/**
 * «Посетить здание Маяка» of this same quest id (objective 63ab727b1287ef0b827d0c95) as tarkov.dev published it until it
 * dropped the quest (copies of json.tarkov.dev/regular/tasks of 26 and 28.08.2026).
 */
const LIGHTHOUSE_BUILDING: ArchivedZone = {
  id: '63ab727b1287ef0b827d0c95-z0',
  position: { x: 442.2326, y: 24.1148987, z: 460.690674 },
  outline: [
    { x: 429.8051, y: 24.1148987, z: 447.883179 },
    { x: 454.6601, y: 24.1148987, z: 447.883179 },
    { x: 454.6601, y: 24.1148987, z: 473.498169 },
    { x: 429.8051, y: 24.1148987, z: 473.498169 },
  ],
  top: 29.9708977,
  bottom: 18.2589,
}

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
  route: { ru: 'Механик → Смотритель', en: 'Mechanic → Lightkeeper' },
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
    'json.tarkov.dev <mode>/tasks (zones of other tasks at the same places)',
    'json.tarkov.dev regular/tasks before 09.2026, copies of 26 and 28.08.2026 (the lighthouse building zone)',
    'tarkov.dev src/data/maps.json (floor heights)',
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
        {
          type: 'plantItem', maps: ['customs'], items: [WIFI_CAMERA],
          // the store itself: the camera goes on its AC unit, Thirsty's stash spot is in its back room
          spots: [{ map: 'customs', taskZone: { task: PLACE_SOURCE_TASKS.thirstyDelivery, zone: 'place_2A2_unlock_3_customs' }, building: true }],
          text: { ru: 'Спрятать Wi-Fi камеру у кондиционера на точке явки в магазине «Местный» на перекрёстке на локации Таможня (В одном рейде)', en: 'Hide a Wi-Fi camera at the AC unit at the convenience store near the bridge on Customs (In one raid)' },
        },
        { type: 'useItem', maps: ['customs'], useAny: [RSP_YELLOW, FLARE_26X75_YELLOW], spots: [{ map: 'customs', transit: '42' }], text: { ru: 'Подать сигнал РСП (Жёлтый) у перехода на локацию Берег (В одном рейде)', en: 'Launch a yellow signal flare at the Shoreline transit on Customs (In one raid)' } },
      ],
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
        {
          type: 'plantItem', maps: ['woods'], items: [SIGNAL_JAMMER],
          // the weather station on the summit (the highest point of Woods)
          spots: [{ map: 'woods', taskZone: { task: PLACE_SOURCE_TASKS.steadySignal, zone: 'q14_8_2' } }],
          text: { ru: 'Установить подавитель сигналов в метеовышку в горах на локации Лес (В одном рейде)', en: 'Plant a Signal jammer at the weather station on the mountain on Woods (In one raid)' },
        },
        { type: 'plantItem', maps: ['woods'], items: [SIGNAL_JAMMER], text: { ru: 'Установить подавитель сигналов в сторожевой будке на лесопилке на локации Лес (В одном рейде)', en: 'Plant a Signal jammer at the sawmill guardhouse on Woods (In one raid)' } },
        { type: 'transit', maps: ['woods'], spots: [{ map: 'woods', transit: '41' }], text: { ru: 'Совершить переход с локации Лес на локацию Таможня (В одном рейде)', en: 'Use the transit from Woods to Customs (In one raid)' } },
        { type: 'plantItem', maps: ['customs'], items: [SIGNAL_JAMMER], text: { ru: 'Установить подавитель сигналов на втором этаже стройки у дороги на локации Таможня (В одном рейде)', en: 'Plant a Signal jammer on the second floor of the roadside construction site on Customs (In one raid)' } },
        { type: 'transit', maps: ['customs'], spots: [{ map: 'customs', transit: '42' }], text: { ru: 'Совершить переход с локации Таможня на локацию Берег (В одном рейде)', en: 'Use the transit from Customs to Shoreline (In one raid)' } },
        {
          type: 'plantItem', maps: ['shoreline'], items: [SIGNAL_JAMMER],
          // the admin building (its basement extract «Adm Basement»), 2nd floor: tarkov.dev's Shoreline «2nd Floor» heights
          spots: [{ map: 'shoreline', extract: '3475b9df1bf661d3c746ff1a1a8493bae828b939', building: true, floor: [-1, 2] }],
          text: { ru: 'Установить подавитель сигналов в архиве на 2 этаже административного корпуса санатория на локации Берег (В одном рейде)', en: 'Plant a Signal jammer at the second floor archives in the Health Resort admin building on Shoreline (In one raid)' },
        },
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
        {
          type: 'findQuestItem', maps: ['lighthouse'], questItem: V3_FLASH_DRIVE,
          spots: [
            // the upper (black) Rogue chalet: laptops on the dining table and in the basement
            { map: 'lighthouse', taskZone: { task: PLACE_SOURCE_TASKS.invasiveTherapy, zone: 'terapevt_tier_03_group_03_quest_03_01' }, building: true },
            // the tennis court at the chalets: a laptop in the tent
            { map: 'lighthouse', taskZone: { task: PLACE_SOURCE_TASKS.bullshit, zone: 'lighthouse_place_bullshit' } },
          ],
          text: { ru: 'Раздобыть флеш-накопитель V3 на локации Маяк', en: 'Obtain the V3 Flash drive on Lighthouse' },
        },
        { type: 'hideout', text: { ru: 'Перепрошить радиопередатчик с помощью флеш-накопителя V3', en: 'Reflash the Radio transmitter using the V3 Flash drive' } },
        { type: 'giveQuestItem', questItem: V3_FLASH_DRIVE, text: { ru: 'Передать флешку', en: 'Hand over the flash drive' } },
        {
          type: 'visit', maps: ['lighthouse'],
          spots: [{ map: 'lighthouse', archived: LIGHTHOUSE_BUILDING }],
          text: { ru: 'Посетить здание Маяка', en: 'Visit the Lighthouse building' },
        },
      ],
      startRewards: [[DSP_TRANSMITTER, 1], [LIGHTHOUSE_STASH_KEY, 1], [WEAPON_CASE, 1]],
      craftUnlock: { itemId: DSP_TRANSMITTER, station: { ru: 'Разведцентр, ур. 2', en: 'Intelligence Center level 2' } },
      bring: [{ itemIds: [DSP_TRANSMITTER], count: 1, maps: ['lighthouse'], objective: 3 }],
      note: {
        ru: 'Радиопередатчик, ключ от схрона на Маяке и оружейный кейс выдаются при взятии задания. Флешка V3 — на базе Отступников у шале: на ноутбуке на обеденном столе на первом этаже верхнего (чёрного) шале, на ноутбуке в его подвале и на ноутбуке в палатке у теннисного корта; ищите у ноутбуков, раций и аппаратуры. Базу Отступников придётся зачистить или дождаться, пока это сделают другие. Перепрошивка — в Разведцентре 2-го уровня; электричество нужно на всё время, иначе она прервётся. Перепрошитый радиопередатчик — в спецслот; перед мостом проверьте, что индикатор зелёный. С ним мины на мосту и Зрячий пропускают к маяку; в группе он нужен у всех, иначе мост не пройти. Не стреляйте в Зрячего, не целитесь в него и не подходите близко; не убивайте ЧВК на полуострове маяка — передатчик заблокируется. Убийство Зрячего проваливает задание. После него открывается Смотритель («Источник информации»).',
        en: 'The radio transmitter, the Lighthouse island stash key and a weapon case come with the task. The V3 flash drive is at the Rogue base by the chalets: on the laptop on the dining table on the ground floor of the upper (black) chalet, on the laptop in its basement and on the laptop in the tent at the tennis court; look by laptops, radios and equipment. The Rogue base has to be cleared, by you or by someone else first. The reflash is done in the Intelligence Center level 2; it needs power the whole time or it is interrupted. Put the reflashed transmitter in the special slot and check that its light is green before the bridge. With it the mines on the bridge and Zryachiy let you through to the lighthouse; in a group everyone needs one or the bridge cannot be crossed. Do not shoot or aim at Zryachiy or come close to him, and do not kill PMCs on the lighthouse peninsula: the transmitter gets blocked. Killing Zryachiy fails the task. It opens Lightkeeper (Information Source).',
      },
    },
  ],
}

export const SCOURGE_QUEST_IDS = {
  hiddenRoute: 'raidos-scourge-hidden-route',
  simpleTask: 'raidos-scourge-simple-task',
  coordination: 'raidos-scourge-coordination',
  informationTrail: 'raidos-scourge-information-trail',
  soulJob: 'raidos-scourge-soul-job',
  deanon: 'raidos-scourge-deanon',
} as const

const MECHANIC_ID = MECHANIC
const LABS_ACCESS = '5c94bbff86f7747ee735c08f'

/**
 * «Вторжение Scourge» (owner, 16.10.2026): the event chain about Ref's operation in the Lab, from the owner's in-game
 * screenshots (objectives, start gear, rewards). The game's quest ids are not published yet, so the ids are our own
 * (they never match a log line: the status comes from the screen reader by the title) and the quests step aside as
 * soon as tarkov.dev lists a quest of the same title. The trader is not on the screenshots: Therapist, by the way the
 * texts speak («Добрый день, молодой человек»).
 */
export const SCOURGE_INVASION: CuratedSeries = {
  id: 'scourge-invasion',
  name: { ru: 'Вторжение Scourge', en: 'Scourge Invasion' },
  route: { ru: 'ивент до 26 октября', en: 'event until 26 October' },
  event: true,
  // the game ends the event on 26 October 2026, 10:00 Moscow (extended from 20 October) (src/events/scourgeEvent.ts `SCOURGE_EVENT_END`)
  endsAt: '2026-10-26T07:00:00.000Z',
  gameVersion: 'event 10.2026',
  checkedAt: '2026-10-16',
  // the event runs in every mode (owner, 16.10.2026: «он спавнится во всех режимах»)
  modes: ['pvp', 'pve', 'seasonal'],
  sources: ['the owner\'s in-game screenshots of both tasks (16.10.2026)', 'json.tarkov.dev regular/maps (Factory transit 14 to the Lab)'],
  quests: [
    {
      id: SCOURGE_QUEST_IDS.hiddenRoute,
      trader: THERAPIST,
      name: { ru: 'Скрытый маршрут', en: 'Hidden Route' },
      experience: 15_000,
      objectives: [
        {
          type: 'visit', maps: ['factory'],
          spots: [{ map: 'factory', transit: '14' }],
          text: { ru: 'Найти место перехода с локации Завод на локацию Лаборатория', en: 'Find the transit from Factory to The Lab' },
        },
      ],
      rewards: [[ROUBLES, 299_875], ['5af0548586f7743a532b7e99', 2], ['5d02778e86f774203e7dedbe', 2], ['5d02797c86f774203f38e30a', 1], ['590c657e86f77412b013051d', 2]],
      skills: [{ ru: 'Хирургия +1 уровень', en: 'Surgery +1 level' }],
      note: {
        ru: 'Наёмники Рефа ушли с Завода в сторону Лаборатории по подземным коммуникациям. Найдите на Заводе место перехода в Лабораторию.',
        en: 'Ref’s mercenaries left Factory for the Lab through the underground passages. Find the transit to the Lab on Factory.',
      },
    },
    {
      id: SCOURGE_QUEST_IDS.simpleTask,
      trader: THERAPIST,
      name: { ru: 'Простая задача в непростом месте', en: 'A Simple Task in a Difficult Place' },
      after: [SCOURGE_QUEST_IDS.hiddenRoute],
      experience: 18_000,
      objectives: [{ type: 'extract', maps: ['the-lab'], text: { ru: 'Выжить и выйти с локации Лаборатория', en: 'Survive and extract from The Lab' } }],
      startRewards: [['5c94bbff86f7747ee735c08f', 1]],
      rewards: [[ROUBLES, 368_550], ['5c0e533786f7747fa23f4d47', 3], ['5c0e530286f7747fa1419862', 3], ['5751a89d24597722aa0e8db0', 2]],
      skills: [{ ru: 'Здоровье +1 уровень', en: 'Health +1 level' }],
      note: {
        ru: 'Ключ-карта доступа в Лабораторию выдаётся при взятии задания. В Лаборатории в каждом рейде — гладиатор Scourge с охраной из четырёх человек (Оружейная или Зелёный офис).',
        en: 'The Labs access keycard comes with the task. Every Lab raid has the gladiator Scourge with four guards (the Armory or the Green Office).',
      },
    },
    {
      id: SCOURGE_QUEST_IDS.coordination,
      trader: THERAPIST,
      // «???» until the owner's screenshot of its title (16.10.2026): «Продление операции»
      name: { ru: 'Продление операции', en: 'Extending the Operation' },
      after: [SCOURGE_QUEST_IDS.simpleTask],
      experience: 28_000,
      objectives: [{ type: 'shoot', count: 6, maps: ['the-lab'], shoot: { targets: ['Any'] }, text: { ru: 'Устранить любую цель на локации Лаборатория', en: 'Eliminate any target in The Lab' } }],
      startRewards: [['5c94bbff86f7747ee735c08f', 3]],
      rewards: [['5c1d0d6d86f7744bb2683e1f', 1], ['5c1e495a86f7743109743dfb', 1], ['5c1d0c5f86f7744bb2683cf0', 1]],
      skills: [{ ru: 'Хирургия +1 уровень', en: 'Surgery +1 level' }],
      note: {
        ru: 'Отрядом Рефа командует гладиатор с позывным Scourge — ветеран Арены, в Таркове был в составе USEC. Прямое столкновение может их спугнуть: достаточно нарушить их координацию — устранить в Лаборатории шесть любых целей (Диких, Рейдеров, ЧВК или охрану Scourge). Три ключ-карты доступа выдаются при взятии задания; в награду — жёлтая, фиолетовая и синяя ключ-карты. Засчитываются любые боты и ЧВК.',
        en: 'Ref’s squad is led by a gladiator called Scourge, an Arena veteran who was with USEC in Tarkov. A head-on fight may scare them off: it is enough to disrupt their coordination by eliminating any six targets in the Lab (Scavs, Raiders, PMCs or Scourge’s guards). Three Labs access keycards come with the task; the reward is the yellow, violet and blue keycards. Any bots and PMCs count.',
      },
    },
    {
      id: SCOURGE_QUEST_IDS.informationTrail,
      trader: THERAPIST,
      name: { ru: 'Информационный след', en: 'Information Trail' },
      after: [SCOURGE_QUEST_IDS.coordination],
      experience: 28_000,
      objectives: [
        { type: 'findQuestItem', maps: ['the-lab'], text: { ru: 'Найти Смартфон Scourge', en: 'Find Scourge’s smartphone' } },
        { type: 'extract', maps: ['the-lab'], text: { ru: 'Выжить и выйти с локации Лаборатория', en: 'Survive and extract from The Lab' } },
        { type: 'giveQuestItem', text: { ru: 'Передать найденный предмет', en: 'Hand over the found item' } },
      ],
      startRewards: [[LABS_ACCESS, 1]],
      rewards: [['5c1d0dc586f7744baf2e7b79', 1], ['5c1d0f4986f7744bb01837fa', 1]],
      skills: [{ ru: 'Здоровье +1 уровень', en: 'Health +1 level' }],
      note: {
        ru: 'Смартфон спавнится в карманах босса Scourge: его нужно убить, забрать смартфон, выжить и выйти. После принятия задания Механик даёт побочное задание «Деанон».',
        en: 'The smartphone spawns in the boss Scourge’s pockets: kill him, take it, survive and extract. Accepting this task makes Mechanic give the side task «Deanon».',
      },
    },
    {
      id: SCOURGE_QUEST_IDS.deanon,
      trader: MECHANIC_ID,
      name: { ru: 'Деанон', en: 'Deanon' },
      afterAccepted: [SCOURGE_QUEST_IDS.informationTrail],
      experience: 28_000,
      objectives: [
        { type: 'findQuestItem', maps: ['ground-zero'], text: { ru: 'Найти SSD-диск с данными для отправлений на локации Эпицентр', en: 'Find the SSD drive with the shipment data in Ground Zero' } },
        { type: 'giveQuestItem', text: { ru: 'Передать найденный предмет', en: 'Hand over the found item' } },
      ],
      rewards: [[ROUBLES, 322_850], ['5dcbd56fdbd3d91b3e5468d5', 1], ['6570254fcfc010a0f5006a22', 4], ['618ba27d9008e4636a67f61d', 1]],
      note: {
        ru: 'Побочное задание Механика, даётся после принятия «Информационного следа» и подсказывает, где искать посылку с прекурсорами. SSD — на 2-м этаже главного офиса TerraGroup в опенспейсе с кухней, на красном системном блоке под столом; у предмета может быть несколько спавнов.',
        en: 'Mechanic’s side task, given after accepting «Information Trail»; it hints where to look for the precursor parcel. The SSD is on the 2nd floor of the TerraGroup head office, in the open space with the kitchen, on the red PC under a desk; the item may have several spawns.',
      },
    },
    {
      id: SCOURGE_QUEST_IDS.soulJob,
      trader: THERAPIST,
      name: { ru: 'Подработка для души', en: 'A Job for the Soul' },
      after: [SCOURGE_QUEST_IDS.informationTrail],
      experience: 65_000,
      objectives: [
        { type: 'shoot', count: 3, maps: ['the-lab'], shoot: { targets: ['Any'] }, text: { ru: 'Устранить гладиаторов Рефа на локации Лаборатория', en: 'Eliminate Ref’s gladiators in The Lab' } },
        { type: 'findQuestItem', maps: ['streets-of-tarkov', 'the-lab'], text: { ru: 'Найти прекурсоры', en: 'Find the precursors' } },
        { type: 'findQuestItem', optional: true, maps: ['streets-of-tarkov', 'the-lab'], text: { ru: '(опционально) Найти кейс или коробку с прекурсорами', en: '(Optional) Find a case or box with precursors' } },
        { type: 'giveQuestItem', text: { ru: 'Передать найденный груз', en: 'Hand over the found cargo' } },
      ],
      startRewards: [[LABS_ACCESS, 1]],
      rewards: [[ROUBLES, 587_000], ['5aafbcd986f7745e590fff23', 1], ['59fb042886f7746c5005a7b2', 1]],
      guideImages: [
        { file: 'scourge-precursor-box.webp', caption: { ru: 'Коробка с прекурсорами («Коробка») — Улицы Таркова, отделение «Почты Руси»', en: 'The precursor box («Box»): Streets of Tarkov, the Russian Post office' } },
        { file: 'scourge-precursor.webp', caption: { ru: 'Прекурсор (Precursor) — квестовый предмет из посылки', en: 'Precursor: the quest item from the parcel' } },
      ],
      skills: [{ ru: 'Здоровье +1 уровень', en: 'Health +1 level' }, { ru: 'Хирургия +1 уровень', en: 'Surgery +1 level' }],
      note: {
        ru: 'Убийства гладиаторов засчитываются всей группе. Груз с прекурсорами — в одной из комнат отделения «Почты Руси» на Улицах Таркова (там, где спавнится кассета сюжета «Синий огонь»): посылку нужно вынести с локации и открыть в схроне — из неё выпадет квестовый предмет для сдачи. Кейс с прекурсорами можно найти и в Лаборатории под котами. Это последнее задание цепочки; достижения за ивент нет.',
        en: 'Gladiator kills count for the whole group. The precursor cargo is in a room of the Russian Post office on Streets of Tarkov (where the «Blue Fire» story cassette spawns): extract with the parcel and open it in the stash to get the quest item to hand over. A precursor case can also be found in the Lab under the cats. This is the last task of the chain; there is no achievement for the event.',
      },
    },
  ],
}

export const BALANCE_SHIFT_QUEST_IDS = {
  fogOfWar: 'raidos-balance-fog-of-war',
  numberUnavailable: '6a763a2fce9a947b4d0918a6',
  allInclusive: '6a763c7bd31fb1191903fc15',
  loseTheTail: '6a76422ae432ba0a190a7fe4',
  callsignMalachite: '6a764367850f975dc00bc5bd',
  familiarFace: '6a763df2161e4b45b1015663',
  scopeTheClearing: '6a763f35ce9a947b4d0918b6',
  cutDownToTheRoot: '6a76466e752258ce02073d07',
  easeTheMove: '6a764462e432ba0a190a7fe9',
  preserveValuablePiece: '6a885ad91006f9d30a0ed61b',
} as const

export const LIGHTHOUSE_BTR_QUEST_IDS = {
  honestReview: '6a764077161e4b45b101566e',
  btrMyself: '6a76457a80a94c0cbf0b07ae',
} as const

/** The game's id of «Туман войны» (the game's log, 11.09.2026): the quest keeps our own id, its log lines count here. */
const FOG_OF_WAR_GAME_ID = '6a7637fed31fb1191903fc07'

const LIGHTHOUSE = ['lighthouse']
const lighthousePoint = (id: string, x: number, z: number): CuratedSpot => ({ map: 'lighthouse', point: { id: `lh-${id}`, x, z } })

/**
 * Places of the series on Lighthouse (docs/quests/lighthouse-balance-shift.md): the marks of the public Lighthouse pictures
 * of each quest, carried over to game metres by the map's door padlocks (9 doors and trunks, 1.6 m off on average, north of
 * the mountain pass) and checked on our own map, where each lies on what its objective names. The camp lies further south,
 * where the same fit is up to some 25 m off. No heights: the pictures have none.
 */
const LIGHTHOUSE_SPOTS = {
  brdm: [lighthousePoint('fog-brdm', -67.1, -695.8)],
  towerCheckpoint: [lighthousePoint('fog-checkpoint', 22.6, -450.8)],
  plantRoofs: [lighthousePoint('wtp-roof-1', 41.0, -624.5), lighthousePoint('wtp-roof-2', -97.3, -741.4), lighthousePoint('wtp-roof-3', -186.2, -666.1)],
  praporCamp: [lighthousePoint('prapor-camp', -54.1, 446.7)],
  lakeCabin: [lighthousePoint('lake-cabin', -370.2, -624.5)],
  platformSouth: [lighthousePoint('platform-south', 6.7, -851.6)],
  platformNorth: [lighthousePoint('platform-north', 7.9, -892.3)],
  woodsTransit: [lighthousePoint('woods-transit', 97.8, -936.3)],
  villageStashes: [lighthousePoint('stash-1-1', -35.9, -384.4), lighthousePoint('stash-1-2', -156.6, -380.9), lighthousePoint('stash-1-3', -301.0, -217.4)],
  farStashes: [lighthousePoint('stash-2-1', -413.4, -276.4), lighthousePoint('stash-2-2', -429.8, -327.2)],
  grottoStash: [lighthousePoint('stash-grotto', 182.4, -489.4)],
  // the same places as the map's BTR stops (src/data/mapMarkerAdapter.ts APPROXIMATE_BTR_STOPS)
  stopVillage: [lighthousePoint('btr-village', -195, -243)],
  stopUn: [lighthousePoint('btr-un', 17, 117)],
  stopPlantParking: [lighthousePoint('btr-wtp-2', -165, -748)],
} satisfies Record<string, CuratedSpot[]>

/**
 * «Смещение баланса» (event of 8.09.2026): what game version 1.1.5.0 brought to Lighthouse after the smugglers drove the Rogues
 * out of the water treatment plant. tarkov.dev lists none of it in any mode. Two lines: Prapor's («Туман войны» …
 * «Позывной "Малахит"»), and Skier's («Знакомое лицо...», «Сечь поляну») with what follows it at Jaeger, Peacekeeper and
 * Lightkeeper. The sources disagree on the order and the game's log settles part of it: a Season character took
 * «Знакомое лицо...» minutes after handing in Prapor's first quest (31.10.2026), so Prapor's line cannot be what opens it.
 * docs/quests/lighthouse-balance-shift.md gives the sources, each one's order and why this one. Ids: the game's, from the
 * Russian wiki's pages (`node`), «Знакомое лицо...» and «Туман войны» also from the game's log; «Туман войны» keeps the
 * own id it had. Rewards are the base amounts, without the Intelligence Center bonus.
 */
export const BALANCE_SHIFT: CuratedSeries = {
  id: 'balance-shift',
  name: { ru: 'Смещение баланса', en: 'Balance Shift' },
  route: { ru: 'временный ивент', en: 'temporary event' },
  event: true,
  gameVersion: '1.1.5.0.47242',
  checkedAt: '2026-11-06',
  modes: ['pvp', 'pve', 'seasonal'],
  sources: [
    'https://tarkov.help/ru/quest/fog-of-war', 'https://tarkov.help/en/quest/fog-of-war',
    'https://escapefromtarkov.fandom.com/ru/wiki/Туман_войны', 'https://escapefromtarkov.fandom.com/wiki/Fog_of_War',
    'https://blast.tv/gaming/news/escape-from-tarkov-fog-of-war-task-guide',
    'https://escapefromtarkov.fandom.com/wiki/A_Familiar_Face...', 'https://escapefromtarkov.fandom.com/wiki/Scope_the_Clearing',
    'https://tarkov.help/api/ru/quest-map?game_mode=regular', 'https://tarkovforge.com/event-quests',
  ],
  quests: [
    {
      id: BALANCE_SHIFT_QUEST_IDS.fogOfWar,
      trader: PRAPOR,
      name: { ru: 'Туман войны', en: 'Fog of War' },
      otherIds: [FOG_OF_WAR_GAME_ID],
      loyalty: [[PRAPOR, 2]],
      experience: 10_000,
      objectives: [
        {
          type: 'visit', maps: LIGHTHOUSE, spots: LIGHTHOUSE_SPOTS.brdm,
          text: { ru: 'Разведать позицию отступников с БРДМ в северной части комплекса очистных сооружений', en: 'Scout the Rogues\' position near the BRDM car in the northern part of the water treatment plant on Lighthouse' },
        },
        {
          type: 'visit', maps: LIGHTHOUSE, spots: LIGHTHOUSE_SPOTS.towerCheckpoint,
          text: { ru: 'Посетить блокпост отступников с дозорной вышкой в юго-западной части очистных сооружений', en: 'Scout the Rogues\' checkpoint with the guard tower in the southwestern part of the water treatment plant on Lighthouse' },
        },
        {
          type: 'visit', maps: LIGHTHOUSE, spots: LIGHTHOUSE_SPOTS.plantRoofs,
          text: { ru: 'Осмотреть территорию очистных сооружений с крыши любого из корпусов', en: 'Scout the water treatment plant territory from the roof of any of the plant buildings on Lighthouse' },
        },
      ],
      rewards: [[ROUBLES, 300_000], [SVDS, 1], [SVD_MAG_10, 3], [PS_GZH_PACK_20, 2]],
      note: {
        ru: 'Задание Прапора (нужен 2-й уровень лояльности). Все три места на Маяке, в комплексе очистных сооружений, где стоят отступники: позиция с БРДМ на севере, блокпост с дозорной вышкой на юго-западе и крыша любого корпуса. Лучше пройти все три за один рейд. Отступники стреляют без предупреждения — идите подготовленными. Следующее задание — «Абонент временно недоступен».',
        en: 'Prapor\'s task (needs loyalty level 2). All three places are on Lighthouse, in the water treatment plant held by the Rogues: the BRDM position in the north, the checkpoint with the guard tower in the southwest and the roof of any plant building. Best done in one raid. The Rogues shoot on sight, so come prepared. The next task is «Number Temporarily Unavailable».',
      },
    },
    {
      id: BALANCE_SHIFT_QUEST_IDS.numberUnavailable,
      trader: PRAPOR,
      name: { ru: 'Абонент временно недоступен', en: 'Number Temporarily Unavailable' },
      aliases: ['Subscriber temporarily unavailable'],
      after: [BALANCE_SHIFT_QUEST_IDS.fogOfWar],
      experience: 15_000,
      objectives: [
        { type: 'plantItem', count: 3, maps: LIGHTHOUSE, items: [ELECTRONIC_COMPONENTS], spots: LIGHTHOUSE_SPOTS.praporCamp, text: { ru: 'Заложить в новом лагере людей Прапора компоненты электроники', en: 'Stash Electronic components at Prapor\'s new camp on Lighthouse' } },
        { type: 'plantItem', maps: LIGHTHOUSE, items: [MILITARY_CABLE], spots: LIGHTHOUSE_SPOTS.praporCamp, text: { ru: 'Заложить в новом лагере людей Прапора военный кабель', en: 'Stash a Military cable at Prapor\'s new camp on Lighthouse' } },
        { type: 'plantItem', count: 3, maps: LIGHTHOUSE, items: [CAPACITORS], spots: LIGHTHOUSE_SPOTS.praporCamp, text: { ru: 'Заложить в новом лагере людей Прапора конденсаторы', en: 'Stash Capacitors at Prapor\'s new camp on Lighthouse' } },
      ],
      rewards: [[ROUBLES, 300_000], [RIG_6B45_MEDIC, 2]],
      note: {
        ru: 'Лагерь людей Прапора стоит на вершине горы на юге карты, напротив перехода на полуостров с маяком: туда ведёт мосток. Точка на карте примерная. Всё закладывается в одном месте, в медицинских ящиках лагеря.',
        en: 'Prapor\'s camp is on the mountaintop in the south of the map, across from the way to the lighthouse peninsula; a footbridge leads up. The point on the map is approximate. Everything goes into one place, the camp\'s medical boxes.',
      },
    },
    {
      id: BALANCE_SHIFT_QUEST_IDS.allInclusive,
      trader: PRAPOR,
      name: { ru: 'Поддержка «всё включено»', en: 'All-Inclusive Support' },
      aliases: ['Поддержка "всё включено"', '"All-inclusive" support'],
      after: [BALANCE_SHIFT_QUEST_IDS.numberUnavailable],
      experience: 20_000,
      objectives: [
        { type: 'shoot', count: 15, maps: LIGHTHOUSE, shoot: { targets: ['Any'] }, text: { ru: 'Устранить любые цели на локации Маяк', en: 'Eliminate any targets on Lighthouse' } },
        { type: 'transit', maps: LIGHTHOUSE, spots: [{ map: 'lighthouse', transit: '22' }], text: { ru: 'Совершить переход с локации Маяк на локацию Резерв', en: 'Use the transit from Lighthouse to Reserve' } },
        { type: 'useItem', maps: LIGHTHOUSE, useAny: [RSP_RED, FLARE_26X75_RED], spots: LIGHTHOUSE_SPOTS.lakeCabin, text: { ru: 'Использовать РСП-30 (Красный) у заброшенного дома на озере в горах на локации Маяк', en: 'Launch a red signal flare at the abandoned mountain lake cabin on Lighthouse' } },
      ],
      rewards: [[ROUBLES, 300_000], [GRENADE_CASE, 1]],
      note: {
        ru: 'Дом стоит на островке в озере в горах, у выхода «Проход у озера». Нужна красная ракета: РСП-30 или патрон для СП-81. Цели можно набирать за несколько рейдов; переход на Резерв удобнее сделать в последнюю очередь.',
        en: 'The cabin stands on an islet in the mountain lake, by the «Passage by the Lake» exit. A red flare is needed: an RSP-30 or a cartridge for the SP-81. The targets can be spread over several raids; the transit to Reserve is best left for last.',
      },
    },
    {
      id: BALANCE_SHIFT_QUEST_IDS.loseTheTail,
      trader: PRAPOR,
      name: { ru: 'Избавиться от хвоста', en: 'Lose the Tail' },
      after: [BALANCE_SHIFT_QUEST_IDS.allInclusive],
      experience: 30_000,
      objectives: [
        { type: 'shoot', count: 5, maps: LIGHTHOUSE, shoot: { targets: ['followerGluharAssault', 'followerGluharScout', 'followerGluharSecurity', 'followerGluharSnipe'] }, text: { ru: 'Устранить бойцов из свиты Глухаря на локации Маяк', en: 'Eliminate Glukhar\'s guards on Lighthouse' } },
        { type: 'shoot', maps: LIGHTHOUSE, shoot: { targets: ['bossGluhar'] }, text: { ru: 'Найти и нейтрализовать Глухаря на локации Маяк', en: 'Locate and neutralize Glukhar on Lighthouse' } },
      ],
      rewards: [[ROUBLES, 450_000], [AS_VAL, 1], [VAL_MAG_6L25, 3], [PAB9_PACK_20, 4]],
      note: {
        ru: 'На время ивента Глухарь со свитой появляется на очистных сооружениях Маяка: чаще всего в центре комплекса, иногда на третьем корпусе или внутри. Стреляйте из-за укрытий и не задерживайтесь у тел: на выстрелы придут другие ЧВК.',
        en: 'During the event Glukhar and his guards appear at Lighthouse\'s water treatment plant: most often in the middle of it, sometimes on or inside building no. 3. Fight from cover and do not linger over the bodies: other PMCs come to the shots.',
      },
    },
    {
      id: BALANCE_SHIFT_QUEST_IDS.callsignMalachite,
      trader: PRAPOR,
      name: { ru: 'Позывной «Малахит»', en: 'Callsign Malachite' },
      aliases: ['Позывной "Малахит"'],
      after: [BALANCE_SHIFT_QUEST_IDS.loseTheTail],
      experience: 20_000,
      objectives: [
        { type: 'findQuestItem', maps: LIGHTHOUSE, questItem: TRETYAKOV_FILE, spots: LIGHTHOUSE_SPOTS.lakeCabin, text: { ru: 'Найти личное дело Третьякова С.И. на локации Маяк', en: 'Locate and obtain the BEAR operative\'s personnel file on Lighthouse' } },
        { type: 'giveQuestItem', questItem: TRETYAKOV_FILE, text: { ru: 'Передать личное дело Третьякова С.И.', en: 'Hand over the found intel' } },
        { type: 'useItem', optional: true, text: { ru: 'Изучить личное дело Третьякова С.И.', en: 'Read S.I. Tretyakov\'s personnel file' } },
      ],
      rewards: [[ROUBLES, 300_000], [MASKA_SHIELD_OD, 2], [MASKA_HELMET_OD, 2]],
      modeRewards: { seasonal: [[ROUBLES, 300_000], [LSHZ_SHIELD, 2], [LSHZ_HELMET_BLACK, 2]] },
      note: {
        ru: 'Личное дело лежит в том же доме на островке в озере в горах, за матрасом. С ним надо выжить: если погибнете, идти придётся заново.',
        en: 'The file lies in the same cabin on the islet in the mountain lake, behind a mattress. You have to survive with it: die and you go again.',
      },
    },
    {
      id: BALANCE_SHIFT_QUEST_IDS.familiarFace,
      trader: SKIER,
      name: { ru: 'Знакомое лицо...', en: 'A Familiar Face...' },
      loyalty: [[SKIER, 2]],
      experience: 15_000,
      objectives: [
        { type: 'extract', maps: LIGHTHOUSE, exitName: 'EXFIL_Train', spots: [{ map: 'lighthouse', extract: ARMORED_TRAIN_EXIT }], text: { ru: 'Воспользоваться выходом «Бронепоезд» на локации Маяк, используя бронежилет NFM "THOR Concealable Reinforced Vest" или Кираса-N', en: 'Extract from Lighthouse through the Armored Train while wearing a Kirasa-N or NFM THOR CRV body armor' } },
      ],
      bring: [{ itemIds: [KIRASA_N, KIRASA_N_GREEN, THOR_CRV, THOR_CRV_HEAD_EYES], count: 1, maps: LIGHTHOUSE, objective: 0 }],
      rewards: [[EUROS, 1_800], [PROFLEX_DX5, 2]],
      note: {
        ru: 'Задание Лыжника (нужен 2-й уровень лояльности). Бронежилет должен быть на вас при выходе, подойдёт и другая расцветка. Бронепоезд приходит на станцию на севере карты не сразу: прибывает с двумя гудками и стоит около 7 минут.',
        en: 'Skier\'s task (needs loyalty level 2). The armor must be on you when you leave; the other colour counts too. The Armored Train reaches the station in the north of the map only some time into the raid: it arrives with two horn blasts and stays about 7 minutes.',
      },
    },
    {
      id: BALANCE_SHIFT_QUEST_IDS.scopeTheClearing,
      trader: SKIER,
      name: { ru: 'Сечь поляну', en: 'Scope the Clearing' },
      after: [BALANCE_SHIFT_QUEST_IDS.familiarFace],
      experience: 15_000,
      objectives: [
        { type: 'plantItem', maps: LIGHTHOUSE, items: [WIFI_CAMERA], spots: LIGHTHOUSE_SPOTS.platformSouth, text: { ru: 'Установить первую Wi-Fi камеру у перрона контрабандистов на локации Маяк', en: 'Plant the first Wi-Fi Camera at the smuggler train platform on Lighthouse' } },
        { type: 'plantItem', maps: LIGHTHOUSE, items: [WIFI_CAMERA], spots: LIGHTHOUSE_SPOTS.platformNorth, text: { ru: 'Установить вторую Wi-Fi камеру у перрона контрабандистов на локации Маяк', en: 'Plant the second Wi-Fi Camera at the smuggler train platform on Lighthouse' } },
        { type: 'plantItem', maps: LIGHTHOUSE, items: [WIFI_CAMERA], spots: LIGHTHOUSE_SPOTS.woodsTransit, text: { ru: 'Установить третью Wi-Fi камеру у перехода на лес на локации Маяк', en: 'Plant the third Wi-Fi Camera at the Woods transit on Lighthouse' } },
      ],
      rewards: [[EUROS, 1_800], [NL545_GP, 1], [PMAG_545_FDE, 3], [AMMO_7N40_120, 1]],
      note: {
        ru: 'Нужны 3 Wi-Fi камеры, их продаёт Механик. Две ставятся в грудах коробок у перрона, у первого и последнего входа в поезд, третья на севере, у перехода на Лес, возле перевёрнутой машины и первого бетонного ограждения.',
        en: 'You need 3 Wi-Fi Cameras, which Mechanic sells. Two go into the piles of boxes at the platform, by the first and the last door of the train, the third in the north, at the Woods transit, by the overturned car and the first concrete barrier.',
      },
    },
    {
      id: BALANCE_SHIFT_QUEST_IDS.cutDownToTheRoot,
      trader: JAEGER,
      name: { ru: 'Вырубить под корень', en: 'Cut Down to the Root' },
      aliases: ['Вырубить под корень [выбор]', 'Cut Down to the Root [choice]'],
      after: [BALANCE_SHIFT_QUEST_IDS.scopeTheClearing],
      experience: 30_000,
      objectives: [
        { type: 'shoot', count: 15, maps: LIGHTHOUSE, shoot: { targets: ['ExUsec'] }, text: { ru: 'Устранить Отступников на локации Маяк', en: 'Eliminate Rogues on Lighthouse' } },
      ],
      rewards: [[ROUBLES, 450_000], [SICC, 1], [BITCOIN, 2]],
      note: {
        ru: 'Развилка: выполните это задание — и «Сберечь ценную фигуру» Смотрителя провалится. Отступники теперь держатся у шале, их новые позиции легко оборонять, и они заметят вас издалека. Отступники с Ледокола могут не засчитываться.',
        en: 'A choice: complete this task and Lightkeeper\'s «Preserve a Valuable Piece» fails. The Rogues now hold the chalets, their new positions are easy to defend, and they spot you from far away. Rogues on the Icebreaker may not count.',
      },
    },
    {
      id: BALANCE_SHIFT_QUEST_IDS.easeTheMove,
      trader: PEACEKEEPER,
      name: { ru: 'Облегчить переезд', en: 'Ease the Move' },
      after: [BALANCE_SHIFT_QUEST_IDS.scopeTheClearing],
      experience: 20_000,
      objectives: [
        { type: 'mark', maps: LIGHTHOUSE, items: [MS2000], spots: LIGHTHOUSE_SPOTS.villageStashes, text: { ru: 'Найти и пометить маяком MS2000 первый схрон отступников в заброшенной деревне на острове', en: 'Locate and mark the first Rogue stash at the abandoned island village with an MS2000 Marker on Lighthouse' } },
        { type: 'mark', maps: LIGHTHOUSE, items: [MS2000], spots: LIGHTHOUSE_SPOTS.farStashes, text: { ru: 'Найти и пометить маяком MS2000 второй схрон отступников в заброшенной деревне на острове', en: 'Locate and mark the second Rogue stash at the abandoned island village with an MS2000 Marker on Lighthouse' } },
        { type: 'mark', maps: LIGHTHOUSE, items: [MS2000], spots: LIGHTHOUSE_SPOTS.grottoStash, text: { ru: 'Найти и пометить маяком MS2000 схрон отступников в гроте', en: 'Locate and mark the Rogue stash at the grotto with an MS2000 Marker on Lighthouse' } },
      ],
      rewards: [[DOLLARS, 2_000], [MCX_SPEAR, 1], [L7AWM_MAG_20, 3], [SIG_FMJ_PACK_20, 3]],
      note: {
        ru: 'Нужны 3 маркера MS2000. Первый схрон бывает в трёх местах, второй в двух, поэтому на карте по несколько точек; какие подойдут, может зависеть от фракции. Схрон это лагерь со снаряжением и баррикадами. Поставьте маркер и дождитесь конца таймера.',
        en: 'You need 3 MS2000 Markers. The first stash has three possible places and the second two, hence several points on the map; which ones count may depend on your faction. A stash is a camp with gear and barricades. Place the marker and wait for the timer to end.',
      },
    },
    {
      id: BALANCE_SHIFT_QUEST_IDS.preserveValuablePiece,
      trader: LIGHTKEEPER,
      name: { ru: 'Сберечь ценную фигуру', en: 'Preserve a Valuable Piece' },
      aliases: ['Сберечь ценную фигуру [выбор]', 'Preserve a valuable piece [choice]'],
      afterAccepted: [BALANCE_SHIFT_QUEST_IDS.cutDownToTheRoot],
      experience: 40_000,
      objectives: [
        { type: 'shoot', count: 7, maps: LIGHTHOUSE, shoot: { targets: ['AnyPmc'] }, text: { ru: 'Устранить бойцов ЧВК на локации Маяк', en: 'Eliminate PMC operatives on Lighthouse' } },
      ],
      rewards: [[SUBSTATION_MARKED_KEY, 1]],
      note: {
        ru: 'Развилка: выполните это задание — и «Вырубить под корень» Егеря провалится. Убивать ЧВК можно в любом месте Маяка и в группе. К шале не ходите: отступники стреляют и по вам.',
        en: 'A choice: complete this task and Jaeger\'s «Cut Down to the Root» fails. PMCs count anywhere on Lighthouse, in a group too. Stay away from the chalets: the Rogues shoot at you as well.',
      },
    },
  ],
}

/**
 * The BTR Driver's two Lighthouse quests of game version 1.1.5.0 (September 2026), not tied to the event. tarkov.dev has
 * neither. A player has «Честный отзыв» open at once with «Сечь поляну» (a Tasks-table reading of 01.11.2026), so this line
 * does not lead to that quest, whatever one community tree says (docs/quests/lighthouse-balance-shift.md). The driver's
 * quests open once Mechanic's «Рука помощи» is taken.
 */
export const LIGHTHOUSE_BTR: CuratedSeries = {
  id: 'lighthouse-btr',
  name: { ru: 'БТР на Маяке', en: 'BTR on Lighthouse' },
  route: { ru: 'задания Водителя БТР', en: 'BTR Driver\'s tasks' },
  gameVersion: '1.1.5.0.47242',
  checkedAt: '2026-11-06',
  modes: ['pvp', 'pve', 'seasonal'],
  sources: [
    'https://escapefromtarkov.fandom.com/wiki/Honest_Review', 'https://escapefromtarkov.fandom.com/ru/wiki/Честный_отзыв',
    'https://escapefromtarkov.fandom.com/wiki/I\'m_Something_of_a_BTR_Myself', 'https://tarkov.help/ru/quest/chestnyy-otzyv',
    'https://tarkovforge.com/task-guide/honest-review',
  ],
  quests: [
    {
      id: LIGHTHOUSE_BTR_QUEST_IDS.honestReview,
      trader: BTR_DRIVER,
      name: { ru: 'Честный отзыв', en: 'Honest Review' },
      afterAccepted: [A_HELPING_HAND],
      experience: 15_000,
      objectives: [
        { type: 'visit', maps: LIGHTHOUSE, spots: LIGHTHOUSE_SPOTS.stopVillage, text: { ru: 'Посетить остановку БТР на перекрёстке в деревне на локации Маяк', en: 'Scout the intersection at the village on Lighthouse' } },
        { type: 'visit', maps: LIGHTHOUSE, spots: LIGHTHOUSE_SPOTS.stopUn, text: { ru: 'Посетить остановку БТР у блокпоста ООН на главной дороге на локации Маяк', en: 'Scout the UN checkpoint at the main road on Lighthouse' } },
        { type: 'visit', maps: LIGHTHOUSE, spots: LIGHTHOUSE_SPOTS.stopPlantParking, text: { ru: 'Посетить остановку БТР на парковке между двумя корпусами очистных сооружений', en: 'Scout the parking between the two main buildings at the water treatment plant on Lighthouse' } },
        RETURN,
        { type: 'dialogue', text: { ru: 'Дать мехводу БТР обратную связь', en: 'Share your feedback with the BTR Driver' } },
      ],
      note: {
        ru: 'Три остановки БТР на Маяке. Можно проехать их на самом БТР услугой «Подвезти», выходить не нужно. После рейда поговорите с водителем.',
        en: 'Three BTR stops on Lighthouse. You can ride through them on the BTR itself with its «Ride» service, without getting off. Talk to the driver after the raid.',
      },
    },
    {
      id: LIGHTHOUSE_BTR_QUEST_IDS.btrMyself,
      trader: BTR_DRIVER,
      name: { ru: 'Сам себе БТР', en: 'I\'m Something of a BTR Myself' },
      after: [LIGHTHOUSE_BTR_QUEST_IDS.honestReview],
      experience: 30_000,
      objectives: [
        { type: 'shoot', count: 15, maps: LIGHTHOUSE, shoot: { targets: ['Savage'] }, text: { ru: 'Устранить Диких, используя оружие калибра 7.62х54R на локации Маяк', en: 'Eliminate Scavs with any 7.62x54R caliber weapon on Lighthouse' } },
        { type: 'dialogue', text: { ru: 'Доложить мехводу БТР', en: 'Report back to the BTR Driver' } },
      ],
      rewards: [[VPX_STORAGE, 2], [VIRTEX, 2], [MILITARY_FLASH_DRIVE, 2]],
      note: {
        ru: 'Подойдёт любое оружие калибра 7.62x54R. Дикие проще всего на главной дороге и у очистных; можно за несколько рейдов. Боссы и их свита не засчитываются.',
        en: 'Any 7.62x54R weapon will do. Scavs are easiest on the main road and at the water treatment plant, and it can take several raids. Bosses and their guards do not count.',
      },
    },
  ],
}

/** The game's id of «За проезд передаём!» (the Russian wiki's page, `node`). */
export const PAY_THE_FARE_ID = '6a8b8266f47489e5720a63b7'

/**
 * Ragman's «За проезд передаём!» of game version 1.1.5.0 (September 2026): tarkov.dev does not have it in any mode. It opens at
 * a stage of the story chapter «Борей» (telling Mechanic transport to the Icebreaker is found), which the app cannot see, so it
 * is held back until the logs show it (`opensInGame`). No place on any map: the tools come from any toolbox. Three sources say
 * it is live; its rewards as the English wiki gives them (10 kits in PvE). docs/quests/lighthouse-balance-shift.md, «Рядом».
 */
export const BOREAS_RAGMAN: CuratedSeries = {
  id: 'boreas-ragman',
  name: { ru: 'Борей', en: 'Boreas' },
  route: { ru: 'задание Барахольщика', en: 'Ragman\'s task' },
  gameVersion: '1.1.5.0.47242',
  checkedAt: '2026-11-07',
  modes: ['pvp', 'pve', 'seasonal'],
  sources: [
    'https://escapefromtarkov.fandom.com/wiki/Pay_the_Fare!', 'https://escapefromtarkov.fandom.com/ru/wiki/За_проезд_передаём!',
    'https://tarkov.help/ru/quest/za-proezd-peredayom', 'https://tarkovforge.com/task-guide/pay-the-fare',
  ],
  quests: [
    {
      id: PAY_THE_FARE_ID,
      trader: RAGMAN,
      name: { ru: 'За проезд передаём!', en: 'Pay the Fare!' },
      opensInGame: true,
      experience: 30_000,
      objectives: [
        { type: 'findItem', items: [PIPE_GRIP_WRENCH], foundInRaid: true, text: { ru: 'Найти в рейде предмет: Шарнирный ключ КШС', en: 'Find the item in raid: Pipe grip wrench' } },
        { type: 'giveItem', items: [PIPE_GRIP_WRENCH], foundInRaid: true, text: { ru: 'Передать ключ КШС', en: 'Hand over the Pipe grip wrench' } },
        { type: 'findItem', items: [RATCHET_WRENCH], foundInRaid: true, text: { ru: 'Найти в рейде предмет: Трещоточный ключ', en: 'Find the item in raid: Ratchet wrench' } },
        { type: 'giveItem', items: [RATCHET_WRENCH], foundInRaid: true, text: { ru: 'Передать трещоточный ключ', en: 'Hand over the Ratchet wrench' } },
        { type: 'findItem', items: [ELECTRIC_DRILL], foundInRaid: true, text: { ru: 'Найти в рейде предмет: Электродрель', en: 'Find the item in raid: Electric drill' } },
        { type: 'giveItem', items: [ELECTRIC_DRILL], foundInRaid: true, text: { ru: 'Передать электродрель', en: 'Hand over the Electric drill' } },
      ],
      rewards: [[SUDAK_TUDAK_KIT, 5]],
      modeRewards: { pve: [[SUDAK_TUDAK_KIT, 10]] },
      rewardNotes: [{ ru: 'Ежедневное оперативное задание с наградой наборами «Судак-тудак»', en: 'A daily operational task that pays in Sudak-Tudak kits' }],
      note: {
        ru: 'Открывается в главе «Борей», когда вы сообщите Механику, что транспорт на Ледокол найден. Все три инструмента должны быть найдены в рейде, чаще всего они лежат в ящиках с инструментами. Наборы «Судак-тудак» нужны для дороги на Ледокол на катере.',
        en: 'Opens in the «Boreas» chapter, once you tell Mechanic that transport to the Icebreaker is found. All three tools must be found in raid, most often in toolboxes. The Sudak-Tudak kits are for the boat ride to the Icebreaker.',
      },
    },
  ],
}

/** The game's quest ids of «Хеллоуин 2026» (the Russian EFT Wiki's quest pages, `node`). */
export const HALLOWEEN_QUEST_IDS = {
  rumors: '6aba40a15ef26da1360746b8',
  bestDefense: '6aba7df2bb9829de330494c7',
  followUp: '6aba7f65443c3da4df01bb3e',
  unexpectedHelp: '6abb7e59dcebb0efbc0fda7b',
  initialExamination: '6abb7e434f0ef29f16066d77',
  tightening: '6abb92e1505493a036006ee0',
  newVaccine: '6abd0ff5d383d797d602d6c4',
  highRisk: '6abf70a8e4732bc101051bf2',
  firstResults: '6abf93f0e6a93c846b0fe382',
  studyingEnemy: '6abf92bee6a93c846b0fe37d',
  greaterGood: '6abfae3485f9ebf648025acc',
  greaterGoodAgreement: '6abfafda95e39cdaad0bda27',
  finalPush: '6abfb582eac8c75de80bd930',
  dangerZone: '6abb99516cdfa16e93028439',
  coincidence: '6abbb8845baa9031ac068833',
  prototyping: '6abbae9ee591db528505e3e9',
  enemyOfEnemy: '6abbbc647aea5f936906e29d',
  enemyAgreement: '6abbbde75f084d06ce014688',
  blindEnemy: '6abbc2bb71588b5b110f34a5',
} as const

/**
 * When the app stops showing the event: the game has not announced the end (02.11.2026); the last Halloween ended on
 * 11 November. Moved as soon as the end is known (src/events/halloweenEvent.ts shows the same date).
 */
export const HALLOWEEN_2026_END = '2026-11-12T07:00:00.000Z'

const H = HALLOWEEN_QUEST_IDS
const LABS_KEYCARD = '5c94bbff86f7747ee735c08f'
const MEDICAL_TOOLS = '619cc01e0a7c3a1a2731940c'
const BLOOD_SAMPLE = '6acc4988059559342f0830d8'
const TISSUE_SAMPLE = '6acc4af5ada0d6309902b049'
const VACCINE_PROTOTYPE = '6acc4c757587fb38c508c5fa'
const RDA78_VACCINE = '6acc4e8fada0d6309902b04d'
const DORM_105_KEY = '591382d986f774465a6413a7'
const INFECTED_MAPS = ['infected-factory', 'infected-lab']

/**
 * The places of the event on the ordinary maps (owner, 02.11.2026: «ставь точки на обычных картах»). Customs, Woods and
 * Factory: tarkov.help's quest markers carried over by the exits (docs/quests/halloween-2026.md); the other maps: the
 * door or the zone tarkov.dev has in the building the walkthroughs name.
 */
const HALLOWEEN_SPOTS = {
  factoryScientists: [
    { map: 'factory', point: { id: 'th-16040', x: -10.7, z: 29.5 } },
    { map: 'factory', point: { id: 'th-16041', x: 17.3, z: -29.0 } },
    { map: 'factory', point: { id: 'th-16042', x: 51.3, z: 4.5 } },
  ],
  labScientists: [
    // the tunnel to «Накопительный коллектор»; the tents by the blue keycard room
    { map: 'the-lab', extract: '70e59e240344a72e8dbb151c370f32851997fd50', building: true },
    { map: 'the-lab', lockKey: '5c1d0c5f86f7744bb2683cf0', building: true },
  ],
  infectedExits: [
    { map: 'factory', extract: '99c2f21880da0baf75d431a5f45b462fde2f79b1' },
    { map: 'factory', extract: 'f16ce849a9d153a8813b6bf6a049d530f1cc44c2' },
    { map: 'the-lab', extract: '99477cb352520521b92ba91a2c1cfd7fc219ad26' },
    { map: 'the-lab', extract: '70e59e240344a72e8dbb151c370f32851997fd50' },
  ],
  labExits: [
    { map: 'the-lab', extract: '99477cb352520521b92ba91a2c1cfd7fc219ad26' },
    { map: 'the-lab', extract: '70e59e240344a72e8dbb151c370f32851997fd50' },
  ],
  // water treatment building no. 3 (the Rogue USEC barrack door) and no. 2 (the storage room door)
  vaccine: [{ map: 'lighthouse', lockKey: '62a9cb937377a65d7b070cef', building: true }],
  signal: [{ map: 'lighthouse', lockKey: '62987e26a77ec735f90a2995', building: true }],
  room105: [{ map: 'customs', lockKey: DORM_105_KEY }],
  woodsCameras: [
    { map: 'woods', point: { id: 'th-16029', x: -664.0, z: 145.0 } },
    { map: 'woods', point: { id: 'th-16030', x: -647.0, z: 113.4 } },
  ],
  customsCameras: [
    { map: 'customs', point: { id: 'th-16026', x: 233.9, z: 128.5 } },
    { map: 'customs', point: { id: 'th-16027', x: 183.9, z: 168.6 } },
    { map: 'customs', point: { id: 'th-16028', x: 167.8, z: 184.6 } },
  ],
  reserveDepot: [{ map: 'reserve', taskZone: { task: '639136df4b15ca31f76bc31f', zone: 'jaegar_collection_point_rezerve_base' } }],
  // the west wing's third floor (room 301) and the east wing's far end (room 328)
  resort: [
    { map: 'shoreline', lockKey: '5a13ef7e86f7741290491063', building: true },
    { map: 'shoreline', lockKey: '5a0eee1486f77402aa773226', building: true },
  ],
} satisfies Record<string, CuratedSpot[]>

const killInfected = (count: number, maps: string[], ru: string, en: string): CuratedObjective => ({ type: 'shoot', count, maps, shoot: { targets: ['Infected'] }, text: { ru, en } })

/**
 * «Хеллоуин 2026» (owner, 02.11.2026: «найди все данные по Хеллоуинским квестам… добавь их так же как у нас был ивент»):
 * the event of game version 1.3.0.0 (29.10.2026), Skier's and Therapist's line. Two choices split it: the vaccine batch
 * for Skier («Неожиданная помощь») or Therapist («Первичная проверка»), then «Усиление карантина» or «Новая вакцина»;
 * each fails the other one. Those two are given under two ids, one per branch (`otherIds`), with the branch's own
 * objectives and rewards, which the notes give. Objectives in the game's words; rewards as the English wiki gives them
 * (without the Intelligence Center bonus). docs/quests/halloween-2026.md lists the sources.
 */
export const HALLOWEEN_2026: CuratedSeries = {
  id: 'halloween-2026',
  name: { ru: 'Хеллоуин 2026', en: 'Halloween 2026' },
  route: { ru: 'ивент Лыжника и Терапевта', en: 'Skier and Therapist event' },
  event: true,
  endsAt: HALLOWEEN_2026_END,
  gameVersion: '1.3.0.0.48484',
  checkedAt: '2026-11-02',
  // tarkov.dev lists the infected Factory and Lab in all three modes' maps files
  modes: ['pvp', 'pve', 'seasonal'],
  sources: [
    'escapefromtarkov.fandom.com/ru Halloween: … (infobox `node` = quest id)',
    'escapefromtarkov.fandom.com (EN) Halloween: … (objectives, rewards, guide)',
    'tarkov.help/ru|en/quest/halloween-… (objectives, walkthroughs, pictures, map markers)',
    'json.tarkov.dev regular/maps (extracts, locks), regular/tasks (the Reserve depot zone)',
  ],
  quests: [
    {
      id: H.rumors,
      trader: SKIER,
      name: { ru: 'Halloween: Слухи', en: 'Halloween: Rumors' },
      experience: 26_000,
      objectives: [
        { type: 'visit', maps: ['infected-factory'], text: { ru: 'Попасть на локацию «Заражённый завод»', en: 'Visit the Infected Factory' } },
        killInfected(10, ['infected-factory'], 'Убить 10 заражённых на локации «Заражённый завод»', 'Eliminate 10 infected on Infected Factory'),
      ],
      rewards: [[EUROS, 1_800], ['67124dcfa3541f2a1f0e788b', 1], ['6709133fa532466d5403fb7c', 3], ['6570247ebfc87b3a34093229', 4]],
      note: {
        ru: 'Заражённый завод — отдельная ивентовая локация: на экране выбора локации переключитесь на ивентовые в правом верхнем углу. На карте медленные и быстрые заражённые, часть из них с оружием, и Заражённый Тагилла. Надёжнее всего стрелять в голову. Выходы — «Ворота 0» и «Ворота 3».',
        en: 'The Infected Factory is a separate event location: switch to the event locations in the top right of the location screen. It has slow and fast infected, some of them armed, and the Infected Tagilla. Headshots work best. The exits are Gate 0 and Gate 3.',
      },
    },
    {
      id: H.bestDefense,
      trader: SKIER,
      name: { ru: 'Halloween: Лучшая защита', en: 'Halloween: The Best Defense' },
      after: [H.rumors],
      experience: 36_000,
      objectives: [
        { type: 'visit', maps: ['infected-lab'], text: { ru: 'Попасть на локацию «Заражённая лаборатория»', en: 'Visit the Infected Lab' } },
        { type: 'findQuestItem', optional: true, maps: ['infected-lab'], text: { ru: '(опционально) Найти подсказку для секретного выхода', en: '(Optional) Find the hint for the secret exit' } },
        { type: 'extract', optional: true, maps: ['infected-lab'], spots: HALLOWEEN_SPOTS.labExits, text: { ru: '(опционально) Выжить и выйти с локации «Заражённая лаборатория»', en: '(Optional) Survive and extract from the Infected Lab' } },
        killInfected(10, ['infected-lab'], 'Убить 10 заражённых на локации «Заражённая лаборатория»', 'Eliminate 10 infected on the Infected Lab'),
      ],
      rewards: [[EUROS, 2_700], ['69f9ebbcaae020b0db02f65d', 1], ['69f9ec5a7596e93e340c0a1e', 3], ['6a9961d053d704c9d005660e', 4]],
      note: {
        ru: 'В Заражённой лаборатории очень темно — нужен фонарь или ПНВ. Выйти можно только через «Парковку» (нужен ключ от машины) или «Накопительный коллектор» (нужна схема коллектора) — это и есть подсказка для секретного выхода. Ключ и схема лежат на круглом столе со статуями котов и рядом с ним в зоне отдыха на втором уровне; ключ ещё бывает в пасти заражённой головы на кулере в офисе O23, схема — на столе в O23 и за монитором в кабинете Круглова.',
        en: 'The Infected Lab is very dark: bring a flashlight or night vision. The only exits are the Parking gate (needs the car keys) and the Sewage conduit (needs the collector map): that is the hint for the secret exit. The keys and the map lie on and around the round table with the cat statues in the recreation area on the second level; the keys also spawn in the mouth of an infected head on the water dispenser in office O23, the map on a desk in O23 and behind the screen in Kruglov\'s office.',
      },
    },
    {
      id: H.followUp,
      trader: THERAPIST,
      name: { ru: 'Halloween: Контрольная проверка', en: 'Halloween: Follow-Up Examination' },
      aliases: ['Halloween: Hollow-Up Examination'],
      afterAccepted: [H.bestDefense],
      experience: 40_000,
      objectives: [
        { type: 'visit', maps: INFECTED_MAPS, spots: [...HALLOWEEN_SPOTS.labScientists, ...HALLOWEEN_SPOTS.factoryScientists], text: { ru: 'Найти тело сотрудника лаборатории в защитном костюме', en: 'Locate the dead scientist in a hazmat suit on the Infected Lab or the Infected Factory' } },
        { type: 'useItem', maps: INFECTED_MAPS, useAny: [MEDICAL_TOOLS], text: { ru: 'Вскрыть труп лаборанта, используя медицинские инструменты', en: 'Open the scientist\'s body using medical tools' } },
        { type: 'findQuestItem', maps: INFECTED_MAPS, text: { ru: 'Взять образец крови на локации «Заражённая лаборатория» или «Заражённый завод»', en: 'Obtain the blood sample on the Infected Lab or the Infected Factory' } },
        { type: 'giveItem', items: [BLOOD_SAMPLE], text: { ru: 'Передать образец крови', en: 'Hand over the blood sample' } },
      ],
      rewards: [[ROUBLES, 300_000], [LABS_KEYCARD, 2], ['5c10c8fd86f7743d7d706df3', 2], ['637b620db7afa97bfc3d7009', 2]],
      note: {
        ru: 'Открывается после взятия «Лучшей защиты». Возьмите медицинские инструменты — они расходуются при вскрытии. Тела учёных в защитных костюмах: в Заражённой лаборатории — в тоннеле к выходу «Накопительный коллектор» в подвале и в палаточной зоне у комнаты синей ключ-карты на первом уровне; на Заражённом заводе — у лаборатории, на цистернах у насосной напротив «Ворот 3» и у офисов. Держите кнопку действия, пока идёт таймер (около 30 секунд), иначе образец не возьмётся. Образец крови продаётся и на барахолке.',
        en: 'Opens once «The Best Defense» is taken. Bring medical tools: one set is used up per body. The scientists in hazmat suits: on the Infected Lab in the tunnel to the Sewage conduit exit in the basement and in the tent area by the blue keycard room on the first level; on the Infected Factory by the laboratory, on the tanks at the pumping station opposite Gate 3 and by the offices. Hold the action key for the whole timer (about 30 seconds) or no sample is taken. The blood sample is also sold on the flea market.',
      },
    },
    {
      id: H.unexpectedHelp,
      trader: SKIER,
      name: { ru: 'Halloween: Неожиданная помощь', en: 'Halloween: Unexpected Help' },
      after: [H.followUp],
      experience: 38_000,
      objectives: [
        { type: 'findQuestItem', maps: ['lighthouse'], spots: HALLOWEEN_SPOTS.vaccine, text: { ru: 'Забрать партию вакцины с очистных на локации Маяк', en: 'Locate and obtain the vaccine shipment at the water treatment plant on Lighthouse' } },
        { type: 'plantQuestItem', maps: ['customs'], spots: HALLOWEEN_SPOTS.room105, requiredKeys: [[DORM_105_KEY]], text: { ru: 'Заложить партию вакцины в 105 комнате двухэтажной общаги на локации Таможня', en: 'Stash the vaccine shipment in room 105 of the two-story dorm on Customs' } },
      ],
      rewards: [[EUROS, 2_700], ['5aafbde786f774389d0cbc0f', 1]],
      note: {
        ru: 'Развилка: выполните это задание — и «Первичная проверка» Терапевта провалится. Партия вакцины лежит на столе в западном офисе второго этажа здания №3 очистных сооружений на Маяке. Её нужно вынести с Маяка (погибнете — потеряете) и заложить в комнате 105 двухэтажной общаги на Таможне; нужен ключ от комнаты 105 общежития.',
        en: 'A choice: complete this task and Therapist\'s «Initial Examination» fails. The vaccine shipment lies on a desk in the western office on the second floor of water treatment building no. 3 on Lighthouse. Extract with it (dying loses it), then stash it in room 105 of the two-story dorm on Customs; it needs the Dorm room 105 key.',
      },
    },
    {
      id: H.initialExamination,
      trader: THERAPIST,
      name: { ru: 'Halloween: Первичная проверка', en: 'Halloween: Initial Examination' },
      aliases: ['Halloween: Initial Check'],
      afterAccepted: [H.unexpectedHelp],
      experience: 38_000,
      objectives: [
        { type: 'giveQuestItem', maps: ['lighthouse'], spots: HALLOWEEN_SPOTS.vaccine, text: { ru: 'Передать партию вакцины Терапевту', en: 'Hand over the vaccine shipment to Therapist' } },
      ],
      rewards: [[ROUBLES, 200_000], ['590c60fc86f77412b13fddcf', 1]],
      note: {
        ru: 'Развилка: выполните это задание — и «Неожиданная помощь» Лыжника провалится. Партия вакцины лежит на столе в западном офисе второго этажа здания №3 очистных сооружений на Маяке: вынесите её и сдайте Терапевту.',
        en: 'A choice: complete this task and Skier\'s «Unexpected Help» fails. The vaccine shipment lies on a desk in the western office on the second floor of water treatment building no. 3 on Lighthouse: extract with it and hand it to Therapist.',
      },
    },
    {
      id: H.tightening,
      otherIds: ['6abb86cddcebb0efbc0fda8f'],
      trader: SKIER,
      name: { ru: 'Halloween: Усиление карантина', en: 'Halloween: Tightening the Quarantine' },
      afterDecided: [H.unexpectedHelp],
      delay: [900, 3600],
      experience: 48_000,
      objectives: [
        { type: 'giveItem', text: { ru: 'Передать найденные в рейде аптечки, снимающие сильные кровотечения (5 или 7)', en: 'Hand over found in raid medkits that stop heavy bleeding (5 or 7)' } },
        { type: 'giveItem', text: { ru: 'Передать найденные в рейде лечебные мази (2 или 3)', en: 'Hand over found in raid medical balms (2 or 3)' } },
        { type: 'giveItem', text: { ru: 'Передать найденные в рейде хирургические наборы (2 или 3)', en: 'Hand over found in raid surgical kits (2 or 3)' } },
      ],
      rewardNotes: [
        { ru: 'Если вакцину получил Лыжник: 1 800 €, AK-12, 3 магазина и пачка 7Н40 (120 шт.)', en: 'If Skier got the vaccine: €1,800, an AK-12, 3 magazines and a 7N40 pack (120 pcs)' },
        { ru: 'Если вакцину получил Терапевт: 2 700 €, кейс для денег', en: 'If Therapist got the vaccine: €2,700 and a Money case' },
      ],
      note: {
        ru: 'Даётся при любом выборе на первой развилке, через 15–60 минут. Вторая развилка: выполнение этого задания провалит «Новую вакцину» Терапевта, и наоборот; после него идёт линия Лыжника («Зона риска»). Если вакцину получил Лыжник — 5 аптечек, 2 мази и 2 хирургических набора; если Терапевт — 7, 3 и 3. Всё должно быть найдено в рейде.',
        en: 'Given after either side of the first choice, 15–60 minutes later. The second choice: completing it fails Therapist\'s «A New Vaccine», and the other way round; Skier\'s line («Danger Zone») follows it. If Skier got the vaccine: 5 medkits, 2 balms and 2 surgical kits; if Therapist did: 7, 3 and 3. All found in raid.',
      },
    },
    {
      id: H.newVaccine,
      otherIds: ['6abd18fed383d797d602d6c9'],
      trader: THERAPIST,
      name: { ru: 'Halloween: Новая вакцина', en: 'Halloween: A New Vaccine' },
      afterDecided: [H.initialExamination],
      delay: [900, 900],
      experience: 41_000,
      objectives: [
        { type: 'extract', maps: INFECTED_MAPS, spots: HALLOWEEN_SPOTS.infectedExits, text: { ru: 'Выжить и выйти с локации «Заражённый завод» или «Заражённая лаборатория»', en: 'Survive and extract from the Infected Factory or the Infected Lab' } },
      ],
      rewardNotes: [
        { ru: 'Если вакцину получил Терапевт: 150 000 ₽, 2 ключ-карты Лаборатории, 2 набора Surv12', en: 'If Therapist got the vaccine: 150,000 ₽, 2 Labs keycards, 2 Surv12 kits' },
        { ru: 'Если вакцину получил Лыжник: 300 000 ₽, термосумка «Мистер Холодильник»', en: 'If Skier got the vaccine: 300,000 ₽ and a Mr. Holodilnick thermal bag' },
      ],
      note: {
        ru: 'Даётся при любом выборе на первой развилке. Вторая развилка: выполнение этого задания провалит «Усиление карантина» Лыжника, и наоборот; после него идёт линия Терапевта. Если вакцину получил Терапевт — выжить и выйти с одной из заражённых локаций; если Лыжник — выжить и выйти с обеих и передать 2 000 $.',
        en: 'Given after either side of the first choice. The second choice: completing it fails Skier\'s «Tightening the Quarantine», and the other way round; Therapist\'s line follows it. If Therapist got the vaccine: survive and extract from one of the infected locations; if Skier did: from both of them, and hand over $2,000.',
      },
    },
    {
      id: H.highRisk,
      trader: THERAPIST,
      name: { ru: 'Halloween: High-Risk, High-Reward', en: 'Halloween: High-Risk, High-Reward' },
      after: [H.newVaccine],
      experience: 44_000,
      objectives: [killInfected(30, INFECTED_MAPS, 'Убить заражённых на Заражённом заводе или в Заражённой лаборатории', 'Eliminate infected on the Infected Factory or the Infected Lab')],
      rewards: [[ROUBLES, 300_000], ['5c0e530286f7747fa1419862', 3], ['5c0e533786f7747fa23f4d47', 3], [VACCINE_PROTOTYPE, 2]],
      note: {
        ru: 'Удобнее на Заражённом заводе: карта маленькая, заражённых много. Берите надёжное оружие без глушителя, например дробовик, — шум сам приводит заражённых. Задание можно делать в группе. После него у Терапевта появляются ежедневные задания с прототипами вакцины.',
        en: 'Easiest on the Infected Factory: a small map with plenty of infected. Bring a reliable unsuppressed weapon such as a shotgun: the noise brings the infected to you. It can be done in a group. Afterwards Therapist gives daily tasks that pay vaccine prototypes.',
      },
    },
    {
      id: H.firstResults,
      trader: THERAPIST,
      name: { ru: 'Halloween: Первые результаты', en: 'Halloween: First Results' },
      after: [H.highRisk],
      experience: 42_000,
      objectives: [
        killInfected(25, INFECTED_MAPS, 'Убить заражённых, которые находятся под эффектом экспериментальной гранаты', 'Eliminate infected while they are under the effect of the experimental gas grenade'),
        { type: 'findItem', optional: true, text: { ru: '(опционально) Получить экспериментальную газовую гранату РДЭ-68', en: '(Optional) Obtain the RDE-68 experimental gas grenade' } },
      ],
      rewards: [[ROUBLES, 300_000], ['590c657e86f77412b013051d', 5]],
      note: {
        ru: 'При взятии Терапевт выдаёт 3 газовые гранаты РДЭ-68 и открывает бартер на них. Засчитываются только заражённые, убитые в облаке газа. Обязательно наденьте противогаз или респиратор. Займите место, куда заражённые не достанут (ящики, трубы, столы), бросьте гранату, подождите, пока газ разойдётся, и стреляйте по тем, кто в нём. Можно сделать за один рейд.',
        en: 'Therapist gives 3 RDE-68 gas grenades with the task and a barter for more. Only the infected killed inside the gas count. Wear a gas mask or a respirator. Stand where the infected cannot reach (crates, pipes, tables), throw the grenade, let the gas spread and shoot the ones inside it. It can be done in one raid.',
      },
    },
    {
      id: H.studyingEnemy,
      trader: THERAPIST,
      name: { ru: 'Halloween: Изучение врага', en: 'Halloween: Studying the Enemy' },
      after: [H.highRisk],
      experience: 34_000,
      objectives: [{ type: 'giveItem', count: 2, items: [TISSUE_SAMPLE], text: { ru: 'Передать образцы тканей заражённых', en: 'Hand over infected tissue samples' } }],
      rewards: [[ROUBLES, 150_000]],
      note: {
        ru: 'Образцы тканей заражённых Лыжник платит за ежедневные задания своей линии; на линии Терапевта их можно получить за «Ради общей цели. Договор» (2 шт.) или купить на барахолке. После задания у Терапевта открываются бартеры, в том числе кейс для вещей.',
        en: 'Skier pays infected tissue samples for the daily tasks of his line; on Therapist\'s line they come with «For the Greater Good - An Agreement» (2) or from the flea market. Afterwards Therapist opens barters, the Item case among them.',
      },
    },
    {
      id: H.greaterGood,
      trader: THERAPIST,
      name: { ru: 'Halloween: Ради общей цели', en: 'Halloween: For the Greater Good' },
      aliases: ['Halloween: For the Common Goal'],
      after: [H.firstResults],
      experience: 24_000,
      objectives: [{ type: 'giveQuestItem', text: { ru: 'Передать данные о заражении Лыжнику', en: 'Hand over the infection data to Skier' } }],
      rewards: [[ROUBLES, 150_000], [LABS_KEYCARD, 4], ['5af0548586f7743a532b7e99', 2], ['590c695186f7741e566b64a2', 2]],
      note: {
        ru: 'Данные о заражении приходят в сообщении при взятии задания — передайте их Лыжнику в задании «Ради общей цели. Договор». Лыжник отдаст за них 2 образца тканей заражённых для «Изучения врага».',
        en: 'The infection data comes in a message with the task: hand it to Skier in «For the Greater Good - An Agreement». Skier pays 2 infected tissue samples for it, for «Studying the Enemy».',
      },
    },
    {
      id: H.greaterGoodAgreement,
      trader: SKIER,
      name: { ru: 'Halloween: Ради общей цели. Договор', en: 'Halloween: For the Greater Good - An Agreement' },
      aliases: ['Halloween: For the Common Goal. The Deal'],
      afterAccepted: [H.greaterGood],
      experience: 18_000,
      objectives: [{ type: 'giveQuestItem', text: { ru: 'Передать данные о заражении Лыжнику', en: 'Hand over the infection data to Skier' } }],
      rewards: [[EUROS, 1_800], [TISSUE_SAMPLE, 2]],
      note: {
        ru: 'Передайте Лыжнику данные о заражении из задания Терапевта «Ради общей цели».',
        en: 'Hand Skier the infection data of Therapist\'s «For the Greater Good».',
      },
    },
    {
      id: H.finalPush,
      trader: THERAPIST,
      name: { ru: 'Halloween: Последний рывок', en: 'Halloween: The Final Push' },
      aliases: ['Halloween: Final Push'],
      after: [H.greaterGood],
      experience: 60_000,
      objectives: [
        killInfected(30, INFECTED_MAPS, 'Убить заражённых, которые находятся под эффектом экспериментальной гранаты', 'Eliminate infected while they are under the effect of the experimental gas grenade'),
        { type: 'findItem', optional: true, text: { ru: '(опционально) Получить экспериментальную газовую гранату РДЭ-78', en: '(Optional) Obtain the RDE-78 experimental gas grenade' } },
        { type: 'shoot', maps: INFECTED_MAPS, shoot: { targets: ['InfectedTagilla'] }, text: { ru: 'Убить Заражённого Тагиллу', en: 'Eliminate the infected Tagilla' } },
      ],
      rewards: [[ROUBLES, 450_000], ['59fb042886f7746c5005a7b2', 1], [RDA78_VACCINE, 1], [VACCINE_PROTOTYPE, 2]],
      rewardNotes: [{ ru: 'Достижение «Торжество науки»', en: 'The «Triumph of Science» achievement' }],
      note: {
        ru: 'Терапевт открывает бартер на новые газовые гранаты РДЭ-78 (за образцы тканей заражённых). Газ РДЭ-78 сам убивает заражённых, а засчитываются только убитые из вашего оружия — стреляйте сразу после броска; лучше всего оружие с большим магазином или автоматический дробовик. Нужен противогаз или респиратор. Заражённый Тагилла есть на заражённых локациях — его тоже нужно убить. Последнее задание линии Терапевта.',
        en: 'Therapist opens a barter for the new RDE-78 gas grenades (for infected tissue samples). The RDE-78 gas kills the infected by itself and only kills with your weapon count, so shoot right after the throw; a big magazine or an automatic shotgun works best. Wear a gas mask or a respirator. The Infected Tagilla is on the infected locations and has to be killed too. The last task of Therapist\'s line.',
      },
    },
    {
      id: H.dangerZone,
      trader: SKIER,
      name: { ru: 'Halloween: Зона риска', en: 'Halloween: Danger Zone' },
      aliases: ['Halloween: Зона Риска'],
      after: [H.tightening],
      experience: 44_000,
      objectives: [
        { type: 'shoot', count: 15, maps: ['ground-zero', 'customs'], shoot: { targets: ['Any'] }, text: { ru: 'Устранить любую цель на локации Эпицентр или Таможня', en: 'Eliminate any target on Ground Zero or Customs' } },
        { type: 'shoot', count: 15, maps: ['woods', 'interchange'], shoot: { targets: ['Any'] }, text: { ru: 'Устранить любую цель на локации Лес или Развязка', en: 'Eliminate any target on Woods or Interchange' } },
        { type: 'shoot', count: 15, maps: ['streets-of-tarkov', 'shoreline'], shoot: { targets: ['Any'] }, text: { ru: 'Устранить любую цель на локации Улицы Таркова или Берег', en: 'Eliminate any target on Streets of Tarkov or Shoreline' } },
        { type: 'shoot', count: 15, maps: ['lighthouse', 'reserve'], shoot: { targets: ['Any'] }, text: { ru: 'Устранить любую цель на локации Маяк или Резерв', en: 'Eliminate any target on Lighthouse or Reserve' } },
      ],
      rewards: [[EUROS, 2_800], ['5910968f86f77425cf569c32', 1], ['5b44cd8b86f774503d30cba2', 1], [TISSUE_SAMPLE, 2]],
      note: {
        ru: 'Обычные, не заражённые локации: по 15 любых целей в каждой паре. Без глушителя Дикие сами идут на звук. Можно делать в группе. После задания у Терапевта открываются бартеры, а у Лыжника — ежедневные задания с образцами тканей заражённых.',
        en: 'The ordinary, not infected locations: 15 targets of any kind in each pair. Without a suppressor the Scavs come to the noise. It can be done in a group. Afterwards Therapist opens barters and Skier gives daily tasks that pay infected tissue samples.',
      },
    },
    {
      id: H.coincidence,
      trader: SKIER,
      name: { ru: 'Halloween: Совпадение?', en: 'Halloween: Coincidence?' },
      after: [H.dangerZone],
      experience: 42_000,
      objectives: [
        { type: 'visit', maps: ['lighthouse'], spots: HALLOWEEN_SPOTS.signal, text: { ru: 'Найти место распространения сигнала', en: 'Locate the source of the signal on Lighthouse' } },
        { type: 'findQuestItem', maps: ['lighthouse'], spots: HALLOWEEN_SPOTS.signal, text: { ru: 'Найти улики', en: 'Obtain any clues in the area' } },
        { type: 'giveQuestItem', text: { ru: 'Передать улики Лыжнику', en: 'Hand over the clues to Skier' } },
      ],
      rewards: [[EUROS, 2_700], ['64637076203536ad5600c990', 1], ['646372518610c40fc20204e8', 2], ['65702572c5d7d4cb4d078576', 10]],
      note: {
        ru: 'Источник сигнала — в здании №2 очистных сооружений на Маяке. Заходите со стороны выхода на машине (ворота промзоны), поверните направо к двери: на первом этаже комната с радиостанцией и картой мира. Папка с уликами лежит там же, у одной из дверей.',
        en: 'The signal comes from water treatment building no. 2 on Lighthouse. Enter from the vehicle exit side (the industrial zone gates) and turn right to the door: the room with the radio station and the world map is on the first floor. The folder with the clues is in the same room, by one of the doors.',
      },
    },
    {
      id: H.prototyping,
      trader: SKIER,
      name: { ru: 'Halloween: Прототипирование', en: 'Halloween: Prototyping' },
      after: [H.dangerZone],
      experience: 34_000,
      objectives: [
        { type: 'findQuestItem', text: { ru: 'Найти прототипы вакцины', en: 'Obtain the TG-Vi-24 vaccine prototypes' } },
        { type: 'giveItem', count: 2, items: [VACCINE_PROTOTYPE], text: { ru: 'Передать Лыжнику прототипы вакцины', en: 'Hand over the vaccine prototypes to Skier' } },
      ],
      rewards: [[EUROS, 1_800]],
      note: {
        ru: 'Прототипы вакцины TG-Vi-24 Терапевт платит за ежедневные задания своей линии; на линии Лыжника их можно получить за «Враг моего врага. Договор» (2 шт.) или купить на барахолке. После задания Лыжник открывает бартеры: AA-12 Gen 2, Sako TRG M10 и физический биткоин.',
        en: 'Therapist pays TG-Vi-24 vaccine prototypes for the daily tasks of his line; on Skier\'s line they come with «Enemy of My Enemy - An Agreement» (2) or from the flea market. Afterwards Skier opens barters: the AA-12 Gen 2, the Sako TRG M10 and the Physical Bitcoin.',
      },
    },
    {
      id: H.enemyOfEnemy,
      trader: SKIER,
      name: { ru: 'Halloween: Враг моего врага', en: 'Halloween: Enemy of My Enemy' },
      after: [H.coincidence],
      experience: 24_000,
      objectives: [{ type: 'giveQuestItem', text: { ru: 'Передать улики Терапевту', en: 'Hand over the clues to Therapist' } }],
      rewards: [[EUROS, 1_800], ['5ab8e79e86f7742d8b372e78', 3]],
      note: {
        ru: 'Лыжник присылает папку с уликами в сообщении — передайте её Терапевту в задании «Враг моего врага. Договор»: это засчитывает оба задания.',
        en: 'Skier sends the folder with the clues in a message: hand it to Therapist in «Enemy of My Enemy - An Agreement», which completes both tasks.',
      },
    },
    {
      id: H.enemyAgreement,
      trader: THERAPIST,
      name: { ru: 'Halloween: Враг моего врага. Договор', en: 'Halloween: Enemy of My Enemy - An Agreement' },
      afterAccepted: [H.enemyOfEnemy],
      experience: 18_000,
      objectives: [{ type: 'giveQuestItem', text: { ru: 'Передать улики Терапевту', en: 'Hand over the clues to Therapist' } }],
      rewards: [[ROUBLES, 150_000], [RDA78_VACCINE, 1], [VACCINE_PROTOTYPE, 2]],
      note: {
        ru: 'Передайте Терапевту папку, которую прислал Лыжник. В награду — вакцина РДЭ-78 (нужна для «Ослепить противника») и 2 прототипа вакцины TG-Vi-24 (для «Прототипирования»); открываются бартеры у Терапевта, Егеря, Прапора, Лыжника, Барахольщика и Миротворца.',
        en: 'Hand Therapist the folder Skier sent. The reward is the RDA-78 vaccine (for «Blind the Enemy») and 2 TG-Vi-24 vaccine prototypes (for «Prototyping»); it opens barters at Therapist, Jaeger, Prapor, Skier, Ragman and Peacekeeper.',
      },
    },
    {
      id: H.blindEnemy,
      trader: SKIER,
      name: { ru: 'Halloween: Ослепить противника', en: 'Halloween: Blind the Enemy' },
      after: [H.enemyOfEnemy],
      experience: 60_000,
      objectives: [
        { type: 'giveItem', items: [RDA78_VACCINE], text: { ru: 'Передать вакцину Лыжнику', en: 'Hand over the RDA-78 vaccine' } },
        { type: 'visit', count: 2, maps: ['woods'], spots: HALLOWEEN_SPOTS.woodsCameras, text: { ru: 'Уничтожить камеры в депо на локации Лес', en: 'Destroy the cameras at the train depot on Woods' } },
        { type: 'visit', count: 3, maps: ['customs'], spots: HALLOWEEN_SPOTS.customsCameras, text: { ru: 'Уничтожить камеры в общежитии на локации Таможня', en: 'Destroy the cameras at the dorms on Customs' } },
        { type: 'visit', count: 3, maps: ['lighthouse'], spots: HALLOWEEN_SPOTS.signal, text: { ru: 'Уничтожить камеры на очистных сооружениях на локации Маяк', en: 'Destroy the cameras at the water treatment plant on Lighthouse' } },
        { type: 'visit', count: 3, maps: ['reserve'], spots: HALLOWEEN_SPOTS.reserveDepot, text: { ru: 'Уничтожить камеры в депо на локации Резерв', en: 'Destroy the cameras at the train depot on Reserve' } },
        { type: 'visit', count: 3, maps: ['shoreline'], spots: HALLOWEEN_SPOTS.resort, text: { ru: 'Уничтожить камеры в санатории на локации Берег', en: 'Destroy the cameras at the Health Resort on Shoreline' } },
      ],
      rewards: [[EUROS, 4_000], ['59fb023c86f7746d0d4b423c', 1]],
      rewardNotes: [{ ru: 'Достижение «Поднять щиты!»', en: 'The «Shields Up!» achievement' }],
      note: {
        ru: 'Вакцина РДЭ-78 — награда за «Враг моего врага. Договор». Камеры: Лес — депо (стрела крана, край зелёного контейнера); Таможня — общежития (угол крыши двухэтажной общаги, подоконники второго этажа трёхэтажной); Маяк — здание №2 очистных (у АГС и у фонаря на краю крыши, на синей вентиляции под потолком внутри); Резерв — вокзал в депо (крыша и второй этаж); Берег — санаторий (балкон третьего этажа западного крыла, над переходом ближе к восточному крылу, край кирпичной пристройки за восточным крылом). Последнее задание линии Лыжника.',
        en: 'The RDA-78 vaccine comes with «Enemy of My Enemy - An Agreement». The cameras: Woods, the depot (the crane boom, the edge of a green container); Customs, the dorms (the roof corner of the two-story dorm, second-floor windowsills of the three-story one); Lighthouse, water treatment building no. 2 (by the AGS and by the lamp on the roof edge, on the blue ventilation under the ceiling inside); Reserve, the station at the depot (its roof and second floor); Shoreline, the Health Resort (the third-floor balcony of the west wing, above the walkway near the east wing, the edge of the brick annex behind the east wing). The last task of Skier\'s line.',
      },
    },
  ],
}

/** Every curated series. */
export const CURATED_SERIES: readonly CuratedSeries[] = [TO_THE_LIGHT, BALANCE_SHIFT, LIGHTHOUSE_BTR, BOREAS_RAGMAN, SCOURGE_INVASION, HALLOWEEN_2026]

/** The game's other ids of the curated quests → the id the app keeps the quest under (src/quests/questInputs.ts). */
export const CURATED_QUEST_IDS_BY_OTHER: ReadonlyMap<string, string> = new Map(CURATED_SERIES.flatMap((series) => series.quests.flatMap((quest) => (quest.otherIds ?? []).map((other) => [other, quest.id] as const))))

export interface CuratedTaskContext {
  mode: RaidMode
  locale: AppLocale
  /** tarkov.dev `<mode>/maps` (the places the objectives point at). */
  maps: JsonRecord
  /** tarkov.dev `<mode>/traders`: a quest is added only when the feed has its trader. */
  traders: JsonRecord
  /** The series to add: default the built-in ones; the server and the app pass them with the owner's event quests (src/data/eventQuestDefinitions.ts). */
  series?: readonly CuratedSeries[]
  /** For the events' end (`endsAt`); default now. */
  now?: number
}

export interface CuratedTasks {
  /** The tasks file with the curated tasks it lacked. */
  tasks: JsonRecord
  /** Ids of the tasks added (tarkov.dev did not have them). */
  added: ReadonlySet<string>
}

/** Whether a quest is shown at all: not switched off and its event (the quest's own end, else the series') not over. */
export function curatedQuestLive(series: CuratedSeries, quest: CuratedQuest, now: number = Date.now()) {
  if (quest.hidden) return false
  const end = Date.parse(quest.endsAt ?? series.endsAt ?? '')
  return !Number.isFinite(end) || now < end
}

/** The modes a quest is in: its own, else its series'. */
export function curatedQuestModes(series: CuratedSeries, quest: CuratedQuest): readonly RaidMode[] {
  return quest.modes ?? series.modes
}

/** The shown quests of a series, in its order: «задание N из M» counts these. */
function liveQuests(series: CuratedSeries, now: number) {
  return series.quests.filter((quest) => curatedQuestLive(series, quest, now))
}

/** The curated quests this mode has, with their series and their place in it (1-based, among the series' shown quests). */
export function curatedQuestsFor(mode: RaidMode, list: readonly CuratedSeries[] = CURATED_SERIES, now: number = Date.now()): Array<{ series: CuratedSeries; quest: CuratedQuest; order: number }> {
  return list.flatMap((series) => liveQuests(series, now).map((quest, index) => ({ series, quest, order: index + 1 })))
    .filter(({ series, quest }) => curatedQuestModes(series, quest).includes(mode))
}

/**
 * The tarkov.dev tasks file with the curated tasks it does not have, in tarkov.dev's shape and already in the catalog's
 * language. «Источник информации», which tarkov.dev lists without a previous task since the series' last task left its
 * data, gets that task as its previous one again (only while tarkov.dev gives it none).
 */
export function withCuratedTasks(tasksRoot: JsonRecord, context: CuratedTaskContext): CuratedTasks {
  const tasks = asRecord(tasksRoot.tasks)
  const traderIds = new Set(Object.values(context.traders).map((entry) => text(asRecord(entry).id)).filter(Boolean))
  const spots = spotIndex(context.maps, tasks)
  const added = new Set<string>()
  const next: JsonRecord = { ...tasks }
  // A quest tarkov.dev already lists under its own id (our id is not the game's): the same title in this language.
  const titles = new Set(Object.values(tasks).map((task) => text(asRecord(task).name).trim().toLowerCase()).filter(Boolean))
  for (const { quest } of curatedQuestsFor(context.mode, context.series ?? CURATED_SERIES, context.now ?? Date.now())) {
    if (tasks[quest.id] || !traderIds.has(quest.trader)) continue
    if ([quest.name[context.locale], ...(quest.aliases ?? [])].some((title) => titles.has(title.trim().toLowerCase()))) continue
    next[quest.id] = rawTask(quest, context.mode, context.locale, spots)
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
export function applyCuratedQuestNotes(
  quests: Quest[], added: ReadonlySet<string>, locale: AppLocale, items: Map<string, Item>,
  list: readonly CuratedSeries[] = CURATED_SERIES, now: number = Date.now(),
): Quest[] {
  if (!added.size) return quests
  const curated = new Map(list.flatMap((series) => {
    const live = liveQuests(series, now)
    return live.map((quest, index) => [quest.id, { series, quest, order: index + 1, total: live.length }] as const)
  }))
  const itemName = (id: string) => items.get(id)?.name ?? id
  return quests.map((row) => {
    const entry = added.has(row.id) ? curated.get(row.id) : undefined
    if (!entry) return row
    const { series, quest, order, total } = entry
    const route = series.route[locale].trim()
    const lead = locale === 'en'
      ? `${series.name.en} series${route ? ` (${route})` : ''}, task ${order} of ${total}.`
      : `Серия «${series.name.ru}»${route ? ` (${route})` : ''}, задание ${order} из ${total}.`
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
      ...(quest.skills ?? []).map((skill) => skill[locale]),
      ...(quest.rewardNotes ?? []).map((line) => line[locale]),
      ...(quest.startRewards ?? []).map(([itemId, count]) => `${locale === 'en' ? 'On taking the task' : 'При взятии задания'}: ${itemName(itemId)} × ${count}`),
      ...(quest.craftUnlock ? [`${locale === 'en' ? 'Unlocks the craft' : 'Открывает крафт'}: ${itemName(quest.craftUnlock.itemId)} (${quest.craftUnlock.station[locale]})`] : []),
    ]
    const aliases = [...new Set([...(row.ocrAliases ?? []), ...(quest.aliases ?? [])])]
    const note = quest.note[locale].trim()
    return {
      ...row,
      curatedSeriesId: series.id,
      description: note ? `${lead} ${note}` : lead,
      ...(quest.guideImages?.length ? { guideImages: quest.guideImages.map((image) => ({ file: image.file, caption: image.caption[locale] })) } : {}),
      ...(aliases.length ? { ocrAliases: aliases } : {}),
      rewards: [...row.rewards, ...extraRewards],
      raidRequirements: [...(row.raidRequirements ?? []), ...bring],
    }
  })
}

/** Coordinates of the places the curated objectives may point at, keyed `map|kind|id`. */
type SpotIndex = Map<string, JsonRecord>

function spotIndex(mapsRoot: JsonRecord, tasks: JsonRecord): SpotIndex {
  const index: SpotIndex = new Map()
  const mapNames = new Map<string, string>()
  for (const map of Object.values(asRecord(mapsRoot.maps)).map(asRecord)) {
    const name = text(map.normalizedName)
    if (!name) continue
    if (text(map.id)) mapNames.set(text(map.id), name)
    for (const transit of asArray(map.transits)) index.set(`${name}|transit|${text(transit.id)}`, transit)
    for (const extract of asArray(map.extracts)) index.set(`${name}|extract|${text(extract.id)}`, extract)
    for (const lock of asArray(map.locks)) if (text(lock.key)) index.set(`${name}|lock|${text(lock.key)}`, lock)
  }
  // Zones of other tasks: tarkov.dev names their map by id (or, in older files, by normalizedName).
  for (const task of Object.values(tasks).map(asRecord)) {
    for (const objective of asArray(task.objectives)) {
      for (const zone of asArray(objective.zones)) {
        const map = mapNames.get(text(zone.map)) ?? text(zone.map)
        const key = `${map}|task|${text(task.id)}|${text(zone.id)}`
        if (text(zone.id) && !index.has(key)) index.set(key, zone)
      }
    }
  }
  return index
}

function spotKey(spot: CuratedSpot) {
  if ('transit' in spot) return `${spot.map}|transit|${spot.transit}`
  if ('extract' in spot) return `${spot.map}|extract|${spot.extract}`
  if ('lockKey' in spot) return `${spot.map}|lock|${spot.lockKey}`
  if ('taskZone' in spot) return `${spot.map}|task|${spot.taskZone.task}|${spot.taskZone.zone}`
  if ('point' in spot) return `${spot.map}|point|${spot.point.id}`
  return `${spot.map}|archived|${spot.archived.id}`
}

function spotZoneId(spot: CuratedSpot) {
  if ('transit' in spot) return `transit-${spot.transit}`
  if ('extract' in spot) return `extract-${spot.extract}`
  if ('lockKey' in spot) return `lock-${spot.lockKey}`
  if ('taskZone' in spot) return `zone-${spot.taskZone.zone}`
  if ('point' in spot) return `point-${spot.point.id}`
  return `zone-${spot.archived.id}`
}

/**
 * A zone of tarkov.dev's shape at the place, with its position, outline and heights exactly as the file has them (a
 * `building` place keeps its position only: the room's outline is not where the objective is; with a `floor`, that floor's
 * heights instead of the room's height).
 */
function zoneAt(spot: CuratedSpot, spots: SpotIndex): JsonRecord | undefined {
  // a marked point: its position only (the community map gives no height)
  if ('point' in spot) return { id: spotZoneId(spot), map: spot.map, position: { x: spot.point.x, z: spot.point.z } }
  const place = 'archived' in spot ? spot.archived as unknown as JsonRecord : spots.get(spotKey(spot))
  const position = asRecord(place?.position)
  if (!place || typeof position.x !== 'number' || typeof position.z !== 'number') return undefined
  if (spot.building) {
    return {
      id: spotZoneId(spot),
      map: spot.map,
      position: spot.floor ? { x: position.x, z: position.z } : position,
      ...(spot.floor ? { bottom: spot.floor[0], top: spot.floor[1] } : {}),
    }
  }
  return {
    id: spotZoneId(spot),
    map: spot.map,
    position,
    ...(Array.isArray(place.outline) ? { outline: place.outline } : {}),
    ...(typeof place.top === 'number' ? { top: place.top } : {}),
    ...(typeof place.bottom === 'number' ? { bottom: place.bottom } : {}),
  }
}

function rawTask(quest: CuratedQuest, mode: RaidMode, locale: AppLocale, spots: SpotIndex): JsonRecord {
  const items = (list: Array<[string, number]> = []) => list.map(([item, count]) => ({ item, count, attributes: {} }))
  return {
    id: quest.id,
    name: quest.name[locale],
    trader: quest.trader,
    minPlayerLevel: 0,
    taskRequirements: [
      ...(quest.after ?? []).map((task) => ({ task, status: ['complete'] })),
      ...(quest.afterAccepted ?? []).map((task) => ({ task, status: ['active', 'complete'] })),
      ...(quest.afterDecided ?? []).map((task) => ({ task, status: ['complete', 'failed'] })),
    ],
    traderRequirements: (quest.loyalty ?? []).map(([trader, value]) => ({ trader, requirementType: 'level', compareMethod: '>=', value })),
    otherRequirements: quest.dialogue ? [{ type: 'dialogue', traders: [quest.trader] }] : quest.opensInGame ? [{ type: 'storyStage' }] : [],
    objectives: quest.objectives.map((objective, index) => rawObjective(quest.id, index, objective, locale, spots)),
    failConditions: [],
    startRewards: { items: items(quest.startRewards), craftUnlock: quest.craftUnlock ? [{ items: [{ item: quest.craftUnlock.itemId, count: 1 }] }] : [] },
    finishRewards: {
      items: items(quest.modeRewards?.[mode] ?? quest.rewards),
      traderStanding: (quest.standing ?? []).map(([trader, standing]) => ({ trader, standing })),
    },
    experience: quest.experience,
    factionName: 'Any',
    neededKeys: [],
    availableDelaySecondsMin: quest.delay?.[0] ?? 0,
    availableDelaySecondsMax: quest.delay?.[1] ?? 0,
    normalizedName: slug(quest.name.en) || slug(quest.id),
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
