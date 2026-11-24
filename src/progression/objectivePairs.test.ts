import { describe, expect, it } from 'vitest'
import type { MapMarker, Quest, QuestObjective } from '../domain/types'
import { pairedFindObjective, SAME_PLACE } from './objectivePairs'

const objective = (id: string, type: string, description: string, mapIds = ['streets']): QuestObjective => ({ id, type, description, count: 1, mapIds })
const point = (questId: string, objectiveId: string, x: number, y = 0, extra: Partial<MapMarker> = {}): MapMarker => ({
  id: `${objectiveId}-${x}`, mapId: 'streets', type: 'quest', title: '', description: '', position: [x, y], questId, objectiveId, ...extra,
})
const quest = (objectiveDetails: QuestObjective[]) => ({ id: 'q', objectiveDetails }) as Pick<Quest, 'id' | 'objectiveDetails'>

describe('the find that goes with a mark or a plant', () => {
  // The real «Финансовая пирамида»: the mark comes first, its find third; the first group of ATMs stands 17 m away.
  const pyramid = quest([
    objective('mark', 'mark', 'Пометить банкомат на Улице Климова Маркером MS2000'),
    objective('group', 'visit', 'Найти первую группу банкоматов на улице Климова'),
    objective('inside', 'visit', 'Найти первый банкомат внутри ТД Климова'),
    objective('atm', 'visit', 'Найти первый банкомат на улице Климова'),
    objective('third', 'visit', 'Найти третий банкомат на улице Климова'),
  ])
  const pyramidPoints = [point('q', 'mark', 100), point('q', 'atm', 100.4), point('q', 'group', 117), point('q', 'inside', 334), point('q', 'third', 183)]

  it('is the nearest one at the same place, wherever it stands in the list', () => {
    expect(pairedFindObjective(pyramid, 'mark', pyramidPoints)).toBe('atm')
  })

  it('a find does not close anything, nor does an objective the quest does not have', () => {
    expect(pairedFindObjective(pyramid, 'atm', pyramidPoints)).toBeUndefined()
    expect(pairedFindObjective(pyramid, 'nope', pyramidPoints)).toBeUndefined()
  })

  it('is no find at all when the nearest one stands elsewhere', () => {
    const far = quest([objective('find', 'visit', 'Найти лодку'), objective('plant', 'plantItem', 'Заложить в лодке')])
    expect(pairedFindObjective(far, 'plant', [point('q', 'plant', 0), point('q', 'find', SAME_PLACE + 1)])).toBeUndefined()
    expect(pairedFindObjective(far, 'plant', [point('q', 'plant', 0), point('q', 'find', SAME_PLACE)])).toBe('find')
  })

  it('takes each «Пометить» to its own «Найти»: four armoured vehicles, in order of the list or not', () => {
    const revision = quest([
      objective('find-1', 'visit', 'Найти первую БМП-2'), objective('find-2', 'visit', 'Найти вторую БМП-2'),
      objective('mark-1', 'mark', 'Пометить первую БМП-2'), objective('mark-2', 'mark', 'Пометить вторую БМП-2'),
    ])
    const points = [point('q', 'find-1', 0), point('q', 'mark-1', 0.4), point('q', 'find-2', 300), point('q', 'mark-2', 300.2)]
    expect(pairedFindObjective(revision, 'mark-1', points)).toBe('find-1')
    expect(pairedFindObjective(revision, 'mark-2', points)).toBe('find-2')
  })

  it('«один из особых грузов», with points all over the map, has no one find', () => {
    const cargo = quest([objective('find', 'visit', 'Найти второй особый груз'), objective('mark', 'mark', 'Найти и пометить один из особых грузов')])
    expect(pairedFindObjective(cargo, 'mark', [point('q', 'find', 0), point('q', 'mark', 0, 0, { id: 'a' }), point('q', 'mark', 400, 0, { id: 'b' })])).toBeUndefined()
  })

  it('without a point: the find right before it, unless the words say another', () => {
    const noPoints = quest([objective('find', 'visit', 'Найти транспорт с реагентом'), objective('mark', 'mark', 'Пометить транспорт Маркером MS2000')])
    expect(pairedFindObjective(noPoints, 'mark', [])).toBe('find')
    const trucks = quest([
      objective('first', 'visit', 'Найти первый грузовик'), objective('second', 'visit', 'Найти второй грузовик'),
      objective('mark-1', 'mark', 'Найти и пометить первый грузовик'), objective('mark-2', 'mark', 'Найти и пометить второй грузовик'),
    ])
    expect(pairedFindObjective(trucks, 'mark-1', [])).toBe('first')
    expect(pairedFindObjective(trucks, 'mark-2', [])).toBe('second')
    const other = quest([objective('first', 'visit', 'Найти первый грузовик'), objective('mark', 'mark', 'Найти и пометить второй грузовик')])
    expect(pairedFindObjective(other, 'mark', [])).toBeUndefined()
  })

  it('only on its own map, and an approximate point is no place', () => {
    const maps = quest([objective('find', 'visit', 'Найти склад', ['customs']), objective('mark', 'mark', 'Пометить склад')])
    expect(pairedFindObjective(maps, 'mark', [point('q', 'mark', 0), point('q', 'find', 1)])).toBeUndefined()
    const fuzzy = quest([objective('group', 'visit', 'Найти склад первый'), objective('near', 'visit', 'Найти склад'), objective('mark', 'mark', 'Пометить склад')])
    expect(pairedFindObjective(fuzzy, 'mark', [point('q', 'mark', 0), point('q', 'group', 0.5, 0, { approximate: true }), point('q', 'near', 5)])).toBe('near')
  })
})
