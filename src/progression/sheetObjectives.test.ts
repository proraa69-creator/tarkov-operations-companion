import { describe, expect, it } from 'vitest'
import type { QuestObjective } from '../domain/types'
import { item, progressWith, quest } from '../raidprep/fixtures'
import { sheetObjectives } from './sheetObjectives'

const maps = [
  { id: 'factory', name: 'Завод' }, { id: 'lighthouse', name: 'Маяк' }, { id: 'reserve', name: 'Резерв' },
  { id: 'streets-of-tarkov', name: 'Улицы Таркова' }, { id: 'shoreline', name: 'Берег' }, { id: 'ground-zero', name: 'Эпицентр' }, { id: 'customs', name: 'Таможня' },
]
const objective = (id: string, type: string, description: string, extra: Partial<QuestObjective> = {}): QuestObjective => ({ id, type, description, count: 1, ...extra })
const itemsById = new Map([item('p22', 'P22 (Препарат 22)'), item('antidote', 'Антидот xTG-12')].map((entry) => [entry.id, entry]))
const options = (mapId: string) => ({ mapId, maps, itemsById })

describe('quest card objectives under the map', () => {
  it('«Потрошитель»: one kill per map — every line names its map, the viewed map is marked', () => {
    const butcher = quest('butcher', 'Потрошитель', {
      trader: 'Егерь',
      objectiveDetails: ['factory', 'lighthouse', 'reserve', 'streets-of-tarkov', 'shoreline', 'ground-zero'].map((mapId, index) =>
        objective(`kill-${index}`, 'shoot', `Устранить Диких, используя холодное оружие на локации ${maps.find((map) => map.id === mapId)?.name}`, { mapIds: [mapId === 'factory' ? 'night-factory' : mapId] })),
    })
    const sheet = sheetObjectives(butcher, options('lighthouse'))!
    expect(sheet.showWhere).toBe(true)
    expect(sheet.groups.map((group) => group.title)).toEqual(['В рейде'])
    expect(sheet.groups[0].objectives.map((line) => line.where)).toEqual(['Завод', 'Маяк', 'Резерв', 'Улицы Таркова', 'Берег', 'Эпицентр'])
    expect(sheet.groups[0].objectives.filter((line) => line.here).map((line) => line.where)).toEqual(['Маяк'])
  })

  it('«Инвазивная терапия»: plant on the map, find anywhere and hand over to the trader are separate', () => {
    const therapy = quest('therapy', 'Инвазивная терапия', {
      trader: 'Терапевт',
      objectiveDetails: [
        objective('give-p22', 'giveItem', 'Передать найденный в рейде предмет: P22 (Препарат 22)', { itemIds: ['p22'], foundInRaid: true }),
        objective('find-p22', 'findItem', 'Найти в рейде предмет: P22 (Препарат 22)', { itemIds: ['p22'], foundInRaid: true }),
        objective('give-antidote', 'giveItem', 'Передать найденный в рейде предмет: Антидот xTG-12', { itemIds: ['antidote'], foundInRaid: true }),
        objective('find-antidote', 'findItem', 'Найти в рейде предмет: Антидот xTG-12', { itemIds: ['antidote'], foundInRaid: true }),
        objective('plant-1', 'plantItem', 'Заложить коктейль "Обдолбос" в мед.блок', { itemIds: ['cocktail'], mapIds: ['lighthouse'] }),
        objective('plant-2', 'plantItem', 'Заложить коктейль "Обдолбос" в гостевом зале', { itemIds: ['cocktail'], mapIds: ['lighthouse'] }),
      ],
    })
    const sheet = sheetObjectives(therapy, options('lighthouse'))!
    expect(sheet.groups.map((group) => [group.kind, group.title, group.objectives.length])).toEqual([
      ['place', 'Заложить', 2], ['find', 'Найти в рейде', 2], ['handover', 'Сдать торговцу', 2],
    ])
    expect(sheet.showWhere).toBe(true)
    const [place, find, handover] = sheet.groups
    expect(place.objectives.every((line) => line.where === 'Маяк' && line.here)).toBe(true)
    expect(find.objectives.map((line) => line.where)).toEqual(['Любая карта', 'Любая карта'])
    expect(handover.objectives.map((line) => [line.item, line.where, line.foundInRaid])).toEqual([['P22 (Препарат 22)', null, true], ['Антидот xTG-12', null, true]])
  })

  it('all on one map: no map names on the lines', () => {
    const local = quest('local', 'Местное', { objectiveDetails: [objective('a', 'visit', 'Посетить склад', { mapIds: ['customs'] }), objective('b', 'mark', 'Отметить бензовоз', { mapIds: ['customs'] })] })
    expect(sheetObjectives(local, options('customs'))?.showWhere).toBe(false)
  })

  it('counts, menu conditions, done objectives and quests without details', () => {
    const progress = progressWith({ mixed: 'active' })
    progress.taskProgress.mixed = { ...progress.taskProgress.mixed, objectives: { 'kill-5': { current: 5, target: 5 } } } as never
    const mixed = quest('mixed', 'Смешанный', {
      objectiveDetails: [
        objective('kill-5', 'shoot', 'Устранить 5 Диких на Таможне', { count: 5, mapIds: ['customs'] }),
        objective('kill-any', 'shoot', 'Устранить ЧВК', { count: 3 }),
        objective('level', 'traderLevel', 'Достичь 2 уровня лояльности у Прапора', { count: 1 }),
      ],
    })
    const sheet = sheetObjectives(mixed, { ...options('customs'), progress })!
    const raid = sheet.groups.find((group) => group.kind === 'raid')!
    expect(raid.objectives.map((line) => [line.id, line.count, line.done])).toEqual([['kill-5', undefined, true], ['kill-any', 3, false]])
    expect(sheet.groups.find((group) => group.kind === 'other')?.objectives.map((line) => [line.text, line.where])).toEqual([['Достичь 2 уровня лояльности у Прапора', null]])
    expect(sheetObjectives(quest('plain', 'Без деталей', { objectives: ['Сделать дело'] }), options('customs'))).toBeNull()
  })
})
