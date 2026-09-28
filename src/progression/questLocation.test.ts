import { describe, expect, it } from 'vitest'
import { detectAnyMapQuest, questAppliesToMap } from './questLocation'

describe('any-map quests', () => {
  it('treats raid objectives without a location as any-map work', () => {
    expect(detectAnyMapQuest({
      name: 'Гренадёр',
      objectives: [{ type: 'shoot', description: 'Устранить любую цель, используя гранаты' }],
      mapIds: [],
    })).toBe(true)
    expect(detectAnyMapQuest({
      name: 'Санэпиднадзор. Часть 2',
      objectives: [{ type: 'findItem' }, { type: 'giveItem' }],
      mapIds: [],
    })).toBe(true)
  })

  it('keeps trader hand-ins and Arena tasks off the maps', () => {
    expect(detectAnyMapQuest({
      name: 'Друг с Запада. Часть 2',
      objectives: [{ type: 'giveItem', description: 'Передать доллары' }],
      mapIds: [],
    })).toBe(false)
    expect(detectAnyMapQuest({
      name: 'Профпригодность - Часть 2 [PVP ZONE]',
      objectives: [{ type: 'shoot', description: 'Устранить противников на Арене' }],
      mapIds: [],
    })).toBe(false)
    expect(detectAnyMapQuest({
      traderId: '6617beeaa9cfa777ca915b7c',
      name: 'Удержаться в лидерах',
      objectives: [{ type: 'shoot' }],
      mapIds: [],
    })).toBe(false)
  })

  it('applies any-map quests to every location', () => {
    const quest = { id: 'grenadier', name: 'Гренадёр', trader: 'Прапор', anyMap: true, level: 15, kappa: false, description: '', objectives: [], rewards: [] }
    expect(questAppliesToMap(quest, 'customs')).toBe(true)
    expect(questAppliesToMap(quest, 'reserve')).toBe(true)
  })

  it('shows story chapters only on the current stage map', () => {
    const tour = {
      id: 'story-tour',
      kind: 'story' as const,
      name: 'Тур',
      trader: 'Глава истории',
      level: 1,
      kappa: false,
      description: '',
      objectives: [],
      rewards: [],
      mapIds: ['ground-zero', 'interchange', 'customs'],
      stages: [
        { id: 's0', title: 'Эпицентр', description: '', mapIds: ['ground-zero'] },
        { id: 's1', title: 'Разговор', description: '', mapIds: [] },
        { id: 's2', title: 'Развязка', description: '', mapIds: ['interchange'] },
      ],
    }
    expect(questAppliesToMap(tour, 'customs', 2)).toBe(false)
    expect(questAppliesToMap(tour, 'interchange', 2)).toBe(true)
    expect(questAppliesToMap(tour, 'ground-zero', 2)).toBe(false)
    expect(questAppliesToMap(tour, 'interchange', 1)).toBe(false)
    expect(questAppliesToMap(tour, 'ground-zero', 0)).toBe(true)
  })
})
