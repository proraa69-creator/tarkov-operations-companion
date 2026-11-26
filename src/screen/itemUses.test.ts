import { describe, expect, it } from 'vitest'
import type { Quest, TaskProgressStatus } from '../domain/types'
import type { Barter } from '../data/economyApi'
import { itemBarterUses, itemQuestUses, needText } from './itemUses'

const quest = (id: string, requirements: NonNullable<Quest['raidRequirements']>, extra: Partial<Quest> = {}): Quest => ({
  id, name: id, trader: 'Терапевт', level: 5, kappa: false, description: '', objectives: [], rewards: [], raidRequirements: requirements, ...extra,
})
const progress = { taskProgress: {}, faction: 'usec' as const }
const statuses = (entries: Record<string, TaskProgressStatus>) => (id: string) => entries[id]

describe('«Тир листы»: what an item is needed for', () => {
  it('lists the quests that have it handed over, planted, marked or opened with, the completed ones last; no failed or other faction\'s quest', () => {
    const quests = [
      quest('Поставка', [
        { itemId: 'gpu', count: 2, purpose: 'find', mapIds: [], foundInRaid: true, objectiveId: 'a' },
        { itemId: 'gpu', count: 2, purpose: 'handover', mapIds: [], foundInRaid: true, objectiveId: 'b' },
        { itemId: 'key', count: 1, purpose: 'key', mapIds: [] },
        { itemId: 'spare-key', count: 1, purpose: 'key', mapIds: [], optional: true },
      ], { level: 20 }),
      quest('Закладка', [{ itemId: 'wifi', count: 1, purpose: 'place', mapIds: [], objectiveId: 'c' }, { itemId: 'marker', count: 1, purpose: 'mark', mapIds: [], objectiveId: 'd' }], { level: 10 }),
      quest('Старый', [{ itemId: 'gpu', count: 1, purpose: 'handover', mapIds: [], objectiveId: 'e' }], { level: 1 }),
      quest('Провал', [{ itemId: 'gpu', count: 9, purpose: 'handover', mapIds: [], objectiveId: 'f' }]),
      quest('Для BEAR', [{ itemId: 'gpu', count: 9, purpose: 'handover', mapIds: [], objectiveId: 'g' }], { faction: 'Bear' }),
      // «сдать любые 9 медикаментов»: not a need of each of them
      quest('Любые', Array.from({ length: 9 }, (_, index) => ({ itemId: index ? `med-${index}` : 'gpu', count: 1, purpose: 'handover' as const, mapIds: [], objectiveId: 'h' }))),
    ]
    const uses = itemQuestUses(quests, progress, statuses({ Старый: 'completed', Провал: 'failed' }))
    expect(uses.get('gpu')?.map((use) => [use.name, use.done])).toEqual([['Поставка', false], ['Старый', true]])
    expect(uses.get('gpu')?.[0]).toMatchObject({ kinds: ['handover', 'find'], count: 2, foundInRaid: true })
    expect(needText(uses.get('gpu')![0], false)).toBe('сдать 2 · FIR')
    expect(needText(uses.get('gpu')![1], false)).toBe('выполнен')
    expect(needText(uses.get('wifi')![0], false)).toBe('заложить')
    expect(needText(uses.get('marker')![0], true)).toBe('mark')
    expect(needText(uses.get('key')![0], false)).toBe('ключ')
    expect(uses.has('spare-key')).toBe(false)
    expect(uses.has('med-1')).toBe(false)
  })

  it('a weapon part: the Gunsmith parts whose build must have it, may have it or takes it in the ready build', () => {
    const build = (weaponId: string, partIds: string[], extra: object = {}) => ({ id: `o-${weaponId}`, type: 'buildWeapon', description: '', count: 1, build: { weaponId, partIds, attributes: [], ...extra } })
    const quests = [
      quest('aks', [], { name: 'Оружейник. АКС-74Н', trader: 'Механик', level: 10, objectiveDetails: [build('aks74n', ['grip'], { anyOfIds: ['stock'], guide: { source: 'wiki', parts: [{ itemId: 'grip', name: 'grip', required: true, sellers: [] }, { itemId: 'muzzle', name: 'muzzle', sellers: [] }] } })] }),
      quest('m4', [], { name: 'Оружейник. M4A1', trader: 'Механик', level: 20, previous: ['aks'], objectiveDetails: [build('m4a1', ['grip'])] }),
    ]
    const uses = itemQuestUses(quests, progress, statuses({ aks: 'completed' }))
    expect(uses.get('grip')?.map((use) => [use.name, use.gunsmith, use.done])).toEqual([['Оружейник. M4A1', 'required', false], ['Оружейник. АКС-74Н', 'required', true]])
    expect(needText(uses.get('stock')![0], false)).toBe('выполнен')
    expect(uses.get('muzzle')?.[0].gunsmith).toBe('build')
    expect(needText({ ...uses.get('muzzle')![0], done: false }, false)).toBe('в сборке')
    expect(needText({ ...uses.get('muzzle')![0], done: false }, true)).toBe('in the build')
    expect(uses.get('aks74n')?.[0].gunsmith).toBe('weapon')
  })

  it('lists the traders\' barters that take the item, by the trader\'s level', () => {
    const barter = (id: string, traderName: string, level: number, requiredItems: Barter['requiredItems']): Barter => ({ id, traderId: traderName, traderName, level, requiredItems, rewardItems: [{ itemId: `${id}-reward`, count: 1 }] })
    const twin = { ...barter('b3', 'Прапор', 3, [{ itemId: 'gpu', count: 2 }]), rewardItems: [{ itemId: 'b2-reward', count: 1 }] }
    const uses = itemBarterUses([barter('b2', 'Прапор', 3, [{ itemId: 'gpu', count: 2 }]), barter('b1', 'Механик', 1, [{ itemId: 'gpu', count: 1 }, { itemId: 'wires', count: 4 }]), twin])
    expect(uses.get('gpu')?.map((use) => [use.trader, use.level, use.count, use.rewardId])).toEqual([['Механик', 1, 1, 'b1-reward'], ['Прапор', 3, 2, 'b2-reward']])
    expect(uses.get('wires')).toHaveLength(1)
  })
})
