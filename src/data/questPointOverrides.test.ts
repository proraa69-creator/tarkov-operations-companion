import { describe, expect, it } from 'vitest'
import type { MapMarker, Quest } from '../domain/types'
import { addedOverrideIdOf, OWNER_QUEST_POINT_SOURCE, parseQuestPointOverrides, withQuestPointOverrides, type QuestPointOverride } from './questPointOverrides'
import { questGoals, searchQuests } from '../components/QuestPointEditor'

const zone = (id: string, over: Partial<MapMarker> = {}): MapMarker => ({
  id, mapId: 'customs', type: 'quest', layerId: 'quest.zone', title: 'Дебют', description: 'Ликвидировать Диких', position: [10, 20],
  questId: 'q1', objectiveId: 'o1', meta: 'Прапор · ур. 1', source: 'json.tarkov.dev/tasks', ...over,
})
const boss: MapMarker = { id: 'boss-1', mapId: 'customs', type: 'boss', layerId: 'boss', title: 'Решала', description: '', position: [0, 0] }
const quest = { id: 'q1', name: 'Дебют', normalizedName: 'debut', trader: 'Прапор', level: 1, kappa: true, description: '', objectives: ['Ликвидировать Диких'], rewards: [], objectiveDetails: [{ id: 'o1', type: 'shoot', description: 'Ликвидировать Диких', count: 5 }] } as Quest
const override = (over: Partial<QuestPointOverride>): QuestPointOverride => ({ id: 'a'.repeat(24), questId: 'q1', mapId: 'customs', x: 0, z: 0, kind: 'move', ...over })

describe('quest point overrides', () => {
  it('leaves the markers alone without corrections', () => {
    const markers = [zone('m1'), boss]
    expect(withQuestPointOverrides(markers, [])).toBe(markers)
  })

  it('moves a point (with its area outline and floor), keeps its id', () => {
    const markers = [zone('m1', { outline: [[10, 20], [12, 22], [10, 24]], floor: 'Второй этаж', height: 5 }), zone('m2'), boss]
    const result = withQuestPointOverrides(markers, [override({ markerId: 'm1', x: 120, z: -40 })])
    const moved = result.find((marker) => marker.id === 'm1')!
    expect(moved.position).toEqual([-40, 120])
    expect(moved.outline).toEqual([[-40, 120], [-38, 122], [-40, 124]])
    expect(moved.floor).toBeUndefined()
    expect(moved.height).toBeUndefined()
    expect(result.find((marker) => marker.id === 'm2')!.position).toEqual([10, 20])
    expect(result).toContain(boss)
  })

  it('hides a point and adds an extra one with the text of its objective', () => {
    const markers = [zone('m1'), zone('m2', { description: 'Другая цель', objectiveId: 'o2' })]
    const result = withQuestPointOverrides(markers, [
      override({ markerId: 'm2', kind: 'hide' }),
      override({ id: 'b'.repeat(24), kind: 'add', objectiveId: 'o1', x: 5, z: 6, floor: 'Подвал' }),
    ], [quest])
    expect(result.map((marker) => marker.id)).toEqual(['m1', `owner-quest-${'b'.repeat(24)}`])
    const added = result[1]
    expect(added).toMatchObject({ questId: 'q1', objectiveId: 'o1', position: [6, 5], floor: 'Подвал', title: 'Дебют', description: 'Ликвидировать Диких', layerId: 'quest.zone', source: OWNER_QUEST_POINT_SOURCE })
    expect(addedOverrideIdOf(added)).toBe('b'.repeat(24))
  })

  it('a story stage point keeps its stage index (the map shows the current stage only)', () => {
    const story = { ...quest, id: 'story-tour', name: 'Тур', kind: 'story', stages: [{ id: 's0', title: 'Начало', description: 'Поговорить', mapIds: [] }, { id: 's1', title: 'Найти', description: 'Найти флешку', mapIds: ['customs'] }] } as Quest
    const [added] = withQuestPointOverrides([], [override({ questId: 'story-tour', kind: 'add', stageIndex: 1 })], [story])
    expect(added).toMatchObject({ stageIndex: 1, description: 'Найти флешку', title: 'Тур' })
  })

  it('parses the server answer and drops broken rows', () => {
    expect(parseQuestPointOverrides({ overrides: [
      { id: 'x', questId: 'q', mapId: 'customs', x: 1, z: 2, kind: 'move', markerId: 'm', note: 'по баг-репорту' },
      { id: 'y', questId: 'q', mapId: 'customs', x: 1, z: 2, kind: 'move' },
      { id: 'z', questId: 'q', mapId: 'customs', x: 'far', z: 2, kind: 'add' },
      { id: 'w', questId: 'q', mapId: 'customs', x: 1, z: 2, kind: 'teleport' },
    ] })).toEqual([{ id: 'x', questId: 'q', mapId: 'customs', x: 1, z: 2, kind: 'move', markerId: 'm', note: 'по баг-репорту' }])
    expect(parseQuestPointOverrides(null)).toEqual([])
  })
})

describe('quest point editor search', () => {
  const other = { ...quest, id: 'q2', name: 'Проверка на вшивость', normalizedName: 'checking' } as Quest
  const counts = new Map([['q2', new Map([['customs', 2]])]])
  it('finds a quest by its Russian or English name, quests on this map first', () => {
    expect(searchQuests([quest, other], 'деб', 'customs', counts).map((entry) => entry.id)).toEqual(['q1'])
    expect(searchQuests([quest, other], 'Debut', 'customs', counts).map((entry) => entry.id)).toEqual(['q1'])
    expect(searchQuests([quest, other], 'ве', 'customs', counts).map((entry) => entry.id)).toEqual(['q2'])
    expect(searchQuests([quest, other], 'е', 'customs', counts)).toEqual([])
  })
  it('lists the objectives of a trader quest', () => {
    expect(questGoals(quest, [zone('m1', { objectiveId: 'o9', description: 'Найти' })])).toEqual([{ key: 'o:o1', label: 'Ликвидировать Диких' }, { key: 'o:o9', label: 'Найти' }])
  })
})
