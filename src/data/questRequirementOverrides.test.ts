import { describe, expect, it } from 'vitest'
import type { AppDataset, Item, MapMarker, Quest } from '../domain/types'
import { describeItem } from '../overlay/itemInfo'
import { aggregateRaidNeeds } from '../shared/raidNeeds'
import { sheetObjectives } from '../progression/sheetObjectives'
import {
  parseQuestRequirementOverrides, questWithRequirements, requirementMatches, withQuestRequirementOverrides, type QuestRequirementOverride,
} from './questRequirementOverrides'

const KEY = '5780cf7f2459777de4559322'
const GPU = '57347ca924597744596b4e71'
const SALEWA = '544fb45d4bdc2dee738b4568'
const item = (id: string, name: string, category: Item['category'] = 'Бартер'): Item => ({ id, name, shortName: name, category, description: '', prices: [], iconUrl: `https://img/${id}.webp` })
const items = [item(KEY, 'Ключ от комнаты 314', 'Ключ'), item(GPU, 'Видеокарта'), item(SALEWA, 'Аптечка Salewa', 'Медицина')]
const quest: Quest = {
  id: 'q1', name: 'Посылка', trader: 'Прапор', description: '', level: 1, kappa: false, rewards: [], objectives: ['Сдать видеокарту'],
  mapIds: ['customs'], requiredItems: [GPU, SALEWA],
  objectiveDetails: [{ id: 'o1', type: 'giveItem', description: 'Сдать видеокарту', count: 1, itemIds: [GPU], mapIds: [] }],
  raidRequirements: [
    { itemId: GPU, count: 1, purpose: 'handover', mapIds: [], foundInRaid: true, objectiveId: 'o1' },
    { itemId: SALEWA, count: 2, purpose: 'bring', mapIds: ['customs'] },
  ],
}
const entry = (over: Partial<QuestRequirementOverride>): QuestRequirementOverride => ({ id: 'a'.repeat(24), questId: 'q1', op: 'add', itemId: KEY, kind: 'key', count: 1, position: 0, ...over })

