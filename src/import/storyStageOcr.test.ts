import { describe, expect, it } from 'vitest'
import { applyCuratedStoryStages } from '../data/storyChapters'
import { matchQuestsFromOcr } from './questOcr'
import { inferStoryStageIndex } from './storyStageOcr'
import type { Quest } from '../domain/types'

const tourBase: Quest = {
  id: 'story-tour',
  kind: 'story',
  name: 'Тур',
  trader: 'Глава истории',
  level: 1,
  kappa: false,
  description: '',
  objectives: [],
  rewards: [],
  stages: [],
}

const tour = applyCuratedStoryStages([tourBase])[0]!

describe('story stage OCR', () => {
  it('detects the Interchange stage from Tasks → Story detail text', () => {
    const text = `
ЗАДАЧИ
СЮЖЕТНЫЕ
Тур
История
АКТИВНО
Главные задачи
Выжить на локации Развязка и выйти или посетить Развязку 3 раза
Опциональные задачи
Посетить Развязку
0/3
`
    expect(inferStoryStageIndex(text, tour)).toBe(4)
    const matches = matchQuestsFromOcr(text, [tour])
    expect(matches[0]?.questId).toBe('story-tour')
    expect(matches[0]?.stageIndex).toBe(4)
  })

  it('treats «выйдите с Развязки» as Tour stage 5 even when Барахольщик is mentioned', () => {
    const text = 'Сюжетные\nТур\nАКТИВНО\nБарахольщик\nГлавные задачи\nВыжить на локации Развязка и выйти или посетить Развязку 3 раза\nПосетить Развязку\n0/3'
    expect(inferStoryStageIndex(text, tour)).toBe(4)
    expect(matchQuestsFromOcr(text, [tour])[0]?.stageIndex).toBe(4)
  })

  it('does not pick «Поговорить с Барахольщиком» when Interchange is the hanging objective', () => {
    const text = 'СЮЖЕТНЫЕ\nТур\nГлавные задачи\nВыжить на локации Развязка и выйти\nОпциональные задачи\nПосетить Развязку'
    expect(inferStoryStageIndex(text, tour)).toBe(4)
  })

  it('does not invent Labyrinth from an unrelated objective line', () => {
    const maze = applyCuratedStoryStages([{
      id: 'story-labyrinth',
      kind: 'story',
      name: 'Лабиринт',
      trader: 'Глава истории',
      level: 1,
      kappa: false,
      description: '',
      objectives: [],
      rewards: [],
      stages: [
        { id: 'm0', title: 'Старт', description: '', mapIds: [] },
        { id: 'm1', title: 'Найти командира отряда', description: '', mapIds: [], ocrAliases: ['найти командира', 'собрать больше информации'] },
      ],
    }])[0]!
    const text = 'СЮЖЕТНЫЕ\nТур\nГлавные задачи\nВыжить на локации Развязка\nНайти командира отряда собрать больше информации'
    const matches = matchQuestsFromOcr(text, [tour, maze])
    expect(matches.map((match) => match.questId)).toEqual(['story-tour'])
    expect(matches.some((match) => match.questId === 'story-labyrinth')).toBe(false)
  })

  it('does not treat a map-column «Лабиринт» as the story chapter', () => {
    const maze: Quest = {
      id: 'story-labyrinth',
      kind: 'story',
      name: 'Лабиринт',
      trader: 'Глава истории',
      level: 1,
      kappa: false,
      description: '',
      objectives: [],
      rewards: [],
      stages: [
        { id: 'm0', title: 'Старт', description: '', mapIds: [] },
        { id: 'm5', title: 'Найти командира отряда', description: '', mapIds: [], ocrAliases: ['найти командира', 'собрать больше информации'] },
      ],
    }
    const text = `
ЗАДАЧИ
ПОБОЧНЫЕ
Дебют
Прапор
Лабиринт
активно!
СЮЖЕТНЫЕ
Тур
Главные задачи
Выйдите с Развязки со статусом выжил
`
    const matches = matchQuestsFromOcr(text, [tour, maze])
    expect(matches.map((match) => match.questId)).toEqual(['story-tour'])
    expect(matches[0]?.stageIndex).toBe(4)
  })

  it('matches Labyrinth only when its chapter title is in the story list', () => {
    const maze: Quest = {
      id: 'story-labyrinth',
      kind: 'story',
      name: 'Лабиринт',
      trader: 'Глава истории',
      level: 1,
      kappa: false,
      description: '',
      objectives: [],
      rewards: [],
      stages: [{ id: 'm0', title: 'Старт', description: '', mapIds: [] }],
    }
    const text = 'СЮЖЕТНЫЕ\nТур\nЛабиринт\nАКТИВНО'
    const matches = matchQuestsFromOcr(text, [tour, maze])
    expect(matches.map((match) => match.questId).sort()).toEqual(['story-labyrinth', 'story-tour'])
  })

  it('keeps earlier stages when Ground Zero escape is shown', () => {
    const text = 'Сюжетные\nТур\nГлавные задачи\nВыбраться из Эпицентра'
    expect(inferStoryStageIndex(text, tour)).toBe(0)
  })

  it('advances past a completed visit counter', () => {
    const text = `
Тур
Главные задачи
Выжить на локации Развязка и выйти или посетить Развязку 3 раза
Посетить Развязку
3/3
Рассказать Барахольщику о разведке
`
    expect(inferStoryStageIndex(text, tour)).toBe(5)
  })
})
