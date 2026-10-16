import type { Quest } from '../domain/types'
import { STORY_CHAPTER_SEEDS } from '../data/storyChapterSeeds'

/**
 * «Концовки» — the four endings of Escape from Tarkov and the choices that lead to them, from the owner's flowchart
 * (12.10.2026: «внедри в нашу програму данные по концовкам… если на каких то этапах или квестах есть решающее
 * событие, то в квесте… должно сообщаться что такое то решение приведет туда то»; «если нужно будет удалим» — the
 * whole thing lives in src/endings/ and is switched off by `storyEndings` in src/app/archivedFeatures.ts).
 * The English names of the achievements are translations of the flowchart's Russian ones.
 */

export type EndingId = 'survivor' | 'savior' | 'fallen' | 'debtor'

export interface Phrase { ru: string; en: string }

export interface EndingStep {
  text: Phrase
  /** A craft or an achievement on the way, a warning, or a step only for one mode / one earlier choice. */
  kind?: 'craft' | 'achievement' | 'warning'
  when?: Phrase
}

export interface StoryEnding {
  id: EndingId
  name: Phrase
  /** The choices that lead here. */
  route: Phrase
  steps: EndingStep[]
  /** How to leave through the port Terminal. */
  escape: Phrase
  /** What to do when the attempt fails. */
  retry: Phrase
}

const p = (ru: string, en: string): Phrase => ({ ru, en })

const CASE_GIVEN = p('если кейс отдан Прапору', 'if the case went to Prapor')
const CASE_KEPT = p('если кейс оставлен себе', 'if you kept the case')
const PVP = p('PvP', 'PvP')
const PVE = p('PvE', 'PvE')

/** Woods: the case from the fallen plane, given to Prapor or kept («Небеса в огне»), then opened («Билет»). */
export const ENDINGS_START = {
  take: p('Забрать кейс из упавшего самолёта в Лесу', 'Take the case from the fallen plane on Woods'),
  give: {
    choice: p('Передать кейс Прапору', 'Hand the case over to Prapor'),
    steps: [
      p('Найти компромат на Прапора в его лагере на Маяке', 'Find dirt on Prapor in his camp on Lighthouse'),
      p('Получить доступ к Смотрителю Маяка (Механик выдаёт «Сетевой провайдер. Часть 1»)', 'Get access to Lightkeeper (Mechanic gives out “Network Provider - Part 1”)'),
      p('Поговорить со Смотрителем и передать ему 3 папки «синих документов TerraGroup»', 'Talk to Lightkeeper and hand him 3 TerraGroup “blue folders”'),
      p('Запустить жёлтую сигнальную ракету напротив входа в ТЦ «Ультра» на Развязке', 'Fire a yellow flare opposite the ULTRA mall entrance on Interchange'),
      p('Убить 15 любых целей внутри ТЦ «Ультра» за один рейд и выжить', 'Kill 15 targets of any kind inside ULTRA in one raid and survive'),
      p('Доложить Смотрителю и забрать у него кейс', 'Report to Lightkeeper and take the case back from him'),
    ],
  },
  keep: { choice: p('Оставить кейс у себя', 'Keep the case') },
  open: p('Открыть кейс, найдя подавитель сигналов на Лаборатории', 'Open the case with the signal jammer found on the Lab'),
  openCraft: p('Крафт 55 часов на Верстаке', 'Craft: 55 hours at the Workbench'),
  opened: p('Кейс открыт', 'The case is open'),
}

