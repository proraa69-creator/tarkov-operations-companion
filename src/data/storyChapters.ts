import type { Quest, QuestStage } from '../domain/types'
import { STORY_BRANCHES, STORY_CHAPTER_SEEDS, STORY_NEEDS, TOUR_STAGE_POINTS, type StoryChapterSeed, type StoryStagePointSeed, type StoryStageSeed } from './storyChapterSeeds'
import { STORY_QUEST_INDEX } from './storyQuestIndex'

const talk = (id: string, title: string, description: string, aliases: string[]): QuestStage => ({
  id, title, description, mapIds: [], ocrAliases: aliases,
})

const survive = (id: string, mapId: string, locative: string, accusative: string, extra: string[] = []): QuestStage => ({
  id,
  title: `Выжить на локации ${locative} и выйти или посетить ${accusative} 3 раза`,
  description: `Выйдите с локации ${locative} со статусом «Выжил» / «Проскочил» либо посетите её 3 раза. Конкретной точки нет — вся карта.`,
  mapIds: [mapId],
  progressTotal: 3,
  ocrAliases: [`выжить на локации ${locative.toLowerCase()}`, `посетить ${accusative.toLowerCase()}`, ...extra],
})

/**
 * Curated in-game story stages (Tasks → Story), aligned with the ru Wiki objectives list.
 * Talk / hand-over stages have no map: the app must not invent a point for them.
 */