describe('curated quest requirements (owner, 15.10.2026: «в реальном времени мог добавить требование квеста»)', () => {
  it('adds a new requirement on the quest\'s maps, marked as added by Raid OS', () => {
    const merged = questWithRequirements(quest, [entry({ comment: 'Дверь 314', commentEn: 'Door 314' })])
    expect(merged.raidRequirements?.at(-1)).toEqual({ itemId: KEY, count: 1, purpose: 'key', mapIds: ['customs'], curated: { id: 'a'.repeat(24), kind: 'key', comment: 'Дверь 314' } })
    expect(questWithRequirements(quest, [entry({ comment: 'Дверь 314', commentEn: 'Door 314' })], 'en').raidRequirements?.at(-1)?.curated?.comment).toBe('Door 314')
    // The plain list stays the catalog's: the curated rows show on their own.
    expect(merged.requiredItems).toEqual([GPU, SALEWA])
  })

  it('does not duplicate the catalog: the same item and kind takes the curated count, «найден в рейде» and comment', () => {
    const merged = questWithRequirements(quest, [entry({ itemId: GPU, kind: 'handover', count: 3, foundInRaid: false, comment: 'Любые' })])
    const rows = merged.raidRequirements!.filter((row) => row.itemId === GPU)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ count: 3, foundInRaid: false, purpose: 'handover', objectiveId: 'o1', curated: { kind: 'handover', comment: 'Любые', replaced: true } })
  })

  it('«скрыть» drops the catalog\'s requirement of that item and kind, and the item from the plain list', () => {
    const merged = questWithRequirements(quest, [entry({ op: 'hide', itemId: SALEWA, kind: 'bring' })])
    expect(merged.raidRequirements!.map((row) => row.itemId)).toEqual([GPU])
    expect(merged.requiredItems).toEqual([GPU])
    // Another kind of the same item stays.
    expect(questWithRequirements(quest, [entry({ op: 'hide', itemId: SALEWA, kind: 'find' })]).raidRequirements).toHaveLength(2)
    expect(requirementMatches({ itemId: KEY, purpose: 'mark' }, KEY, 'use')).toBe(true)
  })

  it('a requirement tied to a point counts on the point\'s map and is listed in that point\'s tooltip', () => {
    const point: MapMarker = { id: 'quest-zone-q1-a', mapId: 'shoreline', type: 'quest', layerId: 'quest.zone', title: 'Посылка', description: '', position: [1, 2], questId: 'q1' }
    const dataset = { quests: [quest], items, markers: [point] } as unknown as AppDataset
    const result = withQuestRequirementOverrides(dataset, [entry({ pointId: point.id, count: 1 })])
    expect(result.quests[0].raidRequirements?.at(-1)?.mapIds).toEqual(['shoreline'])
    expect(result.markers[0].hint?.needs).toEqual([{ itemId: KEY, name: 'Ключ от комнаты 314', iconUrl: `https://img/${KEY}.webp`, kind: 'key', count: 1 }])
    expect(withQuestRequirementOverrides(dataset, [])).toBe(dataset)
  })

  it('reaches «Требования рейда» (bring / key / plant / use) and the item overlay (hand-over / find)', () => {
    const merged = questWithRequirements(quest, [
      entry({ kind: 'key' }),
      entry({ id: 'b'.repeat(24), itemId: GPU, kind: 'use', count: 2, position: 1 }),
      entry({ id: 'c'.repeat(24), itemId: SALEWA, kind: 'find', count: 4, foundInRaid: true, position: 2 }),
    ])
    // The Overview's filter (src/pages/DashboardPage.tsx): what to take into the raid on this map.
    const raidPrep = new Set(['place', 'mark', 'key', 'bring'])
    const lines = (merged.raidRequirements ?? []).filter((row) => raidPrep.has(row.purpose) && (!row.mapIds.length || row.mapIds.includes('customs'))).map((row) => ({ ...row, questName: merged.name }))
    expect(aggregateRaidNeeds(lines).map((row) => [row.itemId, row.count])).toEqual(expect.arrayContaining([[KEY, 1], [GPU, 2], [SALEWA, 2]]))
    const info = describeItem(items[2], [merged], { taskProgress: {} })
    expect(info.quests).toEqual([expect.objectContaining({ questId: 'q1', count: 6 })])
    const key = describeItem(items[0], [merged], { taskProgress: {} })
    expect(key.quests[0]).toMatchObject({ purpose: 'ключ', count: 1 })
  })

  it('the quest card under the map shows the description under its objective', () => {
    const sheet = sheetObjectives({ ...quest, pointHints: [{ markerId: 'm', mapId: 'customs', objectiveId: 'o1', title: 'Склад', text: 'За красной дверью' }, { markerId: 'n', mapId: 'customs', objectiveId: 'o1', title: 'Склад', text: 'За красной дверью' }] },
      { mapId: 'customs', maps: [], itemsById: new Map() })
    expect(sheet?.groups[0].objectives[0].hints).toEqual([{ markerId: 'm', title: 'Склад', text: 'За красной дверью' }])
  })

  it('parses the public list; entries an older or newer server sends that it does not know are skipped', () => {
    const parsed = parseQuestRequirementOverrides({ overrides: [
      { ...entry({ position: 2 }), updatedBy: undefined, future: true },
      { ...entry({ id: 'b'.repeat(24), position: 1, itemId: GPU, kind: 'handover' }) },
      { ...entry({ id: 'c'.repeat(24) }), kind: 'teleport' },
      { ...entry({ id: 'd'.repeat(24) }), itemId: '../etc' },
      null,
    ] })
    expect(parsed.map((row) => row.id)).toEqual(['b'.repeat(24), 'a'.repeat(24)])
    expect(parsed[1]).not.toHaveProperty('future')
    expect(parseQuestRequirementOverrides({})).toEqual([])
  })
})