/** «Сотрудничать с мистером Керманом»: the road the three Kerman endings share up to the intercom on Shoreline. */
export const KERMAN_ROAD: EndingStep[] = [
  { text: p('Найти «Мастер-ключ» на Лаборатории', 'Find the master pass on the Lab') },
  { text: p('Не найти шифратор RFID-карт на Лаборатории и поговорить с Механиком', 'Fail to find the RFID card encoder on the Lab and talk to Mechanic') },
  { text: p('Заплатить Механику 40 BTC за информацию', 'Pay Mechanic 40 BTC for the information') },
  { text: p('Получить у Механика ключ от квартиры и забрать там шифратор RFID-карт', 'Get the apartment key from Mechanic and take the RFID card encoder there') },
  { text: p('Активировать RFID-карту на имя Круглова из кейса', 'Activate the RFID card in Kruglov\'s name from the case') },
  { text: p('Крафт 50 часов в Разведцентре', 'Craft: 50 hours in the Intelligence Center'), kind: 'craft' },
  { text: p('Использовать активированную ключ-карту в интеркоме на Береге', 'Use the activated keycard at the intercom on Shoreline') },
]

const CARD_ESCAPE = p(
  'Подойти к интеркому портового Терминала с 22:00 до 4:00, провести ключ-картой, убрать оружие в рюкзак, подойти к воротам Терминала, активировать переход и перейти на Терминал',
  'Come to the port Terminal intercom between 22:00 and 4:00, swipe the keycard, put your weapons in the backpack, walk to the Terminal gates, activate the passage and cross to the Terminal',
)
const CARD_RETRY = p(
  'Если попытка провалена — каждый раз заново крафтить карту (11 часов); для крафта нужна чистая RFID-карта',
  'If the attempt fails, craft the card again each time (11 hours); the craft needs a clean RFID card',
)