const CURATED: Record<string, { name: string; aliases?: string[]; stages: QuestStage[] }> = {
  'story-tour': {
    name: 'Тур',
    stages: [
      {
        id: 'story-tour-0',
        title: 'Выбраться из Эпицентра',
        description: 'Выйдите с Эпицентра. По Wiki — выход «Улица Климова» за «Skyside».',
        mapIds: ['ground-zero'],
        ocrAliases: ['выбраться из эпицентра', 'побег с эпицентра'],
        landmarkHints: ['климова', 'skyside'],
      },
      talk('story-tour-1', 'Поговорить с Терапевтом', 'Разговор с Терапевтом в меню торговцев.', ['поговорить с терапевтом']),
      {
        id: 'story-tour-2',
        title: 'Обеспечить доступ на локацию Улицы Таркова',
        description: 'Передайте Терапевту 250 000 ₽ (опционально — собрать сумму). Передача в меню торговца, точки на карте нет.',
        mapIds: [],
        ocrAliases: ['доступ на локацию улицы таркова', 'передать рубли терапевту', 'собрать сумму в 250 000'],
      },
      talk('story-tour-3', 'Поговорить с Барахольщиком', 'Разговор с Барахольщиком в меню торговцев.', ['поговорить с барахольщиком']),
      survive('story-tour-4', 'interchange', 'Развязка', 'Развязку', ['выйти с развязки', 'выйдите с развязки', 'развязку 3 раза']),
      talk('story-tour-5', 'Рассказать Барахольщику о результатах разведки', 'Доклад Барахольщику в меню торговцев.', ['рассказать барахольщику', 'результатах разведки']),
      talk('story-tour-6', 'Поговорить с Лыжником', 'Разговор с Лыжником в меню торговцев.', ['поговорить с лыжником']),
      survive('story-tour-7', 'customs', 'Таможня', 'Таможню', ['таможню 3 раза']),
      {
        id: 'story-tour-8',
        title: 'Передать Лыжнику 5 предметов из категории Стройматериалы',
        description: 'Сдача в меню Лыжника (опционально — найти в рейде). Точки на карте нет.',
        mapIds: [],
        ocrAliases: ['передать лыжнику 5 предметов', 'категории стройматериалы'],
      },
      talk('story-tour-9', 'Поговорить с Механиком', 'Разговор с Механиком в меню торговцев.', ['поговорить с механиком']),
      survive('story-tour-10', 'factory', 'Завод', 'Завод', ['завод 3 раза']),
      {
        id: 'story-tour-11',
        title: 'Передать Механику 2 предмета из категории Оружие',
        description: 'Сдача в меню Механика (опционально — найти в рейде). Точки на карте нет.',
        mapIds: [],
        ocrAliases: ['передать механику 2 предмета', 'категории оружие'],
      },
      talk('story-tour-12', 'Поговорить с Лыжником', 'Повторный разговор с Лыжником в меню торговцев.', ['поговорить с лыжником']),
      {
        id: 'story-tour-13',
        title: 'Убить 3 любые цели на локации Лес',
        description: 'Любые ЧВК или Дикие на Лесу. Конкретной точки нет — вся карта.',
        mapIds: ['woods'],
        progressTotal: 3,
        ocrAliases: ['убить 3 любые цели на локации лес', 'любые цели на локации лес'],
      },
      survive('story-tour-14', 'woods', 'Лес', 'Лес', ['лес 3 раза']),
      {
        id: 'story-tour-15',
        title: 'Найти вход в портовый Терминал',
        description: 'Берег, западный край карты (дальше радиовышки): подход к порту у сторожевой вышки.',
        mapIds: ['shoreline'],
        ocrAliases: ['найти вход в портовый терминал', 'портовый терминал'],
        landmarkHints: ['терминал', 'вышка'],
      },
      {
        id: 'story-tour-16',
        title: 'Найти способ связаться с военными на Терминале',
        description: 'Берег, у входа в порт Терминала.',
        mapIds: ['shoreline'],
        ocrAliases: ['связаться с военными на терминале'],
        landmarkHints: ['терминал', 'интерком'],
      },
      {
        id: 'story-tour-17',
        title: 'Связаться с гарнизоном порта через интерком',
        description: 'Интерком у сторожевой вышки перед Терминалом (западный край Берега).',
        mapIds: ['shoreline'],
        ocrAliases: ['гарнизоном порта через интерком', 'связаться с гарнизоном порта'],
        landmarkHints: ['интерком', 'вышка'],
      },
      talk('story-tour-18', 'Узнать, как выбраться из Таркова', 'Разговоры с торговцами в меню, точки на карте нет.', ['как выбраться из таркова']),
      {
        id: 'story-tour-19',
        title: 'Обеспечить доступ на локацию Резерв',
        description: 'Выжить на Береге и выйти или посетить Берег 3 раза; передать Прапору 5 армейских жетонов (сдача в меню).',
        mapIds: ['shoreline'],
        progressTotal: 3,
        ocrAliases: ['доступ на локацию резерв', 'выжить на локации берег', 'посетить берег', 'армейских жетонов'],
      },
      {
        id: 'story-tour-20',
        title: 'Обеспечить доступ на локацию Маяк',
        description: 'Передать Механику 20 000 долларов (опционально — собрать сумму). Сдача в меню, точки на карте нет.',
        mapIds: [],
        ocrAliases: ['доступ на локацию маяк', '20 000 долларов механику'],
      },
      {
        id: 'story-tour-21',
        title: 'Обеспечить доступ на локацию Лаборатория',
        description: 'Попасть на объект TerraGroup; найти путь отхода через водосток (подвал, у выхода «Накопительный коллектор»); осмотреть серверную (1-й уровень, у ангара); осмотреть офисы топ-менеджеров (O21, 2-й уровень).',
        mapIds: ['the-lab'],
        ocrAliases: ['доступ на локацию лаборатория', 'водосток лаборатории', 'осмотреть серверную', 'офисы топ менеджеров', 'секретный объект terragroup'],
        landmarkHints: ['накопительный коллектор', 'серверн', 'офис'],
      },
    ],
  },
}

/** Stage texts are built from these fragments; uiEnglishGameData.ts translates each of them. */
export const STORY_TEXT = {
  steps: { ru: 'Подзадачи:', en: 'Sub-steps:' },
  optional: { ru: '(опционально)', en: '(optional)' },
  branch: { ru: 'Ветка:', en: 'Branch:' },
  needs: { ru: 'Нужно:', en: 'Needs:' },
  noPoint: { ru: 'Точки на карте нет.', en: 'No map point.' },
  addedFromWiki: { ru: 'Этап добавлен по Wiki.', en: 'Stage added from the wiki.' },
  approximatePoint: { ru: 'Точка на карте поставлена игроками вручную — примерная.', en: 'The map point was placed by players by hand and is approximate.' },
}

