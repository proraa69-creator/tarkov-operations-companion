import { describe, expect, it } from 'vitest'
import { buildRaidBriefing } from './briefing'
import { item, marker, progressWith, quest } from './fixtures'

const items = [item('key-206', 'Ключ 206'), item('ms2000', 'MS2000'), item('gas', 'Газоанализатор'), item('flash', 'Флешка')]
const quests = [
  quest('q1', 'Проверка', {
    trader: 'Прапор', mapIds: ['customs'], level: 5,
    objectiveDetails: [
      { id: 'o1', type: 'visit', description: 'Найти склад на Таможне', count: 1, mapIds: ['customs'] },
      { id: 'o2', type: 'visit', description: 'Осмотреть Лес', count: 1, mapIds: ['woods'] },
      { id: 'o3', type: 'giveItem', description: 'Сдать флешку', count: 1, mapIds: [] },
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

  // Owner, 06.11.2026: a key is not needed once the objective it opens is ticked.
  it('drops a key and a locked door once their objective is ticked, and brings them back with the tick', () => {
    const room = quest('room', 'Кабинет', {
      mapIds: ['customs'],
      objectiveDetails: [{ id: 'xray', type: 'visit', description: 'Кабинет', count: 1, mapIds: ['customs'] }, { id: 'hall', type: 'visit', description: 'Коридор', count: 1, mapIds: ['customs'] }],
      raidRequirements: [{ itemId: 'key-206', count: 1, purpose: 'key', mapIds: ['customs'], objectiveId: 'xray' }],
    })
    const keysWith = (objectiveProgress: object) => buildRaidBriefing({
      mapId: 'customs', quests: [room], items,
      markers: [marker('door', [0, 0], { questId: 'room', objectiveId: 'xray', lock: { keyId: 'flash', keyName: 'Флешка' } })],
      progress: { ...progressWith({ room: 'active' }), objectiveProgress: objectiveProgress as never },
    }).keys.map((row) => row.itemId)
    expect(keysWith({})).toEqual(['key-206', 'flash'])
    expect(keysWith({ hall: { current: 1, target: 1 } })).toEqual(['key-206', 'flash'])
    expect(keysWith({ xray: { current: 1, target: 1 } })).toEqual([])
    expect(keysWith({ xray: { current: 0, target: 1 } })).toEqual(['key-206', 'flash'])
  })

  it('splits zone-bound objectives (map points) from the checklist', () => {
    const typed = quest('q6', 'Разведка', {
      trader: 'Механик', mapIds: ['customs'],
      objectiveDetails: [
        { id: 'p1', type: 'mark', description: 'Отметить бензовоз', count: 1, mapIds: ['customs'], zoneBound: true },
        { id: 'p2', type: 'shoot', description: 'Убить 5 диких', mapIds: ['customs'], count: 5 },
        { id: 'p3', type: 'giveItem', description: 'Сдать маркер', count: 1, mapIds: [] },
        { id: 'p4', type: 'visit', description: 'Посетить Лес', count: 1, mapIds: ['woods'], zoneBound: true },
      ],
    })
    const result = buildRaidBriefing({ mapId: 'customs', quests: [typed], items, markers: [], progress: progressWith({ q6: 'active' }) })
    const entry = result.groups[0].quests[0]
    expect(entry.points.map((objective) => [objective.type, objective.description])).toEqual([['mark', 'Отметить бензовоз']])
    expect(entry.checklist.map((objective) => [objective.type, objective.count])).toEqual([['shoot', 5], ['giveItem', undefined]])
  })

  it('drops objectives already done when per-objective progress is present', () => {
    const typed = quest('q7', 'Две цели', {
      mapIds: ['customs'],
      objectiveDetails: [
        { id: 'a', type: 'visit', description: 'Первая', count: 1, mapIds: ['customs'], zoneBound: true },
        { id: 'b', type: 'visit', description: 'Вторая', count: 1, mapIds: ['customs'], zoneBound: true },
      ],
    })
    const progress = progressWith({ q7: 'active' })
    Object.assign(progress, { objectiveProgress: { a: { current: 1, target: 1 } } })
    const result = buildRaidBriefing({ mapId: 'customs', quests: [typed], items, markers: [], progress })
    expect(result.groups[0].quests[0].objectives).toEqual(['Вторая'])
  })

  it('is empty for a map without current quests', () => {
    const empty = buildRaidBriefing({ mapId: 'lighthouse', quests: quests.filter((entry) => !entry.anyMap), items, markers: [], progress })
    expect(empty.groups).toEqual([])
    expect(empty.questCount).toBe(0)
  })
})

// Report №90: «ключ 219 или ключ 220» — one key in the list, the other named under it.
describe('either key of a door in the briefing', () => {
  const keys = [item('k219', 'Ключ 219'), item('k220', 'Ключ 220')]
  const either = quest('e1', 'Энергия', {
    trader: 'Механик', mapIds: ['shoreline'],
    raidRequirements: [
      { itemId: 'k219', count: 1, purpose: 'key', mapIds: ['shoreline'], objectiveId: 'gen', alternatives: 2 },
      { itemId: 'k220', count: 1, purpose: 'key', mapIds: ['shoreline'], objectiveId: 'gen', alternatives: 2 },
    ],
  })

  it('lists one of them with the other as «или»', () => {
    const briefing = buildRaidBriefing({ mapId: 'shoreline', quests: [either], items: keys, markers: [], progress: progressWith({ e1: 'active' }) })
    expect(briefing.keys.map((row) => [row.itemId, row.or?.map((other) => other.itemId)])).toEqual([['k219', ['k220']]])
  })

  it('takes the key another door needs anyway, alone', () => {
    const other = quest('e2', 'Другое', { trader: 'Прапор', mapIds: ['shoreline'], raidRequirements: [{ itemId: 'k220', count: 1, purpose: 'key', mapIds: ['shoreline'] }] })
    const briefing = buildRaidBriefing({ mapId: 'shoreline', quests: [either, other], items: keys, markers: [], progress: progressWith({ e1: 'active', e2: 'active' }) })
    expect(briefing.keys.map((row) => [row.itemId, row.or, row.questNames])).toEqual([['k220', undefined, ['Другое', 'Энергия']]])
  })
})