export const ENDINGS: StoryEnding[] = [
  {
    id: 'survivor',
    name: p('Выживший', 'Survivor'),
    route: p('Отказаться от сотрудничества с мистером Керманом', 'Refuse to cooperate with Mr. Kerman'),
    steps: [
      { text: p('Использовать карту из кейса у входа в Терминал', 'Use the card from the case at the Terminal entrance') },
      { text: p('Карта не работает — попросить помощи у Прапора', 'The card does not work: ask Prapor for help') },
      { text: p('Прапор просит 300кк', 'Prapor asks for 300kk'), when: CASE_GIVEN },
      { text: p('Прапор просит 500кк и даёт дополнительные задания', 'Prapor asks for 500kk and gives extra tasks'), when: CASE_KEPT },
      { text: p('Найти отчёты об исследованиях TerraGroup на Лаборатории', 'Find the TerraGroup research reports on the Lab'), when: CASE_KEPT },
      { text: p('Крафт 5 часов в Разведцентре', 'Craft: 5 hours in the Intelligence Center'), kind: 'craft', when: CASE_KEPT },
      { text: p('Отдать Прапору флешку с данными после крафта', 'Give Prapor the flash drive with the data after the craft'), when: CASE_KEPT },
      { text: p('Убить 50 любых целей на Улицах Таркова', 'Kill 50 targets of any kind on Streets of Tarkov'), when: CASE_KEPT },
      { text: p('Убить 4 ЧВК за один рейд и выжить в этом рейде', 'Kill 4 PMCs in one raid and survive it'), when: CASE_KEPT },
      { text: p('Быстрее чем за 72 часа — достижение «Я — скорость»', 'Faster than 72 hours: the “I Am Speed” achievement'), kind: 'achievement', when: CASE_KEPT },
      { text: p('Не успели за 72 часа — Прапор потребует контейнер «Каппа»', 'Not done within 72 hours: Prapor demands the Kappa container'), kind: 'warning', when: CASE_KEPT },
      { text: p('Прапор выдаёт «записку с деньгами» — проход в Терминал', 'Prapor gives the “note with money”: the pass to the Terminal') },
      { text: p('Достижение «Лёгкий путь»', 'The “Easy Way” achievement'), kind: 'achievement' },
    ],
    escape: p(
      'Подойти к интеркому портового Терминала с 22:00 до 4:00, нажать кнопку, затем подойти к воротам Терминала, убрав оружие в рюкзак, передать «записку с деньгами» от Прапора и перейти в Терминал',
      'Come to the port Terminal intercom between 22:00 and 4:00 and press the button, then walk to the Terminal gates with your weapons in the backpack, hand over Prapor\'s “note with money” and cross to the Terminal',
    ),
    retry: p('Если попытка провалена — купить новую записку у Прапора за 5кк (2 штуки за завоз)', 'If the attempt fails, buy a new note from Prapor for 5kk (2 per restock)'),
  },
  {
    id: 'savior',
    name: p('Спаситель', 'Savior'),
    route: p('Сотрудничать с мистером Керманом и помочь ему собрать компромат на TerraGroup', 'Cooperate with Mr. Kerman and help him collect dirt on TerraGroup'),
    steps: [
      { text: p('Убедитесь, что прочитали ВСЕ записки и прослушали ВСЕ аудиокассеты, найденные по заданиям', 'Make sure you have read ALL the notes and listened to ALL the audio cassettes found during the tasks'), kind: 'warning' },
      { text: p('Выполнить ВСЕ оставшиеся сюжетные задания', 'Complete ALL the remaining story tasks') },
      { text: p('Дождаться, когда доверенное лицо Кермана выйдет на связь', 'Wait for Kerman\'s trusted contact to get in touch') },
      { text: p('Поднять репутацию у Скупщика до 4.0', 'Raise your standing with Fence to 4.0') },
      { text: p('Совершить совместный выход в Лесу и на Резерве', 'Use the co-op extracts on Woods and Reserve'), when: PVP },
      { text: p('Убить 5 ЧВК за один рейд, не убивая Диких, на Береге и Развязке', 'Kill 5 PMCs in one raid without killing Scavs, on Shoreline and Interchange'), when: PVE },
      { text: p('Поднять репутацию у Водителя БТР до 0.4 (нужно выполнить ВСЕ его задания)', 'Raise your standing with the BTR Driver to 0.4 (all of his tasks are needed)') },
      { text: p('Провалите задания Водителя БТР, встав на сторону Лыжника, — путь уйдёт в «Выживший»: Прапор попросит 500кк и даст дополнительные задания', 'Fail the BTR Driver\'s tasks by siding with Skier and the road turns to “Survivor”: Prapor asks for 500kk and gives extra tasks'), kind: 'warning' },
      { text: p('Построить Солнечную электростанцию в Убежище', 'Build the Solar power in the Hideout') },
      { text: p('Скрафтить финальную ключ-карту с хеш-кодами от Кермана', 'Craft the final keycard with Kerman\'s hash codes'), kind: 'craft' },
    ],
    escape: CARD_ESCAPE,
    retry: CARD_RETRY,
  },
  {
    id: 'fallen',
    name: p('Падший', 'Fallen'),
    route: p('Сотрудничать с мистером Керманом, но не помогать ему собирать компромат', 'Cooperate with Mr. Kerman but do not help him collect the dirt'),
    steps: [
      { text: p('Достижение «Хватит твоих игр»', 'The “Enough of Your Games” achievement'), kind: 'achievement' },
      { text: p('Поговорить с Прапором', 'Talk to Prapor') },
      { text: p('Передать 40 наборов для ремонта брони или оружия (100% прочности, можно без «найдено в рейде»)', 'Hand over 40 armor or weapon repair kits (100% durability, found in raid not needed)'), when: CASE_KEPT },
      { text: p('Передать на выбор защищённый контейнер — «Гамма», «Тета» или «Эпсилон»', 'Hand over a secure container of your choice: Gamma, Theta or Epsilon'), when: CASE_KEPT },
      { text: p('Передать 50 предметов военной электроники', 'Hand over 50 military electronics items'), when: CASE_KEPT },
      { text: p('Забрать «Кейс с БИО-оружием» на Резерве в РБ-ПКПТС и передать его Прапору', 'Take the “bio-weapon case” in RB-PKPTS on Reserve and hand it to Prapor') },
      { text: p('Достижение «А оно взорвётся?»', 'The “Will It Blow?” achievement'), kind: 'achievement' },
      { text: p('Передать Прапору 1 000 000 $', 'Hand Prapor $1,000,000') },
      { text: p('Прождать 48 часов и получить от Прапора флешку с хеш-кодами', 'Wait 48 hours and get the flash drive with the hash codes from Prapor') },
      { text: p('Построить Солнечную электростанцию в Убежище', 'Build the Solar power in the Hideout') },
      { text: p('Скрафтить финальную ключ-карту с хеш-кодами Прапора', 'Craft the final keycard with Prapor\'s hash codes'), kind: 'craft' },
    ],
    escape: CARD_ESCAPE,
    retry: CARD_RETRY,
  },
  {
    id: 'debtor',
    name: p('Должник', 'Debtor'),
    route: p('Начать собирать компромат, передать часть Керману, а потом отказаться продолжать', 'Start collecting the dirt, give part of it to Kerman, then refuse to go on'),
    steps: [
      { text: p('Достижение «Поворот не туда»', 'The “Wrong Turn” achievement'), kind: 'achievement' },
      { text: p('Поговорить со Смотрителем Маяка', 'Talk to Lightkeeper') },
      { text: p('Найти материалы топографической разведки для Смотрителя (5 карт, каждая на своей локации)', 'Find topographic survey materials for Lightkeeper (5 maps, each on its own location)') },
      { text: p('Крафт 6 часов в Разведцентре', 'Craft: 6 hours in the Intelligence Center'), kind: 'craft' },
      { text: p('Передать Смотрителю оцифрованные материалы после крафта', 'Hand the digitized materials to Lightkeeper after the craft') },
      { text: p('Убить 30 ЧВК в Лесу и передать Смотрителю 100 жетонов ЧВК', 'Kill 30 PMCs on Woods and hand Lightkeeper 100 PMC dogtags') },
      { text: p('Найти амулеты сектантов во всех меченых комнатах', 'Find the cultist amulets in all the marked rooms') },
      { text: p('Заложить амулеты в меченой комнате на Маяке', 'Stash the amulets in the marked room on Lighthouse') },
      { text: p('Доложить Смотрителю и получить у него ключ-карту от Терминала', 'Report to Lightkeeper and get the Terminal keycard from him') },
    ],
    escape: CARD_ESCAPE,
    retry: p('Если попытка провалена — каждый раз покупать новую карту доступа у Смотрителя в обмен на «Синие документы TerraGroup»', 'If the attempt fails, buy a new access card from Lightkeeper each time for TerraGroup “blue folders”'),
  },
]

