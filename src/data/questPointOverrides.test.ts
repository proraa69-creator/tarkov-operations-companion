import { describe, expect, it } from 'vitest'
import type { AppDataset, MapMarker, Quest } from '../domain/types'
import { addedOverrideIdOf, hasPointText, OWNER_QUEST_POINT_SOURCE, parseQuestPointOverrides, withQuestPointHints, withQuestPointOverrides, type QuestPointOverride } from './questPointOverrides'
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

describe('point descriptions «где и что искать» (owner, 15.10.2026)', () => {
  const described = override({ markerId: 'm1', kind: 'describe', x: 999, z: 999, title: 'Склад', description: 'За красной дверью', descriptionEn: 'Behind the red door', note: 'для себя' })

  it('a described original point stays in place and carries the description for players, never the note', () => {
    const [marker] = withQuestPointOverrides([zone('m1')], [described], [quest])
    expect(marker.position).toEqual([10, 20])
    expect(marker.hint).toEqual({ title: 'Склад', text: 'За красной дверью' })
    expect(JSON.stringify(marker)).not.toContain('для себя')
    // English uses its own text; a missing English title falls back to the Russian one.
    expect(withQuestPointOverrides([zone('m1')], [described], [quest], 'en')[0].hint).toEqual({ title: 'Склад', text: 'Behind the red door' })
  })

  it('a moved and an added point carry their descriptions too', () => {
    const result = withQuestPointOverrides([zone('m1')], [
      override({ markerId: 'm1', x: 1, z: 2, description: 'Под лестницей' }),
      override({ id: 'b'.repeat(24), kind: 'add', objectiveId: 'o1', x: 5, z: 6, title: 'Второй тайник' }),
    ], [quest])
    expect(result.map((marker) => [marker.position, marker.hint])).toEqual([[[2, 1], { text: 'Под лестницей' }], [[6, 5], { title: 'Второй тайник' }]])
  })

  it('gathers the descriptions on the quest under its objective / stage; nothing changes without them', () => {
    const markers = withQuestPointOverrides([zone('m1'), zone('m2', { objectiveId: undefined, stageIndex: 1 })], [described, override({ id: 'c'.repeat(24), markerId: 'm2', kind: 'describe', description: 'У маяка' })], [quest])
    const dataset = { quests: [quest], markers } as unknown as AppDataset
    const result = withQuestPointHints(dataset)
    expect(result.quests[0].pointHints).toEqual([
      { markerId: 'm1', mapId: 'customs', objectiveId: 'o1', title: 'Склад', text: 'За красной дверью' },
      { markerId: 'm2', mapId: 'customs', stageIndex: 1, text: 'У маяка' },
    ])
    const plain = { quests: [quest], markers: [zone('m1')] } as unknown as AppDataset
    expect(withQuestPointHints(plain)).toBe(plain)
  })

  it('the public list parses the new kind and fields; unknown kinds and fields are skipped (forward compatibility)', () => {
    const parsed = parseQuestPointOverrides({ overrides: [
      { ...described, futureField: { x: 1 } },
      { ...described, id: 'd'.repeat(24), kind: 'teleport' },
      { ...described, id: 'e'.repeat(24), kind: 'describe', markerId: undefined },
    ] })
    expect(parsed).toHaveLength(1)
    expect(parsed[0]).not.toHaveProperty('futureField')
    expect(parsed[0]).toMatchObject({ kind: 'describe', title: 'Склад', description: 'За красной дверью', descriptionEn: 'Behind the red door' })
    expect(hasPointText(parsed[0])).toBe(true)
    expect(hasPointText(override({}))).toBe(false)
  })
})

