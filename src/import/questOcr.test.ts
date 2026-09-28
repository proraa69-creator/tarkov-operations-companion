import { describe, expect, it } from 'vitest'
import type { Quest } from '../domain/types'
import { applyCuratedStoryStages } from '../data/storyChapters'
import { matchQuestsFromOcr } from './questOcr'

const quests: Quest[] = [
  { id: '5a27bbf886f774333a418eeb', name: 'Мокрое дело. Часть 2', trader: 'Миротворец', level: 8, kappa: true, description: '', objectives: [], rewards: [] },
  { id: 'debut', name: 'Дебют', trader: 'Прапор', level: 1, kappa: true, description: '', objectives: [], rewards: [] },
  { id: 'checking', name: 'Проверка', trader: 'Прапор', level: 2, kappa: true, description: '', objectives: [], rewards: [] },
]

const SCREENSHOT_TITLES = [
  'Витамины',
  'Тарковский стрелок. Часть 3',
  'Красиво жить не запретишь',
  'Авторем',
  'Супервайзер',
  'Тарковский мясник',
  'Почтальон Печкин. Часть 2',
  'Захват аванпоста',
  'Здоровая альтернатива',
  'Посылка из прошлого',
  'Обновка. Часть 1',
  'Перехват инициативы',
  'Легкотня',
  'Новое начало',
  'Подчистить хвосты',
  'Шить – не тужить. Часть 1',
  'Благотворительность',
  'Сельпо',
  'Врачебная тайна. Часть 1',
  'Дела на Арене [PVP ZONE]',
  'Рыбное место',
  'Выпивка',
  'Путь выживальщика. Контролёр',
  'Вперед, к вершинам! Часть 4 [PVP ZONE]',
  'Оружейник. АКС-74Н',
  'Водохлёб. Курьер',
  'Работа для патриота',
  'Ностальгия',
  'Мокрое дело. Часть 2',
  'Дипломатия по-тарковски',
  'Металлолом',
  'Гуманитарка',
  'Ищейка',
  'Мастер-ключ',
  'Чужое добро',
  'Кабинет химика',
]

const screenshotQuests: Quest[] = SCREENSHOT_TITLES.map((name, index) => ({
  id: `shot-${index}`,
  name,
  trader: 'Тест',
  level: 1,
  kappa: false,
  description: '',
  objectives: [],
  rewards: [],
}))

const CLEAN_TABLE = `
ЗАДАНИЯ ПОБОЧНЫЕ
Торговец Тип Класс Задание Локация Статус Прогресс
Витамины Любая локация активно! 66%
Тарковский стрелок. Часть 3 Любая локация активно! 0%
Красиво жить не запретишь Любая локация активно! 66%
Авторем Любая локация активно! 31%
Супервайзер Любая локация активно! 0%
Тарковский мясник Любая локация активно! 0%
Почтальон Печкин. Часть 2 Любая локация активно! 0%
Захват аванпоста Любая локация активно! 25%
Здоровая альтернатива Любая локация активно! 0%
Посылка из прошлого Любая локация активно! 0%
Обновка. Часть 1 Любая локация активно! 18%
Перехват инициативы Любая локация активно! 0%
Легкотня Любая локация активно! 0%
Новое начало Любая локация активно! 66%
Подчистить хвосты Любая локация активно! 0%
Шить – не тужить. Часть 1 Любая локация активно! 50%
Благотворительность Любая локация активно! 60%
Сельпо Любая локация активно! 46%
Врачебная тайна. Часть 1 Берег активно! 75%
Дела на Арене [PVP ZONE] Любая локация активно! 33%
Рыбное место Любая локация активно! 0%
Выпивка Любая локация активно! 42%
Путь выживальщика. Контролёр Любая локация активно! 0%
Вперед, к вершинам! Часть 4 [PVP ZONE] Любая локация активно! 50%
Оружейник. АКС-74Н Любая локация активно! 0%
Водохлёб. Курьер Любая локация активно! 0%
Работа для патриота Любая локация активно! 0%
Ностальгия Берег активно! 0%
Мокрое дело. Часть 2 Берег активно! 50%
Дипломатия по-тарковски Берег активно! 0%
Металлолом Берег активно! 33%
Гуманитарка Берег активно! 45%
Ищейка Берег активно! 0%
Мастер-ключ Берег активно! 0%
Чужое добро Берег активно! 80%
Кабинет химика Берег активно! 0%
`