/** Stage description in one language, from the seed's structured parts. */
function seedDescription(seed: StoryStageSeed, lang: 'ru' | 'en') {
  const parts: string[] = []
  if (seed.branch) parts.push(`${STORY_TEXT.branch[lang]} ${lang === 'ru' ? STORY_BRANCHES[seed.branch] ?? seed.branch : seed.branch}.`)
  if (seed.steps?.length) {
    parts.push(`${STORY_TEXT.steps[lang]} ${seed.steps.map((step) => `${step[lang]}${step.optional ? ` ${STORY_TEXT.optional[lang]}` : ''}`).join('; ')}.`)
  }
  if (seed.needs) parts.push(`${STORY_TEXT.needs[lang]} ${lang === 'ru' ? STORY_NEEDS[seed.needs] ?? seed.needs : seed.needs}.`)
  if (seed.points?.length) parts.push(STORY_TEXT.approximatePoint[lang])
  else if (!seed.mapIds.length) parts.push(STORY_TEXT.noPoint[lang])
  if (seed.synthetic) parts.push(STORY_TEXT.addedFromWiki[lang])
  return parts.join(' ')
}

/** A sub-step pinned at the parent's spot (a few cm apart in the source) is one point on the map. */
function distinctPoints(points: StoryStagePointSeed[]) {
  const kept: StoryStagePointSeed[] = []
  for (const point of points) {
    if (!kept.some((other) => other.mapId === point.mapId && Math.hypot(other.x - point.x, other.z - point.z) < 3)) kept.push({ ...point })
  }
  return kept
}

function seedStage(chapter: StoryChapterSeed, seed: StoryStageSeed, index: number): QuestStage {
  return {
    id: `story-${chapter.id}-${index}`,
    title: seed.ru,
    description: seedDescription(seed, 'ru'),
    mapIds: [...new Set([...seed.mapIds, ...(seed.points ?? []).map((point) => point.mapId)])],
    optional: seed.optional,
    points: seed.points ? distinctPoints(seed.points) : undefined,
    // The Tasks → Story pane lists sub-objectives under the stage; any of them identifies it.
    ocrAliases: [seed.ru.toLowerCase(), ...(seed.aliases ?? []).map((alias) => alias.toLowerCase()), ...(seed.steps ?? []).map((step) => step.ru.toLowerCase())],
  }
}

for (const chapter of STORY_CHAPTER_SEEDS) {
  CURATED[`story-${chapter.id}`] = { name: chapter.ru, aliases: chapter.aliases, stages: chapter.stages.map((seed, index) => seedStage(chapter, seed, index)) }
}
for (const [index, points] of Object.entries(TOUR_STAGE_POINTS)) {
  const stage = CURATED['story-tour'].stages[Number(index)]
  if (!stage) continue
  stage.points = distinctPoints(points)
  stage.mapIds = [...new Set([...stage.mapIds, ...points.map((point) => point.mapId)])]
}

function curatedFor(quest: Pick<Quest, 'id' | 'name' | 'normalizedName'>) {
  const name = quest.name.trim().toLowerCase().replace(/ё/g, 'е')
  return CURATED[quest.id] ?? CURATED[`story-${quest.normalizedName ?? ''}`]
    ?? Object.values(CURATED).find((entry) => [entry.name, ...(entry.aliases ?? [])].some((alias) => alias.toLowerCase().replace(/ё/g, 'е') === name))
}

