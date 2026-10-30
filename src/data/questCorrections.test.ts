import { describe, expect, it } from 'vitest'
import type { Quest } from '../domain/types'
import { applyQuestCorrections } from './questCorrections'

const patriot = (patch: Partial<Quest> = {}): Quest => ({
  id: '64f5deac39e45b527a7c4232', name: 'Работа для патриота', trader: 'Прапор', level: 25, kappa: false, description: '', experience: 18000,
  objectives: ['Убить бойцов ЧВК … на локациях Маяк, Таможня или Резерв'], rewards: ['18 000 опыта', 'Рубли × 165000'], mapId: 'lighthouse', mapIds: ['lighthouse', 'customs', 'reserve'],
  objectiveDetails: [{ id: 'o', type: 'shoot', description: 'old', count: 10, mapIds: ['lighthouse', 'customs', 'reserve'] }],
  ...patch,
})

describe('applyQuestCorrections', () => {
  it('«Работа для патриота»: Streets, Shoreline or Ground Zero, Prapor loyalty 2, 10 000 experience and 200 000 roubles', () => {
    const [quest] = applyQuestCorrections([patriot()], 'ru')
    expect(quest).toMatchObject({ level: 15, experience: 10000, mapIds: ['streets-of-tarkov', 'shoreline', 'ground-zero'], traderLoyalty: { needed: [{ level: 2 }] } })
    expect(quest!.objectives[0]).toContain('Улицы Таркова, Берег или Эпицентр')
    expect(quest!.objectiveDetails![0]).toMatchObject({ count: 10, mapIds: ['streets-of-tarkov', 'shoreline', 'ground-zero'] })
    expect(quest!.rewards).toContain('Рубли × 200000')
    expect(quest!.raidRequirements?.map((entry) => entry.itemId)).toHaveLength(3)
    expect(applyQuestCorrections([patriot()], 'en')[0]!.objectives[0]).toContain('Streets of Tarkov, Shoreline or Ground Zero')
  })

  it('is pinned: a later upstream change does not replace it, and the quest is marked; other quests are left alone', () => {
    const changed = patriot({ experience: 12345, level: 30, mapIds: ['woods'], rewards: ['Рубли × 1'] })
    const [quest] = applyQuestCorrections([changed], 'ru')
    expect(quest).toMatchObject({ level: 15, experience: 10000, mapIds: ['streets-of-tarkov', 'shoreline', 'ground-zero'], manualCorrection: { source: 'tarkov.help', checkedAt: '2026-10-14' } })
    expect(quest!.rewards).toContain('Рубли × 200000')
    const other = patriot({ id: 'other' })
    expect(applyQuestCorrections([other], 'ru')[0]).toBe(other)
  })

  it('«Золотые понты»: no trailer park cabin key any more, the room 303 key stays', () => {
    const swag = patriot({
      id: '5979eee086f774311955e614', name: 'Золотые понты',
      requiredItems: ['593aa4be86f77457f56379f8', '5913611c86f77479e0084092'],
      raidRequirements: [
        { itemId: '593aa4be86f77457f56379f8', count: 1, purpose: 'key', mapIds: ['customs'] },
        { itemId: '5913611c86f77479e0084092', count: 1, purpose: 'key', mapIds: ['customs'] },
      ],
    })
    const [quest] = applyQuestCorrections([swag], 'ru')
    expect(quest!.requiredItems).toEqual(['593aa4be86f77457f56379f8'])
    expect(quest!.raidRequirements?.map((entry) => entry.itemId)).toEqual(['593aa4be86f77457f56379f8'])
  })
})