const NOISY_OCR = `
и Посылка из прошлого oni ae
O6HosKa Часть 1 Любая ni
Перехват инициативы Любая ni
Легкотня Любая ni
Новое начало Любая ni
Подчистить хвосты Любая л
Wht — не тужить. Часть 1 Любая ni
Благотворительность Любая ni
Сельпо Любая локация активно!
Врачебная Ee
Дела на Арене [PVP ZONE] Любая
Рыбное место Любая ni
Выпивка Любая л
Путь выживальщика. Контролёр Любая л
Ваеред, к вершинам! Часть 4 [PVP ZONE] Любая ni
Оружейник. АКС-74Н Любая л
Водохлёб. Курьер Любая ni
Работа для патриота
9 ностальгия Берег активно!
Moxpoe дело. Часть 2 Берег
Дипломатия по-тарковски Берег
Металлолом Берег
Гуманитарка Берег
Ищейка Берег
Мастер-ключ Берег
чужое добро Берег
Кабинет химика
визмины Любая локация активно
Tapxoackwii стрелок. Часть $ Любая локация активно!
красиво жить не запретишь Любая локация активно!
Автором Любая локация активно!
супервайзер Любая локация активно!
Тарковский мясник Любая локация активно!
Почтальон Печкин. Часть 2 Любая локация активно!
Захват эванлоста Любая локация активно!
Здоровая альтернатива Любая локация активно!
`

describe('quest OCR matching', () => {
  it('matches noisy Russian quest titles from a tasks screenshot', () => {
    const text = `
      ЗАДАЧИ
      Мокрое дело Часть 2
      Дебют
      Прапор
    `
    expect(matchQuestsFromOcr(text, quests).map((match) => match.name)).toEqual(expect.arrayContaining(['Мокрое дело. Часть 2', 'Дебют']))
    expect(matchQuestsFromOcr(text, quests)).toHaveLength(2)
  })

  it('matches a story chapter name and its current stage line', () => {
    const story: Quest[] = applyCuratedStoryStages([{
      id: 'story-tour',
      kind: 'story',
      name: 'Тур',
      trader: 'Глава истории',
      level: 1,
      kappa: false,
      description: '',
      objectives: [],
      rewards: [],
      stages: [
        { id: 's0', title: 'Побег с Эпицентра', description: '', mapIds: ['ground-zero'] },
        { id: 's1', title: 'Терминал', description: '', mapIds: ['shoreline'] },
      ],
    }])
    const matches = matchQuestsFromOcr('ЗАДАЧИ\nТур\nВыбраться из Эпицентра', story)
    expect(matches).toHaveLength(1)
    expect(matches[0]?.questId).toBe('story-tour')
    expect(matches[0]?.stageIndex).toBe(0)
  })

  it('ignores chrome labels and does not invent locked catalog quests', () => {
    const text = 'Текущие\nНедоступные\nНайти\nКарта'
    expect(matchQuestsFromOcr(text, quests)).toEqual([])
  })

  it('reads every title from the in-game Tasks table into current matches', () => {
    const names = matchQuestsFromOcr(CLEAN_TABLE, screenshotQuests).map((match) => match.name).sort((a, b) => a.localeCompare(b, 'ru'))
    expect(names).toEqual([...SCREENSHOT_TITLES].sort((a, b) => a.localeCompare(b, 'ru')))
  })

  it('does not invent short quests from words inside sentences', () => {
    const short: Quest[] = ['Дверь', 'Резерв', 'Секта', 'Бункер', 'Скаут', 'Разведка', 'Разведка боем'].map((name, index) => ({
      id: `short-${index}`, name, trader: 'Тест', level: 1, kappa: false, description: '', objectives: [], rewards: [],
    }))
    const text = 'ЗАДАНИЯ\nОткрыть дверь в подвале\nВыжить и выйти с локации Резерве\nНа складе сидит сектант у двери\nКлюч от бункера\nРазведка боем Лабиринт Активно'
    expect(matchQuestsFromOcr(text, short).map((match) => match.name)).toEqual(['Разведка боем'])
  })

  it('recovers screenshot titles from noisy live OCR', () => {
    const names = matchQuestsFromOcr(NOISY_OCR, screenshotQuests).map((match) => match.name)
    expect(names).toEqual(expect.arrayContaining(SCREENSHOT_TITLES))
    expect(names).toHaveLength(SCREENSHOT_TITLES.length)
  })
})