export const ENDINGS_NOTE = p(
  'Каждая концовка даёт свою награду и достижение. Пройти игру всеми четырьмя концовками можно — это открывается после прохождения Терминала.',
  'Each ending has its own reward and achievement. All four can be played: that opens up after you get through the Terminal.',
)

export interface DecisionOption {
  choice: Phrase
  /** Where it leads. */
  outcome: Phrase
  endings: EndingId[]
  /** The chapter stage (its Russian title, as in the game) that is this choice: the stage shows where it leads. */
  stage?: string
}

export interface StoryDecision {
  id: string
  /** Story chapters (STORY_CHAPTER_SEEDS ids) where it is decided or prepared. */
  chapters: string[]
  title: Phrase
  options: DecisionOption[]
  /** Chapter stages the whole decision hangs on (a deadline): they show all of its options. */
  stages?: string[]
}

export const STORY_DECISIONS: StoryDecision[] = [
  {
    id: 'armored-case',
    chapters: ['falling-skies'],
    title: p('Решающий выбор: бронированный кейс', 'A deciding choice: the armored case'),
    options: [
      {
        choice: p('Отдать кейс Прапору', 'Give the case to Prapor'),
        stage: 'Передать бронированный кейс Прапору',
        outcome: p(
          'Кейс придётся вернуть через Смотрителя: компромат в лагере Прапора на Маяке, 3 «синие папки», ракета у «Ультры», 15 целей внутри. Зато дальше дешевле: в «Выжившем» Прапор попросит 300кк без доп. заданий, в «Падшем» не нужны ремкомплекты, защищённый контейнер и военная электроника.',
          'You win the case back through Lightkeeper: dirt in Prapor\'s camp on Lighthouse, 3 “blue folders”, a flare at ULTRA, 15 kills inside. Later it is cheaper: in “Survivor” Prapor asks 300kk with no extra tasks, in “Fallen” no repair kits, secure container or military electronics.',
        ),
        endings: ['survivor', 'savior', 'fallen', 'debtor'],
      },
      {
        choice: p('Оставить кейс себе', 'Keep the case'),
        stage: 'Оставить бронированный кейс себе',
        outcome: p(
          'Кейс сразу ваш (откроете подавителем сигналов с Лаборатории). Дальше дороже: в «Выжившем» Прапор попросит 500кк и даст задания на 72 часа (не успели — потребует контейнер «Каппа»), в «Падшем» — 40 ремкомплектов, защищённый контейнер и 50 военной электроники.',
          'The case is yours at once (open it with the signal jammer from the Lab). Later it costs more: in “Survivor” Prapor asks 500kk plus 72 hours of tasks (miss them and he demands the Kappa container), in “Fallen” 40 repair kits, a secure container and 50 military electronics.',
        ),
        endings: ['survivor', 'savior', 'fallen', 'debtor'],
      },
    ],
  },
  {
    id: 'kerman-offer',
    chapters: ['the-ticket'],
    title: p('Решающий выбор: предложение мистера Кермана', 'A deciding choice: Mr. Kerman\'s offer'),
    options: [
      {
        choice: p('Отказаться от сотрудничества', 'Refuse to cooperate'),
        stage: 'Отказаться от предложения мистера Кермана о сотрудничестве',
        outcome: p('Концовка «Выживший»: проход в Терминал через Прапора, «записка с деньгами».', 'The “Survivor” ending: the way into the Terminal goes through Prapor and his “note with money”.'),
        endings: ['survivor'],
      },
      {
        choice: p('Сотрудничать', 'Cooperate'),
        stage: 'Принять предложение мистера Кермана о сотрудничестве',
        outcome: p('Дорога к «Спасителю», «Падшему» или «Должнику»: мастер-ключ с Лаборатории, 40 BTC Механику, шифратор RFID, карта Круглова (крафт 50 ч) и интерком на Береге — там следующий выбор.', 'The road to “Savior”, “Fallen” or “Debtor”: the Lab master pass, 40 BTC to Mechanic, the RFID encoder, Kruglov\'s card (50 h craft) and the intercom on Shoreline, where the next choice waits.'),
        endings: ['savior', 'fallen', 'debtor'],
      },
    ],
  },
  {
    id: 'kerman-evidence',
    chapters: ['the-ticket'],
    title: p('Решающий выбор: компромат на TerraGroup', 'A deciding choice: the dirt on TerraGroup'),
    options: [
      { choice: p('Помочь собрать компромат', 'Help collect the dirt'), outcome: p('Концовка «Спаситель».', 'The “Savior” ending.'), endings: ['savior'], stage: 'Согласиться искать для мистера Кермана компромат на TerraGroup' },
      { choice: p('Не помогать собирать компромат', 'Do not help collect it'), outcome: p('Концовка «Падший» (достижение «Хватит твоих игр»).', 'The “Fallen” ending (the “Enough of Your Games” achievement).'), endings: ['fallen'] },
      { choice: p('Начать собирать, передать часть и отказаться', 'Start, give part of it, then refuse'), outcome: p('Концовка «Должник» (достижение «Поворот не туда»).', 'The “Debtor” ending (the “Wrong Turn” achievement).'), endings: ['debtor'], stage: 'Предать мистера Кермана и оставить улики себе' },
    ],
  },
  {
    id: 'prapor-72h',
    chapters: ['the-ticket'],
    title: p('Важно: задания Прапора на 72 часа', 'Mind the clock: Prapor\'s 72-hour tasks'),
    stages: ['Вовремя выполнить все задания Прапора'],
    options: [
      { choice: p('Успеть за 72 часа', 'Make it within 72 hours'), outcome: p('Достижение «Я — скорость».', 'The “I Am Speed” achievement.'), endings: ['survivor'] },
      { choice: p('Не успеть', 'Miss the time'), outcome: p('Прапор потребует защищённый контейнер «Каппа».', 'Prapor demands the Kappa secure container.'), endings: ['survivor'] },
    ],
  },
  {
    id: 'evidence-notes',
    chapters: ['batya', 'the-unheard', 'they-are-already-here'],
    title: p('Для концовки «Спаситель»', 'For the “Savior” ending'),
    options: [
      { choice: p('Читайте все записки и слушайте все аудиокассеты', 'Read every note and play every audio cassette'), outcome: p('Найденные по заданиям записки и кассеты — улики для мистера Кермана; без них «Спаситель» не откроется.', 'The notes and cassettes found during the tasks are the evidence for Mr. Kerman; “Savior” does not open without them.'), endings: ['savior'] },
    ],
  },
]