export function applyCuratedStoryStages(quests: Quest[]): Quest[] {
  return quests.map((quest) => {
    if (quest.kind !== 'story') return quest
    const curated = curatedFor(quest)
    if (!curated) return quest
    return {
      ...quest,
      name: curated.name,
      stages: curated.stages,
      objectives: curated.stages.filter((stage) => !stage.optional).map((stage) => stage.title),
      mapIds: [...new Set(curated.stages.flatMap((stage) => stage.mapIds))],
      mapId: curated.stages.find((stage) => stage.mapIds[0])?.mapIds[0] ?? quest.mapId,
    }
  })
}

/**
 * Adds the story chapters the catalog does not have (the Russian wiki was unreachable, or the English catalog, which
 * does not load it). Chapters already present (matched by id, name or alias) are left to applyCuratedStoryStages.
 */
export function addMissingStoryChapters(quests: Quest[], locale: 'ru' | 'en' = 'ru'): Quest[] {
  quests = quests.map(quest => {
    const chapter = STORY_QUEST_INDEX.find(row => row.questId === quest.id || `story-${row.id}` === quest.id || row.id === quest.normalizedName)
    const curated = curatedFor(quest)
    if (chapter || curated) {
      const order = chapter?.order ?? [{ id: 'tour', order: 1 }, ...STORY_CHAPTER_SEEDS].find(row => CURATED[`story-${row.id}`] === curated)?.order
      return { ...quest, normalizedName: quest.normalizedName ?? chapter?.id, kind: 'story' as const, storyOrder: order ?? quest.storyOrder }
    }
    const parent = STORY_QUEST_INDEX.find(row => (row.objectiveQuestIds as readonly string[]).includes(quest.id))
    return parent ? { ...quest, storyChapterId: parent.id } : quest
  })
  const missing = [{ id: 'tour', order: 1, en: 'Tour', ru: 'Тур', aliases: ['Tour'] }, ...STORY_CHAPTER_SEEDS]
    .filter((chapter) => !quests.some((quest) => quest.kind === 'story' && curatedFor(quest) === CURATED[`story-${chapter.id}`]))
  return [...quests, ...missing.map((chapter): Quest => {
    const curated = CURATED[`story-${chapter.id}`]
    const mapIds = [...new Set(curated.stages.flatMap((stage) => stage.mapIds))]
    return {
      id: `story-${chapter.id}`,
      normalizedName: chapter.id,
      name: locale === 'en' ? chapter.en : curated.name,
      trader: 'Глава истории',
      kind: 'story',
      storyOrder: chapter.order,
      mapId: mapIds[0],
      mapIds,
      level: 1,
      kappa: false,
      description: 'Сюжетная глава Escape from Tarkov.',
      objectives: curated.stages.filter((stage) => !stage.optional).map((stage) => stage.title),
      stages: curated.stages,
      rewards: [],
      wikiLink: `https://escapefromtarkov.fandom.com/wiki/${encodeURIComponent(chapter.en.replace(/ /g, '_'))}`,
    }
  })]
}

/** RU → EN pairs of every curated story text (chapter names, stage titles, sub-steps, branches, needs). */
export function storyPhrases(): Array<[string, string]> {
  const pairs: Array<[string, string]> = Object.values(STORY_TEXT).map((text): [string, string] => [text.ru, text.en])
  for (const chapter of STORY_CHAPTER_SEEDS) {
    pairs.push([chapter.ru, chapter.en])
    for (const stage of chapter.stages) {
      pairs.push([stage.ru, stage.en])
      // Whole descriptions too, so the English overlay finds them by exact match (fast) instead of phrase by phrase.
      const description = seedDescription(stage, 'ru')
      if (description) pairs.push([description, seedDescription(stage, 'en')])
      for (const step of stage.steps ?? []) pairs.push([step.ru, step.en])
      if (stage.branch) pairs.push([STORY_BRANCHES[stage.branch] ?? stage.branch, stage.branch])
      if (stage.needs) pairs.push([STORY_NEEDS[stage.needs] ?? stage.needs, stage.needs])
    }
  }
  return [...new Map(pairs.filter(([ru]) => /[А-Яа-яЁё]/.test(ru))).entries()]
}
