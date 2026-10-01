import { describe, expect, it } from 'vitest'
import { buildRaidBriefing } from './briefing'
import { item, marker, progressWith, quest } from './fixtures'

const items = [item('key-206', 'Ключ 206'), item('ms2000', 'MS2000'), item('gas', 'Газоанализатор'), item('flash', 'Флешка')]
const quests = [
  quest('q1', 'Проверка', {
    trader: 'Прапор', mapIds: ['customs'], level: 5,
    objectiveDetails: [
      { id: 'o1', type: 'visit', description: 'Найти склад на Таможне', mapIds: ['customs'] },
      { id: 'o2', type: 'visit', description: 'Осмотреть Лес', mapIds: ['woods'] },
      { id: 'o3', type: 'giveItem', description: 'Сдать флешку', mapIds: [] },
    ],
    raidRequirements: [
      { itemId: 'key-206', count: 1, purpose: 'key', mapIds: ['customs'] },
      { itemId: 'ms2000', count: 1, purpose: 'mark', mapIds: ['customs'], alternatives: 1 },
      { itemId: 'gas', count: 2, purpose: 'find', mapIds: ['customs'], foundInRaid: true, alternatives: 1 },
      { itemId: 'gas', count: 2, purpose: 'find', mapIds: ['woods'], alternatives: 1 },
    ],
  }),
  quest('q2', 'Дальнобойщик', { trader: 'Терапевт', mapIds: ['customs'], objectives: ['Доехать'] }),
  quest('q3', 'Везде', { trader: 'Прапор', anyMap: true, objectives: ['Убить 5 диких'], level: 1 }),
  quest('q4', 'Лесное', { trader: 'Прапор', mapIds: ['woods'] }),
  quest('q5', 'Не принято', { trader: 'Лыжник', mapIds: ['customs'] }),
]

describe('buildRaidBriefing', () => {
  const progress = progressWith({ q1: 'active', q2: 'active', q3: 'active', q4: 'active' })
  const briefing = buildRaidBriefing({ mapId: 'customs', quests, items, markers: [marker('door', [0, 0], { questId: 'q2', lock: { keyId: 'flash', keyName: 'Флешка' } })], progress })

  it('groups the current quests of the map by trader, map quests before «any map»', () => {
    expect(briefing.questCount).toBe(3)
    expect(briefing.groups.map((group) => [group.trader, group.quests.map((entry) => entry.quest.id)])).toEqual([
      ['Прапор', ['q1', 'q3']],
      ['Терапевт', ['q2']],
    ])
  })

  it('keeps only objectives of this map (and those without a map)', () => {
    expect(briefing.groups[0].quests[0].objectives).toEqual(['Найти склад на Таможне', 'Сдать флешку'])
    expect(briefing.groups[1].quests[0].objectives).toEqual(['Доехать'])
  })

  it('lists items to find here, to bring, and keys (with locked quest doors)', () => {
    expect(briefing.find.map((row) => [row.itemId, row.count, row.foundInRaid])).toEqual([['gas', 2, true]])
    expect(briefing.bring.map((row) => row.itemId)).toEqual(['ms2000'])
    expect(briefing.keys.map((row) => [row.itemId, row.questNames])).toEqual([['key-206', ['Проверка']], ['flash', ['Дальнобойщик']]])
  })

  it('is empty for a map without current quests', () => {
    const empty = buildRaidBriefing({ mapId: 'lighthouse', quests: quests.filter((entry) => !entry.anyMap), items, markers: [], progress })
    expect(empty.groups).toEqual([])
    expect(empty.questCount).toBe(0)
  })
})