/** The BTR Driver's tasks: failing them (siding with Skier) closes «Savior». */
export const BTR_DRIVER_DECISION: StoryDecision = {
  id: 'btr-driver',
  chapters: [],
  title: p('Решающее: задания Водителя БТР', 'Deciding: the BTR Driver\'s tasks'),
  options: [
    { choice: p('Выполнить все его задания (репутация 0.4)', 'Complete all of his tasks (standing 0.4)'), outcome: p('Нужно для концовки «Спаситель».', 'Needed for the “Savior” ending.'), endings: ['savior'] },
    { choice: p('Провалить их, встав на сторону Лыжника', 'Fail them by siding with Skier'), outcome: p('«Спаситель» закроется — путь уйдёт в «Выживший»: Прапор попросит 500кк и даст дополнительные задания.', '“Savior” closes and the road turns to “Survivor”: Prapor asks for 500kk and gives extra tasks.'), endings: ['survivor'] },
  ],
}

const normalize = (value: string) => value.toLowerCase().replace(/ё/g, 'е').replace(/[«»"]/g, '').replace(/\s+/g, ' ').trim()

/** The story chapter (STORY_CHAPTER_SEEDS id) a quest is: by its seed id, its id, or one of the chapter's names. */
export function storyChapterId(quest: Pick<Quest, 'id' | 'name' | 'normalizedName' | 'kind'>): string | undefined {
  if (quest.kind !== 'story') return undefined
  const name = normalize(quest.name)
  return STORY_CHAPTER_SEEDS.find((chapter) => chapter.id === quest.normalizedName || `story-${chapter.id}` === quest.id
    || [chapter.ru, chapter.en, ...chapter.aliases].some((alias) => normalize(alias) === name))?.id
}

/** The deciding choices of a story chapter, or of a BTR Driver's task. */
export function decisionsFor(quest: Pick<Quest, 'id' | 'name' | 'normalizedName' | 'kind' | 'trader'>): StoryDecision[] {
  if (/водитель бтр|btr driver/i.test(quest.trader)) return [BTR_DRIVER_DECISION]
  const chapter = storyChapterId(quest)
  return chapter ? STORY_DECISIONS.filter((decision) => decision.chapters.includes(chapter)) : []
}

const sameStage = (text: string, stage: string) => {
  const key = normalize(text)
  const wanted = normalize(stage)
  return Boolean(key) && (key === wanted || key.includes(wanted) || (key.length >= 12 && wanted.includes(key)))
}

/** The deciding choice made at this stage of a chapter (its game wording): the option it is, or the whole decision. */
export function decisionAtStage(text: string): { decision: StoryDecision; option?: DecisionOption } | undefined {
  for (const decision of STORY_DECISIONS) {
    const option = decision.options.find((entry) => entry.stage && sameStage(text, entry.stage))
    if (option) return { decision, option }
    if (decision.stages?.some((stage) => sameStage(text, stage))) return { decision }
  }
  return undefined
}

export const endingName = (id: EndingId) => ENDINGS.find((ending) => ending.id === id)!.name
