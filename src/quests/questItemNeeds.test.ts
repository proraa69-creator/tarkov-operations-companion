import { describe, expect, it } from 'vitest'
import type { Quest } from '../domain/types'
import type { TaskAvailability } from '../progression/requirementEngine'
import { questNeeds } from './questItemNeeds'

const quest = (id: string, requirements: NonNullable<Quest['raidRequirements']>, extra: Partial<Quest> = {}): Quest => ({
  id, name: id, trader: 'Терапевт', level: 5, kappa: false, description: '', objectives: [], rewards: [], raidRequirements: requirements, ...extra,
})
const status = (entries: Record<string, TaskAvailability['status']>) => new Map(Object.entries(entries).map(([id, value]) => [id, { status: value, blockers: [] } as TaskAvailability]))
const progress = { taskProgress: {}, faction: 'unknown' as const }

describe('«Квесты»: the items the quests still ask for', () => {
  it('find and hand over of one item are one need; a key counts once per quest; money is left out', () => {
    const syringe = quest('sick', [
      { itemId: 'syringe', count: 5, purpose: 'find', mapIds: [], foundInRaid: true, objectiveId: 'a' },
      { itemId: 'syringe', count: 5, purpose: 'handover', mapIds: [], foundInRaid: true, objectiveId: 'b' },
      { itemId: 'key-1', count: 1, purpose: 'key', mapIds: [] },
      { itemId: '5449016a4bdc2d6f028b456f', count: 100000, purpose: 'handover', mapIds: [], objectiveId: 'c' },
    ])
    const needs = questNeeds([syringe], progress, status({ sick: 'active' }), new Map())
    expect(needs.items.find((need) => need.itemId === 'syringe')).toMatchObject({ total: 5, remaining: 5, foundInRaid: true })
    expect(needs.items.find((need) => need.itemId === 'key-1')).toMatchObject({ total: 1, key: true })
    expect(needs.items.some((need) => need.itemId === '5449016a4bdc2d6f028b456f')).toBe(false)
  })

  it('a completed quest\'s items move to «Собрано»; marked pieces count for the rest; failed quests are left out', () => {
    const quests = [
      quest('done', [{ itemId: 'gpu', count: 2, purpose: 'handover', mapIds: [], objectiveId: 'x' }]),
      quest('later', [{ itemId: 'gpu', count: 3, purpose: 'handover', mapIds: [], objectiveId: 'y' }], { trader: 'Механик' }),
      quest('failed', [{ itemId: 'gpu', count: 9, purpose: 'handover', mapIds: [], objectiveId: 'z' }]),
    ]
    const availability = status({ done: 'completed', later: 'locked', failed: 'failed' })
    const gpu = questNeeds(quests, progress, availability, new Map([['gpu', 1]])).items.find((need) => need.itemId === 'gpu')!
    expect(gpu).toMatchObject({ total: 5, found: 3, remaining: 2 })
    expect(gpu.uses.map((use) => [use.stationId, use.done])).toEqual([['later', false], ['done', true]])
    expect(questNeeds(quests, progress, availability, new Map(), 'Механик').items[0]).toMatchObject({ total: 3, remaining: 3 })
  })

  it('4 500 rounds of ammunition are one item in the totals; the item still shows every round', () => {
    const quests = [quest('sost', [
      { itemId: 'mk318', count: 4500, purpose: 'handover', mapIds: [], objectiveId: 'r' },
      { itemId: 'hk416', count: 15, purpose: 'handover', mapIds: [], objectiveId: 'g' },
    ])]
    const needs = questNeeds(quests, progress, status({ sost: 'active' }), new Map(), undefined, new Set(['mk318']))
    expect(needs).toMatchObject({ total: 16, remaining: 16 })
    expect(needs.items.find((need) => need.itemId === 'mk318')).toMatchObject({ total: 4500, remaining: 4500 })
  })
})
