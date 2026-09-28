import type { Quest, QuestStage } from '../domain/types'

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
const CURATED: Record<string, { name: string; stages: QuestStage[] }> = {
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
        description: 'Берег, юго-восток: подход к порту у сторожевой вышки.',
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
        description: 'Интерком у сторожевой вышки перед Терминалом (юго-восток Берега).',
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

export function applyCuratedStoryStages(quests: Quest[]): Quest[] {
  return quests.map((quest) => {
    if (quest.kind !== 'story') return quest
    const curated = CURATED[quest.id] ?? CURATED[`story-${quest.normalizedName ?? ''}`]
      ?? Object.values(CURATED).find((entry) => entry.name.toLowerCase() === quest.name.toLowerCase())
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