describe('the point constructor (owner, 16.10.2026: «ставлю точку, она пустая … можно выбрать любую эмблему»)', () => {
  const three = {
    ...quest, objectives: ['Найти тайник', 'Заложить маяк', 'Выжить и выйти'],
    objectiveDetails: [
      { id: 'o1', type: 'visit', description: 'Найти тайник', count: 1 },
      { id: 'o2', type: 'plantItem', description: 'Заложить маяк', count: 1 },
      { id: 'o3', type: 'extract', description: 'Выжить и выйти', count: 1 },
    ],
  } as Quest
  const item = 'f'.repeat(24)
  const photo = '1'.repeat(24)

  it('BUG «пишется самый первый этап»: a point added to an objective with no points of its own says that objective, never the first one', () => {
    const added = withQuestPointOverrides([zone('m1')], [override({ id: 'b'.repeat(24), kind: 'add', objectiveId: 'o3' })], [three]).at(-1)
    expect(added).toMatchObject({ objectiveId: 'o3', description: 'Выжить и выйти' })
    const [plain] = withQuestPointOverrides([], [override({ id: 'b'.repeat(24), kind: 'add', objectiveId: 'o2' })], [{ ...three, objectiveDetails: undefined, objectiveIds: ['o1', 'o2', 'o3'] }])
    expect(plain.description).toBe('Заложить маяк')
    // No goal picked on a quest of several objectives: nothing but what the owner writes (not the first objective).
    const [empty] = withQuestPointOverrides([], [override({ id: 'b'.repeat(24), kind: 'add' })], [three])
    expect(empty.description).toBe('')
  })

  it('BUG: an original point moved to another objective / stage counts there; the quest emblem may switch to an item', () => {
    const [moved] = withQuestPointOverrides([zone('m1')], [override({ markerId: 'm1', kind: 'describe', objectiveId: 'o2', icon: 'quest.item' })], [three])
    expect(moved).toMatchObject({ id: 'm1', objectiveId: 'o2', layerId: 'quest.item' })
    const [staged] = withQuestPointOverrides([zone('m1', { objectiveId: undefined, stageIndex: 0 })], [override({ markerId: 'm1', kind: 'move', stageIndex: 2 })], [three])
    expect(staged.stageIndex).toBe(2)
  })

  it('a free point (no quest) is drawn with its emblem in that layer, with the owner title, text, items and photos', () => {
    const parsed = parseQuestPointOverrides({ overrides: [
      { id: 'c'.repeat(24), mapId: 'customs', x: 7, z: 8, kind: 'add', icon: 'transit', title: 'Переход', titleEn: 'Transit', description: 'У ворот', itemIds: [item, item, 'bad'], photoIds: [photo] },
      { id: 'd'.repeat(24), mapId: 'customs', x: 7, z: 8, kind: 'add' },
      { id: 'e'.repeat(24), mapId: 'customs', x: 7, z: 8, kind: 'add', icon: 'quest.zone' },
      { id: 'f'.repeat(24), mapId: 'customs', x: 7, z: 8, kind: 'add', icon: 'spawn' },
    ] })
    expect(parsed).toHaveLength(1)
    expect(parsed[0]).toMatchObject({ questId: '', icon: 'transit', itemIds: [item], photoIds: [photo] })
    const [free] = withQuestPointOverrides([], parsed, [], 'en')
    expect(free).toMatchObject({ type: 'extract', layerId: 'transit', title: 'Transit', description: 'У ворот', position: [8, 7], hint: { itemIds: [item], photoIds: [photo] } })
    expect(free.questId).toBeUndefined()
  })

  it('items and photos make a point «described»; the quest sheet gets them named and pictured from the catalog', () => {
    const entry = override({ markerId: 'm1', kind: 'describe', itemIds: [item], photoIds: [photo] })
    expect(hasPointText(entry)).toBe(true)
    const markers = withQuestPointOverrides([zone('m1')], [entry], [quest])
    const dataset = { quests: [quest], markers, items: [{ id: item, name: 'Флешка', iconUrl: 'flash.png' }] } as unknown as AppDataset
    const [hint] = withQuestPointHints(dataset).quests[0].pointHints!
    expect(hint).toMatchObject({ markerId: 'm1', objectiveId: 'o1', items: [{ itemId: item, name: 'Флешка', iconUrl: 'flash.png' }], photoIds: [photo] })
  })
})
