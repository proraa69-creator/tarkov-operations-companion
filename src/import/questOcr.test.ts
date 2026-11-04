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

/** A player's ticket №37, 04.11.2026: «Каратель. Часть 3» with only Part 1 held. The catalog's own order: Part 3 first. */
describe('the number of a quest\'s part is read, never approximated', () => {
  const titled = (names: string[]): Quest[] => names.map((name, index) => ({ id: `part-${index}`, name, trader: 'Тест', level: 1, kappa: false, description: '', objectives: [], rewards: [] }))
  const punisher = titled(['Каратель. Часть 3', 'Каратель. Часть 4', 'Каратель. Часть 5', 'Каратель. Часть 6', 'Каратель. Часть 2', 'Каратель. Часть 1'])
  const read = (text: string, catalog: Quest[]) => matchQuestsFromOcr(text, catalog).map((match) => match.name)

  it('a stroke after «Часть» is a 1', () => {
    for (const stroke of ['|', 'l', 'I', '1']) expect(read(`Каратель. Часть ${stroke} Любая локация активно!`, punisher)).toEqual(['Каратель. Часть 1'])
    expect(read('Каратель. Часть| Берег активно!', punisher)).toEqual(['Каратель. Часть 1'])
    // Not a stroke of a word further on.
    expect(read('Каратель. Часть lec активно!', punisher)).toEqual([])
  })

  it('each number its own part, with the word read wrong too and in every reading', () => {
    for (const number of [1, 2, 3, 4, 5, 6]) {
      expect(read(`Каратель. Часть ${number} Любая локация активно!`, punisher)).toEqual([`Каратель. Часть ${number}`])
      expect(read(`Карагель. Часть ${number} Берег активно!`, punisher)).toEqual([`Каратель. Часть ${number}`])
      expect(read(`Каратель. Частб ${number} Jlec активно!`, punisher)).toEqual([`Каратель. Часть ${number}`])
      expect(read(`Ш Каратель. Чаоть ${number} Таможия активно!`, punisher)).toEqual([`Каратель. Часть ${number}`])
      expect(read(`Каратель. Часть ${number}`, punisher)).toEqual([`Каратель. Часть ${number}`])
    }
  })

  it('a number that cannot be read, or that no part has, names none of several parts', () => {
    for (const lost of ['!', ']', '/', 'i', '7', '$', '']) {
      expect(read(`Каратель. Часть ${lost} Любая локация активно!`, punisher)).toEqual([])
      expect(read(`Каратель. Часть ${lost}`, punisher)).toEqual([])
    }
    expect(read('Каратель Любая локация активно!', punisher)).toEqual([])
  })

  it('the parts ruled out leave no other title alone to take the row', () => {
    const near = titled(['Задержка отправления. Часть 1', 'Задержка отправления. Часть 2', 'Задержка поставки', 'Тарковский стрелок. Часть 1', 'Тарковский стрелок. Часть 2', 'Тарковский мясник'])
    for (const lost of ['!', ']', '$', '']) {
      expect(read(`Задержка отправления. Часть ${lost} Любая локация активно!`, near)).toEqual([])
      expect(read(`Тарковский стрелок. Часть ${lost} Любая локация активно!`, near)).toEqual([])
    }
    expect(read('Задержка поставки Берег активно!', near)).toEqual(['Задержка поставки'])
  })

  it('one part in the catalog leaves no doubt about a lost number, but another number read is another quest', () => {
    const one = titled(['Груз Х. Часть 3'])
    expect(read('Груз Х. Часть $ Берег активно!', one)).toEqual(['Груз Х. Часть 3'])
    expect(read('Груз Х. Часть 3 Берег активно!', one)).toEqual(['Груз Х. Часть 3'])
    expect(read('Груз Х. Часть 2 Берег активно!', one)).toEqual([])
    expect(read('Груз Х. Часть 1з Берег активно!', one)).toEqual([])
  })

  it('the first part the catalog names without a number is «… Часть 1» (the game\'s titles, «Инвентаризация» and «Простая задача»)', () => {
    const inventory = titled(['Инвентаризация. Часть 2', 'Инвентаризация', 'Простая задача', 'Простая задача. Часть 2'])
    for (const row of ['Инвентаризация. Часть 1', 'Инвентаризация. Часть |', 'Инвентаризацня. Часть 1', 'Инвентаризация', 'Инвентаризация Часть l']) {
      expect(read(`${row} Берег активно!`, inventory)).toEqual(['Инвентаризация'])
    }
    expect(read('Инвентаризация. Часть 2 Берег активно!', inventory)).toEqual(['Инвентаризация. Часть 2'])
    expect(read('Инвентаризацня. Часть 2 Берег активно!', inventory)).toEqual(['Инвентаризация. Часть 2'])
    expect(read('Простая задача. Часть | Берег активно!', inventory)).toEqual(['Простая задача'])
    expect(read('Простая задача. Часть 2 Берег активно!', inventory)).toEqual(['Простая задача. Часть 2'])
    // Its number lost: either of the two, so neither.
    expect(read('Инвентаризация. Часть ! Берег активно!', inventory)).toEqual([])
    expect(read('Инвентаризация. Часть 3 Берег активно!', inventory)).toEqual([])
  })

  it('the tag after the number, the English game and a title that only holds the word', () => {
    const tagged = titled(['Вперед, к вершинам! Часть 3 [PVP ZONE]', 'Вперед, к вершинам! Часть 4 [PVP ZONE]', 'Вперёд, к вершинам! – Часть 6 [PVP ZONE]'])
    expect(read('Вперед, к вершинам! Часть 4 [PVP ZONE] Любая локация активно! 50%', tagged)).toEqual(['Вперед, к вершинам! Часть 4 [PVP ZONE]'])
    expect(read('Вперед, к вершннам! Часть 3 [PVP ZONE] Любая локация активно!', tagged)).toEqual(['Вперед, к вершинам! Часть 3 [PVP ZONE]'])
    expect(read('Вперёд, к вершинам! Часть 6 Любая локация активно!', tagged)).toEqual(['Вперёд, к вершинам! – Часть 6 [PVP ZONE]'])
    expect(read('Вперед, к вершинам! Часть | Любая локация активно!', tagged)).toEqual([])
    const english: Quest[] = [{ ...punisher[0]!, id: 'en-2', name: 'Мокрое дело. Часть 2', nameEn: 'Wet Job - Part 2' }, { ...punisher[0]!, id: 'en-1', name: 'Мокрое дело. Часть 1', nameEn: 'Wet Job - Part 1' }]
    expect(read('Wet Job - Part 1 Any location active! 0%', english)).toEqual(['Мокрое дело. Часть 1'])
    expect(read('Wet Job - Part | Any location active! 0%', english)).toEqual(['Мокрое дело. Часть 1'])
    expect(read('Wet Job - Part 2 Any location active! 0%', english)).toEqual(['Мокрое дело. Часть 2'])
    expect(read('Wet Job - Part ] Any location active! 0%', english)).toEqual([])
    const plain = titled(['Запчасти для лодки', 'Секретная часть плана', 'Счастье'])
    expect(read('Запчасти для лодки Берег активно!', plain)).toEqual(['Запчасти для лодки'])
    expect(read('Запчастн для лодки Берег активно!', plain)).toEqual(['Запчасти для лодки'])
    expect(read('Секретная часть плана Берег активно!', plain)).toEqual(['Секретная часть плана'])
    expect(read('Счастье Берег активно!', plain)).toEqual(['Счастье'])
  })
})

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
    const matches = matchQuestsFromOcr('ЗАДАЧИ\nТур\nГлавные задачи\nВыбраться из Эпицентра', story)
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

  it('reads the title that starts a table row beside the icons\' junk and a column read wrong (owner, 03.11.2026: «Аудит» and «Ловкач» in PvP)', () => {
    const catalog: Quest[] = ['Аудит', 'Ловкач', 'Скаут', 'Секта', 'Дверь', 'Снабженец', 'Груз Х', 'Тарковский стрелок. Часть 3'].map((name, index) => ({
      id: `row-${index}`, name, trader: 'Тест', level: 1, kappa: false, description: '', objectives: [], rewards: [],
    }))
    const read = (text: string) => matchQuestsFromOcr(text, catalog).map((match) => [match.name, match.status, match.score])
    // The row's icons read as a letter before the title; the location read in Latin letters, so no column cut it off.
    expect(read('Ш Аудит Развязка активно! 0%')).toEqual([['Аудит', 'active', 1]])
    expect(read('Ловкач Jlec активно! 0%')).toEqual([['Ловкач', 'active', 1]])
    expect(read('я 9, Ловкач Лсс aктивнo!')).toEqual([['Ловкач', 'active', 1]])
    // A letter of the title read wrong: the title only one letter from it, no other within two.
    expect(read('Ауднт Любая локация выполнено!')).toEqual([['Аудит', 'ready', 0.8]])
    expect(read('Тарковскнй стрелок. Часть 3 Jlec Таможия активно!')).toEqual([['Тарковский стрелок. Часть 3', 'active', expect.closeTo(0.96, 2)]])
    // «Jl» for «Л» in the title itself.
    expect(read('JIовкач Лес активно!')).toEqual([['Ловкач', 'active', 1]])
  })

  it('one row names one quest: not the longer title holding its word too, nor a shorter title inside a misread one (03.11.2026)', () => {
    const catalog: Quest[] = ['Компромат', 'Контр-компромат', 'Инвентаризация', 'Инвентаризация. Часть 2', 'Разведка', 'Разведка боем',
      'Ревизия. Резерв', 'Ревизия. Маяк', 'Резерв', 'Каратель. Часть 1', 'Каратель. Часть 6'].map((name, index) => ({
      id: `one-${index}`, name, trader: 'Тест', level: 1, kappa: false, description: '', objectives: [], rewards: [],
    }))
    const read = (text: string) => matchQuestsFromOcr(text, catalog).map((match) => match.name)
    // Read exactly: that quest alone (the word pass added «Контр-компромат» and «Инвентаризация. Часть 2» beside them).
    expect(read('Компромат Эпицентр активно! 0%')).toEqual(['Компромат'])
    expect(read('Инвентаризация Развязка активно!')).toEqual(['Инвентаризация'])
    // A letter read wrong: the title the row starts with, not a shorter one its words hold.
    expect(read('Хонтр-компромат Берег активно! 0%')).toEqual(['Контр-компромат'])
    expect(read('Разведка баем Jlec активно! 0%')).toEqual(['Разведка боем'])
    expect(read('Каратель. Частб 1 Улицы Таркова активно!')).toEqual(['Каратель. Часть 1'])
    // A title holding a map name: the map is no column there.
    expect(read('Ревизия. Резерв Маяк активно! 0%')).toEqual(['Ревизия. Резерв'])
    expect(read('Ш Резерв Маяк активно! 0%')).toEqual(['Резерв'])
  })

  it('does not guess a title the row-start reading cannot tell apart, nor one from a sentence or a row without a status', () => {
    const catalog: Quest[] = ['Аудит', 'Аудиг', 'Дверь', 'Ловкач'].map((name, index) => ({
      id: `near-${index}`, name, trader: 'Тест', level: 1, kappa: false, description: '', objectives: [], rewards: [],
    }))
    // «Ауднт» is one letter from «Аудит» and two from «Аудиг»: either could be meant.
    expect(matchQuestsFromOcr('Ауднт Любая локация активно!', catalog)).toEqual([])
    // A sentence of the quest pane beside a status: the title must start the row, not stand inside it.
    expect(matchQuestsFromOcr('Открыть дверь в подвале Таможня активно!', catalog)).toEqual([])
    // No status cell: not a table row, nothing guessed from its start.
    expect(matchQuestsFromOcr('Ловкач Jlec', catalog)).toEqual([])
    // A story chapter's row is no trader quest, however close.
    const story: Quest = { id: 'story-x', kind: 'story', name: 'Ловкачи', trader: 'Глава истории', level: 1, kappa: false, description: '', objectives: [], rewards: [] }
    expect(matchQuestsFromOcr('Ловкачи Jlec активно!', [...catalog, story]).filter((match) => match.questId !== story.id)).toEqual([])
  })

  it('recovers screenshot titles from noisy live OCR', () => {
    const names = matchQuestsFromOcr(NOISY_OCR, screenshotQuests).map((match) => match.name)
    expect(names).toEqual(expect.arrayContaining(SCREENSHOT_TITLES))
    expect(names).toHaveLength(SCREENSHOT_TITLES.length)
  })
})
